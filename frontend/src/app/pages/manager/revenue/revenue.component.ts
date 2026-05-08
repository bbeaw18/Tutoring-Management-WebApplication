import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil, forkJoin } from 'rxjs';
import { PaymentService } from '../../../services/payment.service';
import { UserService } from '../../../services/user.service';
import { ExpenseService, IExpense } from '../../../services/expense.service';
import { IRevenueSchedule } from '../../../interfaces/payment.interface';
import { IUser } from '../../../interfaces/user.interface';
import { LoadingComponent } from '../../../shared/components/loading/loading.component';
import { MonthPickerComponent } from '../../../shared/components/month-picker/month-picker.component';
import { DisplayNamePipe } from '../../../shared/pipes/display-name.pipe';

type KpiMode = 'all' | 'paid' | 'unpaid';

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

  // ── Expenses (per month) ─────────────────────────────────────
  manualExpenses: IExpense[] = [];

  // Modal state for adding new expense
  showExpenseModal = false;
  newExpenseDescription = '';
  newExpenseAmount: number | null = null;
  savingExpense = false;
  expenseError = '';

  // Palette for teacher slices
  private readonly TEACHER_COLORS = [
    '#ec4899', '#1e3f80', '#22c55e', '#f59e0b', '#8b5cf6',
    '#0ea5e9', '#ef4444', '#14b8a6', '#f97316', '#a855f7'
  ];

  constructor(
    private paymentService: PaymentService,
    private userService: UserService,
    private expenseService: ExpenseService
  ) {}

  ngOnInit(): void {
    // Set default month to current month
    const now = new Date();
    this.filterMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    this.loadDropdowns();
    this.loadReport();
    this.loadExpenses();
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
    this.loadReport();
    this.loadExpenses();
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

  // ── Auto teacher wage from completed schedules in selected month ──
  get teacherWageTotal(): number {
    return this.allSchedules.reduce((sum, s) => sum + (s.actualTeacherIncome || 0), 0);
  }

  get manualExpenseTotal(): number {
    return this.manualExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  }

  get expenseTotal(): number {
    return this.teacherWageTotal + this.manualExpenseTotal;
  }

  get netProfit(): number {
    return this.kpiTotal - this.expenseTotal;
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
    const income = this.kpiTotal;
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

  // ── Expense modal handlers ──
  openExpenseModal(): void {
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
    this.expenseService.create({ description: desc, amount, month: this.filterMonth })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (created) => {
          this.manualExpenses = [created, ...this.manualExpenses];
          this.savingExpense = false;
          this.showExpenseModal = false;
        },
        error: (err) => {
          this.savingExpense = false;
          this.expenseError = err?.error?.message || 'ไม่สามารถบันทึกรายจ่ายได้';
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

  trackByExpenseId(_i: number, e: IExpense): string {
    return e._id;
  }

  trackByPieKey(_i: number, p: PieSlice): string {
    return p.key;
  }
}
