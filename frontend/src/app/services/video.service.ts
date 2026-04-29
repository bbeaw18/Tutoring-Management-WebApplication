import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '@environments/environment';
import { IVideo, IVideoCreateRequest, IVideoGrantAccessRequest, IVideoRevokeAccessRequest } from '../interfaces/video.interface';
import { IApiResponse, IPaginationParams } from '../interfaces/api-response.interface';

@Injectable({
  providedIn: 'root'
})
export class VideoService {
  private apiUrl = `${environment.apiUrl}/videos`;

  constructor(private http: HttpClient) {}

  getVideos(params?: IPaginationParams): Observable<IApiResponse<IVideo[]>> {
    return this.http.get<IApiResponse<IVideo[]>>(this.apiUrl, { params: params as any });
  }

  getVideoById(id: string): Observable<IVideo> {
    return this.http.get<IApiResponse<IVideo>>(`${this.apiUrl}/${id}`).pipe(
      map(res => res.data)
    );
  }

  createVideo(request: IVideoCreateRequest): Observable<IVideo> {
    return this.http.post<IApiResponse<IVideo>>(this.apiUrl, request).pipe(
      map(res => res.data)
    );
  }

  updateVideo(id: string, request: Partial<IVideoCreateRequest>): Observable<IVideo> {
    return this.http.put<IApiResponse<IVideo>>(`${this.apiUrl}/${id}`, request).pipe(
      map(res => res.data)
    );
  }

  deleteVideo(id: string): Observable<void> {
    return this.http.delete<IApiResponse<void>>(`${this.apiUrl}/${id}`).pipe(
      map(() => undefined)
    );
  }

  grantAccess(request: IVideoGrantAccessRequest): Observable<IVideo> {
    return this.http.post<IApiResponse<IVideo>>(`${this.apiUrl}/grant-access`, request).pipe(
      map(res => res.data)
    );
  }

  revokeAccess(request: IVideoRevokeAccessRequest): Observable<IVideo> {
    return this.http.post<IApiResponse<IVideo>>(`${this.apiUrl}/revoke-access`, request).pipe(
      map(res => res.data)
    );
  }

  getVideosByCourse(courseId: string, params?: IPaginationParams): Observable<IVideo[]> {
    return this.http.get<IApiResponse<IVideo[]>>(`${this.apiUrl}?courseId=${courseId}`, { params: params as any }).pipe(
      map(res => res.data)
    );
  }

  getGrantedVideos(studentId: string): Observable<IVideo[]> {
    return this.http.get<IApiResponse<IVideo[]>>(`${this.apiUrl}/student/${studentId}`).pipe(
      map(res => res.data)
    );
  }
}
