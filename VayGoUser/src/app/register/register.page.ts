import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, IonButton, IonItem, IonInput, IonText, LoadingController, ToastController } from '@ionic/angular/standalone';
import { ApiService } from '../services/api';

@Component({
  selector: 'app-register',
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  standalone: true,
  imports: [IonContent, IonButton, IonItem, IonInput, IonText, CommonModule, ReactiveFormsModule]
})
export class RegisterPage {
  registerForm: FormGroup;
  errorMessage = '';

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private api: ApiService,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController
  ) {
    this.registerForm = this.fb.group({
      fullName: ['', [Validators.required, Validators.minLength(3)]],
      email: ['', [Validators.email]]
    });
  }

  async onRegister() {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }

    const loader = await this.loadingCtrl.create({ message: 'Saving profile...' });
    await loader.present();

    this.api.put('user/update-profile', this.registerForm.value).subscribe({
      next: async () => {
        loader.dismiss();

        const userDataStr = localStorage.getItem('userData');
        if (userDataStr) {
          const userData = JSON.parse(userDataStr);
          userData.fullName = this.registerForm.value.fullName;
          userData.email = this.registerForm.value.email;
          localStorage.setItem('userData', JSON.stringify(userData));
        }

        const toast = await this.toastCtrl.create({
          message: 'Profile updated successfully!',
          duration: 2000,
          color: 'success'
        });
        toast.present();

        this.router.navigate(['/home']);
      },
      error: (err) => {
        loader.dismiss();
        this.errorMessage = err.error?.message || 'Failed to update profile. Please try again.';
      }
    });
  }
}
