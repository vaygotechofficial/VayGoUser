import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class RegistrationStateService {
  fullName = '';
  mobileNumber = '';
  email = '';
  gender = '';
  referralCode = '';
  photo: File | null = null;

  reset() {
    this.fullName = '';
    this.mobileNumber = '';
    this.email = '';
    this.gender = '';
    this.referralCode = '';
    this.photo = null;
  }
}
