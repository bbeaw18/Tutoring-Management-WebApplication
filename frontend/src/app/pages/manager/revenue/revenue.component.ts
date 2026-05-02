import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil, forkJoin } from 'rxjs';
import { PaymentService } from '../../../services/payment.service';
import { UserService } from '../../../services/user.service';
import { IRevenueSchedule } from '../../../interfaces/payment.interface';
import { IUser } from '../../../interfaces/user.interface';
import { LoadingComponent } from '../../../shared/components/loading/loading.component';
import { MonthPickerComponent } from '../../../shared/components/month-picker/month-picker.component';
import { DisplayNamePipe } from '../../../shared/pipes/display-name.pipe';

type KpiMode = 'all' | 'paid' | 'unpaid';

@Component({
  selector: 'app-revenue',
  standalone: true,
  imports: [CommonModule, FormsModule, LoadingComponent, MonthPickerComponent, DisplayNamePipe],
  templateUrl: './revenue.component.html',
  styleUrls: ['./revenue.component.css']
})
export class RevenueComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // KPI totals
  kpiTotal   = 0;
  kpiPaid    = 0;
  kpiUnpaid  = 0;

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

  constructor(
    private paymentService: PaymentService,
    private userService: UserService
  ) {}

  ngOnInit(): void {
    // Set default month to current month
    const now = new Date();
    this.filterMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    this.loadDropdowns();
    this.loadReport();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
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
    const params: any = {};
    if (this.filterMonth)   params.month     = this.filterMonth;
    if (this.filterTeacher) params.teacherId = this.filterTeacher;
    if (this.filterStudent) params.studentId = this.filterStudent;

    this.paymentService.getRevenueReport(params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.kpiTotal  = res.kpi.total;
          this.kpiPaid   = res.kpi.paid;
          this.kpiUnpaid = res.kpi.unpaid;
          this.allSchedules = res.schedules;
          this.loading = false;
        },
        error: () => { this.loading = false; }
      });
  }

  onFilterChange(): void {
    this.loadReport();
  }

  selectKpi(mode: KpiMode): void {
    this.activeKpi = mode;
  }

  get filteredSchedules(): IRevenueSchedule[] {
    if (this.activeKpi === 'paid') {
      return this.allSchedules.filter(s => s.paid > 0);
    }
    if (this.activeKpi === 'unpaid') {
      return this.allSchedules.filter(s => s.unpaid > 0);
    }
    return this.allSchedules;
  }

  /** Daily revenue bars for the currently filtered month */
  get dailyBars(): { day: number; paid: number; unpaid: number; heightPaid: number; heightUnpaid: number; isPeak: boolean }[] {
    if (!this.filterMonth) return [];
    const [y, m] = this.filterMonth.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const buckets: Record<number, { paid: number; unpaid: number }> = {};
    for (let d = 1; d <= daysInMonth; d++) buckets[d] = { paid: 0, unpaid: 0 };
    for (const s of this.allSchedules) {
      const dt = new Date(s.date);
      const day = dt.getDate();
      if (!buckets[day]) buckets[day] = { paid: 0, unpaid: 0 };
      buckets[day].paid   += s.paid   || 0;
      buckets[day].unpaid += s.unpaid || 0;
    }
    const maxVal = Math.max(1, ...Object.values(buckets).map(v => v.paid + v.unpaid));
    const peakVal = maxVal;
    return Object.entries(buckets).map(([day, v]) => {
      const total = v.paid + v.unpaid;
      return {
        day: Number(day),
        paid: v.paid,
        unpaid: v.unpaid,
        heightPaid:   maxVal > 0 ? (v.paid / maxVal) * 100 : 0,
        heightUnpaid: maxVal > 0 ? (v.unpaid / maxVal) * 100 : 0,
        isPeak: total === peakVal && total > 0
      };
    });
  }

  /** Top teachers by total income for period */
  get topTeachers(): { name: string; total: number; count: number; pct: number }[] {
    const tally: Record<string, { name: string; total: number; count: number }> = {};
    for (const s of this.allSchedules) {
      const t: any = (s as any).teacher;
      if (!t) continue;
      const id = t._id || t.id || (typeof t === 'string' ? t : '');
      if (!id) continue;
      const name = `${t.firstName || ''} ${t.lastName || ''}`.trim() || 'ไม่ระบุ';
      if (!tally[id]) tally[id] = { name, total: 0, count: 0 };
      tally[id].total += (s.paid || 0) + (s.unpaid || 0);
      tally[id].count += 1;
    }
    const list = Object.values(tally).sort((a, b) => b.total - a.total).slice(0, 5);
    const max = Math.max(1, ...list.map(x => x.total));
    return list.map(x => ({ ...x, pct: (x.total / max) * 100 }));
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
          // อัปเดต local state ทันที (ไม่ต้องรอ refetch)
          for (const s of this.allSchedules) {
            for (const st of s.attendedStudents) {
              if (st.paymentId === paymentId) {
                st.paymentStatus = 'confirmed';
              }
            }
          }
          // ดึงข้อมูลใหม่เพื่อ refresh KPI
          this.loadReport();
        },
        error: (err) => {
          this.confirmingPaymentId = null;
          alert(err?.error?.message || 'ไม่สามารถยืนยันการชำระเงินได้');
        }
      });
  }
}
