import { Component, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular/standalone';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
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

  constructor(
    private api: ApiService,
    private signalr: SignalrService,
    private ngZone: NgZone
  ) {}

  ngOnInit() {
    this.signalr.connect();
    this.subs.push(this.signalr.rideAccepted$.subscribe(d => this.onRideAccepted(d)));
    this.subs.push(this.signalr.rideStarted$.subscribe(d => this.onRideStarted(d)));
    this.subs.push(this.signalr.rideCompleted$.subscribe(d => this.onRideCompleted(d)));
    this.subs.push(this.signalr.rideCancelled$.subscribe(d => this.onRideCancelled(d)));
    this.subs.push(this.signalr.driverLocationUpdate$.subscribe(d => this.onDriverLocationUpdate(d)));
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

  private getInitialLocation(): Promise<{ lat: number; lng: number } | null> {
    return new Promise(resolve => {
      if (!navigator.geolocation) {
        this.ngZone.run(() => { this.locationDenied = true; });
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {
          this.ngZone.run(() => { this.locationDenied = true; });
          resolve(null);
        },
        { timeout: 10000, maximumAge: 0, enableHighAccuracy: true }
      );
    });
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
      if (this.state === 'accepted' || this.state === 'started') this.drawRoute();
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

    this.state = 'searching';
    this.statusMessage = 'Searching for a nearby rider…';

    this.api.post('ride/request', {
      pickupLat: this.pickup.lat,
      pickupLong: this.pickup.lng,
      dropLat: this.drop.lat,
      dropLong: this.drop.lng,
      pickupAddress: this.pickup.address,
      dropAddress: this.drop.address,
      vehicleType: this.selectedVehicleType,
      userId: getCurrentUserId()
    }).subscribe({
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

  cancelRide() {
    if (!this.activeRide) {
      this.resetBooking();
      return;
    }
    this.api.post(`ride/cancel/${this.activeRide.rideId}`, {}).subscribe({
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
    this.state = 'address';
    this.activeRide = null;
    this.driverInfo = null;
    this.statusMessage = '';
    this.selectedVehicleType = null;
    this.rating = 0;
    this.feedback = '';
    this.vehicleOptions = [];
    this.drop = null;

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
    this.saveActiveBooking();
  }

  private onRideCancelled(data: any) {
    if (!this.activeRide || data?.rideId !== this.activeRide.rideId) return;
    this.state = 'cancelled';
    this.statusMessage = data?.reason || 'Ride was cancelled.';
    this.clearActiveBooking();
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
  }
}
