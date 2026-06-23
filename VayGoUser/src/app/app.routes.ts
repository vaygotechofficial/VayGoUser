import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'otp',
    loadComponent: () => import('./otp/otp.page').then((m) => m.OtpPage),
  },
  {
    path: 'register',
    loadComponent: () => import('./register/register.page').then((m) => m.RegisterPage),
  },
  {
    path: 'registration',
    children: [
      {
        path: '',
        loadComponent: () => import('./registration/registration.page').then((m) => m.RegistrationPage),
      },
      {
        path: 'otp',
        loadComponent: () => import('./registration/reg-otp/reg-otp.page').then((m) => m.RegOtpPage),
      },
      {
        path: 'step2',
        loadComponent: () => import('./registration/step2/step2.page').then((m) => m.Step2Page),
      },
    ],
  },
  {
    path: 'home',
    loadComponent: () => import('./home/home.page').then((m) => m.HomePage),
  },
  {
    path: 'ride-history',
    loadComponent: () => import('./ride-history/ride-history.page').then((m) => m.RideHistoryPage),
  },
  {
    path: 'invoice/:rideId',
    loadComponent: () => import('./invoice/invoice.page').then((m) => m.InvoicePage),
  },
  {
    path: 'safety',
    loadComponent: () => import('./safety/safety.page').then((m) => m.SafetyPage),
  },
  {
    path: 'places',
    loadComponent: () => import('./places/places.page').then((m) => m.PlacesPage),
  },
  {
    path: 'scheduled-rides',
    loadComponent: () => import('./scheduled-rides/scheduled-rides.page').then((m) => m.ScheduledRidesPage),
  },
  {
    path: 'referral',
    loadComponent: () => import('./referral/referral.page').then((m) => m.ReferralPage),
  },
  {
    path: 'loyalty',
    loadComponent: () => import('./loyalty/loyalty.page').then((m) => m.LoyaltyPage),
  },
  {
    path: 'ride/track/:shareToken',
    loadComponent: () => import('./track/track.page').then((m) => m.TrackPage),
  },
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
];
