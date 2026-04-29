import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ScheduleService } from '../../../services/schedule.service';
import { LoadingComponent } from '../../../shared/components/loading/loading.component';
import { ISchedule } from '../../../interfaces/schedule.interface';
import { MonthPickerComponent } from '../../../shared/components/month-picker/month-picker.component';

@Component({
  selector: 'app-vdo-online',
  standalone: true,
  imports: [CommonModule, FormsModule, LoadingComponent, MonthPickerComponent],
  templateUrl: './vdo-online.component.html',
  styleUrls: ['./vdo-online.component.css']
})
export class VdoOnlineComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  loading = false;
  schedules: ISchedule[] = [];

  // Filter
  selectedMonth = '';

  // Per-schedule: videoLink input & send state
  videoLinks: Record<string, string> = {};
  sendingId = '';
  successId = '';
  errorId = '';
  errorMsg = '';

  readonly monthNames = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                         'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

  constructor(private scheduleService: ScheduleService) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnInit(): void {
    const now = new Date();
    this.selectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    this.loadSchedules();
  }

  loadSchedules(): void {
    this.loading = true;
    const [y, m] = this.selectedMonth.split('-').map(Number);
    this.scheduleService.getCalendarMonthly(y, m)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data: Record<string, ISchedule[]>) => {
          const all = Object.values(data).flat();
          // Only group classes, non-cancelled
          this.schedules = all
            .filter(s => (s.course as any)?.type === 'group' && s.status !== 'cancelled')
            .sort((a, b) => new Date(a.date as string).getTime() - new Date(b.date as string).getTime());
          this.loading = false;
        },
        error: () => { this.loading = false; }
      });
  }

  onMonthChange(): void { this.loadSchedules(); }

  sendVideoLink(sch: ISchedule): void {
    const link = this.videoLinks[sch._id]?.trim();
    if (!link) return;
    this.sendingId = sch._id;
    this.successId = '';
    this.errorId = '';
    this.errorMsg = '';

    this.scheduleService.sendVideoLink(sch._id, link)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sendingId = '';
          this.successId = sch._id;
          this.videoLinks[sch._id] = '';
        },
        error: (err) => {
          this.sendingId = '';
          this.errorId = sch._id;
          this.errorMsg = err?.error?.message || 'เกิดข้อผิดพลาด';
        }
      });
  }

  // ─── Helpers ─────────────────────────────────────────────
  getCourseName(s: ISchedule): string {
    const c = s.course as any;
    return typeof c === 'object' ? (c.name || c.subject || '-') : '-';
  }

  getTeacherName(s: ISchedule): string {
    const t = s.teacher as any;
    return typeof t === 'object' ? `${t.firstName} ${t.lastName}` : '-';
  }

  formatMonth(ym: string): string {
    if (!ym) return '';
    const [y, m] = ym.split('-');
    return `${this.monthNames[parseInt(m) - 1]} ${parseInt(y) + 543}`;
  }

  getStatusLabel(s: string): string {
    return {
      pending: 'รอครูยืนยัน', confirmed: 'ครูยืนยันแล้ว', scheduled: 'นัดแล้ว',
      completed: 'เสร็จสิ้น', cancelled: 'ยกเลิก', awaiting_confirmation: 'รอ Manager ยืนยัน'
    }[s] || s;
  }

  getStatusClass(s: string): string {
    return { completed: 'status-completed', awaiting_confirmation: 'status-awaiting',
             confirmed: 'status-confirmed', pending: 'status-pending' }[s] || '';
  }
}
