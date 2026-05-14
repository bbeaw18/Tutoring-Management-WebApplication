import { Component, OnInit, OnDestroy, AfterViewInit, ElementRef, ViewChild, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil, forkJoin } from 'rxjs';
import { gsap } from 'gsap';
import { PaymentService } from '../../../services/payment.service';
import { UserService } from '../../../services/user.service';
import { ExpenseService, IExpense, ExpenseType } from '../../../services/expense.service';
import { AuthService } from '../../../services/auth.service';
import { IRevenueSchedule } from '../../../interfaces/payment.interface';
import { IUser } from '../../../interfaces/user.interface';
import { LoadingComponent } from '../../../shared/components/loading/loading.component';
import { MonthPickerComponent } from '../../../shared/components/month-picker/month-picker.component';
import { DisplayNamePipe } from '../../../shared/pipes/display-name.pipe';
import { CountUpDirective } from '../../../shared/directives/count-up.directive';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

type KpiMode = 'all' | 'paid' | 'unpaid' | 'teacherExpense' | 'managerIncome' | 'myIncome';
type TxStatus = 'paid' | 'pending' | 'unpaid';

interface TxRow {
  scheduleId: string;
  studentId: string;
  courseName: string;
  teacherName: string;
  startTime: string;
  endTime: string;
  nickname: string;
  amount: number;
  status: TxStatus;
  paymentId: string | null;
}

interface TxGroup {
  dayKey: string;     // YYYY-MM-DD
  label: string;      // "พุธ 14 พ.ค."
  rows: TxRow[];
  total: number;
  sortKey: number;
}

interface PieSlice {
  key: string;
  label: string;
  value: number;
  pct: number;
  color: string;
  // SVG pre-computed arc
  dashArray: string;
  dashOffset: string;
}

@Component({
  selector: 'app-revenue',
  standalone: true,
  imports: [CommonModule, FormsModule, LoadingComponent, MonthPickerComponent, DisplayNamePipe, CountUpDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './revenue.component.html',
  styleUrls: ['./revenue.component.css']
})
export class RevenueComponent implements OnInit, OnDestroy, AfterViewInit {
  private destroy$ = new Subject<void>();

  /** Root of the date-spine transaction list. GSAP row stagger plays
   *  when this element gains/changes child rows (after data loads or filter changes). */
  @ViewChild('txList', { read: ElementRef, static: false }) txList?: ElementRef<HTMLElement>;
  private lastStaggerKey = '';

  // KPI totals
  kpiTotal   = 0;
  kpiPaid    = 0;
  kpiUnpaid  = 0;
  // KPI ใหม่ (ผูกกับสถานะ completed/manager-confirmed เท่านั้น)
  kpiTeacherExpense = 0;   // รายจ่ายสถาบัน — รายได้ครู (role='teacher')
  kpiManagerIncome  = 0;   // รายได้ Manager (role='manager' ที่สอน)
  kpiNetInstitute   = 0;   // กำไรสุทธิสถาบัน = paid - teacherExpense

  // Active KPI filter
  activeKpi: KpiMode = 'all';

  // All schedules from backend
  allSchedules: IRevenueSchedule[] = [];

  // Dropdown data
  teachers: IUser[] = [];
  students: IUser[] = [];

  // Filter values
  filterMonth    = '';
  filterTeacher  = '';
  filterStudent  = '';

  loading = false;

  // Tracks the paymentId currently being confirmed (for button disable state)
  confirmingPaymentId: string | null = null;

  // ── Expenses (per month) ─────────────────────────────────────
  manualExpenses: IExpense[] = [];

  // Modal state for adding new expense / income
  showExpenseModal = false;
  newExpenseType: ExpenseType = 'expense';
  newExpenseDescription = '';
  newExpenseAmount: number | null = null;
  savingExpense = false;
  expenseError = '';

  // Current logged-in user — used for "รายได้ของคุณ" KPI
  currentUser: IUser | null = null;

  // ── Student monthly classes modal ────────────────────────────
  // เปิดเมื่อคลิกชื่อเล่นเด็กในตาราง "ประวัติคลาสทั้งหมด"
  showStudentMonthlyModal = false;
  studentMonthlyTarget: { id: string; nickname: string } | null = null;
  studentMonthlyClasses: IRevenueSchedule[] = [];

  // Palette for teacher slices
  private readonly TEACHER_COLORS = [
    '#ec4899', '#1e3f80', '#22c55e', '#f59e0b', '#8b5cf6',
    '#0ea5e9', '#ef4444', '#14b8a6', '#f97316', '#a855f7'
  ];

  constructor(
    private paymentService: PaymentService,
    private userService: UserService,
    private expenseService: ExpenseService,
    private authService: AuthService,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    // Set default month to current month
    const now = new Date();
    this.filterMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Track current user — default filterTeacher to themselves so KPI shows "รายได้ของคุณ"
    // (filter is frontend-only — does NOT trigger backend reload, KPIs stay institute-wide)
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.currentUser = user;
        if (user?._id && !this.filterTeacher) {
          this.filterTeacher = user._id;
        }
      });

    this.loadDropdowns();
    this.loadReport();
    this.loadExpenses();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngAfterViewInit(): void {
    // Play stagger once after initial render. ngDoCheck handles subsequent changes.
    queueMicrotask(() => this.maybePlayRowStagger());
  }

  ngDoCheck(): void {
    // Re-play stagger when the visible transaction set changes (filter, month, KPI mode).
    this.maybePlayRowStagger();
  }

  /** Plays a GSAP power3.out fade-up stagger on .rev-tx-row whenever the
   *  set of rendered rows changes. Honors prefers-reduced-motion (CSS-only fallback). */
  private maybePlayRowStagger(): void {
    const root = this.txList?.nativeElement;
    if (!root) return;
    if (typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const rows = root.querySelectorAll<HTMLElement>('.rev-tx-row');
    const key = `${this.activeKpi}:${this.filterMonth}:${this.filterStudent}:${rows.length}`;
    if (key === this.lastStaggerKey) return;
    this.lastStaggerKey = key;
    if (rows.length === 0) return;

    this.ngZone.runOutsideAngular(() => {
      gsap.fromTo(
        rows,
        { opacity: 0, y: 8 },
        {
          opacity: 1,
          y: 0,
          duration: 0.55,
          ease: 'power3.out',
          stagger: { each: 0.035, from: 'start' },
          clearProps: 'opacity,transform',
        }
      );
    });
  }

  loadDropdowns(): void {
    forkJoin({
      teachers: this.userService.getTeachingStaff(),
      students: this.userService.getStudents()
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ teachers, students }) => {
        this.teachers = teachers.data || [];
        this.students = students;
      },
      error: (err) => console.error('[Revenue] loadDropdowns failed:', err)
    });
  }

  loadReport(): void {
    this.loading = true;
    // KPIs are always institute-wide for the selected month.
    // teacher/student filters are applied on the frontend (in filteredSchedules
    // and the per-person "รายได้ของ X" KPI) so they never change the totals.
    const params: any = {};
    if (this.filterMonth) params.month = this.filterMonth;

    this.paymentService.getRevenueReport(params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.kpiTotal  = res.kpi.total;
          this.kpiPaid   = res.kpi.paid;
          this.kpiUnpaid = res.kpi.unpaid;
          this.kpiTeacherExpense = res.kpi.teacherExpense || 0;
          this.kpiManagerIncome  = res.kpi.managerIncome  || 0;
          this.kpiNetInstitute   = res.kpi.netInstitute   || 0;
          this.allSchedules = res.schedules;
          this.loading = false;
        },
        error: () => { this.loading = false; }
      });
  }

  loadExpenses(): void {
    if (!this.filterMonth) {
      this.manualExpenses = [];
      return;
    }
    this.expenseService.list({ month: this.filterMonth })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (list) => { this.manualExpenses = list || []; },
        error: (err) => console.error('[Revenue] loadExpenses failed:', err)
      });
  }

  onFilterChange(): void {
    // teacher/student filters are frontend-only — only month change refetches data
    this.loadReport();
    this.loadExpenses();
  }

  /** Called when teacher or student dropdown changes — frontend filter only, no reload */
  onPersonFilterChange(): void {
    // intentionally no reload; bindings react to filterTeacher/filterStudent changes
  }

  selectKpi(mode: KpiMode): void {
    this.activeKpi = mode;
  }

  get filteredSchedules(): IRevenueSchedule[] {
    let list = this.allSchedules;

    // KPI mode filter
    if (this.activeKpi === 'paid') {
      list = list.filter(s => s.paid > 0);
    } else if (this.activeKpi === 'unpaid') {
      list = list.filter(s => s.unpaid > 0);
    } else if (this.activeKpi === 'teacherExpense') {
      list = list.filter(s =>
        s.status === 'completed' &&
        s.teacherRole === 'teacher' &&
        (s.actualTeacherIncome || 0) > 0
      );
    } else if (this.activeKpi === 'managerIncome') {
      list = list.filter(s =>
        s.status === 'completed' &&
        s.teacherRole === 'manager' &&
        (s.actualTeacherIncome || 0) > 0
      );
    } else if (this.activeKpi === 'myIncome') {
      const targetId = this.filterTeacher || this.currentUser?._id || '';
      if (!targetId) return [];
      list = list.filter(s =>
        s.teacherId === targetId &&
        s.status === 'completed' &&
        (s.actualTeacherIncome || 0) > 0
      );
    }

    // Student filter — only applied to paid/unpaid mode (the student-related KPIs)
    if (this.filterStudent && (this.activeKpi === 'paid' || this.activeKpi === 'unpaid')) {
      list = list.filter(s =>
        s.attendedStudents?.some(st => st.studentId === this.filterStudent)
      );
    }
    // Teacher filter is already baked into myIncome mode above; no extra filtering elsewhere.

    return list;
  }

  // ── Student-filtered paid/unpaid totals (used by ยืนยันแล้ว / รอชำระ KPIs) ──
  get paidFiltered(): number {
    if (!this.filterStudent) return this.kpiPaid;
    let sum = 0;
    for (const s of this.allSchedules) {
      const entry = s.attendedStudents?.find(st => st.studentId === this.filterStudent);
      if (entry && entry.paymentStatus === 'confirmed') {
        sum += entry.paymentAmount || 0;
      }
    }
    return sum;
  }

  get unpaidFiltered(): number {
    if (!this.filterStudent) return this.kpiUnpaid;
    let sum = 0;
    for (const s of this.allSchedules) {
      const entry = s.attendedStudents?.find(st => st.studentId === this.filterStudent);
      if (entry && entry.paymentStatus !== 'confirmed') {
        sum += entry.paymentAmount || 0;
      }
    }
    return sum;
  }

  /**
   * Daily-revenue micro-bars for the selected month. Each bar represents one
   * day's *paid* revenue, normalised to a 48-unit drawable height.
   *
   * Returned items have `h` (height in viewBox units) and an `isToday` flag so
   * the template can stay pure data-binding — no Math.* calls in HTML.
   */
  get dailyRevenueBars(): { day: number; paid: number; h: number; isToday: boolean }[] {
    if (!this.filterMonth) return [];
    const [year, month] = this.filterMonth.split('-').map(Number);
    if (!year || !month) return [];
    const daysInMonth = new Date(year, month, 0).getDate();
    const buckets = new Array(daysInMonth).fill(0);
    for (const s of this.allSchedules) {
      const d = new Date(s.date);
      if (d.getFullYear() === year && d.getMonth() + 1 === month) {
        buckets[d.getDate() - 1] += s.paid || 0;
      }
    }
    const max = Math.max(1, ...buckets);
    const today = new Date();
    const isCurrentMonth =
      today.getFullYear() === year && today.getMonth() + 1 === month;
    const todayDay = isCurrentMonth ? today.getDate() : -1;
    const H = 48;
    return buckets.map((paid, i) => ({
      day: i + 1,
      paid,
      h: paid > 0 ? Math.max((paid / max) * H, 2) : 0,
      isToday: i + 1 === todayDay,
    }));
  }

  /** SVG viewBox width tracks day count; bar slot is 12 units wide. */
  get dailyChartViewBox(): string {
    const n = this.dailyRevenueBars.length || 30;
    return `0 0 ${n * 12} 60`;
  }

  get dailyChartMidLabel(): number {
    const n = this.dailyRevenueBars.length;
    return n ? Math.ceil(n / 2) : 15;
  }

  get dailyHasData(): boolean {
    return this.dailyRevenueBars.some(b => b.paid > 0);
  }

  get peakDailyDay(): { day: number; paid: number } | null {
    const bars = this.dailyRevenueBars;
    if (!bars.length) return null;
    let max = bars[0];
    for (const b of bars) if (b.paid > max.paid) max = b;
    return max.paid > 0 ? max : null;
  }

  get studentFilterLabel(): string {
    if (!this.filterStudent) return '';
    const s = this.students.find(x => x._id === this.filterStudent);
    if (!s) return '';
    const nick = (s.nickname || '').trim() || `${s.firstName || ''} ${s.lastName || ''}`.trim();
    return nick;
  }

  /** Teachers list with the current user prepended (if not already included) */
  get teachersForFilter(): IUser[] {
    if (!this.currentUser?._id) return this.teachers;
    const inList = this.teachers.some(t => t._id === this.currentUser?._id);
    return inList ? this.teachers : [this.currentUser, ...this.teachers];
  }

  /** Display name for the currently selected teacher (or "ทั้งหมด") */
  get teacherFilterDisplay(): string {
    if (!this.filterTeacher) return 'ทั้งหมด';
    const list = this.teachersForFilter;
    const t = list.find(x => x._id === this.filterTeacher);
    if (!t) return 'ทั้งหมด';
    const nick = (t.nickname || '').trim() || `${t.firstName || ''} ${t.lastName || ''}`.trim();
    return nick;
  }

  /** True when the currently selected teacher is the logged-in user */
  get isFilteringSelf(): boolean {
    return !!this.currentUser?._id && this.filterTeacher === this.currentUser._id;
  }

  /** ป้ายหัวข้อตาราง — เปลี่ยนตาม activeKpi */
  get scheduleTableTitle(): string {
    switch (this.activeKpi) {
      case 'paid':           return 'คลาสที่ชำระเงินแล้ว';
      case 'unpaid':         return 'คลาสที่รอการชำระเงิน';
      case 'teacherExpense': return 'คลาสที่ครูสอน (รายจ่ายสถาบัน)';
      case 'myIncome':       return `คลาสของ ${this.myIncomeTitle.replace(/^รายได้ของ\s*/, '')}`;
      case 'managerIncome':  return 'คลาสที่ Manager สอน (รายได้ Manager)';
      default:               return 'คลาสทั้งหมด';
    }
  }

  /** จะแสดงคอลัมน์รายจ่ายครู/รายได้ Manager หรือไม่ */
  get showTeacherIncomeColumn(): boolean {
    return this.activeKpi === 'teacherExpense' ||
           this.activeKpi === 'managerIncome' ||
           this.activeKpi === 'myIncome';
  }

  // ── Auto teacher wage = ค่าจ้างครู (role='teacher') ที่ Manager ยืนยันแล้ว ──
  // ใช้ค่าจาก backend (kpiTeacherExpense) เพื่อให้ตรงกับ KPI card
  get teacherWageTotal(): number {
    return this.kpiTeacherExpense;
  }

  get manualExpenseTotal(): number {
    return this.manualExpenses
      .filter(e => e.type !== 'income')
      .reduce((sum, e) => sum + (e.amount || 0), 0);
  }

  get manualIncomeTotal(): number {
    return this.manualExpenses
      .filter(e => e.type === 'income')
      .reduce((sum, e) => sum + (e.amount || 0), 0);
  }

  get expenseTotal(): number {
    return this.teacherWageTotal + this.manualExpenseTotal;
  }

  get incomeTotal(): number {
    return this.kpiTotal + this.manualIncomeTotal;
  }

  get netProfit(): number {
    return this.incomeTotal - this.expenseTotal;
  }

  /** Paid share of the month's total revenue. Hero KPI proportion strip. */
  get heroPaidPct(): number {
    if (this.kpiTotal <= 0) return 0;
    return Math.max(0, Math.min(100, (this.kpiPaid / this.kpiTotal) * 100));
  }
  /** Unpaid share — complementary. */
  get heroUnpaidPct(): number {
    if (this.kpiTotal <= 0) return 0;
    return Math.max(0, Math.min(100, (this.kpiUnpaid / this.kpiTotal) * 100));
  }
  get heroBarEmpty(): boolean { return this.kpiTotal <= 0; }

  // ── Date-spine transaction groups ────────────────────────────────
  // One transaction = one student × one schedule. Grouped by date (desc),
  // each group lists rows sorted by start time then student name.
  // Respects activeKpi filter (paid/unpaid/all) + filterStudent.
  get txGroups(): TxGroup[] {
    const groups = new Map<string, TxRow[]>();
    const labels = new Map<string, string>();
    const sortKeys = new Map<string, number>();

    for (const s of this.filteredSchedules) {
      const list = s.attendedStudents || [];
      if (list.length === 0) continue;
      const dt = s.date ? new Date(s.date) : null;
      if (!dt || isNaN(dt.getTime())) continue;

      // Day key (YYYY-MM-DD) for grouping. Local Asia/Bangkok offset OK because
      // backend already returns dates in app timezone.
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      const dayKey = `${y}-${m}-${d}`;

      if (!labels.has(dayKey)) {
        labels.set(dayKey, this.formatDayHeading(dt));
        sortKeys.set(dayKey, dt.getTime());
      }
      if (!groups.has(dayKey)) groups.set(dayKey, []);

      for (const st of list) {
        if (this.filterStudent && st.studentId !== this.filterStudent) continue;
        const status: TxStatus = st.paymentStatus === 'confirmed'
          ? 'paid'
          : (st.paymentStatus === 'pending' ? 'pending' : 'unpaid');
        // Filter by activeKpi
        if (this.activeKpi === 'paid' && status !== 'paid') continue;
        if (this.activeKpi === 'unpaid' && status === 'paid') continue;

        groups.get(dayKey)!.push({
          scheduleId: s.scheduleId || '',
          studentId: st.studentId,
          courseName: s.courseName || '—',
          teacherName: s.teacherName || '',
          startTime: s.startTime || '',
          endTime: s.endTime || '',
          nickname: this.getStudentNickname(st.studentId, st.name),
          amount: st.paymentAmount || 0,
          status,
          paymentId: st.paymentId || null,
        });
      }
    }

    const out: TxGroup[] = [];
    for (const [dayKey, rows] of groups) {
      if (rows.length === 0) continue;
      rows.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '') || a.nickname.localeCompare(b.nickname, 'th'));
      out.push({
        dayKey,
        label: labels.get(dayKey) || dayKey,
        rows,
        total: rows.reduce((sum, r) => sum + r.amount, 0),
        sortKey: sortKeys.get(dayKey) || 0,
      });
    }
    // Newest day first.
    out.sort((a, b) => b.sortKey - a.sortKey);
    return out;
  }

  get txTotalRows(): number {
    return this.txGroups.reduce((n, g) => n + g.rows.length, 0);
  }

  /** Thai day heading: "วันพุธ 14 พ.ค." — short, no year (year already in month picker). */
  private formatDayHeading(d: Date): string {
    const dow = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสฯ','ศุกร์','เสาร์'][d.getDay()];
    const mo  = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][d.getMonth()];
    return `${dow} ${d.getDate()} ${mo}`;
  }

  /** Helpers for the transaction row template. */
  txStatusLabel(s: TxStatus): string {
    return s === 'paid' ? 'ชำระแล้ว' : (s === 'pending' ? 'รอ Manager' : 'ค้างชำระ');
  }
  txAvatarHue(seed: string): number {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return h % 360;
  }

  /** Open student-monthly modal from a transaction row. */
  openTxRow(row: TxRow): void {
    if (!row.studentId) return;
    this.openStudentMonthlyModal(row.studentId, row.nickname);
  }

  trackByTxRow(_i: number, r: TxRow): string {
    return `${r.scheduleId}:${r.studentId}`;
  }
  trackByDay(_i: number, g: TxGroup): string {
    return g.dayKey;
  }

  // ── "รายได้ของคุณ" / "รายได้ของ <ชื่อเล่น>" — ขึ้นกับ filterTeacher ──
  get myIncomeTitle(): string {
    if (!this.filterTeacher || this.filterTeacher === this.currentUser?._id) {
      return 'รายได้ของคุณ';
    }
    const t = this.teachers.find(x => x._id === this.filterTeacher);
    if (!t) return 'รายได้ของครู';
    const nickname = (t.nickname || '').trim() || `${t.firstName || ''} ${t.lastName || ''}`.trim();
    return `รายได้ของ ${nickname}`;
  }

  get myIncomeAmount(): number {
    const targetId = this.filterTeacher || this.currentUser?._id || '';
    if (!targetId) return 0;
    return this.allSchedules
      .filter(s => s.teacherId === targetId && s.status === 'completed')
      .reduce((sum, s) => sum + (s.actualTeacherIncome || 0), 0);
  }

  get myIncomeSubtitle(): string {
    if (!this.filterTeacher || this.filterTeacher === this.currentUser?._id) {
      return 'รายได้จากการสอนของคุณในเดือนนี้';
    }
    return 'รายได้จากการสอนของครูคนนี้ในเดือนนี้';
  }

  // ── Teacher revenue proportion pie ──
  get teacherPie(): PieSlice[] {
    const tally: Record<string, { name: string; total: number }> = {};
    for (const s of this.allSchedules) {
      const id = s.teacherId || s.teacherName || 'unknown';
      const name = s.teacherName || 'ไม่ระบุ';
      const value = (s.paid || 0) + (s.unpaid || 0);
      if (!tally[id]) tally[id] = { name, total: 0 };
      tally[id].total += value;
    }
    const list = Object.entries(tally)
      .map(([key, v]) => ({ key, name: v.name, total: v.total }))
      .filter(x => x.total > 0)
      .sort((a, b) => b.total - a.total);

    const sum = list.reduce((s, x) => s + x.total, 0) || 1;
    return this.buildPieSlices(
      list.map((x, i) => ({
        key: x.key,
        label: x.name,
        value: x.total,
        color: this.TEACHER_COLORS[i % this.TEACHER_COLORS.length]
      })),
      sum
    );
  }

  // ── Income vs Expense pie ──
  get incomeExpensePie(): PieSlice[] {
    const income = this.incomeTotal;
    const expense = this.expenseTotal;
    const total = income + expense || 1;
    return this.buildPieSlices([
      { key: 'income', label: 'รายรับ', value: income, color: '#22c55e' },
      { key: 'expense', label: 'รายจ่าย', value: expense, color: '#ef4444' }
    ], total);
  }

  /** Build pie slices with cumulative SVG dashArray/dashOffset for r=42 circle */
  private buildPieSlices(
    items: { key: string; label: string; value: number; color: string }[],
    total: number
  ): PieSlice[] {
    const circ = 2 * Math.PI * 42; // r=42
    let cumulative = 0;
    return items.map(it => {
      const pct = total > 0 ? (it.value / total) * 100 : 0;
      const len = (pct / 100) * circ;
      const slice: PieSlice = {
        key: it.key,
        label: it.label,
        value: it.value,
        pct,
        color: it.color,
        dashArray: `${len} ${circ - len}`,
        dashOffset: `${-cumulative}`
      };
      cumulative += len;
      return slice;
    });
  }

  /** Paid vs unpaid donut (percentage for arc) */
  get paidRatioPct(): number {
    const total = this.kpiTotal || 1;
    return (this.kpiPaid / total) * 100;
  }

  /** SVG arc path for donut */
  get donutDashArray(): string {
    const circ = 2 * Math.PI * 42; // r=42
    const paid = (this.paidRatioPct / 100) * circ;
    return `${paid} ${circ - paid}`;
  }

  // ── Hourly-mode rollout cutoffs (must match course-management) ──
  // เริ่มใช้การคิดต่อชม. ตั้งแต่วันที่กำหนด — คลาสก่อนหน้านี้ยังเป็น flat-rate เดิม
  private readonly TEACHER_HOURLY_FROM = new Date('2026-05-08T00:00:00+07:00');
  private readonly PRICE_HOURLY_FROM   = new Date('2026-05-09T00:00:00+07:00');

  /** ชั่วโมงของคลาสคำนวณจาก totalDurationMinutes หรือ start/end time */
  getScheduleHours(s: IRevenueSchedule): number {
    if (s.totalDurationMinutes && s.totalDurationMinutes > 0) {
      return s.totalDurationMinutes / 60;
    }
    if (s.startTime && s.endTime) {
      const [sh, sm] = String(s.startTime).split(':').map(Number);
      const [eh, em] = String(s.endTime).split(':').map(Number);
      const minutes = (eh * 60 + em) - (sh * 60 + sm);
      return minutes > 0 ? minutes / 60 : 0;
    }
    return 0;
  }

  formatHours(h: number): string {
    if (!h || h <= 0) return '0 ชม.';
    return Number.isInteger(h) ? `${h} ชม.` : `${h.toFixed(1)} ชม.`;
  }

  /** ใช้รูปแบบ "ชม.ละ × ชม. = รวม" สำหรับค่าเรียนของคลาสนี้หรือไม่ */
  isPriceHourlyForSchedule(s: IRevenueSchedule): boolean {
    const d = s?.date ? new Date(s.date) : null;
    return !!d && !isNaN(d.getTime()) && d >= this.PRICE_HOURLY_FROM;
  }

  /** ใช้รูปแบบ "ชม.ละ × ชม. = รวม" สำหรับรายได้ครูของคลาสนี้หรือไม่ */
  isTeacherHourlyForSchedule(s: IRevenueSchedule): boolean {
    const d = s?.date ? new Date(s.date) : null;
    return !!d && !isNaN(d.getTime()) && d >= this.TEACHER_HOURLY_FROM;
  }

  /** ราคาคอร์สต่อชม. (raw rate ที่ Manager กรอก) */
  getCoursePriceRate(s: IRevenueSchedule): number {
    return Number(s.coursePriceRaw || 0);
  }

  /** อัตรารายได้ครูต่อชม. ตามจำนวนนักเรียนที่เข้าเรียน (1 → individual, >1 → group) */
  getTeacherRate(s: IRevenueSchedule): number {
    const att = s.attendanceCount || 0;
    if (att === 1) return Number(s.teacherIncomeIndividual || 0);
    if (att > 1)   return Number(s.teacherIncomeGroup || 0);
    return 0;
  }

  formatDate(date: Date | string): string {
    return new Date(date).toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  getStatusLabel(status: string): string {
    const labels: { [key: string]: string } = {
      'awaiting_confirmation': 'รอยืนยัน',
      'completed':             'เสร็จสิ้น'
    };
    return labels[status] || status;
  }

  getStatusClass(status: string): string {
    return status === 'completed' ? 'badge-completed' : 'badge-pending';
  }

  // ── Expense/Income modal handlers ──
  openExpenseModal(): void {
    this.newExpenseType = 'expense';
    this.newExpenseDescription = '';
    this.newExpenseAmount = null;
    this.expenseError = '';
    this.showExpenseModal = true;
  }

  closeExpenseModal(): void {
    if (this.savingExpense) return;
    this.showExpenseModal = false;
  }

  saveExpense(): void {
    const desc = (this.newExpenseDescription || '').trim();
    const amount = Number(this.newExpenseAmount);
    if (!desc) {
      this.expenseError = 'กรุณากรอกรายการ';
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      this.expenseError = 'กรุณากรอกราคาที่ถูกต้อง';
      return;
    }
    if (!this.filterMonth) {
      this.expenseError = 'กรุณาเลือกเดือน';
      return;
    }
    this.savingExpense = true;
    this.expenseError = '';
    this.expenseService.create({ description: desc, type: this.newExpenseType, amount, month: this.filterMonth })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (created) => {
          this.manualExpenses = [created, ...this.manualExpenses];
          this.savingExpense = false;
          this.showExpenseModal = false;
        },
        error: (err) => {
          this.savingExpense = false;
          this.expenseError = err?.error?.message || 'ไม่สามารถบันทึกรายการได้';
        }
      });
  }

  deleteExpense(exp: IExpense): void {
    if (!confirm(`ลบรายการ "${exp.description}" ?`)) return;
    this.expenseService.delete(exp._id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.manualExpenses = this.manualExpenses.filter(e => e._id !== exp._id);
        },
        error: (err) => alert(err?.error?.message || 'ไม่สามารถลบรายการได้')
      });
  }

  /** Manager กดยืนยันการชำระเงินของนักเรียนรายคน */
  confirmStudentPayment(student: { paymentId?: string | null; paymentStatus?: string; name?: string }): void {
    if (!student?.paymentId || student.paymentStatus !== 'pending') return;
    if (this.confirmingPaymentId) return;

    if (!confirm(`ยืนยันการชำระเงินของ ${student.name || 'นักเรียน'} ?`)) return;

    const paymentId = student.paymentId;
    this.confirmingPaymentId = paymentId;

    this.paymentService.confirmPayment(paymentId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.confirmingPaymentId = null;
          for (const s of this.allSchedules) {
            for (const st of s.attendedStudents) {
              if (st.paymentId === paymentId) {
                st.paymentStatus = 'confirmed';
              }
            }
          }
          this.loadReport();
        },
        error: (err) => {
          this.confirmingPaymentId = null;
          alert(err?.error?.message || 'ไม่สามารถยืนยันการชำระเงินได้');
        }
      });
  }

  // ── Deduped student list (ตาราง "ประวัติคลาสทั้งหมด" → กริดชื่อเล่นเด็ก) ──
  /** รายชื่อนักเรียนที่มีในรอบการกรอง — แสดงครั้งละ 1 คน ไม่ซ้ำ
   *  ใช้แทนตารางรายคลาสในหน้า revenue เพื่อให้เห็นแค่ชื่อเล่นเด็ก
   *  เรียงตามชื่อเล่น */
  get uniqueStudentsInFilter(): { studentId: string; nickname: string; classCount: number }[] {
    const seen = new Map<string, { nickname: string; classCount: number }>();
    for (const s of this.filteredSchedules) {
      for (const st of s.attendedStudents || []) {
        if (!st.studentId) continue;
        const cur = seen.get(st.studentId);
        if (cur) {
          cur.classCount++;
        } else {
          seen.set(st.studentId, {
            nickname: this.getStudentNickname(st.studentId, st.name),
            classCount: 1
          });
        }
      }
    }
    return Array.from(seen.entries())
      .map(([studentId, v]) => ({ studentId, nickname: v.nickname, classCount: v.classCount }))
      .sort((a, b) => a.nickname.localeCompare(b.nickname, 'th'));
  }

  // ── Student nickname helpers ─────────────────────────────────
  /** หา "ชื่อเล่น" ของนักเรียนจาก studentId — fallback เป็นชื่อเดิมที่ backend ส่งมา
   *  (st.name โดยปกติเป็น "FirstName LastName")
   *  ถ้ามี "(ชื่อเล่น)" ใน fallback ให้ดึงตรงนั้น ไม่งั้นเอา word แรก */
  getStudentNickname(studentId: string, fallback?: string): string {
    const u = this.students.find(s => s._id === studentId);
    if (u) {
      const nick = (u.nickname || '').trim();
      if (nick) return nick;
      const first = (u.firstName || '').trim();
      if (first) return first;
    }
    if (fallback) {
      const m = fallback.match(/\(([^)]+)\)/);
      if (m) return m[1].trim();
      return fallback.split(/\s+/)[0] || fallback;
    }
    return '—';
  }

  /** เปิด modal รายการคลาสที่นักเรียนคนนี้เข้าเรียนทั้งหมดในเดือนที่เลือก */
  openStudentMonthlyModal(studentId: string, fallbackName?: string): void {
    if (!studentId) return;
    const nickname = this.getStudentNickname(studentId, fallbackName);
    this.studentMonthlyTarget = { id: studentId, nickname };
    this.studentMonthlyClasses = this.allSchedules
      .filter(s => s.attendedStudents?.some(st => st.studentId === studentId))
      .slice()
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    this.showStudentMonthlyModal = true;
  }

  closeStudentMonthlyModal(): void {
    this.showStudentMonthlyModal = false;
    this.studentMonthlyTarget = null;
    this.studentMonthlyClasses = [];
  }

  /** ข้อมูลการชำระเงินของนักเรียนคนนี้ในคลาสที่กำหนด */
  getStudentEntry(s: IRevenueSchedule, studentId: string)
    : { amount: number; status?: string; paymentId?: string | null } {
    const e = s.attendedStudents?.find(st => st.studentId === studentId);
    return { amount: e?.paymentAmount || 0, status: e?.paymentStatus, paymentId: e?.paymentId };
  }

  /** ชื่อเดือนเต็มในภาษาไทย เช่น "พฤษภาคม 2569" — ใช้บนหัว modal */
  monthLabelTH(monthStr: string): string {
    if (!monthStr) return '';
    const [y, m] = monthStr.split('-').map(Number);
    if (!y || !m) return '';
    return new Date(y, m - 1, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
  }

  /** ยอดรวมค่าเรียน + จำนวนคลาสในชุดของนักเรียนที่เลือก (ใช้ใน modal footer) */
  get studentMonthlyTotal(): number {
    if (!this.studentMonthlyTarget) return 0;
    const sid = this.studentMonthlyTarget.id;
    return this.studentMonthlyClasses.reduce((sum, s) => sum + this.getStudentEntry(s, sid).amount, 0);
  }

  get studentMonthlyPaidTotal(): number {
    if (!this.studentMonthlyTarget) return 0;
    const sid = this.studentMonthlyTarget.id;
    return this.studentMonthlyClasses.reduce((sum, s) => {
      const e = this.getStudentEntry(s, sid);
      return sum + (e.status === 'confirmed' ? e.amount : 0);
    }, 0);
  }

  trackByExpenseId(_i: number, e: IExpense): string {
    return e._id;
  }

  trackByPieKey(_i: number, p: PieSlice): string {
    return p.key;
  }
}
