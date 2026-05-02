import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ScheduleService } from '../../../services/schedule.service';
import { AuthService } from '../../../services/auth.service';
import { ISchedule, IAttendanceRecord, IQRStatus } from '../../../interfaces/schedule.interface';
import { DisplayNamePipe } from '../../../shared/pipes/display-name.pipe';

@Component({
  selector: 'app-qr-display',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, DisplayNamePipe],
  templateUrl: './qr-display.component.html',
  styleUrls: ['./qr-display.component.css']
})
export class QrDisplayComponent implements OnInit, OnDestroy {
  scheduleId = '';
  schedule: ISchedule | null = null;
  qrDataURL = '';
  qrActive = false;
  qrExpiresAt: Date | null = null;
  attendances: IAttendanceRecord[] = [];

  // สถานะยืนยันเสร็จสิ้นการสอน
  classConfirmed = false;
  confirming = false;

  loading = false;
  generating = false;
  error = '';

  // Theater mode (fullscreen QR display)
  theaterMode = false;

  // Admin manual-add panel
  isAdmin = false;
  selectedStudentId = '';
  manualAdding = false;
  manualError = '';
  manualSuccess = '';

  private pollInterval: any = null;

  constructor(
    private route: ActivatedRoute,
    private scheduleService: ScheduleService,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    this.scheduleId = this.route.snapshot.paramMap.get('id') || '';
    this.isAdmin = this.authService.getUserRole() === 'admin';
    if (this.scheduleId) {
      this.loadSchedule();
      this.checkQRStatus();
    }
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  loadSchedule(): void {
    this.loading = true;
    this.scheduleService.getScheduleById(this.scheduleId).subscribe({
      next: (s) => {
        this.schedule = s;
        // ถ้าคลาสอยู่ในสถานะรอยืนยัน หรือเสร็จสิ้นแล้ว → ถือว่าครูกดยืนยันแล้ว
        if (s.status === 'awaiting_confirmation' || s.status === 'completed') {
          this.classConfirmed = true;
        }
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
  }

  checkQRStatus(): void {
    this.scheduleService.getQRStatus(this.scheduleId).subscribe({
      next: (status: IQRStatus) => {
        this.qrActive = status.qrActive;
        this.qrExpiresAt = status.qrExpiresAt || null;
        this.attendances = status.attendances;
      },
      error: (err) => console.error('[QR] checkQRStatus failed:', err)
    });
  }

  generateQR(): void {
    this.generating = true;
    this.error = '';
    this.scheduleService.generateQR(this.scheduleId).subscribe({
      next: (res) => {
        this.qrDataURL = res.qrDataURL;
        this.qrActive = true;
        this.qrExpiresAt = new Date(res.qrExpiresAt);
        this.generating = false;
        this.startPolling();
      },
      error: (err) => {
        this.error = err.error?.message || 'เกิดข้อผิดพลาดในการสร้าง QR';
        this.generating = false;
      }
    });
  }

  /**
   * ครูกด "ยืนยันเสร็จสิ้นการสอน"
   * - ปิด QR
   * - คำนวณรายได้จริงจากจำนวนผู้เช็คชื่อ
   * - เปลี่ยนสถานะเป็น awaiting_confirmation (รอผู้จัดการยืนยัน)
   */
  confirmClass(): void {
    this.confirming = true;
    this.error = '';
    this.scheduleService.closeQR(this.scheduleId).subscribe({
      next: (result) => {
        this.qrActive = false;
        this.qrDataURL = '';
        this.classConfirmed = true;
        this.confirming = false;
        this.stopPolling();
        if (this.schedule) {
          this.schedule.actualTeacherIncome = result.actualTeacherIncome;
          this.schedule.status = 'awaiting_confirmation';
        }
      },
      error: (err) => {
        this.error = err.error?.message || 'เกิดข้อผิดพลาดในการยืนยัน';
        this.confirming = false;
      }
    });
  }

  // ── Admin: เพิ่มนักเรียนเข้าเรียนด้วยตนเอง ──────────────────────────────
  manualAddStudent(): void {
    if (!this.selectedStudentId) return;
    this.manualAdding = true;
    this.manualError = '';
    this.manualSuccess = '';

    this.scheduleService.manualAddAttendance(this.scheduleId, this.selectedStudentId).subscribe({
      next: (res) => {
        // เพิ่มนักเรียนเข้า attendance list ทันที (ไม่ต้องรอ poll)
        const newRecord: IAttendanceRecord = {
          _id: Date.now().toString(),
          schedule: this.scheduleId,
          student: {
            _id: res.student._id,
            firstName: res.student.firstName,
            lastName: res.student.lastName,
            profileImage: res.student.profileImage
          },
          scannedAt: new Date(res.scannedAt)
        };
        this.attendances = [...this.attendances, newRecord];

        const name = (res.student as any).nickname || `${res.student.firstName} ${res.student.lastName}`;
        this.manualSuccess = `เพิ่ม ${name} สำเร็จ`;
        this.selectedStudentId = '';
        this.manualAdding = false;

        // clear success message after 3s
        setTimeout(() => { this.manualSuccess = ''; }, 3000);
      },
      error: (err) => {
        this.manualError = err.error?.message || 'เพิ่มไม่สำเร็จ';
        this.manualAdding = false;
      }
    });
  }

  /** นักเรียนที่ลงทะเบียนไว้ แต่ยังไม่ได้เช็คชื่อ */
  get unenrolledStudents(): Array<{ _id: string; firstName: string; lastName: string }> {
    if (!this.schedule) return [];
    const checkedIds = new Set(this.attendances.map(a => a.student._id));
    return (this.schedule.students as any[]).filter(s => !checkedIds.has(s._id?.toString() || s.toString()));
  }

  startPolling(): void {
    this.stopPolling();
    // poll ทุก 5 วินาที เพื่ออัปเดตรายชื่อ real-time
    // (ลดจาก 3s เป็น 5s เพื่อลดภาระ server และไม่ชน rate limit)
    this.pollInterval = setInterval(() => {
      this.scheduleService.getQRStatus(this.scheduleId).subscribe({
        next: (status: IQRStatus) => {
          this.qrActive = status.qrActive;
          this.attendances = status.attendances;
          if (!status.qrActive) this.stopPolling();
        },
        error: (err) => console.warn('[QR] polling error (will retry):', err?.status || err)
      });
    }, 5000);
  }

  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  getCourseName(): string {
    if (!this.schedule) return '-';
    const c = this.schedule.course as any;
    return typeof c === 'object' ? c.name : '-';
  }

  getTeacherName(): string {
    if (!this.schedule) return '-';
    const t = this.schedule.teacher as any;
    return typeof t === 'object' ? (t.nickname || `${t.firstName} ${t.lastName}`) : '-';
  }

  // ── Theater Mode ────────────────────────────────────────
  toggleTheater(): void {
    this.theaterMode = !this.theaterMode;
    if (this.theaterMode) {
      document.body.classList.add('qr-theater-active');
    } else {
      document.body.classList.remove('qr-theater-active');
    }
  }
  exitTheater(): void {
    this.theaterMode = false;
    document.body.classList.remove('qr-theater-active');
  }

  /** Attendance progress percentage (out of expected students) */
  get attendancePct(): number {
    const total = this.schedule?.students?.length || 0;
    if (total === 0) return 0;
    return Math.min(100, Math.round((this.attendances.length / total) * 100));
  }

  get expectedTotal(): number {
    return this.schedule?.students?.length || 0;
  }

  /** Minutes until QR expires */
  get minutesUntilExpire(): number {
    if (!this.qrExpiresAt) return 0;
    const ms = new Date(this.qrExpiresAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 60000));
  }
}
