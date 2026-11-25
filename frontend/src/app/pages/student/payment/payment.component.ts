import { Component, OnInit, OnDestroy, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AttendanceService } from '../../../services/attendance.service';
import { PaymentService, TuitionQuote, TuitionRow } from '../../../services/payment.service';
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
  @Input() lineMode = false;
  loadError = '';
  private tuition = new Map<string, TuitionRow>();
  private readonly monthFormat = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit'
  });

  attendanceHistory: any[] = [];
  selectedMonth = '';

  // ── Bank Transfer Modal ──
  showPaymentModal = false;
  paymentLoading = false;
  paymentAmount = 0;
  paymentDescription = '';
  quote?: TuitionQuote;
  quoteLoading = false;
  paymentTarget: { scheduleId?: string; month?: string } = {};

  // ข้อมูลบัญชีธนาคาร
  bankInfo: { bankName: string; accountNumber: string; accountName: string; promptpayId: string } | null = null;

  // สถานะการแจ้งโอน
  transferClaimed = false;          // กดยืนยันโอนแล้วหรือยัง
  transactionRef = '';               // เลข ref slip (optional)
  claimError = '';

  // ── My payment status (รวมจาก backend) ──
  myPayments: any[] = [];

  // Classes on/after this date bill course price as rate × hours (matches backend)
  private readonly PRICE_HOURLY_FROM = new Date('2026-05-09T00:00:00+07:00');

  constructor(
    private attendanceService: AttendanceService,
    private paymentService: PaymentService
  ) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnInit(): void {
    this.selectedMonth = this.monthOf(new Date());
    this.loadHistory(this.lineMode);
    this.loadBankInfo();
  }

  private monthOf(date: string | Date): string {
    const parts = this.monthFormat.formatToParts(new Date(date));
    return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}`;
  }

  loadHistory(chooseDueMonth = false): void {
    this.loading = true;
    this.loadError = '';
    forkJoin({
      history: this.attendanceService.getMyAttendanceHistory(),
      payments: this.paymentService.getMyPaymentStatus(),
      tuition: this.paymentService.getTuition()
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ history, payments, tuition }) => {
        this.attendanceHistory = history;
        this.myPayments = payments;
        this.tuition = new Map(tuition.map(row => [row.scheduleId, row]));
        if (chooseDueMonth) this.selectedMonth = this.dueMonths.at(-1)?.month ||
          this.attendanceHistory.filter(row => row.schedule?.date)
            .map(row => this.monthOf(row.schedule.date)).sort().at(-1) || this.selectedMonth;
        this.mergePaymentStatuses();
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.tuition.clear();
        this.loadError = 'โหลดรายการค่าเรียนไม่สำเร็จ กรุณาลองอีกครั้ง';
      }
    });
  }

  get dueMonths(): { month: string; amount: number }[] {
    const months = new Map<string, number>();
    for (const row of this.tuition.values()) {
      months.set(row.month, (months.get(row.month) || 0) + row.amount);
    }
    return [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => ({ month, amount }));
  }

  payable(row: any): TuitionRow | undefined {
    return this.tuition.get(row.schedule?._id || row.schedule);
  }

  /** ดึงข้อมูลบัญชีธนาคาร — แสดงในโมดอลโอนเงิน */
  loadBankInfo(): void {
    this.paymentService.getBankInfo()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (info) => { this.bankInfo = info; },
        error: () => {
          // fallback ถ้า endpoint ยังไม่ deploy
          this.bankInfo = {
            bankName: 'ธนาคารกสิกรไทย (K-BANK)',
            accountNumber: '140-1-28661-2',
            accountName: 'น.ส. ณัฐบุษย์ เหมธนาพิพัฒน์',
            promptpayId: ''
          };
        }
      });
  }

  /** ผสานสถานะ payment เข้ากับ attendanceHistory เพื่อแสดงผล */
  private mergePaymentStatuses(): void {
    if (!this.attendanceHistory.length || !this.myPayments.length) return;
    const paymentByScheduleId = new Map<string, any>();
    for (const p of this.myPayments) {
      const sid = (p.schedule?._id || p.schedule)?.toString();
      if (!sid) continue;
      const existing = paymentByScheduleId.get(sid);
      // confirmed > pending > rejected
      const rank = { confirmed: 3, pending: 2, rejected: 1, unpaid: 0 } as any;
      if (!existing || (rank[p.status] || 0) > (rank[existing.status] || 0)) {
        paymentByScheduleId.set(sid, p);
      }
    }
    this.attendanceHistory = this.attendanceHistory.map(a => {
      const sid = (a.schedule?._id || a.schedule)?.toString();
      const p = sid ? paymentByScheduleId.get(sid) : null;
      // map status ของ Payment → field paymentStatus ที่ UI ใช้
      let paymentStatus = a.paymentStatus || 'unpaid';
      if (p) {
        if (p.status === 'confirmed')      paymentStatus = 'paid';
        else if (p.status === 'pending')   paymentStatus = 'pending';
        else if (p.status === 'rejected')  paymentStatus = 'rejected';
      }
      return { ...a, paymentStatus, paymentRecord: p || null };
    });
  }

  // ─── Filtered ────────────────────────────────────────────────
  get filteredHistory(): any[] {
    if (!this.selectedMonth) return this.attendanceHistory;
    return this.attendanceHistory.filter(a => {
      const d = a.schedule?.date;
      if (!d) return false;
      return this.monthOf(d) === this.selectedMonth;
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
    return this.selectedMonth
      ? [...this.tuition.values()].filter(row => row.month === this.selectedMonth).length
      : this.tuition.size;
  }
  get totalUnpaidAmount(): number {
    return this.dueMonths.filter(row => !this.selectedMonth || row.month === this.selectedMonth)
      .reduce((sum, row) => sum + row.amount, 0);
  }
  get totalPaidAmount(): number {
    return this.filteredHistory
      .filter(a => a.paymentStatus === 'paid')
      .reduce((s, a) => s + (a.paymentRecord?.amount ?? this.effectivePrice(a.schedule)), 0);
  }

  // ─── Effective course price (rate/hr × class hours for hourly classes) ──
  /** ชั่วโมงของคลาส — จาก totalDurationMinutes ก่อน, fallback start/end */
  classHours(s: any): number {
    if (s?.totalDurationMinutes > 0) return s.totalDurationMinutes / 60;
    if (s?.startTime && s?.endTime) {
      const [sh, sm] = String(s.startTime).split(':').map(Number);
      const [eh, em] = String(s.endTime).split(':').map(Number);
      let mins = (eh * 60 + em) - (sh * 60 + sm);
      if (mins <= 0) mins += 24 * 60; // ข้ามเที่ยงคืน (เลิกวันถัดไป)
      return mins > 0 ? mins / 60 : 0;
    }
    return 0;
  }

  /** คลาสตั้งแต่ 9 พ.ค. 2569 คิดค่าเรียนแบบ rate × ชม. */
  isPriceHourly(s: any): boolean {
    const d = s?.date ? new Date(s.date) : null;
    return !!d && !isNaN(d.getTime()) && d >= this.PRICE_HOURLY_FROM;
  }

  /** ค่าเรียนจริงต่อคลาส = อัตรา × ชม. (คลาสใหม่) หรือ flat (คลาสเก่า) */
  effectivePrice(s: any): number {
    const rate = Number(s?.coursePrice || 0);
    if (!rate) return 0;
    if (this.isPriceHourly(s)) return Math.round(rate * this.classHours(s));
    return rate;
  }

  // ─── Deadline: วันที่ 5 ของเดือนถัดไป ─────────────────────────
  get deadlineText(): string {
    if (!this.selectedMonth) return '';
    const [y, m] = this.selectedMonth.split('-').map(Number);
    const nextMonth = m === 12 ? 1 : m + 1;
    const nextYear = m === 12 ? y + 1 : y;
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    return `5 ${months[nextMonth - 1]} ${nextYear + 543}`;
  }

  /** วันที่ครบกำหนดของเดือนที่เลือก (Date object) — วันที่ 5 ของเดือนถัดไป เวลา 23:59 */
  get deadlineDate(): Date | null {
    if (!this.selectedMonth) return null;
    const [y, m] = this.selectedMonth.split('-').map(Number);
    const nextMonth = m === 12 ? 1 : m + 1;
    const nextYear = m === 12 ? y + 1 : y;
    return new Date(Date.UTC(nextYear, nextMonth - 1, 5, 16, 59, 59));
  }

  /**
   * สถานะกำหนดชำระ:
   * - 'upcoming'   = ยังอยู่ในเดือนของบิล หรือก่อนหน้านั้น (ปกติ)
   * - 'graceLast'  = อยู่ในช่วงผ่อนผัน (วันที่ 1-5 ของเดือนถัดไป)
   * - 'overdue'    = เลยวันที่ 5 ของเดือนถัดไปแล้ว (เกินกำหนด)
   */
  get deadlineStatus(): 'upcoming' | 'graceLast' | 'overdue' {
    if (!this.selectedMonth) return 'upcoming';
    const [y, m] = this.selectedMonth.split('-').map(Number);
    const now = new Date();
    const startOfNextMonth = new Date(Date.UTC(y, m, 1, -7));   // m=5 → Jun 1
    const endOfGrace = new Date(Date.UTC(y, m, 5, 16, 59, 59));       // Jun 5 23:59
    if (now < startOfNextMonth) return 'upcoming';
    if (now <= endOfGrace) return 'graceLast';
    return 'overdue';
  }

  /** จำนวนวันที่เหลือก่อนครบกำหนด — แสดงใน UI ช่วงผ่อนผัน */
  get daysRemainingToDeadline(): number {
    const d = this.deadlineDate;
    if (!d) return 0;
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  // ─── Payment Actions (K-BANK Transfer Flow) ─────────────────

  private openPaymentModal(target: { scheduleId?: string; month?: string }): void {
    this.showPaymentModal = true;
    this.paymentTarget = target;
    this.transferClaimed = false;
    this.transactionRef = '';
    this.loadQuote(true);
  }

  openPaymentQR(item: any): void {
    const scheduleId = this.payable(item)?.scheduleId;
    if (scheduleId) this.openPaymentModal({ scheduleId });
  }

  openMonthlyPaymentQR(): void {
    if (this.selectedMonth) this.openPaymentModal({ month: this.selectedMonth });
  }

  loadQuote(resume: boolean): void {
    if (this.quoteLoading || this.paymentLoading) return;
    this.quoteLoading = true;
    this.claimError = '';
    this.paymentService.generatePromptpayQR({ ...this.paymentTarget, resume })
      .pipe(takeUntil(this.destroy$)).subscribe({
        next: quote => {
          this.quoteLoading = false;
          this.quote = quote;
          this.paymentAmount = quote.amount;
          this.paymentDescription = quote.description;
        },
        error: err => {
          this.quoteLoading = false;
          this.claimError = err.error?.message || 'โหลดข้อมูลการโอนไม่สำเร็จ กรุณาลองใหม่';
        }
      });
  }

  confirmTransfer(): void {
    if (!this.quote || this.quoteLoading || this.paymentLoading) return;
    this.paymentLoading = true;
    this.claimError = '';
    this.paymentService.claimTransfer({
      quoteId: this.quote.quoteId,
      transactionRef: this.transactionRef || undefined
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.paymentLoading = false;
        this.transferClaimed = true;
        this.loadHistory();
      },
      error: err => {
        this.paymentLoading = false;
        this.claimError = err.error?.message || 'ไม่สามารถแจ้งว่าโอนแล้ว กรุณาลองใหม่';
      }
    });
  }

  /** Copy เลขบัญชีไปยัง clipboard */
  copyAccountNumber(): void {
    if (!this.bankInfo) return;
    const text = this.bankInfo.accountNumber.replace(/-/g, '');
    navigator.clipboard?.writeText(text).then(
      () => alert(`คัดลอกเลขบัญชีแล้ว: ${this.bankInfo!.accountNumber}`),
      () => {/* ignore */}
    );
  }

  closePaymentModal(): void {
    if (this.quoteLoading || this.paymentLoading) return;
    this.quote = undefined;
    this.showPaymentModal = false;
    this.paymentAmount = 0;
    this.paymentDescription = '';
    this.paymentTarget = {};
    this.transferClaimed = false;
    this.transactionRef = '';
    this.claimError = '';
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
    return t ? (t.nickname || `${t.firstName} ${t.lastName}`) : '-';
  }

  formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0 && m > 0) return `${h} ชม. ${m} นาที`;
    if (h > 0) return `${h} ชม.`;
    return `${m} นาที`;
  }
}
