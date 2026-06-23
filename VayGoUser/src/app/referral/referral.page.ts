import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, ToastController } from '@ionic/angular/standalone';
import { ApiService } from '../services/api';
import { getCurrentUserId } from '../services/signalr';

@Component({
  selector: 'app-referral',
  templateUrl: './referral.page.html',
  styleUrls: ['./referral.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent]
})
export class ReferralPage implements OnInit {
  data: any = null;
  loading = true;

  applyCode = '';
  applying = false;

  constructor(
    private api: ApiService,
    private router: Router,
    private toastCtrl: ToastController
  ) {}

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading = true;
    this.api.get('promo/referral', { userId: getCurrentUserId() }).subscribe({
      next: (res) => { this.data = res; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  async shareCode() {
    const code = this.data?.referralCode;
    if (!code) return;
    const text = `Join me on VayGo! Use my referral code ${code} and we both earn rewards.`;
    const nav: any = navigator;
    if (nav.share) {
      try { await nav.share({ title: 'VayGo Referral', text }); return; } catch { /* ignore */ }
    }
    if (nav.clipboard?.writeText) {
      try { await nav.clipboard.writeText(text); this.showToast('Referral message copied.'); return; } catch { /* ignore */ }
    }
    this.showToast(`Your code: ${code}`);
  }

  apply() {
    const code = this.applyCode.trim();
    if (!code || this.applying) return;
    this.applying = true;
    this.api.post('promo/referral/apply', { code, userId: getCurrentUserId() }).subscribe({
      next: (res) => {
        this.applying = false;
        this.applyCode = '';
        this.showToast(res?.message || 'Referral code applied.');
        this.load();
      },
      error: (err) => {
        this.applying = false;
        this.showToast(err?.error?.message || 'Could not apply code.');
      }
    });
  }

  private async showToast(message: string) {
    const t = await this.toastCtrl.create({ message, duration: 2400, position: 'bottom' });
    await t.present();
  }

  back() {
    this.router.navigate(['/home']);
  }
}
