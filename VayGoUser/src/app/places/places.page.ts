import { Component, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, ToastController } from '@ionic/angular/standalone';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { ApiService } from '../services/api';
import { getCurrentUserId } from '../services/signalr';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-places',
  templateUrl: './places.page.html',
  styleUrls: ['./places.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent]
})
export class PlacesPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('placeInput') placeInputRef!: ElementRef<HTMLInputElement>;

  places: any[] = [];
  loading = true;

  // add form
  placeType: 'Home' | 'Work' | 'Favorite' = 'Home';
  label = '';
  selected: { address: string; lat: number; lng: number } | null = null;
  saving = false;

  private autocomplete?: google.maps.places.Autocomplete;

  constructor(
    private api: ApiService,
    private router: Router,
    private ngZone: NgZone,
    private toastCtrl: ToastController
  ) {}

  ngOnInit() {
    this.loadPlaces();
  }

  ngAfterViewInit() {
    setTimeout(() => this.initAutocomplete(), 300);
  }

  private async initAutocomplete() {
    setOptions({ key: environment.googleMapsApiKey, v: 'weekly' });
    await importLibrary('places');
    if (!this.placeInputRef?.nativeElement) return;

    this.autocomplete = new google.maps.places.Autocomplete(this.placeInputRef.nativeElement, {
      componentRestrictions: { country: 'in' },
      fields: ['geometry', 'formatted_address', 'name']
    });
    this.autocomplete.addListener('place_changed', () => {
      this.ngZone.run(() => {
        const place = this.autocomplete!.getPlace();
        if (place.geometry?.location) {
          this.selected = {
            lat: place.geometry.location.lat(),
            lng: place.geometry.location.lng(),
            address: place.formatted_address || place.name || ''
          };
        }
      });
    });
  }

  loadPlaces() {
    this.loading = true;
    this.api.get('places').subscribe({
      next: (res) => { this.places = res || []; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  savePlace() {
    if (!this.selected || this.saving) return;
    this.saving = true;
    this.api.post('places', {
      placeType: this.placeType,
      label: this.label.trim() || this.placeType,
      address: this.selected.address,
      lat: this.selected.lat,
      long: this.selected.lng,
      userId: getCurrentUserId()
    }).subscribe({
      next: () => {
        this.saving = false;
        this.label = '';
        this.selected = null;
        if (this.placeInputRef?.nativeElement) this.placeInputRef.nativeElement.value = '';
        this.showToast('Place saved.');
        this.loadPlaces();
      },
      error: () => { this.saving = false; this.showToast('Could not save place.'); }
    });
  }

  deletePlace(place: any) {
    this.api.delete(`places/${place.placeId}`).subscribe({
      next: () => this.loadPlaces(),
      error: () => this.showToast('Could not delete place.')
    });
  }

  iconFor(type: string): string {
    if (type === 'Home') return '🏠';
    if (type === 'Work') return '💼';
    return '⭐';
  }

  private async showToast(message: string) {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'bottom' });
    await t.present();
  }

  back() {
    this.router.navigate(['/home']);
  }

  ngOnDestroy() {
    this.autocomplete?.unbindAll();
  }
}
