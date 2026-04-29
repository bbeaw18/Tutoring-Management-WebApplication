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
    kpi: { total: number; paid: number; unpaid: number };
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
}
