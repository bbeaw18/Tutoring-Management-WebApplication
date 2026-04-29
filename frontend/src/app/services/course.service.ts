import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '@environments/environment';
import { ICourse, ICourseCreateRequest } from '../interfaces/course.interface';
import { IApiResponse, IPaginationParams } from '../interfaces/api-response.interface';

@Injectable({
  providedIn: 'root'
})
export class CourseService {
  private apiUrl = `${environment.apiUrl}/courses`;

  constructor(private http: HttpClient) {}

  getCourses(params?: IPaginationParams): Observable<IApiResponse<ICourse[]>> {
    return this.http.get<IApiResponse<ICourse[]>>(this.apiUrl, { params: params as any });
  }

  getCourseById(id: string): Observable<ICourse> {
    return this.http.get<IApiResponse<ICourse>>(`${this.apiUrl}/${id}`).pipe(
      map(res => res.data)
    );
  }

  createCourse(request: ICourseCreateRequest): Observable<ICourse> {
    return this.http.post<IApiResponse<ICourse>>(this.apiUrl, request).pipe(
      map(res => res.data)
    );
  }

  updateCourse(id: string, request: Partial<ICourseCreateRequest>): Observable<ICourse> {
    return this.http.put<IApiResponse<ICourse>>(`${this.apiUrl}/${id}`, request).pipe(
      map(res => res.data)
    );
  }

  // ยกเลิก (ตั้ง status = 'cancelled')
  deleteCourse(id: string): Observable<void> {
    return this.http.delete<IApiResponse<void>>(`${this.apiUrl}/${id}`).pipe(
      map(() => undefined)
    );
  }

  // ลบออกถาวร (เฉพาะ status = 'cancelled')
  permanentDeleteCourse(id: string): Observable<void> {
    return this.http.delete<IApiResponse<void>>(`${this.apiUrl}/${id}/permanent`).pipe(
      map(() => undefined)
    );
  }

  // แก้ไขรายละเอียดนัดสอน + อัพเดต Schedule + ส่งอีเมล
  editCourseBooking(id: string, data: Partial<ICourseCreateRequest & { description?: string }>): Observable<ICourse> {
    return this.http.patch<IApiResponse<ICourse>>(`${this.apiUrl}/${id}/edit-booking`, data).pipe(
      map(res => res.data)
    );
  }

  acceptCourse(courseId: string): Observable<ICourse> {
    return this.http.put<IApiResponse<ICourse>>(`${this.apiUrl}/${courseId}/accept`, {}).pipe(
      map(res => res.data)
    );
  }

  rejectCourse(courseId: string, reason?: string): Observable<ICourse> {
    return this.http.put<IApiResponse<ICourse>>(`${this.apiUrl}/${courseId}/reject`, { reason }).pipe(
      map(res => res.data)
    );
  }

  getCoursesByTeacher(teacherId: string, params?: IPaginationParams): Observable<ICourse[]> {
    return this.http.get<IApiResponse<ICourse[]>>(`${this.apiUrl}/teacher/${teacherId}`, { params: params as any }).pipe(
      map(res => res.data || [])
    );
  }

  // GET /courses — backend filters by student role from JWT token automatically
  getCoursesByStudent(studentId?: string): Observable<ICourse[]> {
    return this.http.get<IApiResponse<ICourse[]>>(this.apiUrl, {
      params: { limit: '1000' }
    }).pipe(
      map(res => res.data || [])
    );
  }

  // GET /courses/meta/subjects — วิชาที่เคยสร้างมา (สำหรับ datalist)
  getSubjects(): Observable<string[]> {
    return this.http.get<IApiResponse<string[]>>(`${this.apiUrl}/meta/subjects`).pipe(
      map(res => res.data || [])
    );
  }

  // GET /courses/meta/teaching-types — ประเภทการสอนที่เคยสร้างมา (สำหรับ datalist)
  getTeachingTypes(): Observable<string[]> {
    return this.http.get<IApiResponse<string[]>>(`${this.apiUrl}/meta/teaching-types`).pipe(
      map(res => res.data || [])
    );
  }
}
