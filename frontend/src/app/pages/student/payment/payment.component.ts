import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, interval } from 'rxjs';
import { takeUntil, switchMap, filter, take } from 'rxjs/operators';
import { AttendanceService } from '../../../services/attendance.service';
import { PaymentService } from '../../../services/payment.service';
import { AuthService } from '../../../services/auth.service';
import { LoadingComponent } from '../../../shared/components/loading/loading.component';
import { MonthPickerComponent } from '../../../shared/components/month-picker/month-picker.component';

@Component({
  selector: 'app-payment',
  standalone: true,
  imports: [CommonModule, FormsModule, LoadingComponent, MonthPickerComponent],
  templateUrl: './payment.component.html',
  styleUrls: ['./payment.component.css']
})
export class PaymentComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  loading = false;
  currentUser: any;

  attendanceHistory: any[] = [];
  selectedMonth = '';

  // Payment QR Modal
  showPaymentModal = false;
  paymentQrDataURL = '';
  paymentAmount = 0;
  paymentDescription = '';
  paymentLoading = false;

  // KBank payment session
  paymentReference = '';
  paymentStatus: 'idle' | 'pending' | 'paid' | 'failed' | 'expired' = 'idle';
  paymentExpiresAt: Date | null = null;
  paymentMode: 'kbank' | 'promptpay_fallback' = 'promptpay_fallback';
  private stopPolling$ = new Subject<void>();

  constructor(
    private attendanceService: AttendanceService,
    private paymentService: PaymentService,
    private authService: AuthService
  ) {}

  ngOnDestroy(): void {
    this.stopPolling$.next();
    this.stopPolling$.complete();
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();
    const now = new Date();
    this.selectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    this.loadHistory();
  }

  loadHistory(): void {
    this.loading = true;
    this.attendanceService.getMyAttendanceHistory()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => { this.attendanceHistory = data || []; this.loading = false; },
        error: () => { this.loading = false; }
      });
  }

  // ─── Filtered ────────────────────────────────────────────────
  get filteredHistory(): any[] {
    if (!this.selectedMonth) return this.attendanceHistory;
    return this.attendanceHistory.filter(a => {
      const d = a.schedule?.date;
      if (!d) return false;
      const m = new Date(d);
      const ym = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
      return ym === this.selectedMonth;
    });
  }

  // ─── KPI ─────────────────────────────────────────────────────
  get paidCount(): number {
    return this.filteredHistory.filter(a => a.paymentStatus === 'paid').length;
  }
  get pendingCount(): number {
    return this.filteredHistory.filter(a => a.paymentStatus === 'pending').length;
  }
  get unpaidCount(): number {
    return this.filteredHistory.filter(a => !a.paymentStatus || a.paymentStatus === 'unpaid').length;
  }
  get totalUnpaidAmount(): number {
    return this.filteredHistory
      .filter(a => !a.paymentStatus || a.paymentStatus === 'unpaid')
      .reduce((s, a) => s + (a.schedule?.coursePrice || 0), 0);
  }
  get totalPaidAmount(): number {
    return this.filteredHistory
      .filter(a => a.paymentStatus === 'paid')
      .reduce((s, a) => s + (a.schedule?.coursePrice || 0), 0);
  }

  // ─── Deadline: วันที่ 3 ของเดือนถัดไป ─────────────────────────
  get deadlineText(): string {
    if (!this.selectedMonth) return '';
    const [y, m] = this.selectedMonth.split('-').map(Number);
    const nextMonth = m === 12 ? 1 : m + 1;
    const nextYear = m === 12 ? y + 1 : y;
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    return `3 ${months[nextMonth - 1]} ${nextYear + 543}`;
  }

  // ─── Payment Actions ─────────────────────────────────────────

  private openPaymentModal(body: { scheduleId?: string; month?: string }): void {
    this.paymentLoading = true;
    this.showPaymentModal = true;
    this.paymentQrDataURL = '';
    this.paymentAmount = 0;
    this.paymentReference = '';
    this.paymentStatus = 'idle';
    this.stopPolling$.next(); // หยุด polling เดิม

    this.paymentService.createKBankCharge(body)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.paymentQrDataURL = res.qrDataURL;
          this.paymentAmount = res.amount;
          this.paymentDescription = res.description;
          this.paymentReference = res.reference;
          this.paymentMode = res.mode;
          this.paymentExpiresAt = new Date(res.expiresAt);
          this.paymentStatus = 'pending';
          this.paymentLoading = false;
          this.startPolling(res.reference);
        },
        error: (err) => {
          alert(err?.error?.message || 'ไม่สามารถสร้าง QR ได้');
          this.showPaymentModal = false;
          this.paymentLoading = false;
        }
      });
  }

  openPaymentQR(scheduleId: string): void {
    this.openPaymentModal({ scheduleId });
  }

  openMonthlyPaymentQR(): void {
    if (!this.selectedMonth) return;
    this.openPaymentModal({ month: this.selectedMonth });
  }

  /** Polling สถานะทุก 3 วินาที จนกว่าจะ paid / failed / expired */
  private startPolling(reference: string): void {
    this.stopPolling$.next();
    interval(3000)
      .pipe(
        takeUntil(this.stopPolling$),
        takeUntil(this.destroy$),
        switchMap(() => this.paymentService.getPaymentStatus(reference)),
        filter(s => s.status !== 'pending')  // หยุดเมื่อสถานะเปลี่ยน
      )
      .subscribe({
        next: (result) => {
          this.paymentStatus = result.status;
          this.stopPolling$.next(); // หยุด polling
          if (result.status === 'paid') {
            // reload ข้อมูลหลังจ่ายแล้ว
            setTimeout(() => {
              this.loadHistory();
              this.closePaymentModal();
            }, 3000);
          }
        },
        error: (err) => console.warn('[Payment] polling error (will retry):', err?.status || err)
      });
  }

  closePaymentModal(): void {
    this.stopPolling$.next();
    this.showPaymentModal = false;
    this.paymentQrDataURL = '';
    this.paymentAmount = 0;
    this.paymentDescription = '';
    this.paymentReference = '';
    this.paymentStatus = 'idle';
  }

  // ─── Helpers ─────────────────────────────────────────────────
  formatMonth(ym: string): string {
    if (!ym) return 'ทั้งหมด';
    const [y, m] = ym.split('-');
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    return `${months[parseInt(m) - 1]} ${parseInt(y) + 543}`;
  }

  getCourseName(a: any): string {
    return a.schedule?.course?.name || '-';
  }

  getTeacherName(a: any): string {
    const t = a.schedule?.teacher;
    return t ? `${t.firstName} ${t.lastName}` : '-';
  }

  formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0 && m > 0) return `${h} ชม. ${m} นาที`;
    if (h > 0) return `${h} ชม.`;
    return `${m} นาที`;
  }
}
