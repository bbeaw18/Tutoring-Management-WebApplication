import { Component, OnInit, OnDestroy, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ScheduleService } from '../../../services/schedule.service';
import { LoadingComponent } from '../../../shared/components/loading/loading.component';
import { ISchedule } from '../../../interfaces/schedule.interface';
import { MonthPickerComponent } from '../../../shared/components/month-picker/month-picker.component';
import { DisplayNamePipe } from '../../../shared/pipes/display-name.pipe';

@Component({
  selector: 'app-vdo-online',
  standalone: true,
  imports: [CommonModule, FormsModule, LoadingComponent, MonthPickerComponent, DisplayNamePipe],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './vdo-online.component.html',
  styleUrls: ['./vdo-online.component.css']
})
export class VdoOnlineComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  loading = false;
  schedules: ISchedule[] = [];

  // Filter
  selectedMonth = '';

  // v2: subject (category) filter
  vdoSubject = '';

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
    return typeof t === 'object' ? (t.nickname || `${t.firstName} ${t.lastName}`) : '-';
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

  /** Duration label "Nh Mm" / "Mm" derived from startTime/endTime ("HH:mm"). */
  getDuration(s: ISchedule): string {
    const a = (s as any).startTime as string | undefined;
    const b = (s as any).endTime as string | undefined;
    if (!a || !b) return '';
    const [ah, am] = a.split(':').map(Number);
    const [bh, bm] = b.split(':').map(Number);
    let mins = (bh * 60 + bm) - (ah * 60 + am);
    if (mins <= 0) mins += 24 * 60; // ข้ามเที่ยงคืน (เลิกวันถัดไป)
    if (!Number.isFinite(mins) || mins <= 0) return '';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h && m) return `${h}ชม ${m}น`;
    if (h)      return `${h}ชม`;
    return `${m}น`;
  }

  /** Stable hue (0–359) for thumbnail tint, derived from schedule id. */
  getHue(s: ISchedule): number {
    const id = String(s._id || '');
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    return hash % 360;
  }

  /** Single-character initial for thumb (course name first char). */
  getInitial(s: ISchedule): string {
    return (this.getCourseName(s) || '?').trim().charAt(0).toUpperCase();
  }

  /** Subject of the schedule (course.subject), or 'อื่นๆ' if missing. */
  getSubject(s: ISchedule): string {
    const c: any = s.course;
    if (c && typeof c === 'object') {
      return (c.subject || c.name || '').trim() || 'อื่นๆ';
    }
    return 'อื่นๆ';
  }

  /** Distinct subjects across loaded schedules with counts. Sorted desc by count. */
  get subjectChips(): { value: string; count: number }[] {
    const m = new Map<string, number>();
    for (const s of this.schedules) {
      const k = this.getSubject(s);
      m.set(k, (m.get(k) || 0) + 1);
    }
    return Array.from(m.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'th'));
  }

  /** Schedules filtered by subject chip (if any). */
  get filteredSchedules(): ISchedule[] {
    if (!this.vdoSubject) return this.schedules;
    return this.schedules.filter(s => this.getSubject(s) === this.vdoSubject);
  }

  toggleSubject(v: string): void {
    this.vdoSubject = (this.vdoSubject === v) ? '' : v;
  }
}
