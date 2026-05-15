import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AttendanceService } from '../../../services/attendance.service';
import { AuthService } from '../../../services/auth.service';
import { LoadingComponent } from '../../../shared/components/loading/loading.component';
import { MonthPickerComponent } from '../../../shared/components/month-picker/month-picker.component';
import { resolveDisplayStatus, getDisplayStatusLabel, getDisplayStatusClass } from '../../../shared/constants/schedule-status';

@Component({
  selector: 'app-income',
  standalone: true,
  imports: [CommonModule, FormsModule, LoadingComponent, MonthPickerComponent],
  templateUrl: './income.component.html',
  styleUrls: ['./income.component.css']
})
export class IncomeComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  loading = false;
  currentUser: any;

  /** All teaching sessions (cancelled excluded by backend); filtered client-side by month */
  sessions: any[] = [];
  selectedMonth = '';

  /** Drill-down: the student whose history with this teacher is shown */
  selectedStudent: { id: string; name: string } | null = null;

  constructor(
    private attendanceService: AttendanceService,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();
    const now = new Date();
    this.selectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load(): void {
    this.loading = true;
    // No month param — filter client-side so switching months needs no refetch
    this.attendanceService.getTeacherHistory()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => { this.sessions = data || []; this.loading = false; },
        error: () => { this.loading = false; }
      });
  }

  // ─── Month filter ────────────────────────────────────────────
  private monthKey(s: any): string {
    const d = s?.date ? new Date(s.date) : null;
    if (!d || isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  get filteredSessions(): any[] {
    return this.sessions
      .filter(s => !this.selectedMonth || this.monthKey(s) === this.selectedMonth)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  // ─── Income rule: only counts when status === 'completed' ────
  isPaid(s: any): boolean {
    return s?.status === 'completed';
  }

  /** Income for a session — only when manager-confirmed completed, else null */
  sessionIncome(s: any): number | null {
    return this.isPaid(s) ? Number(s?.actualTeacherIncome || 0) : null;
  }

  // ─── KPI (current/selected month, own, completed only) ───────
  get monthIncome(): number {
    return this.filteredSessions
      .filter(s => this.isPaid(s))
      .reduce((sum, s) => sum + Number(s.actualTeacherIncome || 0), 0);
  }

  get completedCount(): number {
    return this.filteredSessions.filter(s => this.isPaid(s)).length;
  }

  get monthHours(): number {
    const mins = this.filteredSessions
      .filter(s => this.isPaid(s))
      .reduce((sum, s) => sum + (s.totalDurationMinutes || 0), 0);
    return Math.round((mins / 60) * 10) / 10;
  }

  // ─── Drill-down: this student's sessions with me this month ──
  openStudent(student: any, ev?: Event): void {
    ev?.stopPropagation();
    const id = (student?._id || student?.id || '').toString();
    if (!id) return;
    this.selectedStudent = { id, name: this.nick(student) };
  }

  closeStudent(): void {
    this.selectedStudent = null;
  }

  get studentSessions(): any[] {
    if (!this.selectedStudent) return [];
    const sid = this.selectedStudent.id;
    return this.filteredSessions.filter(s =>
      Array.isArray(s.students) &&
      s.students.some((st: any) => (st?._id || st?.id || '').toString() === sid)
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────
  getCourseName(s: any): string {
    return s?.course?.name || '-';
  }

  nick(student: any): string {
    return student?.nickname || student?.firstName || '-';
  }

  statusLabel(s: any): string {
    return getDisplayStatusLabel(resolveDisplayStatus(s));
  }

  statusClass(s: any): string {
    return getDisplayStatusClass(resolveDisplayStatus(s));
  }

  formatMonth(ym: string): string {
    if (!ym) return 'ทั้งหมด';
    const [y, m] = ym.split('-');
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    return `${months[parseInt(m) - 1]} ${parseInt(y) + 543}`;
  }

  formatDuration(minutes: number): string {
    const h = Math.floor((minutes || 0) / 60);
    const mm = (minutes || 0) % 60;
    if (h > 0 && mm > 0) return `${h} ชม. ${mm} นาที`;
    if (h > 0) return `${h} ชม.`;
    return `${mm} นาที`;
  }
}
