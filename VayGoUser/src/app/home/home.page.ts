import { Component, OnInit, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular/standalone';
import * as L from 'leaflet';
import { Subscription } from 'rxjs';
import { ApiService } from '../services/api';
import { SignalrService } from '../services/signalr';

interface VehicleOption {
  category: string;
  vehicleType: string;
  estimatedFare: number;
  availableNearby: number;
}

type BookingState = 'selecting' | 'searching' | 'accepted' | 'started' | 'completed' | 'cancelled';

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

  pickup: { lat: number; lng: number; address: string } | null = null;
  drop: { lat: number; lng: number; address: string } | null = null;

  vehicleOptions: VehicleOption[] = [];
  selectedVehicleType: string | null = null;
  loadingOptions = false;

  state: BookingState = 'selecting';
  activeRide: any = null;
  driverInfo: any = null;
  statusMessage = '';

  rating = 0;
  feedback = '';

  private map!: L.Map;
  private pickupMarker?: L.Marker;
  private dropMarker?: L.Marker;
  private driverMarker?: L.Marker;
  private subs: Subscription[] = [];

  constructor(private api: ApiService, private signalr: SignalrService) {}

  ngOnInit() {
    this.signalr.connect();

    this.subs.push(this.signalr.rideAccepted$.subscribe(data => this.onRideAccepted(data)));
    this.subs.push(this.signalr.rideStarted$.subscribe(data => this.onRideStarted(data)));
    this.subs.push(this.signalr.rideCompleted$.subscribe(data => this.onRideCompleted(data)));
    this.subs.push(this.signalr.rideCancelled$.subscribe(data => this.onRideCancelled(data)));
    this.subs.push(this.signalr.driverLocationUpdate$.subscribe(data => this.onDriverLocationUpdate(data)));
  }

  ngAfterViewInit() {
    setTimeout(() => this.initMap(), 300);
  }

  private initMap() {
    const defaultCoords: L.LatLngTuple = [13.0827, 80.2707]; // Chennai default

    this.map = L.map('map', {
      center: defaultCoords,
      zoom: 15,
      zoomControl: false,
      attributionControl: false
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(this.map);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        const { latitude: lat, longitude: lng } = pos.coords;
        this.map.setView([lat, lng], 15);
        this.setPickup(lat, lng);
      });
    }

    this.map.on('click', (e: L.LeafletMouseEvent) => {
      if (this.state !== 'selecting') return;
      this.setDrop(e.latlng.lat, e.latlng.lng);
    });
  }

  private pickupIcon() {
    return L.icon({
      iconUrl: 'assets/VayGoIcon.png',
      iconSize: [40, 40],
      iconAnchor: [20, 40],
      popupAnchor: [0, -40]
    });
  }

  private setPickup(lat: number, lng: number) {
    this.pickup = { lat, lng, address: `Pickup (${lat.toFixed(5)}, ${lng.toFixed(5)})` };

    if (this.pickupMarker) {
      this.pickupMarker.setLatLng([lat, lng]);
    } else {
      this.pickupMarker = L.marker([lat, lng], { icon: this.pickupIcon() })
        .addTo(this.map)
        .bindPopup('Pickup');
    }

    this.fetchVehicleOptions();
  }

  private setDrop(lat: number, lng: number) {
    this.drop = { lat, lng, address: `Drop (${lat.toFixed(5)}, ${lng.toFixed(5)})` };

    if (this.dropMarker) {
      this.dropMarker.setLatLng([lat, lng]);
    } else {
      this.dropMarker = L.marker([lat, lng]).addTo(this.map).bindPopup('Drop').openPopup();
    }

    this.fetchVehicleOptions();
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
      error: () => {
        this.loadingOptions = false;
      }
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

    const body = {
      pickupLat: this.pickup.lat,
      pickupLong: this.pickup.lng,
      dropLat: this.drop.lat,
      dropLong: this.drop.lng,
      pickupAddress: this.pickup.address,
      dropAddress: this.drop.address,
      vehicleType: this.selectedVehicleType
    };

    this.api.post('ride/request', body).subscribe({
      next: (res) => {
        this.activeRide = res?.data;
        this.state = 'searching';
        this.statusMessage = this.activeRide?.driverAssigned
          ? 'Driver found! Waiting for them to accept...'
          : 'Searching for nearby drivers...';
      },
      error: (err) => {
        this.statusMessage = err?.error?.message || 'Could not request ride. Please try again.';
      }
    });
  }

  cancelRide() {
    if (!this.activeRide) return;
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
    this.state = 'selecting';
    this.activeRide = null;
    this.driverInfo = null;
    this.statusMessage = '';
    this.selectedVehicleType = null;
    this.rating = 0;
    this.feedback = '';
    this.vehicleOptions = [];

    if (this.dropMarker) {
      this.map.removeLayer(this.dropMarker);
      this.dropMarker = undefined;
    }
    if (this.driverMarker) {
      this.map.removeLayer(this.driverMarker);
      this.driverMarker = undefined;
    }
    this.drop = null;

    if (this.pickup) this.fetchVehicleOptions();
  }

  private onRideAccepted(data: any) {
    if (!this.activeRide || data?.rideId !== this.activeRide.rideId) return;
    this.activeRide.rideStatus = data.rideStatus;
    this.driverInfo = data.driver;
    this.state = 'accepted';
    this.statusMessage = `${data.driver?.fullName || 'A driver'} is on the way!`;
  }

  private onRideStarted(data: any) {
    if (!this.activeRide || data?.rideId !== this.activeRide.rideId) return;
    this.activeRide.rideStatus = data.rideStatus;
    this.state = 'started';
    this.statusMessage = 'Your ride has started.';
  }

  private onRideCompleted(data: any) {
    if (!this.activeRide || data?.rideId !== this.activeRide.rideId) return;
    this.activeRide.rideStatus = data.rideStatus;
    this.activeRide.finalFare = data.finalFare;
    this.state = 'completed';
    this.statusMessage = 'Ride completed. Thanks for riding with VayGo!';
  }

  private onRideCancelled(data: any) {
    if (!this.activeRide || data?.rideId !== this.activeRide.rideId) return;
    this.state = 'cancelled';
    this.statusMessage = data?.reason || 'Ride was cancelled.';
  }

  private onDriverLocationUpdate(data: any) {
    if (!this.activeRide || data?.rideId !== this.activeRide.rideId) return;

    const icon = L.icon({
      iconUrl: 'assets/VayGoIcon.png',
      iconSize: [36, 36],
      iconAnchor: [18, 36]
    });

    if (this.driverMarker) {
      this.driverMarker.setLatLng([data.lat, data.lng]);
    } else {
      this.driverMarker = L.marker([data.lat, data.lng], { icon }).addTo(this.map).bindPopup('Your driver');
    }
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    this.signalr.disconnect();
    if (this.map) this.map.remove();
  }
}
