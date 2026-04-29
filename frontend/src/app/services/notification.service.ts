import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '@environments/environment';
import { INotification, INotificationRequest, IMarkReadRequest } from '../interfaces/notification.interface';
import { IApiResponse, IPaginationParams } from '../interfaces/api-response.interface';

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private apiUrl = `${environment.apiUrl}/notifications`;

  constructor(private http: HttpClient) {}

  getNotifications(params?: IPaginationParams): Observable<IApiResponse<INotification[]>> {
    return this.http.get<IApiResponse<INotification[]>>(this.apiUrl, { params: params as any });
  }

  getNotificationById(id: string): Observable<INotification> {
    return this.http.get<IApiResponse<INotification>>(`${this.apiUrl}/${id}`).pipe(
      map(res => res.data)
    );
  }

  createNotification(request: INotificationRequest): Observable<INotification> {
    return this.http.post<IApiResponse<INotification>>(this.apiUrl, request).pipe(
      map(res => res.data)
    );
  }

  markAsRead(notificationId: string): Observable<INotification> {
    return this.http.post<IApiResponse<INotification>>(`${this.apiUrl}/${notificationId}/read`, {}).pipe(
      map(res => res.data)
    );
  }

  markAllAsRead(): Observable<void> {
    return this.http.post<IApiResponse<void>>(`${this.apiUrl}/read-all`, {}).pipe(
      map(() => undefined)
    );
  }

  getUnreadCount(): Observable<number> {
    return this.http.get<IApiResponse<{ count: number }>>(`${this.apiUrl}/unread-count`).pipe(
      map(res => res.data.count)
    );
  }

  deleteNotification(id: string): Observable<void> {
    return this.http.delete<IApiResponse<void>>(`${this.apiUrl}/${id}`).pipe(
      map(() => undefined)
    );
  }
}
