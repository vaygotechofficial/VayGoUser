import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from 'src/environments/environment';
import { Observable, map } from 'rxjs';

export interface DistanceMatrixResponse {
  distance: string; // e.g., "5.2 km"
  duration: string; // e.g., "15 mins"
  distanceValue: number; // in meters
  durationValue: number; // in seconds
}

export interface PlacePrediction {
  description: string;
  placeId: string;
}

export interface PlaceDetails {
  lat: number;
  lng: number;
  address: string;
}

@Injectable({
  providedIn: 'root'
})
export class MapsService {
  private apiKey = environment.googleMapsApiKey;

  constructor(private http: HttpClient) {}

  /**
   * Fetches distance and duration between two points using Google Distance Matrix API.
   */
  getDistanceAndDuration(origin: string, destination: string): Observable<DistanceMatrixResponse> {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&key=${this.apiKey}`;

    return this.http.get<any>(url).pipe(
      map(res => {
        if (res.status === 'OK' && res.rows[0].elements[0].status === 'OK') {
          const element = res.rows[0].elements[0];
          return {
            distance: element.distance.text,
            duration: element.duration.text,
            distanceValue: element.distance.value,
            durationValue: element.duration.value
          };
        } else {
          throw new Error(res.error_message || 'Failed to fetch distance data');
        }
      })
    );
  }

  /**
   * Fetches address predictions from Google Places Autocomplete API.
   */
  searchPlaces(query: string): Observable<PlacePrediction[]> {
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${this.apiKey}&components=country:in`;

    return this.http.get<any>(url).pipe(
      map(res => {
        if (res.status === 'OK') {
          return res.predictions.map((p: any) => ({
            description: p.description,
            placeId: p.place_id
          }));
        }
        return [];
      })
    );
  }

  /**
   * Fetches details for a specific place using Place ID.
   */
  getPlaceDetails(placeId: string): Observable<PlaceDetails> {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=geometry,formatted_address&key=${this.apiKey}`;

    return this.http.get<any>(url).pipe(
      map(res => {
        if (res.status === 'OK') {
          const result = res.result;
          return {
            lat: result.geometry.location.lat,
            lng: result.geometry.location.lng,
            address: result.formatted_address
          };
        } else {
          throw new Error(res.error_message || 'Failed to fetch place details');
        }
      })
    );
  }

  /**
   * Fetches route directions from Google Directions API.
   */
  getDirections(origin: string, destination: string): Observable<string> {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&key=${this.apiKey}`;

    return this.http.get<any>(url).pipe(
      map(res => {
        if (res.status === 'OK' && res.routes.length > 0) {
          return res.routes[0].overview_polyline.points;
        } else {
          throw new Error(res.error_message || 'No routes found');
        }
      })
    );
  }

  /**
   * Fetches the address for a given latitude and longitude using Google Geocoding API.
   */
  getAddressFromCoords(lat: number, lng: number): Observable<string> {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${this.apiKey}`;

    return this.http.get<any>(url).pipe(
      map(res => {
        if (res.status === 'OK' && res.results.length > 0) {
          return res.results[0].formatted_address;
        }
        return 'Unknown Location';
      })
    );
  }
}
