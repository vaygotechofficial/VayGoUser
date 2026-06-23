import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, AlertController, ToastController } from '@ionic/angular/standalone';
import { Geolocation } from '@capacitor/geolocation';
import { ApiService } from '../services/api';
import { getCurrentUserId } from '../services/signalr';

@Component({
  selector: 'app-safety',
  templateUrl: './safety.page.html',
  styleUrls: ['./safety.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent]
})
export class SafetyPage implements OnInit {
  activeRideId: number | null = null;

  category: 'ReportIssue' | 'LostAndFound' = 'ReportIssue';
  subject = '';
  description = '';
  submitting = false;

  issues: any[] = [];
  loadingIssues = true;

  constructor(
    private api: ApiService,
    private router: Router,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController
  ) {}

  ngOnInit() {
    this.activeRideId = this.readActiveRideId();
    this.loadIssues();
  }

  private readActiveRideId(): number | null {
    const saved = localStorage.getItem('userActiveBooking');
    if (!saved) return null;
    try {
      const d = JSON.parse(saved);
      const state = d?.state;
      if (state === 'accepted' || state === 'started') {
        return d?.activeRide?.rideId ?? null;
      }
    } catch {
      return null;
    }
    return null;
  }

  loadIssues() {
    this.loadingIssues = true;
    this.api.get('safety/issues').subscribe({
      next: (res) => {
        this.issues = res || [];
        this.loadingIssues = false;
      },
      error: () => { this.loadingIssues = false; }
    });
  }

  async triggerSos() {
    const alert = await this.alertCtrl.create({
      header: 'Send SOS?',
      message: 'This will alert VayGo safety with your current location. Use only in an emergency.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Send SOS', role: 'destructive', handler: () => this.sendSos() }
      ]
    });
    await alert.present();
  }

  private async sendSos() {
    let lat = 0;
    let long = 0;
    try {
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
      lat = pos.coords.latitude;
      long = pos.coords.longitude;
    } catch {
      // fall back to 0,0 if location unavailable; still raise the alert
    }

    this.api.post('safety/sos', {
      rideId: this.activeRideId,
      raisedBy: 'User',
      userId: getCurrentUserId(),
      lat,
      long
    }).subscribe({
      next: () => this.showToast('SOS sent. Help is being notified.'),
      error: () => this.showToast('Could not send SOS. Please call emergency services.')
    });
  }

  submitIssue() {
    if (!this.subject.trim() || !this.description.trim() || this.submitting) return;
    this.submitting = true;
    const body: any = {
      category: this.category,
      subject: this.subject.trim(),
      description: this.description.trim(),
      userId: getCurrentUserId()
    };
    if (this.activeRideId) body.rideId = this.activeRideId;

    this.api.post('safety/issue', body).subscribe({
      next: () => {
        this.submitting = false;
        this.subject = '';
        this.description = '';
        this.showToast('Submitted. We will get back to you.');
        this.loadIssues();
      },
      error: () => {
        this.submitting = false;
        this.showToast('Could not submit. Please try again.');
      }
    });
  }

  private async showToast(message: string) {
    const t = await this.toastCtrl.create({ message, duration: 2500, position: 'bottom' });
    await t.present();
  }

  back() {
    this.router.navigate(['/home']);
  }
}
