import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonContent, IonButton, IonText } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { Camera } from '@capacitor/camera';
import { RegistrationStateService } from '../registration-state.service';

@Component({
  selector: 'app-step2',
  templateUrl: './step2.page.html',
  styleUrls: ['./step2.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent, IonButton, IonText]
})
export class Step2Page {
  photoPreview: string | null = null;
  photoFile: File | null = null;

  errorMsg = '';
  loading = false;

  constructor(
    private router: Router,
    private regState: RegistrationStateService,
    private cdRef: ChangeDetectorRef
  ) {}

  async takePhoto() {
    try {
      const result = await Camera.takePhoto({ quality: 90 });

      const src = result.webPath
        ?? (result.thumbnail ? `data:image/jpeg;base64,${result.thumbnail}` : null);

      if (!src) return;

      this.photoPreview = src;

      // Fetch the image into a Blob so we can build a File for upload
      const blob = await fetch(src).then(r => r.blob());
      this.photoFile = new File([blob], 'profile-photo.jpg', { type: 'image/jpeg' });
      this.regState.photo = this.photoFile;
      this.errorMsg = '';
      this.cdRef.detectChanges();
    } catch {
      // User cancelled the camera
    }
  }

  onSubmit() {
    if (!this.photoFile) {
      this.errorMsg = 'Please take a profile photo before continuing';
      return;
    }
    this.errorMsg = '';
    this.loading = true;
    setTimeout(() => {
      this.loading = false;
      // After photo, user is fully registered. Redirecting to login for authentication.
      this.router.navigate(['/login']);
    }, 1200);
  }
}
