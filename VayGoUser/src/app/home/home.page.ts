import { Component, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { ActionSheetController, ToastController } from '@ionic/angular/standalone';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { Geolocation } from '@capacitor/geolocation';
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
  private directionsRenderer?: google.maps.DirectionsRenderer;
  private pickupAutocomplete?: google.maps.places.Autocomplete;
  private dropAutocomplete?: google.maps.places.Autocomplete;
  private geocoder?: google.maps.Geocoder;
  private googleReady = false;
  private subs: Subscription[] = [];

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
        this.drawRoute();
        this.startEtaPolling();
      }
      return true;
    } catch {
      localStorage.removeItem('userActiveBooking');
      return false;
    }
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

  private setDrop(lat: number, lng: number, address: string) {
    this.drop = { lat, lng, address };

    if (this.dropMarker) {
      this.dropMarker.setPosition({ lat, lng });
    } else {
      this.dropMarker = new google.maps.Marker({
        position: { lat, lng },
        map: this.gmap,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: '#8b1c2c',
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
    return !!(this.pickup && this.drop && this.selectedVehicleType);
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
    this.statusMessage = 'Searching for a nearby rider…';

    this.api.post('ride/request', body).subscribe({
      next: (res) => {
        this.activeRide = res?.data;
        if (!res?.data?.driverAssigned) {
          this.state = 'noRiders';
          this.statusMessage = 'No riders available at the moment. Please try again later.';
        } else {
          this.statusMessage = 'Rider found! Waiting for them to accept…';
          this.saveActiveBooking();
        }
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
    this.state = 'accepted';
    this.statusMessage = `${data.driver?.fullName || 'A driver'} is on the way!`;
    this.drawRoute();
    this.startEtaPolling();
    this.saveActiveBooking();
  }

  private onRideStarted(data: any) {
    if (!this.activeRide || data?.rideId !== this.activeRide.rideId) return;
    this.activeRide.rideStatus = data.rideStatus;
    this.state = 'started';
    this.statusMessage = 'Your ride has started.';
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

    const pos = { lat: data.lat, lng: data.lng };
    if (this.driverMarker) {
      this.driverMarker.setPosition(pos);
    } else {
      this.driverMarker = new google.maps.Marker({
        position: pos,
        map: this.gmap,
        icon: {
          url: 'assets/VayGoIcon.png',
          scaledSize: new google.maps.Size(36, 36),
          anchor: new google.maps.Point(18, 36)
        },
        title: 'Your driver'
      });
    }
  }

  private drawRoute() {
    if (!this.googleReady || !this.gmap || !this.pickup || !this.drop) return;
    this.clearRoute();
    const ds = new google.maps.DirectionsService();
    this.directionsRenderer = new google.maps.DirectionsRenderer({
      map: this.gmap,
      suppressMarkers: true,
      polylineOptions: { strokeColor: '#8b1c2c', strokeWeight: 5, strokeOpacity: 0.8 }
    });
    ds.route({
      origin: { lat: this.pickup.lat, lng: this.pickup.lng },
      destination: { lat: this.drop.lat, lng: this.drop.lng },
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
    this.pickupAutocomplete?.unbindAll();
    this.dropAutocomplete?.unbindAll();
    this.clearRoute();
    this.stopEtaPolling();
  }
}
