import { Component, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { ActionSheetController, ToastController } from '@ionic/angular/standalone';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { Geolocation } from '@capacitor/geolocation';
import { App } from '@capacitor/app';
import { Subscription } from 'rxjs';
import { ApiService } from '../services/api';
import { SignalrService, getCurrentUserId } from '../services/signalr';
import { environment } from 'src/environments/environment';

interface VehicleOption {
  category: string;
  vehicleType: string;
  estimatedFare: number;
  availableNearby: number;
  etaMinutes: number;
}

type BookingState = 'address' | 'selecting' | 'searching' | 'noRiders' | 'accepted' | 'started' | 'completed' | 'cancelled';

const VEHICLE_ICONS: Record<string, string> = {
  'Bike EV': '⚡',
  'Scooter': '🛵',
  'Motor Bike': '🏍️',
  'Car Mini': '🚗',
  'Car Sedan': '🚘',
  'Car SUV': '🚙',
  'Car Prime': '🚖',
  'Car XL': '🚐',
  'Auto': '🛺'
};

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent]
})
export class HomePage implements OnInit, AfterViewInit, OnDestroy {
  readonly categories = ['Bike', 'Auto', 'Car'];

  @ViewChild('pickupInput') pickupInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('dropInput') dropInputRef!: ElementRef<HTMLInputElement>;

  pickup: { lat: number; lng: number; address: string } | null = null;
  drop: { lat: number; lng: number; address: string } | null = null;

  // Service-area geofence: is the chosen pickup in a city we serve?
  serviceable = true;
  serviceMessage = '';

  vehicleOptions: VehicleOption[] = [];
  selectedVehicleType: string | null = null;
  loadingOptions = false;

  state: BookingState = 'address';
  activeRide: any = null;
  driverInfo: any = null;
  statusMessage = '';

  rating = 0;
  feedback = '';
  locationDenied = false;

  // ── menu / nav ──
  menuOpen = false;
  appVersion = environment.appVersion;

  // ── saved places ──
  savedPlaces: any[] = [];

  // ── scheduling ──
  scheduleEnabled = false;
  scheduledTime = '';

  // ── promo ──
  promoCode = '';
  promoMessage = '';
  promoValid = false;
  promoDiscount = 0;
  validatingPromo = false;
  availableOffers: any[] = [];

  // ── ETA + sharing ──
  etaMinutes: number | null = null;
  etaTarget: string | null = null;
  private etaPollRef: any;

  private gmap!: google.maps.Map;
  private pickupMarker?: google.maps.Marker;
  private dropMarker?: google.maps.Marker;
  private driverMarker?: google.maps.Marker;
  private driverLat: number | null = null;
  private driverLng: number | null = null;
  private directionsRenderer?: google.maps.DirectionsRenderer;
  private pickupAutocomplete?: google.maps.places.Autocomplete;
  private dropAutocomplete?: google.maps.places.Autocomplete;
  private geocoder?: google.maps.Geocoder;
  private googleReady = false;
  private subs: Subscription[] = [];
  private appResumeHandle?: { remove: () => Promise<void> };

  cancelReasons: string[] = [];

  constructor(
    private api: ApiService,
    private signalr: SignalrService,
    private ngZone: NgZone,
    private actionSheetCtrl: ActionSheetController,
    private router: Router,
    private toastCtrl: ToastController
  ) {}

  ngOnInit() {
    this.signalr.connect();
    this.subs.push(this.signalr.rideAccepted$.subscribe(d => this.onRideAccepted(d)));
    this.subs.push(this.signalr.rideStarted$.subscribe(d => this.onRideStarted(d)));
    this.subs.push(this.signalr.rideCompleted$.subscribe(d => this.onRideCompleted(d)));
    this.subs.push(this.signalr.rideCancelled$.subscribe(d => this.onRideCancelled(d)));
    this.subs.push(this.signalr.driverLocationUpdate$.subscribe(d => this.onDriverLocationUpdate(d)));
    this.subs.push(this.signalr.searchRadiusUpdate$.subscribe(d => this.onSearchRadiusUpdate(d)));
    this.subs.push(this.signalr.reconnected$.subscribe(() => this.syncActiveBooking()));
    App.addListener('resume', () => this.ngZone.run(() => this.syncActiveBooking()))
      .then(h => { this.appResumeHandle = h; });

    // Cache the canonical cancellation reasons for the action sheet
    this.api.get('ride/cancel-reasons').subscribe({
      next: (reasons: string[]) => this.cancelReasons = reasons || [],
      error: () => this.cancelReasons = ['Change of plans', 'Other']
    });

    this.loadSavedPlaces();
    this.loadOffers();
  }

  private loadSavedPlaces() {
    this.api.get('places').subscribe({
      next: (res) => this.savedPlaces = res || [],
      error: () => this.savedPlaces = []
    });
  }

  private loadOffers() {
    this.api.get('promo').subscribe({
      next: (res) => this.availableOffers = res || [],
      error: () => this.availableOffers = []
    });
  }

  ngAfterViewInit() {
    setTimeout(() => this.initGoogleMaps(), 300);
  }

  private async initGoogleMaps() {
    setOptions({ key: environment.googleMapsApiKey, v: 'weekly' });
    await importLibrary('maps');
    await importLibrary('places');
    this.googleReady = true;
    this.geocoder = new google.maps.Geocoder();

    const center = await this.getInitialLocation();
    if (!center) return;

    this.gmap = new google.maps.Map(document.getElementById('map') as HTMLElement, {
      center,
      zoom: environment.mapZoom,
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      styles: [
        { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }
      ]
    });

    this.setupAutocomplete();

    if (!this.restoreActiveBooking()) {
      this.geocoder.geocode({ location: center }, (results, status) => {
        this.ngZone.run(() => {
          const address = status === 'OK' && results?.[0]
            ? results[0].formatted_address
            : `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`;
          this.setPickup(center.lat, center.lng, address);
          if (this.pickupInputRef?.nativeElement) {
            this.pickupInputRef.nativeElement.value = address;
          }
        });
      });
    }
  }

  retryLocation() {
    this.locationDenied = false;
    this.initGoogleMaps();
  }

  private async getInitialLocation(): Promise<{ lat: number; lng: number } | null> {
    try {
      const perm = await Geolocation.requestPermissions();
      if (perm.location === 'denied') {
        this.ngZone.run(() => { this.locationDenied = true; });
        return null;
      }
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      this.ngZone.run(() => { this.locationDenied = true; });
      return null;
    }
  }

  private restoreActiveBooking(): boolean {
    const saved = localStorage.getItem('userActiveBooking');
    if (!saved) return false;
    try {
      const d = JSON.parse(saved);
      this.activeRide = d.activeRide;
      this.driverInfo = d.driverInfo;
      this.pickup = d.pickup;
      this.drop = d.drop;
      this.selectedVehicleType = d.selectedVehicleType;
      this.state = d.state;
      this.statusMessage = d.statusMessage || '';
      if (this.pickup) {
        this.setPickup(this.pickup.lat, this.pickup.lng, this.pickup.address);
        if (this.pickupInputRef?.nativeElement) {
          this.pickupInputRef.nativeElement.value = this.pickup.address;
        }
      }
      if (this.drop) this.setDrop(this.drop.lat, this.drop.lng, this.drop.address);
      if (this.state === 'accepted' || this.state === 'started') {
        if (this.driverInfo?.currentLat != null && this.driverInfo?.currentLong != null) {
          this.driverLat = Number(this.driverInfo.currentLat);
          this.driverLng = Number(this.driverInfo.currentLong);
        }
        this.updateRoute();
        this.startEtaPolling();
      }
      // Validate the restored ride against the server (it may have been cancelled/completed
      // while the app was closed) so we don't show a stale "driver on the way" screen.
      this.syncActiveBooking();
      return true;
    } catch {
      localStorage.removeItem('userActiveBooking');
      return false;
    }
  }

  // Reconcile the on-screen active ride with the server. Clears a stale active view if the
  // ride is no longer active (e.g. cancelled while the app missed the realtime event).
  private syncActiveBooking() {
    const activeStates = ['searching', 'accepted', 'started'];
    if (!activeStates.includes(this.state)) return;
    this.api.get('ride/active', { userId: getCurrentUserId() }).subscribe({
      next: (ride: any) => {
        this.ngZone.run(() => {
          const st = ride?.rideStatus;
          if (st === 'Requested' || st === 'Accepted' || st === 'Started') {
            // Still active — refresh from the server.
            this.activeRide = { ...this.activeRide, ...ride };
            if (ride.driver) this.driverInfo = ride.driver;
            if (ride.driver?.currentLat != null && ride.driver?.currentLong != null) {
              this.driverLat = Number(ride.driver.currentLat);
              this.driverLng = Number(ride.driver.currentLong);
            }
            this.state = st === 'Accepted' ? 'accepted' : st === 'Started' ? 'started' : 'searching';
            this.saveActiveBooking();
            if (this.state === 'accepted' || this.state === 'started') this.updateRoute();
          } else {
            // Server has no active ride for us — the ride ended while we weren't listening.
            this.stopEtaPolling();
            this.clearActiveBooking();
            this.state = 'cancelled';
            this.statusMessage = 'This ride is no longer active.';
          }
        });
      },
      error: () => {}
    });
  }

  private saveActiveBooking() {
    localStorage.setItem('userActiveBooking', JSON.stringify({
      activeRide: this.activeRide,
      driverInfo: this.driverInfo,
      pickup: this.pickup,
      drop: this.drop,
      selectedVehicleType: this.selectedVehicleType,
      state: this.state,
      statusMessage: this.statusMessage
    }));
  }

  private clearActiveBooking() {
    localStorage.removeItem('userActiveBooking');
  }

  private setupAutocomplete() {
    if (!this.pickupInputRef?.nativeElement || !this.dropInputRef?.nativeElement) return;

    const opts: google.maps.places.AutocompleteOptions = {
      componentRestrictions: { country: 'in' },
      fields: ['geometry', 'formatted_address', 'name']
    };

    this.pickupAutocomplete = new google.maps.places.Autocomplete(
      this.pickupInputRef.nativeElement, opts
    );
    this.pickupAutocomplete.addListener('place_changed', () => {
      this.ngZone.run(() => {
        const place = this.pickupAutocomplete!.getPlace();
        if (place.geometry?.location) {
          const lat = place.geometry.location.lat();
          const lng = place.geometry.location.lng();
          const address = place.formatted_address || place.name || '';
          this.setPickup(lat, lng, address);
          this.gmap.setCenter({ lat, lng });
          this.gmap.setZoom(environment.mapZoom);
        }
      });
    });

    this.dropAutocomplete = new google.maps.places.Autocomplete(
      this.dropInputRef.nativeElement, opts
    );
    this.dropAutocomplete.addListener('place_changed', () => {
      this.ngZone.run(() => {
        const place = this.dropAutocomplete!.getPlace();
        if (place.geometry?.location) {
          const lat = place.geometry.location.lat();
          const lng = place.geometry.location.lng();
          const address = place.formatted_address || place.name || '';
          this.setDrop(lat, lng, address);
        }
      });
    });
  }

  private setPickup(lat: number, lng: number, address: string) {
    this.pickup = { lat, lng, address };
    this.checkServiceability();

    if (this.pickupMarker) {
      this.pickupMarker.setPosition({ lat, lng });
    } else {
      this.pickupMarker = new google.maps.Marker({
        position: { lat, lng },
        map: this.gmap,
        icon: {
          url: 'assets/VayGoIcon.png',
          scaledSize: new google.maps.Size(40, 40),
          anchor: new google.maps.Point(20, 40)
        },
        title: 'Pickup'
      });
    }
  }

  // Check serviceability of the ride: the whole route (start + end) when both are set,
  // otherwise just the pickup. Shows "not serving this area" and blocks booking.
  private checkServiceability() {
    const apply = (r: any) => {
      this.serviceable = r?.serviceable !== false;
      this.serviceMessage = this.serviceable ? '' : (r?.message || 'Sorry, we are not serving this area yet.');
    };
    const fail = () => { this.serviceable = true; this.serviceMessage = ''; }; // fail open; server re-validates

    if (this.pickup && this.drop) {
      this.api.get('service-areas/check-route', {
        pickupLat: this.pickup.lat, pickupLng: this.pickup.lng,
        dropLat: this.drop.lat, dropLng: this.drop.lng
      }).subscribe({ next: apply, error: fail });
    } else if (this.pickup) {
      this.api.get('service-areas/check', { lat: this.pickup.lat, lng: this.pickup.lng })
        .subscribe({ next: apply, error: fail });
    }
  }

  private setDrop(lat: number, lng: number, address: string) {
    this.drop = { lat, lng, address };
    this.checkServiceability();

    if (this.dropMarker) {
      this.dropMarker.setPosition({ lat, lng });
    } else {
      this.dropMarker = new google.maps.Marker({
        position: { lat, lng },
        map: this.gmap,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: '#650015',
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 3
        },
        title: 'Drop'
      });
    }
  }

  confirmLocations() {
    if (!this.pickup || !this.drop) return;

    const bounds = new google.maps.LatLngBounds();
    bounds.extend({ lat: this.pickup.lat, lng: this.pickup.lng });
    bounds.extend({ lat: this.drop.lat, lng: this.drop.lng });
    this.gmap.fitBounds(bounds, { top: 80, bottom: 360, left: 40, right: 40 });

    this.fetchVehicleOptions();
    this.state = 'selecting';
  }

  editLocations() {
    this.state = 'address';
  }

  private fetchVehicleOptions() {
    if (!this.pickup || !this.drop) return;

    this.loadingOptions = true;
    this.api.get('ride/vehicle-types', {
      pickupLat: this.pickup.lat,
      pickupLong: this.pickup.lng,
      dropLat: this.drop.lat,
      dropLong: this.drop.lng
    }).subscribe({
      next: (res) => {
        this.vehicleOptions = res || [];
        this.loadingOptions = false;
      },
      error: () => { this.loadingOptions = false; }
    });
  }

  optionsFor(category: string): VehicleOption[] {
    return this.vehicleOptions.filter(o => o.category === category);
  }

  iconFor(vehicleType: string): string {
    return VEHICLE_ICONS[vehicleType] || '🚗';
  }

  selectVehicle(vehicleType: string) {
    this.selectedVehicleType = vehicleType;
  }

  get selectedOption(): VehicleOption | undefined {
    return this.vehicleOptions.find(o => o.vehicleType === this.selectedVehicleType);
  }

  get canBook(): boolean {
    return !!(this.pickup && this.drop && this.selectedVehicleType && this.serviceable);
  }

  bookRide() {
    if (!this.canBook || !this.pickup || !this.drop || !this.selectedVehicleType) return;

    const body: any = {
      pickupLat: this.pickup.lat,
      pickupLong: this.pickup.lng,
      dropLat: this.drop.lat,
      dropLong: this.drop.lng,
      pickupAddress: this.pickup.address,
      dropAddress: this.drop.address,
      vehicleType: this.selectedVehicleType,
      userId: getCurrentUserId()
    };
    if (this.promoValid && this.promoCode.trim()) {
      body.promoCode = this.promoCode.trim();
    }

    // Scheduled ride: send scheduledTime and route to the scheduled list instead of searching.
    if (this.scheduleEnabled && this.scheduledTime) {
      body.scheduledTime = new Date(this.scheduledTime).toISOString();
      this.api.post('ride/request', body).subscribe({
        next: () => {
          this.showToast('Ride scheduled.');
          this.resetBooking();
          this.router.navigate(['/scheduled-rides']);
        },
        error: (err) => {
          this.statusMessage = err?.error?.message || 'Could not schedule ride. Please try again.';
        }
      });
      return;
    }

    this.state = 'searching';
    this.statusMessage = 'Searching within 1 km…';

    this.api.post('ride/request', body).subscribe({
      next: (res) => {
        this.activeRide = res?.data;
        // Stay in 'searching' regardless — the matcher progressively widens 1→2→3 km and a
        // driver can accept at any point (even one coming online later). SearchRadiusUpdate
        // refines the message; a driver accepting fires RideAccepted; a timeout fires RideCancelled.
        this.statusMessage = res?.data?.driverAssigned
          ? 'Rider found! Waiting for them to accept…'
          : 'Searching within 1 km…';
        this.saveActiveBooking();
      },
      error: (err) => {
        this.state = 'address';
        this.statusMessage = err?.error?.message || 'Could not request ride. Please try again.';
      }
    });
  }

  // ── Saved places: pick one as the drop ──
  useSavedPlace(place: any) {
    if (!place || place.lat == null) return;
    const lng = place.long ?? place.lng;
    this.setDrop(place.lat, lng, place.address);
    if (this.dropInputRef?.nativeElement) this.dropInputRef.nativeElement.value = place.address;
    if (this.gmap) {
      this.gmap.setCenter({ lat: place.lat, lng });
      this.gmap.setZoom(environment.mapZoom);
    }
  }

  // ── Promo code validation ──
  validatePromo() {
    const code = this.promoCode.trim();
    if (!code) { this.clearPromo(); return; }
    const fare = this.selectedOption?.estimatedFare || 0;
    this.validatingPromo = true;
    this.api.get('promo/validate', { code, fare }).subscribe({
      next: (res) => {
        this.validatingPromo = false;
        this.promoValid = !!res?.valid;
        this.promoMessage = res?.message || (res?.valid ? 'Promo applied!' : 'Invalid promo code.');
        this.promoDiscount = res?.valid ? (res?.discount || 0) : 0;
      },
      error: () => {
        this.validatingPromo = false;
        this.promoValid = false;
        this.promoDiscount = 0;
        this.promoMessage = 'Could not validate promo code.';
      }
    });
  }

  applyOffer(code: string) {
    this.promoCode = code;
    this.validatePromo();
  }

  private clearPromo() {
    this.promoValid = false;
    this.promoDiscount = 0;
    this.promoMessage = '';
  }

  get discountedFare(): number | null {
    if (!this.promoValid || !this.selectedOption) return null;
    return Math.max(0, this.selectedOption.estimatedFare - this.promoDiscount);
  }

  async cancelRide() {
    if (!this.activeRide) {
      this.resetBooking();
      return;
    }

    // Before a driver is assigned (still searching) there's no point asking why —
    // just cancel. Once a ride is accepted, ask the passenger for a reason.
    if (this.state !== 'accepted') {
      this.sendCancel(null);
      return;
    }

    const reasons = this.cancelReasons.length ? this.cancelReasons : ['Change of plans', 'Other'];
    const sheet = await this.actionSheetCtrl.create({
      header: 'Why are you cancelling?',
      buttons: [
        ...reasons.map(reason => ({ text: reason, handler: () => this.sendCancel(reason) })),
        { text: 'Keep ride', role: 'cancel' }
      ]
    });
    await sheet.present();
  }

  private sendCancel(reason: string | null) {
    if (!this.activeRide) {
      this.resetBooking();
      return;
    }
    this.api.post(`ride/cancel/${this.activeRide.rideId}`, reason ? { reason } : {}).subscribe({
      next: () => this.resetBooking(),
      error: () => this.resetBooking()
    });
  }

  submitRating() {
    if (!this.activeRide || !this.rating) return;
    this.api.post(`ride/rate/${this.activeRide.rideId}`, {
      rating: this.rating,
      feedback: this.feedback
    }).subscribe(() => this.resetBooking());
  }

  resetBooking() {
    this.clearActiveBooking();
    this.stopEtaPolling();
    this.state = 'address';
    this.activeRide = null;
    this.driverInfo = null;
    this.statusMessage = '';
    this.selectedVehicleType = null;
    this.rating = 0;
    this.feedback = '';
    this.vehicleOptions = [];
    this.drop = null;
    this.clearPromo();
    this.promoCode = '';
    this.scheduleEnabled = false;
    this.scheduledTime = '';
    this.etaMinutes = null;
    this.etaTarget = null;

    this.dropMarker?.setMap(null);
    this.dropMarker = undefined;
    this.driverMarker?.setMap(null);
    this.driverMarker = undefined;
    this.clearRoute();

    if (this.dropInputRef?.nativeElement) this.dropInputRef.nativeElement.value = '';
    if (this.pickup) this.gmap?.setCenter({ lat: this.pickup.lat, lng: this.pickup.lng });
  }

  private onRideAccepted(data: any) {
    if (!this.activeRide || data?.rideId !== this.activeRide.rideId) return;
    this.activeRide = { ...this.activeRide, ...data };
    this.driverInfo = data.driver;
    if (data.driver?.currentLat != null && data.driver?.currentLong != null) {
      this.driverLat = Number(data.driver.currentLat);
      this.driverLng = Number(data.driver.currentLong);
    }
    this.state = 'accepted';
    this.statusMessage = `${data.driver?.fullName || 'A driver'} is on the way!`;
    this.updateRoute();   // driver → pickup
    this.startEtaPolling();
    this.saveActiveBooking();
  }

  private onRideStarted(data: any) {
    if (!this.activeRide || data?.rideId !== this.activeRide.rideId) return;
    this.activeRide.rideStatus = data.rideStatus;
    this.state = 'started';
    this.statusMessage = 'Your ride has started.';
    this.updateRoute();   // pickup → drop
    this.saveActiveBooking();
  }

  private onRideCompleted(data: any) {
    if (!this.activeRide || data?.rideId !== this.activeRide.rideId) return;
    this.activeRide.rideStatus = data.rideStatus;
    this.activeRide.finalFare = data.finalFare;
    this.state = 'completed';
    this.statusMessage = 'Ride completed. Thanks for riding with VayGo!';
    this.stopEtaPolling();
    this.saveActiveBooking();
  }

  private onRideCancelled(data: any) {
    if (!this.activeRide || data?.rideId !== this.activeRide.rideId) return;
    this.state = 'cancelled';
    this.statusMessage = data?.reason || 'Ride was cancelled.';
    this.stopEtaPolling();
    this.clearActiveBooking();
  }

  // Live search-radius updates while looking for a driver (1 km → 2 km → 3 km).
  private onSearchRadiusUpdate(data: any) {
    if (this.state !== 'searching' || !this.activeRide || data?.rideId !== this.activeRide.rideId) return;
    this.ngZone.run(() => {
      this.statusMessage = data?.exhausted
        ? 'No riders within 3 km yet — still searching…'
        : `Searching within ${data?.radiusKm ?? 1} km…`;
    });
  }

  // ── ETA polling (every 15s while accepted/started) ──
  private startEtaPolling() {
    this.stopEtaPolling();
    this.fetchEta();
    this.etaPollRef = setInterval(() => this.fetchEta(), 15000);
  }

  private stopEtaPolling() {
    if (this.etaPollRef) {
      clearInterval(this.etaPollRef);
      this.etaPollRef = undefined;
    }
  }

  private fetchEta() {
    if (!this.activeRide?.rideId) return;
    this.api.get(`ride/eta/${this.activeRide.rideId}`).subscribe({
      next: (res) => {
        this.ngZone.run(() => {
          this.etaMinutes = res?.etaMinutes ?? null;
          this.etaTarget = res?.target ?? null;
        });
      },
      error: () => { /* keep last known ETA */ }
    });
  }

  get etaLabel(): string | null {
    if (this.etaMinutes == null) return null;
    const who = this.state === 'started' ? 'Drop' : 'Driver';
    return `${who} ${this.etaMinutes} min away`;
  }

  // Open the in-ride chat with the assigned driver (keyed by ride id).
  openChat() {
    if (this.activeRide?.rideId) this.router.navigate(['/chat', this.activeRide.rideId]);
  }

  // ── Trip sharing ──
  async shareTrip() {
    if (!this.activeRide?.rideId) return;
    this.api.post(`ride/share/${this.activeRide.rideId}`, { userId: getCurrentUserId() }).subscribe({
      next: async (res) => {
        const token = res?.shareToken;
        if (!token) { this.showToast('Could not create share link.'); return; }
        const link = `${environment.baseUrl}/ride/track/${token}`;
        const nav: any = navigator;
        if (nav.share) {
          try { await nav.share({ title: 'Track my VayGo ride', text: 'Follow my trip live:', url: link }); return; } catch { /* fall through */ }
        }
        if (nav.clipboard?.writeText) {
          try { await nav.clipboard.writeText(link); this.showToast('Trip link copied to clipboard.'); return; } catch { /* fall through */ }
        }
        this.showToast(link);
      },
      error: () => this.showToast('Could not create share link.')
    });
  }

  // ── Emergency SOS ──
  async triggerSos() {
    if (!this.activeRide?.rideId) return;
    const sheet = await this.actionSheetCtrl.create({
      header: 'Send emergency SOS?',
      subHeader: 'VayGo safety will be alerted with your location.',
      buttons: [
        { text: 'Send SOS', role: 'destructive', handler: () => this.sendSos() },
        { text: 'Cancel', role: 'cancel' }
      ]
    });
    await sheet.present();
  }

  private async sendSos() {
    let lat = this.pickup?.lat || 0;
    let long = this.pickup?.lng || 0;
    try {
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 8000 });
      lat = pos.coords.latitude;
      long = pos.coords.longitude;
    } catch { /* use fallback */ }

    this.api.post('safety/sos', {
      rideId: this.activeRide?.rideId,
      raisedBy: 'User',
      userId: getCurrentUserId(),
      lat,
      long
    }).subscribe({
      next: () => this.showToast('SOS sent. Help is being notified.'),
      error: () => this.showToast('Could not send SOS. Please call emergency services.')
    });
  }

  // ── Menu navigation ──
  toggleMenu() { this.menuOpen = !this.menuOpen; }

  goTo(path: string) {
    this.menuOpen = false;
    this.router.navigate([path]);
  }

  private async showToast(message: string) {
    const t = await this.toastCtrl.create({ message, duration: 2400, position: 'bottom' });
    await t.present();
  }

  private onDriverLocationUpdate(data: any) {
    if (!this.googleReady || !this.activeRide || data?.rideId !== this.activeRide.rideId) return;

    this.driverLat = data.lat;
    this.driverLng = data.lng;

    // While the driver is heading to pickup, keep the approach route in sync with their movement.
    if (this.state === 'accepted') this.updateRoute();

    const pos = { lat: data.lat, lng: data.lng };
    if (this.driverMarker) {
      this.driverMarker.setPosition(pos);
    } else {
      // Show the ride's vehicle symbol (bike / auto / car…) as the moving driver marker,
      // so the passenger sees their actual vehicle approaching the pickup point.
      this.driverMarker = new google.maps.Marker({
        position: pos,
        map: this.gmap,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 16,
          fillColor: '#ffffff',
          fillOpacity: 1,
          strokeColor: '#650015',
          strokeWeight: 2
        },
        label: {
          text: this.iconFor(this.activeRide?.vehicleType || ''),
          fontSize: '20px'
        },
        title: (this.activeRide?.vehicleType || 'Your driver') + ' • approaching pickup',
        zIndex: 999
      });
    }
  }

  // Draw the route that matches the current ride stage:
  //  - accepted (driver on the way) → driver's live location → pickup
  //  - started  (trip in progress)  → pickup → drop
  private updateRoute() {
    if (!this.pickup) return;
    if (this.state === 'accepted') {
      if (this.driverLat != null && this.driverLng != null) {
        this.drawRoute({ lat: this.driverLat, lng: this.driverLng },
                       { lat: this.pickup.lat, lng: this.pickup.lng });
      }
    } else if (this.state === 'started') {
      if (this.drop) {
        this.drawRoute({ lat: this.pickup.lat, lng: this.pickup.lng },
                       { lat: this.drop.lat, lng: this.drop.lng });
      }
    }
  }

  private drawRoute(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
    if (!this.googleReady || !this.gmap) return;
    const ds = new google.maps.DirectionsService();
    // Reuse one renderer so the line updates smoothly (no flicker) as the driver moves.
    if (!this.directionsRenderer) {
      this.directionsRenderer = new google.maps.DirectionsRenderer({
        map: this.gmap,
        suppressMarkers: true,
        polylineOptions: { strokeColor: '#650015', strokeWeight: 5, strokeOpacity: 0.8 }
      });
    }
    ds.route({
      origin: from,
      destination: to,
      travelMode: google.maps.TravelMode.DRIVING
    }, (result, status) => {
      if (status === 'OK') this.directionsRenderer!.setDirections(result);
    });
  }

  private clearRoute() {
    this.directionsRenderer?.setMap(null);
    this.directionsRenderer = undefined;
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    this.signalr.disconnect();
    this.appResumeHandle?.remove();
    this.pickupAutocomplete?.unbindAll();
    this.dropAutocomplete?.unbindAll();
    this.clearRoute();
    this.stopEtaPolling();
  }
}
