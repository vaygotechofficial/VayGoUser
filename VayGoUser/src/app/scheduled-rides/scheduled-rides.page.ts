import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent, AlertController, ToastController } from '@ionic/angular/standalone';
import { ApiService } from '../services/api';
import { getCurrentUserId } from '../services/signalr';

@Component({
  selector: 'app-scheduled-rides',
  templateUrl: './scheduled-rides.page.html',
  styleUrls: ['./scheduled-rides.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent]
})
export class ScheduledRidesPage implements OnInit {
  rides: any[] = [];
  loading = true;

  constructor(
    private api: ApiService,
    private router: Router,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController
  ) {}

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading = true;
    this.api.get('ride/scheduled').subscribe({
      next: (res) => { this.rides = res || []; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  async cancel(ride: any) {
    const alert = await this.alertCtrl.create({
      header: 'Cancel scheduled ride?',
      message: `Ride #${ride.rideNumber} will be cancelled.`,
      buttons: [
        { text: 'Keep', role: 'cancel' },
        {
          text: 'Cancel ride',
          role: 'destructive',
          handler: () => {
            this.api.post(`ride/scheduled/${ride.rideId}/cancel`, { userId: getCurrentUserId() }).subscribe({
              next: () => { this.showToast('Scheduled ride cancelled.'); this.load(); },
              error: () => this.showToast('Could not cancel. Please try again.')
            });
          }
        }
      ]
    });
    await alert.present();
  }

  private async showToast(message: string) {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'bottom' });
    await t.present();
  }

  back() {
    this.router.navigate(['/home']);
  }
}
