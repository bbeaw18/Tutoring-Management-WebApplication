import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '@environments/environment';
import { IApiResponse } from '../interfaces/api-response.interface';
import { IAttendanceRecord } from '../interfaces/schedule.interface';

@Injectable({
  providedIn: 'root'
})
export class AttendanceService {
  private apiUrl = `${environment.apiUrl}/attendance`;

  constructor(private http: HttpClient) {}

  // นักเรียนสแกน QR
  scanQR(scheduleId: string, token: string): Observable<any> {
    return this.http.post<IApiResponse<any>>(`${this.apiUrl}/scan`, { scheduleId, token }).pipe(
      map(res => res.data)
    );
  }

  // ดูรายชื่อผู้เช็คชื่อ (teacher/manager)
  getAttendanceBySchedule(scheduleId: string): Observable<IAttendanceRecord[]> {
    return this.http.get<IApiResponse<IAttendanceRecord[]>>(`${this.apiUrl}/schedule/${scheduleId}`).pipe(
      map(res => res.data)
    );
  }

  // ประวัติการเรียนของนักเรียน
  getMyAttendanceHistory(): Observable<any[]> {
    return this.http.get<IApiResponse<any[]>>(`${this.apiUrl}/my`).pipe(
      map(res => res.data)
    );
  }

  // ประวัติการสอนของครู/manager (พร้อม filter)
  getTeacherHistory(params?: { teacherId?: string; month?: string }): Observable<any[]> {
    let httpParams: any = {};
    if (params?.teacherId) httpParams['teacherId'] = params.teacherId;
    if (params?.month)     httpParams['month']     = params.month;
    return this.http.get<IApiResponse<any[]>>(`${this.apiUrl}/teacher-history`, { params: httpParams }).pipe(
      map(res => res.data)
    );
  }
}
