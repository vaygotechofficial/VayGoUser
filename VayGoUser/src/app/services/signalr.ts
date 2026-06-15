import { Injectable } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { Subject } from 'rxjs';
import { environment } from 'src/environments/environment';

// Dev-mode user id, mirrors BaseController.GetCurrentUserId()'s unauthenticated default of 1.
export function getCurrentUserId(): number {
  const stored = localStorage.getItem('userId');
  return stored ? Number(stored) : 1;
}

@Injectable({
  providedIn: 'root'
})
export class SignalrService {
  private hubConnection?: signalR.HubConnection;

  rideAccepted$ = new Subject<any>();
  rideCancelled$ = new Subject<any>();
  driverLocationUpdate$ = new Subject<any>();
  rideStarted$ = new Subject<any>();
  rideCompleted$ = new Subject<any>();

  connect(): void {
    if (this.hubConnection) return;

    const hubUrl = environment.baseUrl.replace(/\/api\/?$/, '') + '/hubs/notifications';
    const userId = getCurrentUserId();

    this.hubConnection = new signalR.HubConnectionBuilder()
      .withUrl(`${hubUrl}?userId=${userId}`)
      .withAutomaticReconnect()
      .build();

    this.hubConnection.on('RideAccepted', (data) => this.rideAccepted$.next(data));
    this.hubConnection.on('RideCancelled', (data) => this.rideCancelled$.next(data));
    this.hubConnection.on('DriverLocationUpdate', (data) => this.driverLocationUpdate$.next(data));
    this.hubConnection.on('RideStarted', (data) => this.rideStarted$.next(data));
    this.hubConnection.on('RideCompleted', (data) => this.rideCompleted$.next(data));

    this.hubConnection.start().catch(err => console.error('SignalR connection error:', err));
  }

  disconnect(): void {
    this.hubConnection?.stop();
    this.hubConnection = undefined;
  }
}
