import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AuthService } from '../../../services/auth.service';
import { AttendanceService } from '../../../services/attendance.service';
import { UserService } from '../../../services/user.service';
import { AliasService } from '../../../services/alias.service';
import { ScheduleService } from '../../../services/schedule.service';
import { PaymentService } from '../../../services/payment.service';
import { ISchedule } from '../../../interfaces/schedule.interface';
import { MonthPickerComponent } from '../../../shared/components/month-picker/month-picker.component';
import { DisplayNamePipe } from '../../../shared/pipes/display-name.pipe';
import { resolveDisplayStatus, getDisplayStatusLabel, getDisplayStatusClass } from '../../../shared/constants/schedule-status';

@Component({
  selector: 'app-history',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MonthPickerComponent, DisplayNamePipe],
  templateUrl: './history.component.html',
  styleUrls: ['./history.component.css']
})
export class HistoryComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  currentUser: any = null;
  role = '';
  loading = false;

  // ─── Raw data ─────────────────────────────────────────────
  attendanceHistory: any[] = [];
  teachingHistory: any[] = [];
  studentSchedules: ISchedule[] = [];   // student: schedules with confirmation status

  // ─── Filter state ──────────────────────────────────────────
  selectedMonth = '';          // 'YYYY-MM'  empty = all
  selectedTeacherId = '';      // manager only
  teachers: any[] = [];

  // ─── View toggle & status chip ─────────────────────────────
  hViewMode: 'timeline' | 'table' = 'timeline';
  hStatusFilter: 'all' | 'completed' | 'awaiting_confirmation' | 'pending' | 'cancelled' = 'all';

  // ─── Confirm state ─────────────────────────────────────────
  confirmingId = '';

  // ─── Detail Modal ───────────────────────────────────────────
  showDetailModal = false;
  selectedSchedule: any = null;
  schedulePayments: any[] = [];
  paymentsLoading = false;

  constructor(
    private authService: AuthService,
    private attendanceService: AttendanceService,
    private userService: UserService,
    private scheduleService: ScheduleService,
    private paymentService: PaymentService,   // kept for teacher/manager payment QR
    private aliasService: AliasService
  ) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();
    this.role = this.currentUser?.role || '';
    // Default month = current month
    const now = new Date();
    this.selectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    this.loadHistory();
    this.loadUserStats();
    if (this.role === 'manager' || this.role === 'admin') {
      this.loadTeachers();
    }
  }

  // ─── Load ──────────────────────────────────────────────────

  loadHistory(): void {
    this.loading = true;
    if (this.role === 'student') {
      // Student: load schedules with confirmation status for the selected month
      const [y, m] = this.selectedMonth
        ? this.selectedMonth.split('-').map(Number)
        : [new Date().getFullYear(), new Date().getMonth() + 1];
      this.scheduleService.getCalendarMonthly(y, m)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (data: Record<string, ISchedule[]>) => {
            // Flatten date-keyed dict to array, sorted by date asc
            this.studentSchedules = Object.values(data)
              .flat()
              .sort((a, b) => new Date(a.date as string).getTime() - new Date(b.date as string).getTime());
            this.loading = false;
          },
          error: () => { this.loading = false; }
        });
    } else {
      const params: any = {};
      if (this.selectedTeacherId) params.teacherId = this.selectedTeacherId;
      // Pass no month to backend — we filter client-side so all-time KPI works
      this.attendanceService.getTeacherHistory(params)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (data) => { this.teachingHistory = data || []; this.loading = false; },
          error: () => { this.loading = false; }
        });
    }
  }

  loadUserStats(): void {
    if (!this.currentUser) return;
    this.userService.getUserById(this.currentUser._id || this.currentUser.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (user: any) => { if (user) this.currentUser = { ...this.currentUser, ...user }; },
        error: (err) => console.error('[History] loadUserStats failed:', err)
      });
  }

  loadTeachers(): void {
    // รวม manager ที่สอนได้ในรายชื่อครูด้วย
    this.userService.getTeachingStaff()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => { this.teachers = res.data || []; },
        error: (err) => console.error('[History] loadTeachers failed:', err)
      });
  }

  // ─── Filter handlers ───────────────────────────────────────

  onMonthChange(): void {
    // For student: reload schedules when month changes
    if (this.role === 'student') this.loadHistory();
  }

  onTeacherChange(): void { this.loadHistory(); }

  // ─── Filtered lists (client-side month filter) ─────────────

  get filteredAttendanceHistory(): any[] {
    if (!this.selectedMonth) return this.attendanceHistory;
    return this.attendanceHistory.filter(a => {
      const d = a.schedule?.date;
      if (!d) return false;
      const m = new Date(d);
      const ym = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
      return ym === this.selectedMonth;
    });
  }

  // trackBy — กัน DOM teardown ตอน list ถูกแทนใหม่ (reload/filter)
  trackBySchedule = (_: number, s: any): string => s?._id || s?.id || '';
  trackByGroupKey = (_: number, g: { dateKey: string }): string => g.dateKey;

  get filteredTeachingHistory(): any[] {
    if (!this.selectedMonth) return this.teachingHistory;
    return this.teachingHistory.filter(s => {
      if (!s.date) return false;
      const m = new Date(s.date);
      const ym = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
      return ym === this.selectedMonth;
    });
  }

  // ─── KPI: all-time ─────────────────────────────────────────

  get totalLearningMinutes(): number {
    return this.attendanceHistory.reduce((s, a) => s + (a.schedule?.totalDurationMinutes || 0), 0);
  }
  get totalTeachingMinutes(): number {
    return this.teachingHistory.reduce((s, t) => s + (t.totalDurationMinutes || 0), 0);
  }
  get totalIncome(): number {
    // รวมทั้ง completed และ awaiting_confirmation (รายได้ถูกคำนวณแล้วตั้งแต่คลาสจบ)
    return this.teachingHistory
      .filter(t => t.status === 'completed' || t.status === 'awaiting_confirmation')
      .reduce((s, t) => s + (t.actualTeacherIncome || 0), 0);
  }
  get totalClasses(): number {
    return this.role === 'student' ? this.attendanceHistory.length : this.teachingHistory.length;
  }

  // ─── KPI: selected month ───────────────────────────────────

  get monthLearningMinutes(): number {
    return this.filteredAttendanceHistory.reduce((s, a) => s + (a.schedule?.totalDurationMinutes || 0), 0);
  }
  get monthTeachingMinutes(): number {
    return this.filteredTeachingHistory.reduce((s, t) => s + (t.totalDurationMinutes || 0), 0);
  }
  get monthIncome(): number {
    return this.filteredTeachingHistory
      .filter(t => t.status === 'completed' || t.status === 'awaiting_confirmation')
      .reduce((s, t) => s + (t.actualTeacherIncome || 0), 0);
  }
  get monthClasses(): number {
    return this.role === 'student'
      ? this.filteredAttendanceHistory.length
      : this.filteredTeachingHistory.length;
  }

  // ─── Student: unpaid amount in selected month ──────────────
  get monthUnpaidAmount(): number {
    return this.filteredAttendanceHistory.reduce((s, a) => {
      const hasPaid = a.paymentStatus === 'paid';
      return s + (hasPaid ? 0 : (a.schedule?.coursePrice || 0));
    }, 0);
  }

  // ─── Student: schedule helpers ─────────────────────────────

  getMyConfirmStatus(sch: ISchedule): string {
    const myId = this.currentUser?._id || this.currentUser?.id;
    const conf = sch.studentConfirmations?.find(
      sc => (sc.student as any)?._id === myId || (sc.student as any) === myId
    );
    return conf?.status || 'pending';
  }

  getConfirmLabel(status: string): string {
    return { accepted: 'ยืนยันแล้ว', declined: 'ปฏิเสธ', pending: 'รอยืนยัน' }[status] || status;
  }

  getConfirmClass(status: string): string {
    return { accepted: 'conf-accepted', declined: 'conf-declined', pending: 'conf-pending' }[status] || '';
  }

  /** Unified display status — accepts schedule object (best) or raw status string */
  getScheduleStatusLabel(s: any): string {
    if (typeof s === 'string') return getDisplayStatusLabel(s as any);
    return getDisplayStatusLabel(resolveDisplayStatus(s));
  }

  getScheduleStatusClass(s: any): string {
    if (typeof s === 'string') return getDisplayStatusClass(s as any);
    return getDisplayStatusClass(resolveDisplayStatus(s));
  }

  getCourseName2(s: ISchedule): string {
    const c = s.course as any;
    return typeof c === 'object' ? (c.name || c.subject || '-') : '-';
  }

  getTeacherName2(s: ISchedule): string {
    const t = s.teacher as any;
    return typeof t === 'object' ? (this.aliasService.getAlias(t._id || t.id) || t.nickname || `${t.firstName} ${t.lastName}`) : '-';
  }

  /** "ชื่อวิชา - ครู<ชื่อเล่นครู>" — ใช้ subject (สั้น) ก่อน ค่อย name */
  getCourseWithTeacher(s: ISchedule): string {
    const c = s.course as any;
    const courseName = (c && typeof c === 'object') ? (c.subject || c.name || '-') : '-';
    const t = s.teacher as any;
    if (!t || typeof t !== 'object') return courseName;
    const nick = (this.aliasService.getAlias(t._id || t.id) || t.nickname || t.firstName || '').trim();
    return nick ? `${courseName} - ครู${nick}` : courseName;
  }

  /** "น้อง<ชื่อเล่น> ม.6, น้อง<ชื่อเล่น2> ม.5" — ใช้ใน subline สีเทา */
  getStudentsWithGrade(s: ISchedule): string {
    const students: any[] = Array.isArray(s.students) ? s.students : [];
    const items = students
      .filter(st => st && typeof st === 'object')
      .map(st => {
        const nick = (this.aliasService.getAlias(st._id || st.id) || st.nickname || st.firstName || '').trim();
        if (!nick) return '';
        // ลองทุกฟิลด์ที่อาจเก็บระดับชั้น
        const grade = (st.grade || st.academicYear || '').toString().trim();
        return grade ? `น้อง${nick} ${grade}` : `น้อง${nick}`;
      })
      .filter(Boolean);
    if (items.length === 0) return '';
    if (items.length <= 2) return items.join(', ');
    return `${items[0]}, ${items[1]} +${items.length - 2}`;
  }

  // KPI for student schedule view
  get acceptedCount(): number {
    return this.studentSchedules.filter(s => this.getMyConfirmStatus(s) === 'accepted').length;
  }
  get pendingConfirmCount(): number {
    return this.studentSchedules.filter(s => this.getMyConfirmStatus(s) === 'pending').length;
  }
  get declinedCount(): number {
    return this.studentSchedules.filter(s => this.getMyConfirmStatus(s) === 'declined').length;
  }

  // ─── Manager confirm ───────────────────────────────────────

  confirmClass(scheduleId: string): void {
    if (this.confirmingId) return;
    this.confirmingId = scheduleId;
    this.scheduleService.managerConfirm(scheduleId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.confirmingId = '';
          this.loadHistory();
          this.loadUserStats();
        },
        error: () => { this.confirmingId = ''; }
      });
  }

  // ─── Helpers ───────────────────────────────────────────────

  getCourseName(record: any): string {
    return record.schedule?.course?.name || '-';
  }

  getTeacherName(record: any): string {
    const t = record.schedule?.teacher;
    if (!t) return '-';
    return (this.aliasService.getAlias(t._id || t.id) || t.nickname || `${t.firstName} ${t.lastName}`);
  }

  formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0 && m > 0) return `${h} ชม. ${m} นาที`;
    if (h > 0) return `${h} ชม.`;
    return `${m} นาที`;
  }

  formatMonth(ym: string): string {
    if (!ym) return 'ทั้งหมด';
    const [y, m] = ym.split('-');
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    return `${months[parseInt(m) - 1]} ${parseInt(y) + 543}`;
  }

  getStatusLabel(scheduleOrStatus: any): string {
    if (typeof scheduleOrStatus === 'string') return getDisplayStatusLabel(scheduleOrStatus as any);
    return getDisplayStatusLabel(resolveDisplayStatus(scheduleOrStatus));
  }

  getStatusClass(scheduleOrStatus: any): string {
    if (typeof scheduleOrStatus === 'string') return getDisplayStatusClass(scheduleOrStatus as any);
    return getDisplayStatusClass(resolveDisplayStatus(scheduleOrStatus));
  }

  /** Legacy helper still referenced by the old detail modal — keep for compat */
  getStatusClassLegacy(status: string): string {
    const m: Record<string, string> = {
      pending: 'status-pending',
      confirmed: 'status-confirmed',
      scheduled: 'status-scheduled',
      awaiting_confirmation: 'status-awaiting',
      completed: 'status-completed',
      cancelled: 'status-cancelled'
    };
    return m[status] || '';
  }

  getTeacherDisplayName(t: any): string {
    return t ? (this.aliasService.getAlias(t._id || t.id) || t.nickname || `${t.firstName} ${t.lastName}`) : '';
  }

  // ── Hourly-mode rollout cutoffs (ตรงกับ course-management + revenue) ──
  private readonly TEACHER_HOURLY_FROM = new Date('2026-05-08T00:00:00+07:00');
  private readonly PRICE_HOURLY_FROM   = new Date('2026-05-09T00:00:00+07:00');

  private getScheduleDate(s: any): Date | null {
    const raw = s?.date;
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  isPriceHourlyForSchedule(s: any): boolean {
    const d = this.getScheduleDate(s);
    return !!d && d >= this.PRICE_HOURLY_FROM;
  }

  isTeacherHourlyForSchedule(s: any): boolean {
    const d = this.getScheduleDate(s);
    return !!d && d >= this.TEACHER_HOURLY_FROM;
  }

  /** ชั่วโมงของคลาส คำนวณจาก totalDurationMinutes ก่อน, fallback start/end */
  getScheduleHours(s: any): number {
    if (s?.totalDurationMinutes && s.totalDurationMinutes > 0) {
      return s.totalDurationMinutes / 60;
    }
    if (s?.startTime && s?.endTime) {
      const [sh, sm] = String(s.startTime).split(':').map(Number);
      const [eh, em] = String(s.endTime).split(':').map(Number);
      let minutes = (eh * 60 + em) - (sh * 60 + sm);
      if (minutes <= 0) minutes += 24 * 60; // ข้ามเที่ยงคืน (เลิกวันถัดไป)
      return minutes > 0 ? minutes / 60 : 0;
    }
    return 0;
  }

  formatHoursH(h: number): string {
    if (!h || h <= 0) return '0 ชม.';
    return Number.isInteger(h) ? `${h} ชม.` : `${h.toFixed(1)} ชม.`;
  }

  /** ค่าเรียนต่อคน — ยอดรวม (rate × hours สำหรับคลาสใหม่, flat สำหรับคลาสเก่า) */
  getCoursePriceTotal(s: any): number {
    const rate = Number(s?.coursePrice || 0);
    if (this.isPriceHourlyForSchedule(s)) {
      return Math.round(rate * this.getScheduleHours(s));
    }
    return rate;
  }

  /** รายได้ครูสำหรับ type — ยอดรวม */
  getTeacherIncomeTotalByType(s: any, type: 'individual' | 'group'): number {
    const rate = Number(type === 'individual'
      ? (s?.teacherIncomeIndividual || 0)
      : (s?.teacherIncomeGroup || 0));
    if (this.isTeacherHourlyForSchedule(s)) {
      return Math.round(rate * this.getScheduleHours(s));
    }
    return rate;
  }

  // ─── Timeline view helpers ────────────────────────────────
  setHViewMode(m: 'timeline' | 'table'): void { this.hViewMode = m; }
  setHStatus(s: 'all' | 'completed' | 'awaiting_confirmation' | 'pending' | 'cancelled'): void {
    this.hStatusFilter = s;
  }

  /** Status chip counts on the teacher/manager view */
  get hStatusCounts(): { all: number; completed: number; awaiting: number; pending: number; cancelled: number } {
    const list = this.filteredTeachingHistory;
    return {
      all: list.length,
      completed: list.filter(s => s.status === 'completed').length,
      awaiting: list.filter(s => s.status === 'awaiting_confirmation').length,
      pending: list.filter(s => s.status === 'pending' || s.status === 'confirmed' || s.status === 'scheduled').length,
      cancelled: list.filter(s => s.status === 'cancelled').length,
    };
  }

  get hStatusFilteredTeaching(): any[] {
    const list = this.filteredTeachingHistory;
    if (this.hStatusFilter === 'all') return list;
    if (this.hStatusFilter === 'pending') {
      return list.filter(s => s.status === 'pending' || s.status === 'confirmed' || s.status === 'scheduled');
    }
    return list.filter(s => s.status === this.hStatusFilter);
  }

  /** Group teaching history by date string for timeline view */
  get hTimelineGroups(): { dateKey: string; dateLabel: string; weekday: string; items: any[] }[] {
    const list = this.hStatusFilteredTeaching;
    const map = new Map<string, any[]>();
    for (const s of list) {
      if (!s.date) continue;
      const d = new Date(s.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    const monthShort = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const weekdays = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
    const groups = Array.from(map.entries()).map(([key, items]) => {
      const d = new Date(key);
      const sortedItems = items.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
      return {
        dateKey: key,
        dateLabel: `${d.getDate()} ${monthShort[d.getMonth()]} ${d.getFullYear() + 543}`,
        weekday: weekdays[d.getDay()],
        items: sortedItems
      };
    });
    return groups.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  }

  // ─── Detail Modal ───────────────────────────────────────────
  openDetail(schedule: any): void {
    this.selectedSchedule = schedule;
    this.showDetailModal = true;
    this.schedulePayments = [];
    this.loadSchedulePayments(schedule._id);
  }

  closeDetail(): void {
    this.showDetailModal = false;
    this.selectedSchedule = null;
    this.schedulePayments = [];
  }

  /** ดึงข้อมูลการชำระเงินที่เกี่ยวข้องกับ schedule นี้ */
  loadSchedulePayments(scheduleId: string): void {
    this.paymentsLoading = true;
    this.paymentService.getPayments({ schedule: scheduleId, limit: 1000 } as any)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.schedulePayments = res?.data || [];
          this.paymentsLoading = false;
        },
        error: () => { this.paymentsLoading = false; }
      });
  }

  /** Map paymentStatus ของนักเรียนคนหนึ่งใน schedule นี้ */
  getStudentPaymentStatus(studentId: string): 'unpaid' | 'pending' | 'confirmed' | 'rejected' {
    const sid = String(studentId);
    const matching = this.schedulePayments.filter(p => {
      const pid = String((p.student?._id || p.student) || '');
      return pid === sid;
    });
    if (matching.some(p => p.status === 'confirmed')) return 'confirmed';
    if (matching.some(p => p.status === 'pending'))   return 'pending';
    if (matching.some(p => p.status === 'rejected'))  return 'rejected';
    return 'unpaid';
  }

  getPaymentStatusLabel(s: string): string {
    return {
      confirmed: 'ชำระเงินสำเร็จ',
      pending:   'รอ Manager ยืนยัน',
      rejected:  'ปฏิเสธการชำระ',
      unpaid:    'ยังไม่ชำระ'
    }[s] || s;
  }

  getPaymentStatusClass(s: string): string {
    return {
      confirmed: 'pay-confirmed',
      pending:   'pay-pending',
      rejected:  'pay-rejected',
      unpaid:    'pay-unpaid'
    }[s] || '';
  }

  /** ดึง payment ของฉัน (สำหรับ student) ใน schedule นี้ */
  getMyPaymentStatus(): 'unpaid' | 'pending' | 'confirmed' | 'rejected' {
    const myId = String(this.currentUser?._id || this.currentUser?.id || '');
    return this.getStudentPaymentStatus(myId);
  }

  /** ผลลัพธ์ของ event timeline (manager confirm completion) */
  isClassFinished(s: any): boolean {
    return s?.status === 'completed' || s?.status === 'awaiting_confirmation';
  }
  isManagerConfirmed(s: any): boolean {
    return s?.status === 'completed' || !!s?.managerConfirmedAt;
  }

  /** จำนวนนักเรียนที่ยืนยันแล้ว */
  getAcceptedStudentCount(s: any): number {
    return (s?.studentConfirmations || []).filter((sc: any) => sc.status === 'accepted').length;
  }

  formatDateTime(d: any): string {
    if (!d) return '-';
    const date = new Date(d);
    return date.toLocaleString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  /** For student timeline */
  get sTimelineGroups(): { dateKey: string; dateLabel: string; weekday: string; items: ISchedule[] }[] {
    const map = new Map<string, ISchedule[]>();
    for (const s of this.studentSchedules) {
      if (!s.date) continue;
      const d = new Date(s.date as any);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    const monthShort = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const weekdays = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
    const groups = Array.from(map.entries()).map(([key, items]) => {
      const d = new Date(key);
      const sortedItems = items.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
      return {
        dateKey: key,
        dateLabel: `${d.getDate()} ${monthShort[d.getMonth()]} ${d.getFullYear() + 543}`,
        weekday: weekdays[d.getDay()],
        items: sortedItems
      };
    });
    return groups.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  }
}
