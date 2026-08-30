import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '@environments/environment';
import { IPayment, IPaymentRequest, IPaymentConfirmRequest, IPaymentRejectRequest, IRevenueSchedule } from '../interfaces/payment.interface';
import { IApiResponse, IPaginationParams } from '../interfaces/api-response.interface';

@Injectable({
  providedIn: 'root'
})
export class PaymentService {
  private apiUrl = `${environment.apiUrl}/payments`;

  constructor(private http: HttpClient) {}

  getPayments(params?: IPaginationParams): Observable<IApiResponse<IPayment[]>> {
    return this.http.get<IApiResponse<IPayment[]>>(this.apiUrl, { params: params as any });
  }

  /** Manager: ยืนยันชำระค่าจ้างสอนให้ครู — บันทึก payout + ส่ง notification */
  payoutTeacher(teacherId: string, amount: number, month: string): Observable<any> {
    return this.http.post<IApiResponse<any>>(`${this.apiUrl}/teacher-payout`, { teacherId, amount, month }).pipe(
      map(res => res.data)
    );
  }

  /** รายการครูที่ชำระค่าจ้างแล้วในเดือนที่ระบุ */
  getTeacherPayouts(month: string): Observable<any[]> {
    return this.http.get<IApiResponse<any[]>>(`${this.apiUrl}/teacher-payouts`, { params: { month } as any }).pipe(
      map(res => res.data || [])
    );
  }

  getPaymentById(id: string): Observable<IPayment> {
    return this.http.get<IApiResponse<IPayment>>(`${this.apiUrl}/${id}`).pipe(
      map(res => res.data)
    );
  }

  createPayment(request: IPaymentRequest): Observable<IPayment> {
    return this.http.post<IApiResponse<IPayment>>(this.apiUrl, request).pipe(
      map(res => res.data)
    );
  }

  updatePayment(id: string, request: Partial<IPaymentRequest>): Observable<IPayment> {
    return this.http.put<IApiResponse<IPayment>>(`${this.apiUrl}/${id}`, request).pipe(
      map(res => res.data)
    );
  }

  deletePayment(id: string): Observable<void> {
    return this.http.delete<IApiResponse<void>>(`${this.apiUrl}/${id}`).pipe(
      map(() => undefined)
    );
  }

  // PUT /payments/:id/confirm  (manager/admin only)
  confirmPayment(paymentId: string, note?: string): Observable<IPayment> {
    return this.http.put<IApiResponse<IPayment>>(`${this.apiUrl}/${paymentId}/confirm`, { note }).pipe(
      map(res => res.data)
    );
  }

  // POST /payments/manual-confirm  (manager/admin only)
  // Manager ยืนยันการชำระเงินของนักเรียนเอง (กรณีนักเรียนไม่ได้ claim-transfer)
  manualConfirmPayment(scheduleId: string, studentId: string): Observable<IPayment> {
    return this.http.post<IApiResponse<IPayment>>(`${this.apiUrl}/manual-confirm`, { scheduleId, studentId }).pipe(
      map(res => res.data)
    );
  }

  // POST /payments/bulk-confirm-month  (manager/admin only)
  // Manager ยืนยันการชำระทั้งเดือนของนักเรียน — confirm pending + create-confirmed for unpaid
  bulkConfirmMonth(studentId: string, month: string): Observable<{
    confirmedFromPending: number;
    createdConfirmed: number;
    totalConfirmed: number;
    totalAmount: number;
    skippedNoAttendance: number;
  }> {
    return this.http.post<IApiResponse<any>>(`${this.apiUrl}/bulk-confirm-month`, { studentId, month }).pipe(
      map(res => res.data)
    );
  }

  // PUT /payments/:id/reject  (manager/admin only)
  rejectPayment(paymentId: string, note?: string): Observable<IPayment> {
    return this.http.put<IApiResponse<IPayment>>(`${this.apiUrl}/${paymentId}/reject`, { note }).pipe(
      map(res => res.data)
    );
  }

  // GET /payments?student=... — student can only see their own (backend enforces)
  getPaymentsByStudent(studentId: string, params?: IPaginationParams): Observable<IPayment[]> {
    return this.http.get<IApiResponse<IPayment[]>>(this.apiUrl, { params: { student: studentId, limit: '1000', ...params } as any }).pipe(
      map(res => res.data)
    );
  }

  // GET /payments/revenue/summary  (manager/admin only)
  getRevenue(params?: any): Observable<{ totalRevenue: number; transactionCount: number; courseRevenue: any }> {
    return this.http.get<IApiResponse<{ totalRevenue: number; transactionCount: number; courseRevenue: any }>>(`${this.apiUrl}/revenue/summary`, { params }).pipe(
      map(res => res.data)
    );
  }

  // GET /payments/revenue-report  (manager/admin only)
  getRevenueReport(params?: { month?: string; teacherId?: string; studentId?: string }): Observable<{
    kpi: {
      total: number; paid: number; unpaid: number;
      teacherExpense?: number;
      managerIncome?: number;
      netInstitute?: number;
    };
    schedules: IRevenueSchedule[];
  }> {
    return this.http.get<IApiResponse<any>>(`${this.apiUrl}/revenue-report`, { params: params as any }).pipe(
      map(res => res.data)
    );
  }

  // POST /payments/generate-promptpay-qr
  generatePromptpayQR(body: { scheduleId?: string; month?: string }): Observable<{
    qrDataURL: string; amount: number; description: string;
    paymentType: string; relatedSchedules: string[]; promptpayId: string;
  }> {
    return this.http.post<IApiResponse<any>>(`${this.apiUrl}/generate-promptpay-qr`, body).pipe(
      map(res => res.data)
    );
  }

  // POST /payments/kbank/create-charge — สร้าง QR + PaymentSession
  createKBankCharge(body: { scheduleId?: string; month?: string }): Observable<{
    reference: string;
    qrDataURL: string;
    amount: number;
    description: string;
    expiresAt: string;
    mode: 'kbank' | 'promptpay_fallback';
  }> {
    return this.http.post<IApiResponse<any>>(`${this.apiUrl}/kbank/create-charge`, body).pipe(
      map(res => res.data)
    );
  }

  // GET /payments/kbank/status/:reference — polling สถานะ
  getPaymentStatus(reference: string): Observable<{
    reference: string;
    status: 'pending' | 'paid' | 'failed' | 'expired';
    amount: number;
    paidAt: string | null;
    expiresAt: string;
  }> {
    return this.http.get<IApiResponse<any>>(`${this.apiUrl}/kbank/status/${reference}`).pipe(
      map(res => res.data)
    );
  }

  // ── K-BANK transfer flow (โอนตรงเข้าบัญชี + รอ Manager ยืนยัน) ──

  /** ดึงข้อมูลบัญชีธนาคารสำหรับโอนเงิน */
  getBankInfo(): Observable<{
    bankName: string;
    accountNumber: string;
    accountName: string;
    promptpayId: string;
  }> {
    return this.http.get<IApiResponse<any>>(`${this.apiUrl}/bank-info`).pipe(
      map(res => res.data)
    );
  }

  /** นักเรียนยืนยันว่าได้โอนเงินแล้ว — สร้าง Payment status='pending' รอ Manager */
  claimTransfer(body: { scheduleId?: string; month?: string; transactionRef?: string; note?: string }): Observable<{
    paymentIds: string[];
    totalAmount: number;
    description: string;
    status: 'pending';
    message: string;
  }> {
    return this.http.post<IApiResponse<any>>(`${this.apiUrl}/claim-transfer`, body).pipe(
      map(res => res.data)
    );
  }

  /** Manager ดูรายการที่รอตรวจสอบ */
  getPendingVerifications(): Observable<IPayment[]> {
    return this.http.get<IApiResponse<IPayment[]>>(`${this.apiUrl}/pending-verification`).pipe(
      map(res => res.data)
    );
  }

  /** นักเรียนดูสถานะการชำระทั้งหมดของตัวเอง */
  getMyPaymentStatus(): Observable<IPayment[]> {
    return this.http.get<IApiResponse<IPayment[]>>(`${this.apiUrl}/my-status`).pipe(
      map(res => res.data)
    );
  }

  /** Manager ดูรายการคอร์สทั้งหมด + สถานะชำระเงินรายคน */
  getCoursePayments(): Observable<ICoursePaymentGroup[]> {
    return this.http.get<IApiResponse<ICoursePaymentGroup[]>>(`${this.apiUrl}/courses`).pipe(
      map(res => res.data)
    );
  }
}

export interface ICoursePaymentGroup {
  course: { _id: string; name: string; subject: string; seriesId: string | null; seriesSize: number; scheduledDate?: string; startTime?: string; endTime?: string; coursePrice?: number; };
  teacher: any;
  students: { paymentId: string; status: 'pending' | 'confirmed' | 'rejected'; amount: number; student: any; }[];
  paidCount: number;
  totalCount: number;
  totalAmount: number;
}
