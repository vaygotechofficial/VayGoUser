import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { ApiService } from '../services/api';

@Component({
  selector: 'app-track',
  templateUrl: './track.page.html',
  styleUrls: ['./track.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent]
})
export class TrackPage implements OnInit, OnDestroy {
  ride: any = null;
  loading = true;
  error = '';
  private pollRef: any;

  constructor(private api: ApiService, private route: ActivatedRoute) {}

  ngOnInit() {
    const token = this.route.snapshot.paramMap.get('shareToken');
    if (!token) {
      this.error = 'Invalid tracking link.';
      this.loading = false;
      return;
    }
    this.fetch(token);
    this.pollRef = setInterval(() => this.fetch(token), 15000);
  }

  private fetch(token: string) {
    this.api.get(`ride/track/${token}`).subscribe({
      next: (res) => {
        this.ride = res;
        this.loading = false;
      },
      error: () => {
        if (!this.ride) this.error = 'This trip is no longer being shared.';
        this.loading = false;
      }
    });
  }

  ngOnDestroy() {
    clearInterval(this.pollRef);
  }
}
