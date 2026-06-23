import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { ApiService } from '../services/api';

interface RideHistoryItem {
  rideId: number;
  rideNumber: string;
  pickupAddress: string;
  dropAddress: string;
  estimatedFare: number;
  finalFare: number;
  rideStatus: string;
  rating: number;
  requestedTime: string;
  startTime: string;
  endTime: string;
}

@Component({
  selector: 'app-ride-history',
  templateUrl: './ride-history.page.html',
  styleUrls: ['./ride-history.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent]
})
export class RideHistoryPage implements OnInit {
  rides: RideHistoryItem[] = [];
  loading = true;
  error = '';

  constructor(private api: ApiService, private router: Router) {}

  ngOnInit() {
    this.loadHistory();
  }

  loadHistory() {
    this.loading = true;
    this.error = '';
    this.api.get('ride/history').subscribe({
      next: (res) => {
        this.rides = res || [];
        this.loading = false;
      },
      error: () => {
        this.error = 'Could not load your ride history.';
        this.loading = false;
      }
    });
  }

  isCompleted(ride: RideHistoryItem): boolean {
    return (ride.rideStatus || '').toLowerCase() === 'completed';
  }

  openRide(ride: RideHistoryItem) {
    if (this.isCompleted(ride)) {
      this.router.navigate(['/invoice', ride.rideId]);
    }
  }

  back() {
    this.router.navigate(['/home']);
  }
}
