import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { ApiService } from '../services/api';

@Component({
  selector: 'app-invoice',
  templateUrl: './invoice.page.html',
  styleUrls: ['./invoice.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent]
})
export class InvoicePage implements OnInit {
  invoice: any = null;
  loading = true;
  error = '';

  constructor(
    private api: ApiService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit() {
    const rideId = this.route.snapshot.paramMap.get('rideId');
    if (!rideId) {
      this.error = 'Invoice not found.';
      this.loading = false;
      return;
    }
    this.api.get(`ride/invoice/${rideId}`).subscribe({
      next: (res) => {
        this.invoice = res;
        this.loading = false;
      },
      error: () => {
        this.error = 'Could not load this invoice.';
        this.loading = false;
      }
    });
  }

  get currency(): string {
    return this.invoice?.fare?.currency || '₹';
  }

  back() {
    this.router.navigate(['/ride-history']);
  }
}
