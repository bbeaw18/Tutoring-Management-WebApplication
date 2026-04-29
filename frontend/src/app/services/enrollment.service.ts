import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '@environments/environment';
import { IEnrollment, IEnrollmentRequest } from '../interfaces/enrollment.interface';
import { IApiResponse, IPaginationParams } from '../interfaces/api-response.interface';

@Injectable({
  providedIn: 'root'
})
export class EnrollmentService {
  private apiUrl = `${environment.apiUrl}/enrollments`;

  constructor(private http: HttpClient) {}

  getEnrollments(params?: IPaginationParams): Observable<IApiResponse<IEnrollment[]>> {
    return this.http.get<IApiResponse<IEnrollment[]>>(this.apiUrl, { params: params as any });
  }

  getEnrollmentById(id: string): Observable<IEnrollment> {
    return this.http.get<IApiResponse<IEnrollment>>(`${this.apiUrl}/${id}`).pipe(
      map(res => res.data)
    );
  }

  createEnrollment(request: IEnrollmentRequest): Observable<IEnrollment> {
    return this.http.post<IApiResponse<IEnrollment>>(this.apiUrl, request).pipe(
      map(res => res.data)
    );
  }

  updateEnrollment(id: string, request: Partial<IEnrollmentRequest>): Observable<IEnrollment> {
    return this.http.put<IApiResponse<IEnrollment>>(`${this.apiUrl}/${id}`, request).pipe(
      map(res => res.data)
    );
  }

  deleteEnrollment(id: string): Observable<void> {
    return this.http.delete<IApiResponse<void>>(`${this.apiUrl}/${id}`).pipe(
      map(() => undefined)
    );
  }

  getEnrollmentsByStudent(studentId: string, params?: IPaginationParams): Observable<IEnrollment[]> {
    return this.http.get<IApiResponse<IEnrollment[]>>(`${this.apiUrl}?studentId=${studentId}`, { params: params as any }).pipe(
      map(res => res.data)
    );
  }

  getEnrollmentsByCourse(courseId: string, params?: IPaginationParams): Observable<IEnrollment[]> {
    return this.http.get<IApiResponse<IEnrollment[]>>(`${this.apiUrl}?courseId=${courseId}`, { params: params as any }).pipe(
      map(res => res.data)
    );
  }
}
