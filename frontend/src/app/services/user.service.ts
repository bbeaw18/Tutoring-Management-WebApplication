import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '@environments/environment';
import { IUser } from '../interfaces/user.interface';
import { IApiResponse, IPaginationParams } from '../interfaces/api-response.interface';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private apiUrl = `${environment.apiUrl}/users`;

  constructor(private http: HttpClient) {}

  getUsers(params?: IPaginationParams): Observable<IApiResponse<IUser[]>> {
    // Default limit=1000 so we always get all users (no silent cutoff at 10)
    const merged = { limit: 1000, ...params } as any;
    return this.http.get<IApiResponse<IUser[]>>(this.apiUrl, { params: merged });
  }

  getUserById(id: string): Observable<IUser> {
    return this.http.get<IApiResponse<IUser>>(`${this.apiUrl}/${id}`).pipe(
      map(res => res.data)
    );
  }

  createUser(user: Partial<IUser>): Observable<IUser> {
    return this.http.post<IApiResponse<IUser>>(this.apiUrl, user).pipe(
      map(res => res.data)
    );
  }

  updateUser(id: string, user: Partial<IUser>): Observable<IUser> {
    return this.http.put<IApiResponse<IUser>>(`${this.apiUrl}/${id}`, user).pipe(
      map(res => res.data)
    );
  }

  deleteUser(id: string): Observable<void> {
    return this.http.delete<IApiResponse<void>>(`${this.apiUrl}/${id}`).pipe(
      map(() => undefined)
    );
  }

  getTeachers(params?: IPaginationParams): Observable<IApiResponse<IUser[]>> {
    const merged = { limit: 1000, ...params } as any;
    return this.http.get<IApiResponse<IUser[]>>(`${this.apiUrl}/teachers`, { params: merged });
  }

  /** ดึงรายชื่อครูและผู้จัดการที่สามารถสอนได้ — ใช้ใน filter ครูทุกที่
   *  includeAdmin=true → รวม admin ด้วย (ใช้ในตัวเลือกบุคลากรของรายจ่าย) */
  getTeachingStaff(includeAdmin = false): Observable<IApiResponse<IUser[]>> {
    const params = includeAdmin ? { includeAdmin: 'true' } : undefined;
    return this.http.get<IApiResponse<IUser[]>>(`${this.apiUrl}/teaching-staff`, { params: params as any });
  }

  getStudents(params?: IPaginationParams): Observable<IUser[]> {
    // ใช้ /students endpoint ที่มี dedicated route + limit=1000 เพื่อดึงทุกคน
    const merged = { limit: 1000, ...params } as any;
    return this.http.get<IApiResponse<IUser[]>>(`${this.apiUrl}/students`, { params: merged }).pipe(
      map(res => res.data || [])
    );
  }

  // Admin only: promote teacher→manager or demote manager→teacher
  // Backend expects { newRole } — NOT { role }
  changeRole(userId: string, newRole: string): Observable<IApiResponse<IUser>> {
    return this.http.put<IApiResponse<IUser>>(`${this.apiUrl}/${userId}/change-role`, { newRole });
  }

  // Admin or Manager: approve teacher registration
  approveTeacher(userId: string): Observable<IApiResponse<IUser>> {
    return this.http.put<IApiResponse<IUser>>(`${this.apiUrl}/${userId}/approve-teacher`, {});
  }

  // Admin or Manager: reject teacher registration
  rejectTeacher(userId: string, reason?: string): Observable<IApiResponse<any>> {
    return this.http.put<IApiResponse<any>>(`${this.apiUrl}/${userId}/reject-teacher`, { reason });
  }

  // Admin or Manager: get pending (unregistered) teachers
  getPendingTeachers(): Observable<IApiResponse<IUser[]>> {
    return this.http.get<IApiResponse<IUser[]>>(`${this.apiUrl}/pending-teachers`);
  }
}
