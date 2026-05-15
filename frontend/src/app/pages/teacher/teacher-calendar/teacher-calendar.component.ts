import { Component, OnInit, OnDestroy, HostListener, ViewChild, ElementRef, AfterViewInit, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { gsap } from 'gsap';
import { ScheduleService } from '../../../services/schedule.service';
import { AuthService } from '../../../services/auth.service';
import { LoadingComponent } from '../../../shared/components/loading/loading.component';
import { ISchedule } from '../../../interfaces/schedule.interface';

type CalendarViewMode = 'monthly' | 'weekly';

@Component({
  selector: 'app-teacher-calendar',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, LoadingComponent],
  templateUrl: './teacher-calendar.component.html',
  styleUrls: ['./teacher-calendar.component.css']
})
export class TeacherCalendarComponent implements OnInit, OnDestroy, AfterViewInit {
  private destroy$ = new Subject<void>();

  @ViewChild('calScroll') calScrollRef!: ElementRef<HTMLElement>;
  @ViewChild('weekTotalEl') weekTotalEl?: ElementRef<HTMLElement>;
  private lastCountedTotal = -1;
  private scrolledToNow = false;

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

  // Classes on/after this date bill teacher income as rate × hours (matches backend)
  private readonly TEACHER_HOURLY_FROM = new Date('2026-05-08T00:00:00+07:00');

  constructor(
    private scheduleService: ScheduleService,
    private authService: AuthService,
    private ngZone: NgZone
  ) {}

  ngAfterViewInit(): void {
    queueMicrotask(() => this.maybeAnimateEarnings());
  }

  ngDoCheck(): void {
    this.maybeAnimateEarnings();
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

  /** Count-up animation when the weekly total income changes. */
  private maybeAnimateEarnings(): void {
    if (this.viewMode !== 'weekly') return;
    const el = this.weekTotalEl?.nativeElement;
    if (!el) return;
    const target = this.weekTotalIncome;
    if (target === this.lastCountedTotal) return;
    this.lastCountedTotal = target;

    if (typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = this.formatNumber(target);
      return;
    }

    const startStr = (el.textContent || '0').replace(/,/g, '');
    const from = Number(startStr) || 0;
    const obj = { v: from };
    this.ngZone.runOutsideAngular(() => {
      gsap.to(obj, {
        v: target,
        duration: 0.9,
        ease: 'power3.out',
        onUpdate: () => {
          el.textContent = this.formatNumber(Math.round(obj.v));
        }
      });
    });
  }

  private formatNumber(n: number): string {
    return n.toLocaleString('en-US');
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();
    this.loadCalendar();
    // ── Auto-refresh เมื่อกลับมาที่ tab — เพื่อเห็นสถานะที่ Manager อัปเดต ──
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  /** Refresh calendar เมื่อ user สลับมาที่ tab นี้ (manager อาจอัปเดต status ระหว่างที่ tab inactive) */
  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible' && !this.loading) {
      this.loadCalendar();
    }
  };

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
    if (sch.isFullyConfirmed) return '#dbeafe';
    if (!sch.teacherConfirmed) return '#fef9c3';
    return '#e0e7ff';
  }
  getEventBorder(sch: ISchedule): string {
    if (sch.status === 'cancelled') return '#94a3b8';
    if (sch.status === 'completed') return '#10b981';
    if (sch.isFullyConfirmed) return '#3b82f6';
    if (!sch.teacherConfirmed) return '#f59e0b';
    return '#6366f1';
  }
  getEventText(sch: ISchedule): string {
    if (sch.status === 'cancelled') return '#64748b';
    if (sch.status === 'completed') return '#065f46';
    if (sch.isFullyConfirmed) return '#1d4ed8';
    if (!sch.teacherConfirmed) return '#92400e';
    return '#3730a3';
  }

  // ─── Modal ────────────────────────────────────────────────
  openDetail(schedule: ISchedule, event: Event): void {
    event.stopPropagation();
    this.selectedSchedule = schedule;
    this.showDetailModal = true;
  }

  closeDetailModal(): void { this.showDetailModal = false; this.selectedSchedule = null; }

  confirmAsTeacher(): void {
    if (!this.selectedSchedule) return;
    this.confirmLoading = true;
    this.scheduleService.teacherConfirm(this.selectedSchedule._id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updated) => { this.selectedSchedule = updated; this.confirmLoading = false; this.loadCalendar(); },
        error: () => { this.confirmLoading = false; }
      });
  }

  // ─── Helpers ──────────────────────────────────────────────
  /**
   * หัวข้อในปฏิทินของครู: "ชื่อวิชา - น้อง<ชื่อเล่นนักเรียน>(s)"
   *  - ถ้ามีนักเรียน 1 คน → "subject - น้องnick"
   *  - ถ้ามีหลายคน → "subject - น้องnick1, น้องnick2 (+N)"
   */
  getCourseName(s: ISchedule): string {
    const c = s.course as any;
    const subject = typeof c === 'object' ? (c.subject || c.name || '-') : '-';
    const students: any[] = Array.isArray(s.students) ? s.students : [];
    const nicks = students
      .filter(st => st && typeof st === 'object')
      .map(st => st.nickname || `${st.firstName || ''} ${st.lastName || ''}`.trim())
      .filter(Boolean)
      .map(n => `น้อง${n}`);
    if (nicks.length === 0) return subject;
    if (nicks.length === 1) return `${subject} - ${nicks[0]}`;
    if (nicks.length === 2) return `${subject} - ${nicks[0]}, ${nicks[1]}`;
    return `${subject} - ${nicks[0]}, ${nicks[1]} +${nicks.length - 2}`;
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

  /** Flat list of this week's schedules */
  get weekSchedules(): ISchedule[] {
    return this.weekDays.flatMap(d => d.schedules);
  }

  /** Estimate income per schedule — prefers group rate when multiple students */
  private scheduleIncome(s: ISchedule): number {
    const studentCount = (s.students as any[])?.length || 0;
    const course = (typeof s.course === 'object' && s.course) ? s.course : null;
    const groupRate = Number(s.teacherIncomeGroup || course?.teacherIncomeGroup || 0);
    const indivRate = Number(s.teacherIncomeIndividual || course?.teacherIncomeIndividual || 0);
    const rate = studentCount > 1 ? groupRate : indivRate;
    if (!rate) return 0;
    const d = s.date ? new Date(s.date) : null;
    const isHourly = !!d && !isNaN(d.getTime()) && d >= this.TEACHER_HOURLY_FROM;
    if (isHourly && s.totalDurationMinutes > 0) {
      return Math.round(rate * (s.totalDurationMinutes / 60));
    }
    return rate;
  }

  get weekTotalIncome(): number {
    return this.weekSchedules
      .filter(s => s.status !== 'cancelled')
      .reduce((acc, s) => acc + this.scheduleIncome(s), 0);
  }

  get weekConfirmedIncome(): number {
    return this.weekSchedules
      .filter(s => s.status !== 'cancelled' && s.teacherConfirmed)
      .reduce((acc, s) => acc + this.scheduleIncome(s), 0);
  }

  get weekPendingIncome(): number {
    return this.weekTotalIncome - this.weekConfirmedIncome;
  }

  get weekClassCount(): number {
    return this.weekSchedules.filter(s => s.status !== 'cancelled').length;
  }

  get weekPendingCount(): number {
    return this.weekSchedules.filter(s => !s.teacherConfirmed && s.status !== 'cancelled').length;
  }

  get weekHoursTotal(): number {
    const mins = this.weekSchedules
      .filter(s => s.status !== 'cancelled')
      .reduce((acc, s) => acc + (s.totalDurationMinutes || 0), 0);
    return Math.round((mins / 60) * 10) / 10;
  }

  get weekIncomeProgressPct(): number {
    if (this.weekTotalIncome === 0) return 0;
    return (this.weekConfirmedIncome / this.weekTotalIncome) * 100;
  }

  /** Daily income bars within the week */
  get weekDailyIncome(): { label: string; isToday: boolean; income: number; heightPct: number }[] {
    const bars = this.weekDays.map(d => {
      const income = d.schedules
        .filter(s => s.status !== 'cancelled')
        .reduce((acc, s) => acc + this.scheduleIncome(s), 0);
      return {
        label: this.dayNames[d.date.getDay()],
        isToday: this.isToday(d.date),
        income,
        heightPct: 0
      };
    });
    const max = Math.max(1, ...bars.map(b => b.income));
    return bars.map(b => ({ ...b, heightPct: (b.income / max) * 100 }));
  }

  /** Pending schedule items needing teacher confirmation */
  get weekPendingList(): ISchedule[] {
    return this.weekSchedules
      .filter(s => !s.teacherConfirmed && s.status !== 'cancelled')
      .slice(0, 4);
  }
}
