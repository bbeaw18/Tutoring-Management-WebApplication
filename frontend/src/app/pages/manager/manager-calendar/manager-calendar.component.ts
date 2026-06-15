import { Component, OnInit, OnDestroy, DoCheck, HostListener, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ScheduleService } from '../../../services/schedule.service';
import { UserService } from '../../../services/user.service';
import { CourseService } from '../../../services/course.service';
import { AuthService } from '../../../services/auth.service';
import { LoadingComponent } from '../../../shared/components/loading/loading.component';
import { DisplayNamePipe } from '../../../shared/pipes/display-name.pipe';
import { ISchedule } from '../../../interfaces/schedule.interface';
import { resolveDisplayStatus, getDisplayStatusLabel, getDisplayStatusClass } from '../../../shared/constants/schedule-status';

type CalendarViewMode = 'monthly' | 'weekly';
type FilterMode = 'all' | 'teacher' | 'student';

@Component({
  selector: 'app-manager-calendar',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, LoadingComponent, DisplayNamePipe],
  templateUrl: './manager-calendar.component.html',
  styleUrls: ['./manager-calendar.component.css']
})
export class ManagerCalendarComponent implements OnInit, OnDestroy, DoCheck {
  private destroy$ = new Subject<void>();
  private scrolledToNow = false;

  @ViewChild('calScroll') calScrollRef!: ElementRef<HTMLElement>;

  loading = false;
  viewMode: CalendarViewMode = 'weekly'; // Google Calendar weekly view as default

  // ─── Monthly ──────────────────────────────────────────────────────────────
  currentYear = new Date().getFullYear();
  currentMonth = new Date().getMonth() + 1;
  calendarDays: Array<{ date: Date | null; schedules: ISchedule[] }> = [];

  // ─── Weekly ───────────────────────────────────────────────────────────────
  weekStart: Date = this.getMonday(new Date());
  weekDays: Array<{ date: Date; schedules: ISchedule[] }> = [];

  // ─── Time Grid Config ─────────────────────────────────────────────────────
  readonly START_HOUR = 0;
  readonly END_HOUR = 24;
  readonly HOUR_HEIGHT = 64; // px per hour
  readonly hours: number[] = Array.from(
    { length: this.END_HOUR - this.START_HOUR },
    (_, i) => i + this.START_HOUR
  );

  // ─── Drag State ───────────────────────────────────────────────────────────
  isDragging = false;
  pendingDrag = false;
  dragMoved = false;
  dragJustEnded = false;
  dragSchedule: ISchedule | null = null;
  dragSourceDayIndex = -1;
  dragOffsetMinutes = 0;       // click offset within event (minutes from event start)
  dragPreviewDayIndex = -1;
  dragPreviewStartHour = 0;
  dragPreviewStartMin = 0;
  dragPreviewEndHour = 0;
  dragPreviewEndMin = 0;
  rescheduling = false;

  // ─── Click-and-hold-to-drag ──────────────────────────────────────────────
  readonly HOLD_DURATION_MS = 1300;
  readonly HOLD_MOVE_TOLERANCE_PX = 6;
  dragArmed = false;             // true after 2s hold elapsed
  holdScheduleId: string | null = null; // id of the event currently in hold state (for visual)
  holdProgress = 0;              // 0–100 for progress ring animation
  private holdTimer: any = null;
  private holdProgressInterval: any = null;
  private holdStartX = 0;
  private holdStartY = 0;
  private holdStartTime = 0;
  private holdContext: { sch: ISchedule; dayIndex: number; sh: number; sm: number; eh: number; em: number } | null = null;

  // ─── Filter ───────────────────────────────────────────────────────────────
  filterMode: FilterMode = 'all';
  selectedTeacherId = '';
  selectedStudentId = '';
  students: any[] = [];
  teachers: any[] = [];

  // ─── Modal ────────────────────────────────────────────────────────────────
  selectedSchedule: ISchedule | null = null;
  showDetailModal = false;
  confirmLoading = false;

  currentUser: any = null;

  readonly monthNames = [
    'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
    'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'
  ];
  readonly dayNames = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  readonly dayNamesFull = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];

  get isManager(): boolean {
    const role = this.currentUser?.role;
    return role === 'manager' || role === 'admin';
  }

  get totalGridHeight(): number {
    return this.hours.length * this.HOUR_HEIGHT;
  }

  constructor(
    private scheduleService: ScheduleService,
    private userService: UserService,
    private courseService: CourseService,
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();
    this.loadDropdowns();
    this.loadCalendar();
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

  // ─── Dropdowns ────────────────────────────────────────────────────────────
  loadDropdowns(): void {
    let teacherList: any[] = [];
    let managerList: any[] = [];
    let loaded = 0;
    const merge = () => {
      loaded++;
      if (loaded === 2) {
        this.teachers = [
          ...managerList.map(u => ({ ...u, _displayRole: 'ผู้จัดการ' })),
          ...teacherList.map(u => ({ ...u, _displayRole: 'ครู' }))
        ];
      }
    };
    this.userService.getUsers({ role: 'teacher' } as any)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => { teacherList = res.data || []; merge(); },
        error: () => { merge(); }
      });
    this.userService.getUsers({ role: 'manager' } as any)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => { managerList = res.data || []; merge(); },
        error: () => { merge(); }
      });
    this.userService.getUsers({ role: 'student', limit: 1000 } as any)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => { this.students = res.data || []; },
        error: (err) => console.error('[ManagerCalendar] loadStudents failed:', err)
      });
  }

  // ─── Filter ───────────────────────────────────────────────────────────────
  setFilterMode(mode: FilterMode): void {
    this.filterMode = mode;
    this.selectedTeacherId = '';
    this.selectedStudentId = '';
    this.loadCalendar();
  }
  onTeacherFilterChange(): void { this.loadCalendar(); }
  onStudentFilterChange(): void { this.loadCalendar(); }

  getFilterParams(): { teacherId?: string; studentId?: string } {
    if (this.filterMode === 'teacher' && this.selectedTeacherId) {
      return { teacherId: this.selectedTeacherId };
    }
    if (this.filterMode === 'student' && this.selectedStudentId) {
      return { studentId: this.selectedStudentId };
    }
    return {};
  }

  getFilterLabel(): string {
    if (this.filterMode === 'teacher' && this.selectedTeacherId) {
      const t = this.teachers.find(x => x._id === this.selectedTeacherId);
      if (t) {
        const nick = t.nickname || `${t.firstName} ${t.lastName}`;
        return `ตารางสอน: ครู${nick}`;
      }
      return 'ตารางสอนครู';
    }
    if (this.filterMode === 'student' && this.selectedStudentId) {
      const s = this.students.find(x => x._id === this.selectedStudentId);
      if (s) {
        const nick = s.nickname || `${s.firstName} ${s.lastName}`;
        return `ตารางเรียน: น้อง${nick}`;
      }
      return 'ตารางเรียนนักเรียน';
    }
    return 'ตารางทั้งหมด';
  }

  toLocalDateStr(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // ─── Calendar Loading ─────────────────────────────────────────────────────
  loadCalendar(): void {
    if (this.viewMode === 'monthly') this.loadMonthly();
    else this.loadWeekly();
  }

  loadMonthly(): void {
    this.loading = true;
    this.scheduleService.getCalendarMonthly(this.currentYear, this.currentMonth, this.getFilterParams())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => { this.buildMonthlyGrid(data); this.loading = false; },
        error: () => { this.loading = false; }
      });
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
    const startStr = this.toLocalDateStr(this.weekStart);
    const endStr = this.toLocalDateStr(endDate);
    this.scheduleService.getCalendarWeekly(startStr, endStr, this.getFilterParams())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.weekDays = [];
          for (let i = 0; i < 7; i++) {
            const d = new Date(this.weekStart);
            d.setDate(d.getDate() + i);
            const key = this.toLocalDateStr(d);
            this.weekDays.push({ date: d, schedules: data[key] || [] });
          }
          this.loading = false;
        },
        error: () => { this.loading = false; }
      });
  }

  // ─── Navigation ───────────────────────────────────────────────────────────
  prevMonth(): void {
    this.currentMonth--;
    if (this.currentMonth < 1) { this.currentMonth = 12; this.currentYear--; }
    this.loadMonthly();
  }
  nextMonth(): void {
    this.currentMonth++;
    if (this.currentMonth > 12) { this.currentMonth = 1; this.currentYear++; }
    this.loadMonthly();
  }
  prevWeek(): void {
    this.weekStart = new Date(this.weekStart);
    this.weekStart.setDate(this.weekStart.getDate() - 7);
    this.loadWeekly();
  }
  nextWeek(): void {
    this.weekStart = new Date(this.weekStart);
    this.weekStart.setDate(this.weekStart.getDate() + 7);
    this.loadWeekly();
  }
  goToday(): void {
    this.weekStart = this.getMonday(new Date());
    this.currentYear = new Date().getFullYear();
    this.currentMonth = new Date().getMonth() + 1;
    this.loadCalendar();
  }
  switchView(mode: CalendarViewMode): void {
    this.viewMode = mode;
    this.loadCalendar();
  }
  getMonday(d: Date): Date {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    date.setDate(diff);
    return date;
  }
  getWeekLabel(): string {
    const end = new Date(this.weekStart);
    end.setDate(end.getDate() + 6);
    return `${this.weekStart.getDate()} ${this.monthNames[this.weekStart.getMonth()]} – ${end.getDate()} ${this.monthNames[end.getMonth()]} ${this.weekStart.getFullYear() + 543}`;
  }

  // ─── Time Grid Helpers ────────────────────────────────────────────────────

  /** Top offset in px for an event (based on startTime) */
  getEventTop(sch: ISchedule): number {
    if (!sch.startTime) return 0;
    const [h, m] = sch.startTime.split(':').map(Number);
    return Math.max(0, (h - this.START_HOUR + m / 60) * this.HOUR_HEIGHT);
  }

  /** Height in px for an event (based on duration) */
  getEventHeight(sch: ISchedule): number {
    if (!sch.startTime || !sch.endTime) return this.HOUR_HEIGHT;
    const s = this.minOf(sch.startTime), e = this.minOf(sch.endTime);
    // Overnight: first segment runs start → end of grid (24:00)
    const duration = e <= s ? (this.END_HOUR * 60 - s) : (e - s);
    return Math.max(duration / 60 * this.HOUR_HEIGHT, 28); // min 28px
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

  /** Top of the drag preview ghost */
  getDragPreviewTop(): number {
    return Math.max(
      0,
      (this.dragPreviewStartHour - this.START_HOUR + this.dragPreviewStartMin / 60) * this.HOUR_HEIGHT
    );
  }

  /** Height of the drag preview ghost (clipped to grid bottom for overnight) */
  getDragPreviewHeight(): number {
    if (!this.dragSchedule) return this.HOUR_HEIGHT;
    const dur = this.getEventDurationMinutes(this.dragSchedule);
    const startMin = this.dragPreviewStartHour * 60 + this.dragPreviewStartMin;
    const visible = Math.min(dur, this.END_HOUR * 60 - startMin);
    return Math.max(visible / 60 * this.HOUR_HEIGHT, 28);
  }

  formatDragTime(): string {
    const sh = String(this.dragPreviewStartHour).padStart(2, '0');
    const sm = String(this.dragPreviewStartMin).padStart(2, '0');
    const eh = String(this.dragPreviewEndHour).padStart(2, '0');
    const em = String(this.dragPreviewEndMin).padStart(2, '0');
    return `${sh}:${sm} – ${eh}:${em}`;
  }

  formatTime(h: number, m: number): string {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** Current-time indicator top (for today column) */
  getCurrentTimeTop(): number {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    if (h < this.START_HOUR || h >= this.END_HOUR) return -999;
    return (h - this.START_HOUR + m / 60) * this.HOUR_HEIGHT;
  }

  /** CSS color for event based on status */
  getEventBg(sch: ISchedule): string {
    if (sch.status === 'cancelled') return '#e2e8f0';
    if (sch.status === 'completed') return '#d1fae5';
    // When filtering by student — show confirmation status as red/green/gray
    if (this.filterMode === 'student' && this.selectedStudentId) {
      const studentConfStatus = this.getStudentConfirmStatus(sch, this.selectedStudentId);
      if (studentConfStatus === 'accepted') return '#dcfce7';  // green
      if (studentConfStatus === 'declined') return '#f1f5f9';  // gray
      return '#fee2e2';                                        // red — not confirmed yet
    }
    if (sch.isFullyConfirmed) return '#dbeafe';
    if (sch.status === 'pending') return '#fef3c7';
    return '#e0e7ff';
  }
  getEventBorder(sch: ISchedule): string {
    if (sch.status === 'cancelled') return '#94a3b8';
    if (sch.status === 'completed') return '#10b981';
    if (this.filterMode === 'student' && this.selectedStudentId) {
      const studentConfStatus = this.getStudentConfirmStatus(sch, this.selectedStudentId);
      if (studentConfStatus === 'accepted') return '#16a34a';
      if (studentConfStatus === 'declined') return '#94a3b8';
      return '#ef4444';
    }
    if (sch.isFullyConfirmed) return '#3b82f6';
    if (sch.status === 'pending') return '#f59e0b';
    return '#6366f1';
  }
  getEventText(sch: ISchedule): string {
    if (sch.status === 'cancelled') return '#64748b';
    if (sch.status === 'completed') return '#065f46';
    if (this.filterMode === 'student' && this.selectedStudentId) {
      const studentConfStatus = this.getStudentConfirmStatus(sch, this.selectedStudentId);
      if (studentConfStatus === 'accepted') return '#15803d';
      if (studentConfStatus === 'declined') return '#64748b';
      return '#dc2626';
    }
    if (sch.isFullyConfirmed) return '#1d4ed8';
    if (sch.status === 'pending') return '#92400e';
    return '#3730a3';
  }

  /** Get a specific student's confirmation status from a schedule */
  getStudentConfirmStatus(sch: ISchedule, studentId: string): string {
    if (!sch.studentConfirmations) return 'pending';
    const conf = sch.studentConfirmations.find(
      sc => (sc.student as any)?._id === studentId || (sc.student as any) === studentId
    );
    return conf?.status || 'pending';
  }

  // ─── Drag-and-Drop ────────────────────────────────────────────────────────

  onEventMouseDown(event: MouseEvent, sch: ISchedule, dayIndex: number): void {
    if (!this.isManager) return;
    // Don't preventDefault yet — we want a quick click (released before HOLD_DURATION) to
    // open the detail modal normally. Only the hold gesture should suppress the click.

    // Compute click offset within the event (used once drag actually starts)
    const el = event.currentTarget as HTMLElement;
    const elRect = el.getBoundingClientRect();
    const clickYPx = event.clientY - elRect.top;
    this.dragOffsetMinutes = Math.max(0, Math.min(
      (clickYPx / this.HOUR_HEIGHT) * 60,
      this.getEventDurationMinutes(sch) - 1
    ));

    const [sh, sm] = sch.startTime.split(':').map(Number);
    const [eh, em] = sch.endTime.split(':').map(Number);

    // Initialize hold state — drag is NOT armed yet
    this.cancelHold(); // clear any leftover state
    this.holdScheduleId = sch._id;
    this.holdProgress = 0;
    this.holdStartX = event.clientX;
    this.holdStartY = event.clientY;
    this.holdStartTime = Date.now();
    this.holdContext = { sch, dayIndex, sh, sm, eh, em };

    // Animate progress ring (~30fps is enough for a 2s timer)
    this.holdProgressInterval = setInterval(() => {
      const elapsed = Date.now() - this.holdStartTime;
      this.holdProgress = Math.min(100, Math.round((elapsed / this.HOLD_DURATION_MS) * 100));
    }, 33);

    // After 2 seconds → arm drag
    this.holdTimer = setTimeout(() => {
      this.armDrag();
    }, this.HOLD_DURATION_MS);
  }

  /** Called after the 2-second hold completes — actually arm the drag */
  private armDrag(): void {
    if (!this.holdContext) return;
    const { sch, dayIndex, sh, sm, eh, em } = this.holdContext;
    this.dragArmed = true;
    this.pendingDrag = true;
    this.dragMoved = false;
    this.dragJustEnded = false;
    this.dragSchedule = sch;
    this.dragSourceDayIndex = dayIndex;
    this.dragPreviewDayIndex = dayIndex;
    this.dragPreviewStartHour = sh;
    this.dragPreviewStartMin = sm;
    this.dragPreviewEndHour = eh;
    this.dragPreviewEndMin = em;
    this.holdProgress = 100;
    if (this.holdProgressInterval) {
      clearInterval(this.holdProgressInterval);
      this.holdProgressInterval = null;
    }
    // Subtle haptic-like feedback via vibration if available
    try { (navigator as any).vibrate?.(35); } catch { /* ignore */ }
  }

  /** Cancel an active hold (early release or excessive movement) */
  private cancelHold(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    if (this.holdProgressInterval) {
      clearInterval(this.holdProgressInterval);
      this.holdProgressInterval = null;
    }
    this.holdScheduleId = null;
    this.holdProgress = 0;
    this.holdContext = null;
    this.dragArmed = false;
  }

  @HostListener('document:mousemove', ['$event'])
  onDocMouseMove(event: MouseEvent): void {
    // While holding (drag not yet armed) — abort hold if user moves too far
    if (this.holdScheduleId && !this.dragArmed) {
      const dx = event.clientX - this.holdStartX;
      const dy = event.clientY - this.holdStartY;
      if (dx * dx + dy * dy > this.HOLD_MOVE_TOLERANCE_PX * this.HOLD_MOVE_TOLERANCE_PX) {
        this.cancelHold();
      }
      return;
    }

    if (!this.pendingDrag && !this.isDragging) return;
    if (!this.dragSchedule) return;
    if (!this.dragArmed) return; // safety: only allow drag move after hold completed

    if (!this.isDragging) {
      this.isDragging = true;
      this.dragMoved = true;
    }

    if (!this.calScrollRef?.nativeElement) return;

    const scrollEl = this.calScrollRef.nativeElement;
    const scrollRect = scrollEl.getBoundingClientRect();
    const scrollTop = scrollEl.scrollTop;

    // Y → time calculation
    // relY = pixel position within scroll content (0 = top of grid = START_HOUR:00)
    const relY = (event.clientY - scrollRect.top) + scrollTop;
    const duration = this.getEventDurationMinutes(this.dragSchedule);

    // Subtract click offset so the event top (not click point) tracks the mouse
    const rawStartMins = (relY / this.HOUR_HEIGHT) * 60 - this.dragOffsetMinutes + this.START_HOUR * 60;
    const snappedStartMins = Math.round(rawStartMins / 30) * 30;

    // Start must stay within the day; end may roll into the next day (overnight)
    const minStart = this.START_HOUR * 60;
    const maxStart = this.END_HOUR * 60 - 30; // need at least 30 min on the start day
    const clampedStart = Math.max(minStart, Math.min(maxStart, snappedStartMins));
    const clampedEnd = clampedStart + duration;
    const endWrapped = clampedEnd % (24 * 60); // wrap past midnight

    this.dragPreviewStartHour = Math.floor(clampedStart / 60);
    this.dragPreviewStartMin = clampedStart % 60;
    this.dragPreviewEndHour = Math.floor(endWrapped / 60);
    this.dragPreviewEndMin = endWrapped % 60;

    // X → day index calculation (60px gutter + 7 equal columns)
    const timeGutterWidth = 60;
    const relX = event.clientX - scrollRect.left;
    const availWidth = scrollRect.width - timeGutterWidth;
    const dayColWidth = availWidth / 7;
    const rawDay = Math.floor((relX - timeGutterWidth) / dayColWidth);
    this.dragPreviewDayIndex = Math.max(0, Math.min(6, rawDay));
  }

  @HostListener('document:mouseup', ['$event'])
  onDocMouseUp(_event: MouseEvent): void {
    // If user releases during the hold period (before drag is armed) → abort silently
    // and let the click event fire normally so the detail modal opens.
    if (this.holdScheduleId && !this.dragArmed) {
      this.cancelHold();
      return;
    }

    if (!this.pendingDrag && !this.isDragging) return;

    const wasDragged = this.dragMoved;
    const sch = this.dragSchedule;
    const targetDayIndex = this.dragPreviewDayIndex;
    const newStartH = this.dragPreviewStartHour;
    const newStartM = this.dragPreviewStartMin;
    const newEndH = this.dragPreviewEndHour;
    const newEndM = this.dragPreviewEndMin;

    // Reset drag state
    this.isDragging = false;
    this.pendingDrag = false;
    this.dragSchedule = null;
    this.dragMoved = false;
    this.dragArmed = false;
    this.holdScheduleId = null;
    this.holdProgress = 0;
    this.holdContext = null;

    if (!wasDragged) {
      // Drag was armed but user never moved — treat as click, suppress detail modal open
      // (the click event was prevented by armed drag's preventDefault); just return.
      this.dragJustEnded = true;
      setTimeout(() => { this.dragJustEnded = false; }, 200);
      return;
    }

    // Prevent the click event (fired after mouseup) from opening the detail modal
    this.dragJustEnded = true;
    setTimeout(() => { this.dragJustEnded = false; }, 200);

    if (!sch || targetDayIndex < 0 || targetDayIndex >= this.weekDays.length) return;

    const newDate = this.weekDays[targetDayIndex].date;
    const newStartStr = this.formatTime(newStartH, newStartM);
    const newEndStr = this.formatTime(newEndH, newEndM);
    const newDateStr = this.toLocalDateStr(newDate);

    // Check if anything actually changed
    const oldDateStr = this.toLocalDateStr(new Date(sch.date as string));
    if (newDateStr === oldDateStr && newStartStr === sch.startTime && newEndStr === sch.endTime) return;

    this.rescheduling = true;
    this.scheduleService.reschedule(sch._id, newDateStr, newStartStr, newEndStr)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => { this.rescheduling = false; this.loadCalendar(); },
        error: () => { this.rescheduling = false; this.loadCalendar(); }
      });
  }

  private getEventDurationMinutes(sch: ISchedule): number {
    if (!sch.startTime || !sch.endTime) return 60;
    const s = this.minOf(sch.startTime), e = this.minOf(sch.endTime);
    let dur = e - s;
    if (dur <= 0) dur += 24 * 60; // overnight (ends next day)
    return Math.max(30, dur);
  }

  // ─── Detail Modal ─────────────────────────────────────────────────────────
  openDetail(schedule: ISchedule, event: Event): void {
    event.stopPropagation();
    if (this.dragJustEnded) return; // click after drag — ignore
    this.selectedSchedule = schedule;
    this.showDetailModal = true;
  }

  closeDetailModal(): void {
    this.showDetailModal = false;
    this.selectedSchedule = null;
  }

  confirmAsTeacher(): void {
    if (!this.selectedSchedule) return;
    this.confirmLoading = true;
    this.scheduleService.teacherConfirm(this.selectedSchedule._id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updated) => {
          this.selectedSchedule = updated;
          this.confirmLoading = false;
          this.loadCalendar();
        },
        error: () => { this.confirmLoading = false; }
      });
  }

  /** courseId ของ schedule ที่เลือก — รองรับทั้งกรณี populated และ string */
  private getSelectedCourseId(): string {
    const c: any = this.selectedSchedule?.course;
    if (!c) return '';
    return typeof c === 'object' ? (c._id || c.id || '') : String(c);
  }

  /** ส่งไปยังหน้า course-management พร้อม query param `edit=<courseId>` เพื่อเปิด edit modal */
  editFromCalendar(): void {
    const courseId = this.getSelectedCourseId();
    if (!courseId) return;
    this.closeDetailModal();
    this.router.navigate(['/dashboard/course-management'], { queryParams: { edit: courseId } });
  }

  /** ยกเลิกนัดสอน (set course.status='cancelled' → ทุก schedule ของ course นั้นถูก cancel ด้วย) */
  cancelFromCalendar(): void {
    const courseId = this.getSelectedCourseId();
    if (!courseId) return;
    if (!confirm('ยืนยันการยกเลิกนัดสอนนี้?\n\nนัดสอนจะถูกตั้งเป็น "ยกเลิก" และนำออกจากปฏิทินของครูและนักเรียน')) return;
    this.confirmLoading = true;
    this.courseService.deleteCourse(courseId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.confirmLoading = false;
          this.closeDetailModal();
          this.loadCalendar();
        },
        error: () => { this.confirmLoading = false; }
      });
  }

  /** schedule นี้ยังแก้/ยกเลิกได้หรือไม่ (ไม่ใช่ completed/cancelled) */
  canEditSelected(): boolean {
    if (!this.isManager || !this.selectedSchedule) return false;
    const s = this.selectedSchedule.status;
    return s !== 'completed' && s !== 'cancelled';
  }

  doManagerConfirm(): void {
    if (!this.selectedSchedule) return;
    this.confirmLoading = true;
    this.scheduleService.managerConfirm(this.selectedSchedule._id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.confirmLoading = false;
          if (this.selectedSchedule) {
            this.selectedSchedule = { ...this.selectedSchedule, status: 'completed' };
          }
          this.loadCalendar();
        },
        error: () => { this.confirmLoading = false; }
      });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  /**
   * Status label/class — accept either schedule object (preferred) or raw status string.
   * Schedule object lets us compute the unified displayStatus (incl. รอนักเรียนยืนยัน).
   */
  getStatusLabel(scheduleOrStatus: any): string {
    if (typeof scheduleOrStatus === 'string') {
      return getDisplayStatusLabel(scheduleOrStatus as any);
    }
    return getDisplayStatusLabel(resolveDisplayStatus(scheduleOrStatus));
  }

  getStatusClass(scheduleOrStatus: any): string {
    if (typeof scheduleOrStatus === 'string') {
      return getDisplayStatusClass(scheduleOrStatus as any);
    }
    return getDisplayStatusClass(resolveDisplayStatus(scheduleOrStatus));
  }

  getTeacherName(schedule: ISchedule): string {
    const t = schedule.teacher as any;
    if (t && typeof t === 'object') {
      const nick = t.nickname || `${t.firstName} ${t.lastName}`;
      return `ครู${nick}`;
    }
    return '-';
  }

  /**
   * หัวข้อในปฏิทินของ Manager/Admin: "ชื่อวิชา - น้อง<ชื่อเล่น> - <ระดับชั้น>"
   *  - 1 คน → "subject - น้องnick - ม.6"
   *  - หลายคน → "subject - น้องnick1 ม.6, น้องnick2 ม.5"
   */
  /** Helpers for new course-metadata fields (now populated by /calendar) */
  getCourseSubject(schedule: ISchedule): string {
    const c = schedule.course as any;
    return c && typeof c === 'object' ? (c.subject || c.name || '') : '';
  }

  getCourseGradeLevel(schedule: ISchedule): string {
    const c = schedule.course as any;
    return c && typeof c === 'object' ? (c.gradeLevel || '') : '';
  }

  getCourseType(schedule: ISchedule): string {
    const c = schedule.course as any;
    return c && typeof c === 'object' ? (c.type || '') : '';
  }

  getCourseTeachingType(schedule: ISchedule): string {
    const c = schedule.course as any;
    return c && typeof c === 'object' ? (c.teachingType || '') : '';
  }

  getCourseName(schedule: ISchedule): string {
    const c = schedule.course as any;
    const subject = (c && typeof c === 'object') ? (c.subject || c.name || '-') : '-';
    const students: any[] = Array.isArray(schedule.students) ? schedule.students : [];
    const items = students
      .filter(st => st && typeof st === 'object')
      .map(st => {
        const nick = st.nickname || `${st.firstName || ''} ${st.lastName || ''}`.trim();
        if (!nick) return null;
        // ลองทุกฟิลด์ที่อาจเก็บระดับชั้น
        const grade = (st.grade || st.academicYear || '').toString().trim();
        return { nick: `น้อง${nick}`, grade };
      })
      .filter((x): x is { nick: string; grade: string } => x !== null);

    if (items.length === 0) return subject;
    if (items.length === 1) {
      const { nick, grade } = items[0];
      return grade ? `${subject} - ${nick} - ${grade}` : `${subject} - ${nick}`;
    }
    // หลายคน → "น้องnick ม.6" คั่นด้วย ", "
    const join = items.map(({ nick, grade }) => grade ? `${nick} ${grade}` : nick);
    if (items.length === 2) return `${subject} - ${join[0]}, ${join[1]}`;
    return `${subject} - ${join[0]}, ${join[1]} +${items.length - 2}`;
  }

  formatDate(d: Date): string {
    return d.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  isToday(d: Date): boolean {
    const today = new Date();
    return d.getFullYear() === today.getFullYear() &&
           d.getMonth() === today.getMonth() &&
           d.getDate() === today.getDate();
  }

  isCurrentWeek(): boolean {
    const monday = this.getMonday(new Date());
    return this.toLocalDateStr(this.weekStart) === this.toLocalDateStr(monday);
  }

  /** Flat list of week schedules */
  get weekSchedules(): ISchedule[] {
    return this.weekDays.flatMap(d => d.schedules);
  }

  /** Overview: status counts */
  get overviewCounts(): { total: number; confirmed: number; pendingTeacher: number; completed: number; cancelled: number } {
    const all = this.weekSchedules;
    return {
      total: all.filter(s => s.status !== 'cancelled').length,
      confirmed: all.filter(s => s.isFullyConfirmed && s.status !== 'cancelled').length,
      pendingTeacher: all.filter(s => !s.teacherConfirmed && s.status !== 'cancelled' && s.status !== 'completed').length,
      completed: all.filter(s => s.status === 'completed').length,
      cancelled: all.filter(s => s.status === 'cancelled').length
    };
  }

  /** Teacher workload — top busiest teachers this week */
  get teacherWorkload(): { name: string; count: number; pct: number; initial: string }[] {
    const tally: Record<string, { name: string; count: number }> = {};
    for (const s of this.weekSchedules) {
      if (s.status === 'cancelled') continue;
      const t: any = s.teacher;
      if (!t) continue;
      const id = t._id || t.id || (typeof t === 'string' ? t : '');
      if (!id) continue;
      const name = `${t.firstName || ''} ${t.lastName || ''}`.trim() || 'ไม่ระบุ';
      if (!tally[id]) tally[id] = { name, count: 0 };
      tally[id].count += 1;
    }
    const list = Object.values(tally).sort((a, b) => b.count - a.count).slice(0, 5);
    const max = Math.max(1, ...list.map(x => x.count));
    return list.map(x => ({
      ...x,
      pct: (x.count / max) * 100,
      initial: x.name.charAt(0).toUpperCase()
    }));
  }
}
