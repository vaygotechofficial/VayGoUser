import { Injectable } from '@angular/core';
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { environment } from 'src/environments/environment';

export interface DistanceMatrixResponse {
  distance: string;
  duration: string;
  distanceValue: number;
  durationValue: number;
}

@Injectable({
  providedIn: 'root'
})
export class MapsService {
  private mapsReady = false;

  private async load(): Promise<void> {
    if (!this.mapsReady) {
      setOptions({ key: environment.googleMapsApiKey, v: 'weekly' });
      await importLibrary('maps');
      this.mapsReady = true;
    }
  }

  getAddressFromCoords(lat: number, lng: number): Observable<string> {
    return from(
      this.load().then(async () => {
        return new Promise<string>((resolve) => {
          const geocoder = new google.maps.Geocoder();
          geocoder.geocode({ location: { lat, lng } }, (results, status) => {
            resolve(
              status === 'OK' && results?.[0]
                ? results[0].formatted_address
                : `${lat.toFixed(5)}, ${lng.toFixed(5)}`
            );
          });
        });
      })
    );
  }

  getDistanceMatrix(origin: string, destination: string): Observable<DistanceMatrixResponse> {
    return from(
      this.load().then(async () => {
        return new Promise<DistanceMatrixResponse>((resolve, reject) => {
          const service = new google.maps.DistanceMatrixService();
          service.getDistanceMatrix(
            {
              origins: [origin],
              destinations: [destination],
              travelMode: google.maps.TravelMode.DRIVING
            },
            (res, status) => {
              if (status === 'OK' && res?.rows[0].elements[0].status === 'OK') {
                const el = res.rows[0].elements[0];
                resolve({
                  distance: el.distance.text,
                  duration: el.duration.text,
                  distanceValue: el.distance.value,
                  durationValue: el.duration.value
                });
              } else {
                reject(new Error('Failed to fetch distance'));
              }
            }
          );
        });
      })
    );
  }
}
