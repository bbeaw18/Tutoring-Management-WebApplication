import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '@environments/environment';
import { ISchedule, IScheduleCreateRequest, ICalendarEvent, IQRStatus } from '../interfaces/schedule.interface';
import { IApiResponse, IPaginationParams } from '../interfaces/api-response.interface';

@Injectable({
  providedIn: 'root'
})
export class ScheduleService {
  private apiUrl = `${environment.apiUrl}/schedules`;

  constructor(private http: HttpClient) {}

  getSchedules(params?: IPaginationParams): Observable<IApiResponse<ISchedule[]>> {
    return this.http.get<IApiResponse<ISchedule[]>>(this.apiUrl, { params: params as any });
  }

  getScheduleById(id: string): Observable<ISchedule> {
    return this.http.get<IApiResponse<ISchedule>>(`${this.apiUrl}/${id}`).pipe(
      map(res => res.data)
    );
  }

  createSchedule(request: IScheduleCreateRequest): Observable<ISchedule> {
    return this.http.post<IApiResponse<ISchedule>>(this.apiUrl, request).pipe(
      map(res => res.data)
    );
  }

  updateSchedule(id: string, request: Partial<IScheduleCreateRequest>): Observable<ISchedule> {
    return this.http.put<IApiResponse<ISchedule>>(`${this.apiUrl}/${id}`, request).pipe(
      map(res => res.data)
    );
  }

  deleteSchedule(id: string): Observable<any> {
    return this.http.delete<IApiResponse<any>>(`${this.apiUrl}/${id}`);
  }

  // ─── ปฏิทินรายเดือน ───────────────────────────────────────────
  // filterParams: { teacherId?: string, studentId?: string } — admin/manager only
  getCalendarMonthly(year: number, month: number, filterParams?: { teacherId?: string; studentId?: string }): Observable<any> {
    const params: any = { year: year.toString(), month: month.toString() };
    if (filterParams?.teacherId) params['teacherId'] = filterParams.teacherId;
    if (filterParams?.studentId) params['studentId'] = filterParams.studentId;
    return this.http.get<IApiResponse<any>>(`${this.apiUrl}/calendar`, { params }).pipe(map(res => res.data));
  }

  // ─── ปฏิทินรายสัปดาห์ ─────────────────────────────────────────
  // filterParams: { teacherId?: string, studentId?: string } — admin/manager only
  getCalendarWeekly(startDate: string, endDate: string, filterParams?: { teacherId?: string; studentId?: string }): Observable<any> {
    const params: any = { startDate, endDate };
    if (filterParams?.teacherId) params['teacherId'] = filterParams.teacherId;
    if (filterParams?.studentId) params['studentId'] = filterParams.studentId;
    return this.http.get<IApiResponse<any>>(`${this.apiUrl}/calendar/weekly`, { params }).pipe(map(res => res.data));
  }

  // เพื่อ backward compatibility
  getCalendarEvents(params?: any): Observable<any> {
    return this.http.get<IApiResponse<any>>(`${this.apiUrl}/calendar/view`, { params }).pipe(
      map(res => res.data)
    );
  }

  // ─── ยืนยันนัดสอน — ครู/Manager ────────────────────────────────
  teacherConfirm(scheduleId: string): Observable<ISchedule> {
    return this.http.post<IApiResponse<ISchedule>>(`${this.apiUrl}/${scheduleId}/confirm-teacher`, {}).pipe(
      map(res => res.data)
    );
  }

  // ─── ยืนยัน/ปฏิเสธ — นักเรียน ──────────────────────────────────
  studentConfirm(scheduleId: string, action: 'accepted' | 'declined'): Observable<ISchedule> {
    return this.http.post<IApiResponse<ISchedule>>(`${this.apiUrl}/${scheduleId}/confirm-student`, { action }).pipe(
      map(res => res.data)
    );
  }

  // ─── สร้าง QR Code ────────────────────────────────────────────
  generateQR(scheduleId: string): Observable<{ qrDataURL: string; qrToken: string; qrExpiresAt: Date; scheduleId: string }> {
    return this.http.post<IApiResponse<any>>(`${this.apiUrl}/${scheduleId}/generate-qr`, {}).pipe(
      map(res => res.data)
    );
  }

  // ─── ปิด QR ───────────────────────────────────────────────────
  closeQR(scheduleId: string): Observable<any> {
    return this.http.post<IApiResponse<any>>(`${this.apiUrl}/${scheduleId}/close-qr`, {}).pipe(
      map(res => res.data)
    );
  }

  // ─── ดูสถานะ QR + รายชื่อที่เช็คแล้ว ─────────────────────────
  getQRStatus(scheduleId: string): Observable<IQRStatus> {
    return this.http.get<IApiResponse<IQRStatus>>(`${this.apiUrl}/${scheduleId}/qr-status`).pipe(
      map(res => res.data)
    );
  }

  // ─── ย้ายเวลานัดสอน (manager/admin only) ──────────────────────
  reschedule(id: string, date: string, startTime: string, endTime: string): Observable<ISchedule> {
    return this.http.patch<IApiResponse<ISchedule>>(`${this.apiUrl}/${id}/reschedule`, { date, startTime, endTime }).pipe(
      map(res => res.data)
    );
  }

  // ─── Admin: เพิ่มนักเรียนเข้าเรียนด้วยตนเอง (ทดสอบระบบ) ──────
  manualAddAttendance(scheduleId: string, studentId: string): Observable<{
    student: { _id: string; firstName: string; lastName: string; profileImage?: string };
    scannedAt: Date;
    courseName: string;
  }> {
    return this.http.post<IApiResponse<any>>(`${environment.apiUrl}/attendance/manual-add`, { scheduleId, studentId }).pipe(
      map(res => res.data)
    );
  }

  // ─── Manager ยืนยันสำเร็จการสอน ─────────────────────────────
  managerConfirm(id: string): Observable<any> {
    return this.http.patch<IApiResponse<any>>(`${this.apiUrl}/${id}/manager-confirm`, {}).pipe(
      map(res => res.data)
    );
  }

  getSchedulesByTeacher(teacherId: string): Observable<ISchedule[]> {
    return this.http.get<IApiResponse<ISchedule[]>>(`${this.apiUrl}?teacherId=${teacherId}`).pipe(
      map(res => res.data)
    );
  }

  getSchedulesByCourse(courseId: string): Observable<ISchedule[]> {
    return this.http.get<IApiResponse<ISchedule[]>>(`${this.apiUrl}?courseId=${courseId}`).pipe(
      map(res => res.data)
    );
  }

  sendVideoLink(scheduleId: string, videoLink: string): Observable<any> {
    return this.http.post<IApiResponse<any>>(`${this.apiUrl}/${scheduleId}/send-video-link`, { videoLink }).pipe(
      map(res => res.data)
    );
  }
}
