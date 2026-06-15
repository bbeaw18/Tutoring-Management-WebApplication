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
  @ViewChild('calInner') calInnerRef!: ElementRef<HTMLElement>;
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

  // ─── Drag-to-reschedule (snap 30 min, cross-column = เปลี่ยนวัน) ─
  private readonly SNAP_MINUTES = 30;
  private readonly DRAG_THRESHOLD_PX = 3;
  // ── Click-and-hold gate: ครูต้องกดค้าง 1.3 วินาที ก่อน drag จะ arm ──
  readonly HOLD_DURATION_MS = 1300;
  readonly HOLD_MOVE_TOLERANCE_PX = 6;
  draggingId: string | null = null;
  private dragSch: ISchedule | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOriginalTop = 0;
  private dragOriginalDayIndex = 0;
  dragPreviewTop = 0;
  dragPreviewStart = '';
  dragPreviewEnd = '';
  dragPreviewDayIndex = 0;
  dragPreviewTranslateX = 0;
  private dragColRects: { left: number; width: number }[] = [];
  private dragMoved = false;
  private dragSubmitting = false;
  dragError = '';
  // hold state
  holdScheduleId: string | null = null;
  holdProgress = 0;
  private holdStartX = 0;
  private holdStartY = 0;
  private holdStartTime = 0;
  private holdTimer: any = null;
  private holdProgressInterval: any = null;
  private holdContext: { sch: ISchedule; dayIndex: number; ev: MouseEvent } | null = null;

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
    const s = this.minOf(sch.startTime), e = this.minOf(sch.endTime);
    // Overnight: first segment runs start → end of grid (24:00)
    const duration = e <= s ? (this.END_HOUR * 60 - s) : (e - s);
    return Math.max(duration / 60 * this.HOUR_HEIGHT, 28);
  }

  // ─── Overnight (cross-midnight) support ───────────────────
  private minOf(t?: string): number {
    if (!t) return -1;
    const [h, m] = String(t).split(':').map(Number);
    return (isNaN(h) || isNaN(m)) ? -1 : h * 60 + m;
  }

  isOvernight(sch: ISchedule): boolean {
    const s = this.minOf(sch?.startTime), e = this.minOf(sch?.endTime);
    return s >= 0 && e >= 0 && e <= s;
  }

  /** Tail segments (00:00 → end) carried from the previous day's column */
  overnightTails(di: number): ISchedule[] {
    if (di <= 0 || !this.weekDays[di - 1]) return [];
    return (this.weekDays[di - 1].schedules || []).filter(s => this.isOvernight(s));
  }

  // trackBy — กัน DOM teardown ตอน schedule list ถูกแทนใหม่
  trackBySchedule = (_: number, s: any): string => s?._id || s?.id || '';

  getTailHeight(sch: ISchedule): number {
    const e = this.minOf(sch?.endTime);
    if (e < 0) return this.HOUR_HEIGHT;
    return Math.max((e / 60) * this.HOUR_HEIGHT, 22);
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

  // ─── Drag-to-reschedule ───────────────────────────────────
  /** คลาสนี้ครูเลื่อนได้หรือไม่ (เฉพาะคลาสยังไม่จบ/ยกเลิก/รอ manager) */
  canDragSchedule(sch: ISchedule): boolean {
    const blocked = ['completed', 'cancelled', 'awaiting_confirmation'];
    return !blocked.includes(sch.status as string);
  }

  onEventMouseDown(sch: ISchedule, dayIndex: number, ev: MouseEvent): void {
    if (ev.button !== 0) return;
    if (!this.canDragSchedule(sch)) {
      this.openDetail(sch, ev);
      return;
    }
    // อย่า preventDefault ตอนนี้ — ถ้าผู้ใช้ปล่อยก่อนครบ 1.3s ให้ click ปกติ (เปิด detail)
    ev.stopPropagation();
    this.cancelHold();
    this.holdScheduleId = sch._id;
    this.holdProgress = 0;
    this.holdStartX = ev.clientX;
    this.holdStartY = ev.clientY;
    this.holdStartTime = Date.now();
    this.holdContext = { sch, dayIndex, ev };
    this.holdProgressInterval = setInterval(() => {
      const elapsed = Date.now() - this.holdStartTime;
      this.holdProgress = Math.min(100, Math.round((elapsed / this.HOLD_DURATION_MS) * 100));
    }, 33);
    this.holdTimer = setTimeout(() => this.armDrag(), this.HOLD_DURATION_MS);
    document.addEventListener('mousemove', this.onHoldMove);
    document.addEventListener('mouseup', this.onHoldRelease);
  }

  private onHoldMove = (ev: MouseEvent): void => {
    if (!this.holdScheduleId || this.draggingId) return;
    const dx = ev.clientX - this.holdStartX;
    const dy = ev.clientY - this.holdStartY;
    if (dx * dx + dy * dy > this.HOLD_MOVE_TOLERANCE_PX * this.HOLD_MOVE_TOLERANCE_PX) {
      this.cancelHold();
    }
  };

  private onHoldRelease = (ev: MouseEvent): void => {
    if (!this.holdScheduleId || this.draggingId) return;
    const ctx = this.holdContext;
    this.cancelHold();
    if (ctx) this.openDetail(ctx.sch, ev);
  };

  private cancelHold(): void {
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null; }
    if (this.holdProgressInterval) { clearInterval(this.holdProgressInterval); this.holdProgressInterval = null; }
    document.removeEventListener('mousemove', this.onHoldMove);
    document.removeEventListener('mouseup', this.onHoldRelease);
    this.holdScheduleId = null;
    this.holdProgress = 0;
    this.holdContext = null;
  }

  /** ครบ 1.3 วินาที — เริ่ม drag จริง */
  private armDrag(): void {
    const ctx = this.holdContext;
    if (!ctx) return;
    if (this.holdProgressInterval) { clearInterval(this.holdProgressInterval); this.holdProgressInterval = null; }
    document.removeEventListener('mousemove', this.onHoldMove);
    document.removeEventListener('mouseup', this.onHoldRelease);
    const { sch, dayIndex, ev } = ctx;
    this.holdScheduleId = null;
    this.holdProgress = 100;
    this.holdContext = null;
    try { (navigator as any).vibrate?.(35); } catch { /* ignore */ }
    this.draggingId = sch._id;
    this.dragSch = sch;
    this.dragStartX = ev.clientX;
    this.dragStartY = ev.clientY;
    this.dragOriginalTop = this.getEventTop(sch);
    this.dragOriginalDayIndex = dayIndex;
    this.dragPreviewTop = this.dragOriginalTop;
    this.dragPreviewStart = sch.startTime;
    this.dragPreviewEnd = sch.endTime;
    this.dragPreviewDayIndex = dayIndex;
    this.dragPreviewTranslateX = 0;
    this.dragMoved = false;
    this.dragColRects = this.captureColRects();
    document.addEventListener('mousemove', this.onDragMove);
    document.addEventListener('mouseup', this.onDragUp);
  }

  /** Cache bounding rects ของ 7 day columns (สำหรับ hit-test ตอน drag) */
  private captureColRects(): { left: number; width: number }[] {
    const inner = this.calInnerRef?.nativeElement;
    if (!inner) return [];
    const cols = Array.from(inner.querySelectorAll<HTMLElement>('.gcal-day-col'));
    return cols.map(c => {
      const r = c.getBoundingClientRect();
      return { left: r.left, width: r.width };
    });
  }

  private onDragMove = (ev: MouseEvent): void => {
    if (!this.draggingId || !this.dragSch) return;
    const deltaY = ev.clientY - this.dragStartY;
    const deltaX = ev.clientX - this.dragStartX;
    if (Math.abs(deltaY) > this.DRAG_THRESHOLD_PX || Math.abs(deltaX) > this.DRAG_THRESHOLD_PX) {
      this.dragMoved = true;
    }
    if (!this.dragMoved) return;

    // ── vertical: เวลาใหม่ (snap 30 min) ──
    const snapPx = this.HOUR_HEIGHT * (this.SNAP_MINUTES / 60);
    const snappedDeltaY = Math.round(deltaY / snapPx) * snapPx;
    const startMinOrig = this.minOf(this.dragSch.startTime);
    const endMinOrig = this.minOf(this.dragSch.endTime);
    let dur = endMinOrig - startMinOrig;
    if (dur <= 0) dur = (this.END_HOUR * 60) - startMinOrig;
    let newStartMin = startMinOrig + (snappedDeltaY / this.HOUR_HEIGHT) * 60;
    const minStart = this.START_HOUR * 60;
    const maxStart = this.END_HOUR * 60 - dur;
    newStartMin = Math.max(minStart, Math.min(newStartMin, maxStart));
    this.dragPreviewTop = (newStartMin - this.START_HOUR * 60) / 60 * this.HOUR_HEIGHT;
    this.dragPreviewStart = this.minToTimeStr(newStartMin);
    this.dragPreviewEnd = this.minToTimeStr(newStartMin + dur);

    // ── horizontal: วันใหม่ (hit-test กับ day columns) ──
    let newDayIndex = this.dragOriginalDayIndex;
    for (let i = 0; i < this.dragColRects.length; i++) {
      const r = this.dragColRects[i];
      if (ev.clientX >= r.left && ev.clientX < r.left + r.width) {
        newDayIndex = i;
        break;
      }
    }
    if (this.dragColRects.length > 0) {
      const first = this.dragColRects[0];
      const last = this.dragColRects[this.dragColRects.length - 1];
      if (ev.clientX < first.left) newDayIndex = 0;
      else if (ev.clientX >= last.left + last.width) newDayIndex = this.dragColRects.length - 1;
    }
    this.dragPreviewDayIndex = newDayIndex;
    const origRect = this.dragColRects[this.dragOriginalDayIndex];
    const newRect = this.dragColRects[newDayIndex];
    this.dragPreviewTranslateX = (origRect && newRect) ? (newRect.left - origRect.left) : 0;
  };

  private onDragUp = (ev: MouseEvent): void => {
    document.removeEventListener('mousemove', this.onDragMove);
    document.removeEventListener('mouseup', this.onDragUp);
    const sch = this.dragSch;
    const moved = this.dragMoved;
    const newStart = this.dragPreviewStart;
    const newEnd = this.dragPreviewEnd;
    const newDayIndex = this.dragPreviewDayIndex;
    const origDayIndex = this.dragOriginalDayIndex;
    this.draggingId = null;
    this.dragSch = null;
    this.dragMoved = false;
    this.dragPreviewTranslateX = 0;
    if (!sch) return;
    if (!moved) return; // ครบ hold แล้ว แต่ไม่ลาก — ไม่เปิด detail (กันชน hold gesture)
    const sameTime = (newStart === sch.startTime && newEnd === sch.endTime);
    const sameDay = (newDayIndex === origDayIndex);
    if (sameTime && sameDay) return;
    if (this.dragSubmitting) return;

    const targetDay = this.weekDays[newDayIndex];
    if (!targetDay) return;
    const dateStr = this.toLocalDateStr(targetDay.date);

    this.dragSubmitting = true;
    this.dragError = '';
    this.scheduleService.teacherReschedule(sch._id, dateStr, newStart, newEnd)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => { this.dragSubmitting = false; this.loadCalendar(); },
        error: (err) => {
          this.dragSubmitting = false;
          this.dragError = err?.error?.message || 'เลื่อนคลาสไม่สำเร็จ';
          this.loadCalendar();
          setTimeout(() => { this.dragError = ''; }, 5000);
        }
      });
  };

  private minToTimeStr(min: number): string {
    const total = Math.max(0, Math.round(min));
    const h = Math.floor(total / 60) % 24;
    const m = total % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
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

  /**
   * Income per schedule — group rate when >1 student, else individual.
   * Classes on/after TEACHER_HOURLY_FROM bill rate × class hours; older
   * classes stay flat. Mirrors backend computeEffectiveTeacherIncome.
   */
  private scheduleIncome(s: ISchedule): number {
    const studentCount = (s.students as any[])?.length || 0;
    const rate = Number(studentCount > 1
      ? (s.teacherIncomeGroup || 0)
      : (s.teacherIncomeIndividual || 0));
    if (!rate) return 0;
    const d = s.date ? new Date(s.date) : null;
    const isHourly = !!d && !isNaN(d.getTime()) && d >= this.TEACHER_HOURLY_FROM;
    if (isHourly && (s.totalDurationMinutes || 0) > 0) {
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
