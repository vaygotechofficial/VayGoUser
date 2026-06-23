import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, AlertController, ToastController } from '@ionic/angular/standalone';
import { ApiService } from '../services/api';
import { getCurrentUserId } from '../services/signalr';

@Component({
  selector: 'app-loyalty',
  templateUrl: './loyalty.page.html',
  styleUrls: ['./loyalty.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent]
})
export class LoyaltyPage implements OnInit {
  balance = 0;
  history: any[] = [];
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
    this.api.get('promo/loyalty', { userId: getCurrentUserId() }).subscribe({
      next: (res) => {
        this.balance = res?.balance || 0;
        this.history = res?.history || [];
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
  }

  async redeem() {
    const alert = await this.alertCtrl.create({
      header: 'Redeem points',
      message: 'How many points would you like to redeem?',
      inputs: [
        { name: 'points', type: 'number', placeholder: 'Points', min: 1, max: this.balance }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Redeem',
          handler: (val) => {
            const points = Number(val?.points);
            if (!points || points <= 0) { this.showToast('Enter a valid amount.'); return; }
            if (points > this.balance) { this.showToast('Not enough points.'); return; }
            this.api.post('promo/loyalty/redeem', { points, userId: getCurrentUserId() }).subscribe({
              next: (res) => { this.showToast(res?.message || 'Points redeemed.'); this.load(); },
              error: (err) => this.showToast(err?.error?.message || 'Could not redeem points.')
            });
          }
        }
      ]
    });
    await alert.present();
  }

  private async showToast(message: string) {
    const t = await this.toastCtrl.create({ message, duration: 2400, position: 'bottom' });
    await t.present();
  }

  back() {
    this.router.navigate(['/home']);
  }
}
