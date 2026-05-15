import { Component, OnInit, OnDestroy, DoCheck, HostListener, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ScheduleService } from '../../../services/schedule.service';
import { AuthService } from '../../../services/auth.service';
import { AttendanceService } from '../../../services/attendance.service';
import { LoadingComponent } from '../../../shared/components/loading/loading.component';
import { ISchedule } from '../../../interfaces/schedule.interface';
import { DisplayNamePipe } from '../../../shared/pipes/display-name.pipe';

type CalendarViewMode = 'monthly' | 'weekly';

@Component({
  selector: 'app-student-calendar',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, LoadingComponent, DisplayNamePipe],
  templateUrl: './student-calendar.component.html',
  styleUrls: ['./student-calendar.component.css']
})
export class StudentCalendarComponent implements OnInit, OnDestroy, DoCheck {
  private destroy$ = new Subject<void>();
  private scrolledToNow = false;

  @ViewChild('calScroll') calScrollRef!: ElementRef<HTMLElement>;

  loading = false;
  viewMode: CalendarViewMode = 'weekly';
  currentUser: any;

  currentYear = new Date().getFullYear();
  currentMonth = new Date().getMonth() + 1;
  calendarDays: Array<{ date: Date | null; schedules: ISchedule[] }> = [];

  weekStart: Date = this.getMonday(new Date());
  weekDays: Array<{ date: Date; schedules: ISchedule[] }> = [];

  selectedSchedule: ISchedule | null = null;
  showDetailModal = false;
  confirmLoading = false;
  confirmMessage = '';

  // QR Scan
  showScanModal = false;
  qrScanValue = '';
  scanLoading = false;
  scanError = '';
  scanSuccess = '';

  // ─── Time Grid Config ─────────────────────────────────────
  readonly START_HOUR = 0;
  readonly END_HOUR = 24;
  readonly HOUR_HEIGHT = 64;
  readonly hours: number[] = Array.from(
    { length: this.END_HOUR - this.START_HOUR },
    (_, i) => i + this.START_HOUR
  );

  get totalGridHeight(): number { return this.hours.length * this.HOUR_HEIGHT; }

  readonly monthNames = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                         'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  readonly dayNames = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

  constructor(
    private scheduleService: ScheduleService,
    private authService: AuthService,
    private attendanceService: AttendanceService
  ) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();
    this.loadCalendar();
    this.checkUrlForQR();
    // ── Auto-refresh เมื่อกลับมาที่ tab — เพื่อเห็นสถานะคลาสที่อัปเดต ──
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  ngDoCheck(): void {
    this.maybeScrollToNow();
  }

  /** On first weekly render, scroll the 24h grid to the current time (centred). */
  private maybeScrollToNow(): void {
    if (this.scrolledToNow) return;
    if (this.viewMode !== 'weekly' || this.loading) return;
    const el = this.calScrollRef?.nativeElement;
    if (!el || !el.clientHeight) return;
    this.scrolledToNow = true;
    const now = new Date();
    const top = (now.getHours() - this.START_HOUR + now.getMinutes() / 60) * this.HOUR_HEIGHT;
    el.scrollTop = Math.max(0, top - el.clientHeight / 2);
  }

  /** Refresh calendar เมื่อ user สลับมาที่ tab นี้ (manager อาจกดยืนยันคลาส) */
  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible' && !this.loading) {
      this.loadCalendar();
    }
  };

  checkUrlForQR(): void {
    const params = new URLSearchParams(window.location.search);
    const qrData = params.get('qr');
    if (qrData) {
      try {
        const parsed = JSON.parse(decodeURIComponent(qrData));
        this.processQRScan(parsed.scheduleId, parsed.token);
      } catch { }
    }
  }

  loadCalendar(): void {
    if (this.viewMode === 'monthly') this.loadMonthly();
    else this.loadWeekly();
  }

  loadMonthly(): void {
    this.loading = true;
    this.scheduleService.getCalendarMonthly(this.currentYear, this.currentMonth)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => { this.buildMonthlyGrid(data); this.loading = false; },
        error: () => { this.loading = false; }
      });
  }

  toLocalDateStr(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  buildMonthlyGrid(data: Record<string, ISchedule[]>): void {
    const firstDay = new Date(this.currentYear, this.currentMonth - 1, 1);
    const lastDay = new Date(this.currentYear, this.currentMonth, 0);
    const startPad = firstDay.getDay();
    this.calendarDays = [];
    for (let i = 0; i < startPad; i++) this.calendarDays.push({ date: null, schedules: [] });
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dateObj = new Date(this.currentYear, this.currentMonth - 1, d);
      const key = this.toLocalDateStr(dateObj);
      this.calendarDays.push({ date: dateObj, schedules: data[key] || [] });
    }
  }

  loadWeekly(): void {
    this.loading = true;
    const endDate = new Date(this.weekStart);
    endDate.setDate(endDate.getDate() + 6);
    this.scheduleService.getCalendarWeekly(
      this.toLocalDateStr(this.weekStart),
      this.toLocalDateStr(endDate)
    ).pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (data) => {
        this.weekDays = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(this.weekStart); d.setDate(d.getDate() + i);
          const key = this.toLocalDateStr(d);
          this.weekDays.push({ date: d, schedules: data[key] || [] });
        }
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
  }

  // ─── Navigation ───────────────────────────────────────────
  prevMonth(): void { this.currentMonth--; if (this.currentMonth < 1) { this.currentMonth = 12; this.currentYear--; } this.loadMonthly(); }
  nextMonth(): void { this.currentMonth++; if (this.currentMonth > 12) { this.currentMonth = 1; this.currentYear++; } this.loadMonthly(); }
  prevWeek(): void { this.weekStart = new Date(this.weekStart); this.weekStart.setDate(this.weekStart.getDate() - 7); this.loadWeekly(); }
  nextWeek(): void { this.weekStart = new Date(this.weekStart); this.weekStart.setDate(this.weekStart.getDate() + 7); this.loadWeekly(); }
  goToday(): void { this.weekStart = this.getMonday(new Date()); this.currentYear = new Date().getFullYear(); this.currentMonth = new Date().getMonth() + 1; this.loadCalendar(); }
  switchView(mode: CalendarViewMode): void { this.viewMode = mode; this.loadCalendar(); }

  isCurrentWeek(): boolean {
    return this.toLocalDateStr(this.weekStart) === this.toLocalDateStr(this.getMonday(new Date()));
  }

  getMonday(d: Date): Date {
    const date = new Date(d);
    const day = date.getDay();
    date.setDate(date.getDate() - day + (day === 0 ? -6 : 1));
    return date;
  }

  getWeekLabel(): string {
    const end = new Date(this.weekStart); end.setDate(end.getDate() + 6);
    return `${this.weekStart.getDate()} ${this.monthNames[this.weekStart.getMonth()]} – ${end.getDate()} ${this.monthNames[end.getMonth()]} ${this.weekStart.getFullYear() + 543}`;
  }

  // ─── Time Grid Helpers ────────────────────────────────────
  getEventTop(sch: ISchedule): number {
    if (!sch.startTime) return 0;
    const [h, m] = sch.startTime.split(':').map(Number);
    return Math.max(0, (h - this.START_HOUR + m / 60) * this.HOUR_HEIGHT);
  }

  getEventHeight(sch: ISchedule): number {
    if (!sch.startTime || !sch.endTime) return this.HOUR_HEIGHT;
    const [sh, sm] = sch.startTime.split(':').map(Number);
    const [eh, em] = sch.endTime.split(':').map(Number);
    const duration = (eh * 60 + em) - (sh * 60 + sm);
    return Math.max(duration / 60 * this.HOUR_HEIGHT, 28);
  }

  getCurrentTimeTop(): number {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes();
    if (h < this.START_HOUR || h >= this.END_HOUR) return -999;
    return (h - this.START_HOUR + m / 60) * this.HOUR_HEIGHT;
  }

  getEventBg(sch: ISchedule): string {
    if (sch.status === 'cancelled') return '#e2e8f0';
    if (sch.status === 'completed') return '#d1fae5';
    if (sch.status === 'awaiting_confirmation') return '#d1fae5';
    const myStatus = this.getMyConfirmStatusFor(sch);
    if (myStatus === 'accepted') return '#dcfce7';   // green — confirmed
    if (myStatus === 'declined') return '#f1f5f9';   // gray — declined
    if (myStatus === 'pending')  return '#fee2e2';   // red — not confirmed yet
    return '#e0e7ff';
  }
  getEventBorder(sch: ISchedule): string {
    if (sch.status === 'cancelled') return '#94a3b8';
    if (sch.status === 'completed') return '#10b981';
    if (sch.status === 'awaiting_confirmation') return '#10b981';
    const myStatus = this.getMyConfirmStatusFor(sch);
    if (myStatus === 'accepted') return '#16a34a';   // green
    if (myStatus === 'declined') return '#94a3b8';   // gray
    if (myStatus === 'pending')  return '#ef4444';   // red
    return '#6366f1';
  }
  getEventText(sch: ISchedule): string {
    if (sch.status === 'cancelled') return '#64748b';
    if (sch.status === 'completed') return '#065f46';
    if (sch.status === 'awaiting_confirmation') return '#065f46';
    const myStatus = this.getMyConfirmStatusFor(sch);
    if (myStatus === 'accepted') return '#15803d';   // green
    if (myStatus === 'declined') return '#64748b';   // gray
    if (myStatus === 'pending')  return '#dc2626';   // red
    return '#3730a3';
  }

  // ─── Modal ────────────────────────────────────────────────
  openDetail(schedule: ISchedule, event: Event): void {
    event.stopPropagation();
    this.selectedSchedule = schedule;
    this.showDetailModal = true;
    this.confirmMessage = '';
  }

  closeDetailModal(): void { this.showDetailModal = false; this.selectedSchedule = null; }

  confirmStudent(action: 'accepted' | 'declined'): void {
    if (!this.selectedSchedule) return;
    this.confirmLoading = true;
    this.scheduleService.studentConfirm(this.selectedSchedule._id, action)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
      next: (updated) => {
        this.selectedSchedule = updated;
        this.confirmMessage = action === 'accepted' ? 'ยืนยันการเข้าเรียนแล้ว' : 'ปฏิเสธนัดสอนแล้ว';
        this.confirmLoading = false;
        this.loadCalendar();
      },
      error: (err) => {
        this.confirmMessage = err.error?.message || 'เกิดข้อผิดพลาด';
        this.confirmLoading = false;
      }
    });
  }

  /** คืน true เมื่อเลยเวลาคลาสจบ + 30 นาทีแล้ว (หมดสิทธิ์ยืนยัน) */
  isConfirmDeadlinePassed(sch: ISchedule): boolean {
    if (!sch.date || !sch.endTime) return false;
    const dateStr = typeof sch.date === 'string'
      ? sch.date.split('T')[0]
      : sch.date.toISOString().split('T')[0];
    const [h, m] = sch.endTime.split(':').map(Number);
    const deadline = new Date(`${dateStr}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`);
    deadline.setMinutes(deadline.getMinutes() + 30);
    return new Date() > deadline;
  }

  getMyConfirmStatusFor(schedule: ISchedule): string {
    if (!schedule || !this.currentUser) return 'pending';
    const myId = this.currentUser._id || this.currentUser.id;
    const conf = schedule.studentConfirmations?.find(
      sc => (sc.student as any)?._id === myId || (sc.student as any) === myId
    );
    return conf?.status || 'pending';
  }

  getMyConfirmStatus(): string {
    if (!this.selectedSchedule || !this.currentUser) return 'pending';
    return this.getMyConfirmStatusFor(this.selectedSchedule);
  }

  processQRScan(scheduleId: string, token: string): void {
    this.scanLoading = true;
    this.attendanceService.scanQR(scheduleId, token)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
      next: (res) => {
        this.scanSuccess = `เช็คชื่อสำเร็จ! ${res.student?.firstName} ${res.student?.lastName}`;
        this.scanLoading = false;
        this.scanError = '';
      },
      error: (err) => {
        this.scanError = err.error?.message || 'เกิดข้อผิดพลาดในการสแกน';
        this.scanLoading = false;
      }
    });
  }

  // ─── Helpers ──────────────────────────────────────────────
  /**
   * หัวข้อในปฏิทินของนักเรียน: "ชื่อวิชา - ครู<ชื่อเล่นครู>"
   *  - ใช้ subject ก่อน (กระชับ) ถ้าไม่มีจึงใช้ name
   *  - ใช้ nickname ของครูก่อน ถ้าไม่มีใช้ firstName lastName
   *  - prefix ครู สำหรับครู/manager/admin
   */
  getCourseName(s: ISchedule): string {
    const c = s.course as any;
    const subject = typeof c === 'object' ? (c.subject || c.name || '-') : '-';
    const t = s.teacher as any;
    if (t && typeof t === 'object') {
      const teacherDisplay = t.nickname || `${t.firstName || ''} ${t.lastName || ''}`.trim();
      if (teacherDisplay) return `${subject} - ครู${teacherDisplay}`;
    }
    return subject;
  }

  getTeacherName(s: ISchedule): string {
    const t = s.teacher as any;
    if (typeof t !== 'object' || !t) return '-';
    const nick = t.nickname || `${t.firstName} ${t.lastName}`;
    return `ครู${nick}`;
  }

  getStatusLabel(s: string): string {
    return { pending: 'รอครูยืนยัน', confirmed: 'ครูยืนยันแล้ว', scheduled: 'นัดแล้ว', completed: 'เสร็จสิ้น', cancelled: 'ยกเลิก', awaiting_confirmation: 'รอ Manager ยืนยัน' }[s] || s;
  }

  getStatusClass(s: string): string {
    return { pending: 'badge-warning', confirmed: 'badge-info', scheduled: 'badge-primary', completed: 'badge-success', cancelled: 'badge-danger', awaiting_confirmation: 'badge-warning' }[s] || '';
  }

  isToday(d: Date): boolean {
    const t = new Date();
    return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  }

  /** All schedules in current week (flat) */
  get weekSchedules(): ISchedule[] {
    return this.weekDays.flatMap(d => d.schedules);
  }

  /** Count of classes in week */
  get weekTotalCount(): number {
    return this.weekSchedules.length;
  }

  /** Count of confirmed-by-me classes */
  get weekConfirmedCount(): number {
    return this.weekSchedules.filter(s => this.getMyConfirmStatusFor(s) === 'accepted').length;
  }

  /** Schedules needing my action (teacher confirmed, my status pending, not past deadline) */
  get weekPendingActions(): ISchedule[] {
    return this.weekSchedules.filter(s =>
      s.teacherConfirmed &&
      this.getMyConfirmStatusFor(s) === 'pending' &&
      s.status !== 'cancelled' &&
      !this.isConfirmDeadlinePassed(s)
    );
  }

  /** Total scheduled minutes in week */
  get weekTotalMinutes(): number {
    return this.weekSchedules.reduce((acc, s) => acc + (s.totalDurationMinutes || 0), 0);
  }

  /** Formatted hours label */
  get weekHoursLabel(): string {
    const hrs = Math.floor(this.weekTotalMinutes / 60);
    const mins = this.weekTotalMinutes % 60;
    if (hrs === 0) return `${mins} นาที`;
    if (mins === 0) return `${hrs} ชม.`;
    return `${hrs} ชม. ${mins} นาที`;
  }

  /** Total course fee for the week (effective price per class, computed by backend) */
  get weekTotalFee(): number {
    return this.weekSchedules.reduce(
      (acc, s) => acc + (s.paymentSummary?.effectivePrice || s.coursePrice || 0), 0);
  }

  /** Next upcoming class (today or future, status not cancelled) */
  get nextUpcoming(): ISchedule | null {
    const now = new Date();
    const upcoming = this.weekSchedules
      .filter(s => s.status !== 'cancelled')
      .map(s => ({
        s,
        dt: new Date(`${(typeof s.date === 'string' ? s.date.split('T')[0] : s.date?.toISOString?.().split('T')[0])}T${s.startTime || '00:00'}:00`)
      }))
      .filter(x => !isNaN(x.dt.getTime()) && x.dt.getTime() >= now.getTime())
      .sort((a, b) => a.dt.getTime() - b.dt.getTime());
    return upcoming[0]?.s || null;
  }

  /** Minutes remaining until a schedule */
  getMinutesUntilSch(sch: ISchedule): string {
    if (!sch.date || !sch.startTime) return '';
    const dateStr = typeof sch.date === 'string' ? sch.date.split('T')[0] : new Date(sch.date).toISOString().split('T')[0];
    const dt = new Date(`${dateStr}T${sch.startTime}:00`);
    const diffMs = dt.getTime() - Date.now();
    if (diffMs < 0) return 'กำลังเรียน';
    const mins = Math.round(diffMs / 60000);
    if (mins < 60) return `อีก ${mins} นาที`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `อีก ${hrs} ชม.`;
    return `อีก ${Math.round(hrs / 24)} วัน`;
  }

  /** Confirmation progress ratio */
  get weekProgressPct(): number {
    if (this.weekTotalCount === 0) return 0;
    return (this.weekConfirmedCount / this.weekTotalCount) * 100;
  }
}
