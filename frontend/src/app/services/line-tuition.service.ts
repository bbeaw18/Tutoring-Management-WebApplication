import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs/operators';
import { environment } from '@environments/environment';
import { IApiResponse } from '../interfaces/api-response.interface';

export interface LineConnection {
  linked: boolean;
  matches: boolean;
  optedIn: boolean;
  friend: boolean;
}

export interface ReminderPreview {
  round: string;
  due: boolean;
  enabled: boolean;
  quotaExceededAt: string | null;
  recipients: { studentId: string; name: string; months: string[]; status: string }[];
  deliveries: { student: string; status: string; attempts: number; reason: string }[];
}

@Injectable({ providedIn: 'root' })
export class LineTuitionService {
  private readonly url = `${environment.apiUrl}/line`;

  constructor(private http: HttpClient) {}

  config() {
    return this.http.get<IApiResponse<{ liffId: string | null }>>(`${this.url}/config`)
      .pipe(map(response => response.data));
  }

  status(idToken: string) {
    return this.http.post<IApiResponse<LineConnection>>(`${this.url}/connection/status`, { idToken })
      .pipe(map(response => response.data));
  }

  save(idToken: string, accessToken: string | null, optedIn: boolean) {
    return this.http.put<IApiResponse<LineConnection>>(`${this.url}/connection`, { idToken, accessToken, optedIn })
      .pipe(map(response => response.data));
  }

  unlink() {
    return this.http.delete(`${this.url}/connection`);
  }

  preview() {
    return this.http.get<IApiResponse<ReminderPreview>>(`${this.url}/reminders/preview`)
      .pipe(map(response => response.data));
  }
}
