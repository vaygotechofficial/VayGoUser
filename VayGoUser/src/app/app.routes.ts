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
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
];
