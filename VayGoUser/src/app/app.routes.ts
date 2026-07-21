import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './services/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./login/login.page').then((m) => m.LoginPage),
  },
  {
    // Public — reachable from the accept-privacy checkbox before login/registration.
    path: 'privacy',
    loadComponent: () => import('./privacy/privacy.page').then((m) => m.PrivacyPage),
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
    canActivate: [authGuard],
    loadComponent: () => import('./home/home.page').then((m) => m.HomePage),
  },
  {
    path: 'ride-history',
    canActivate: [authGuard],
    loadComponent: () => import('./ride-history/ride-history.page').then((m) => m.RideHistoryPage),
  },
  {
    path: 'invoice/:rideId',
    canActivate: [authGuard],
    loadComponent: () => import('./invoice/invoice.page').then((m) => m.InvoicePage),
  },
  {
    path: 'safety',
    canActivate: [authGuard],
    loadComponent: () => import('./safety/safety.page').then((m) => m.SafetyPage),
  },
  {
    path: 'support',
    canActivate: [authGuard],
    loadComponent: () => import('./support/support.page').then((m) => m.SupportPage),
  },
  {
    path: 'chat/:rideId',
    canActivate: [authGuard],
    loadComponent: () => import('./chat/chat.page').then((m) => m.ChatPage),
  },
  {
    path: 'places',
    canActivate: [authGuard],
    loadComponent: () => import('./places/places.page').then((m) => m.PlacesPage),
  },
  {
    path: 'scheduled-rides',
    canActivate: [authGuard],
    loadComponent: () => import('./scheduled-rides/scheduled-rides.page').then((m) => m.ScheduledRidesPage),
  },
  {
    path: 'referral',
    canActivate: [authGuard],
    loadComponent: () => import('./referral/referral.page').then((m) => m.ReferralPage),
  },
  {
    path: 'loyalty',
    canActivate: [authGuard],
    loadComponent: () => import('./loyalty/loyalty.page').then((m) => m.LoyaltyPage),
  },
  {
    // Public share-tracking link — intentionally NOT guarded so recipients who aren't
    // logged in can still open a shared ride-tracking URL.
    path: 'ride/track/:shareToken',
    loadComponent: () => import('./track/track.page').then((m) => m.TrackPage),
  },
  {
    path: '',
    redirectTo: 'home',
    pathMatch: 'full',
  },
];
