import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AttendanceService } from '../../../services/attendance.service';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-scan',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="scan-page" [attr.data-status]="status">

      <!-- Animated background orbs -->
      <div class="scan-orb scan-orb-1"></div>
      <div class="scan-orb scan-orb-2"></div>
      <div class="scan-orb scan-orb-3"></div>

      <div class="scan-card" [attr.data-status]="status">

        <!-- Top brand bar -->
        <div class="scan-brand">
          <div class="brand-logo">
            <svg width="28" height="28" viewBox="0 0 48 48" fill="none">
              <rect width="48" height="48" rx="14" fill="currentColor"/>
              <polygon points="24,10 42,20 24,30 6,20" fill="white" opacity="0.95"/>
              <path d="M15,24 L15,35 C15,35 19,41 24,41 C29,41 33,35 33,35 L33,24 L24,30 Z" fill="white" opacity="0.8"/>
            </svg>
          </div>
          <div class="brand-info">
            <span class="brand-name">KMS</span>
            <span class="brand-sub">Know More Sci</span>
          </div>
          <div class="scan-status-pill" [attr.data-status]="status">
            <span class="pill-dot"></span>
            <span *ngIf="status === 'loading'">กำลังตรวจสอบ</span>
            <span *ngIf="status === 'success'">สำเร็จ</span>
            <span *ngIf="status === 'duplicate'">ซ้ำ</span>
            <span *ngIf="status === 'error'">ผิดพลาด</span>
            <span *ngIf="status === 'invalid'">ไม่ถูกต้อง</span>
          </div>
        </div>

        <!-- Loading state -->
        <div *ngIf="status === 'loading'" class="status-box loading">
          <div class="scan-pulse-ring">
            <div class="ring r1"></div>
            <div class="ring r2"></div>
            <div class="ring r3"></div>
            <div class="ring-icon">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20v1"/>
              </svg>
            </div>
          </div>
          <h2>กำลังเช็คชื่อ...</h2>
          <p>โปรดรอสักครู่ กำลังตรวจสอบ QR Code ของคุณ</p>
          <div class="loading-bar"><div class="loading-bar-fill"></div></div>
        </div>

        <!-- Success state -->
        <div *ngIf="status === 'success'" class="status-box success">
          <div class="scan-success-burst">
            <div class="burst-circle"></div>
            <div class="icon-circle success-circle">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <span class="confetti c1"></span>
            <span class="confetti c2"></span>
            <span class="confetti c3"></span>
            <span class="confetti c4"></span>
            <span class="confetti c5"></span>
            <span class="confetti c6"></span>
          </div>
          <h2>เช็คชื่อสำเร็จ!</h2>
          <div class="success-card">
            <div class="success-row">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              <span class="row-label">นักเรียน</span>
              <span class="row-value">{{ studentName }}</span>
            </div>
            <div class="success-row" *ngIf="courseName">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
              <span class="row-label">วิชา</span>
              <span class="row-value">{{ courseName }}</span>
            </div>
            <div class="success-row">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <span class="row-label">เวลาที่บันทึก</span>
              <span class="row-value">{{ scannedAt | date:'HH:mm:ss' }}</span>
            </div>
          </div>
          <a [routerLink]="dashboardPath" class="btn btn-primary">
            กลับหน้าหลัก
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </a>
        </div>

        <!-- Duplicate -->
        <div *ngIf="status === 'duplicate'" class="status-box warning">
          <div class="icon-circle warn-circle">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <h2>เช็คชื่อซ้ำ</h2>
          <p>คุณได้เช็คชื่อในคลาสนี้แล้ว ไม่สามารถเช็คชื่อซ้ำได้</p>
          <a [routerLink]="dashboardPath" class="btn btn-secondary">กลับหน้าหลัก</a>
        </div>

        <!-- Error -->
        <div *ngIf="status === 'error'" class="status-box error">
          <div class="icon-circle error-circle">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </div>
          <h2>เช็คชื่อไม่สำเร็จ</h2>
          <p>{{ errorMessage }}</p>
          <a [routerLink]="dashboardPath" class="btn btn-secondary">กลับหน้าหลัก</a>
        </div>

        <!-- Invalid -->
        <div *ngIf="status === 'invalid'" class="status-box error">
          <div class="icon-circle error-circle">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </div>
          <h2>ลิงก์ไม่ถูกต้อง</h2>
          <p>QR Code นี้อาจไม่ถูกต้องหรือหมดอายุแล้ว ลองสแกน QR ใหม่จากครูของคุณอีกครั้ง</p>
          <a [routerLink]="dashboardPath" class="btn btn-secondary">กลับหน้าหลัก</a>
        </div>

      </div>
    </div>
  `,
  styles: [`
    .scan-page {
      position: fixed;
      inset: 0;
      background:
        radial-gradient(circle at 20% 30%, rgba(99, 102, 241, .15) 0%, transparent 45%),
        radial-gradient(circle at 80% 70%, rgba(236, 72, 153, .12) 0%, transparent 50%),
        linear-gradient(135deg, #0a0f1e 0%, #1a1040 60%, #0d0a20 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      overflow: hidden;
    }

    /* Animated background orbs */
    .scan-orb {
      position: absolute;
      border-radius: 50%;
      filter: blur(60px);
      opacity: .35;
      pointer-events: none;
    }
    .scan-orb-1 {
      width: 360px; height: 360px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      top: -80px; left: -80px;
      animation: orbDrift 14s ease-in-out infinite;
    }
    .scan-orb-2 {
      width: 320px; height: 320px;
      background: linear-gradient(135deg, #ec4899, #f43f5e);
      bottom: -60px; right: -60px;
      animation: orbDrift 18s ease-in-out infinite reverse;
    }
    .scan-orb-3 {
      width: 240px; height: 240px;
      background: linear-gradient(135deg, #06b6d4, #0ea5e9);
      top: 40%; left: 60%;
      animation: orbDrift 22s ease-in-out infinite 2s;
      opacity: .25;
    }
    @keyframes orbDrift {
      0%, 100% { transform: translate(0, 0) scale(1); }
      33% { transform: translate(30px, -20px) scale(1.06); }
      66% { transform: translate(-20px, 30px) scale(.94); }
    }

    /* When success, recolor whole bg subtly */
    .scan-page[data-status="success"] {
      background:
        radial-gradient(circle at 50% 50%, rgba(16, 185, 129, .18) 0%, transparent 50%),
        linear-gradient(135deg, #0a1f1a 0%, #04241f 60%, #050d0b 100%);
    }
    .scan-page[data-status="error"], .scan-page[data-status="invalid"] {
      background:
        radial-gradient(circle at 50% 50%, rgba(239, 68, 68, .15) 0%, transparent 50%),
        linear-gradient(135deg, #1f0a0e 0%, #240407 60%, #110305 100%);
    }
    .scan-page[data-status="duplicate"] {
      background:
        radial-gradient(circle at 50% 50%, rgba(245, 158, 11, .18) 0%, transparent 50%),
        linear-gradient(135deg, #1f1408 0%, #241704 60%, #110a05 100%);
    }

    .scan-card {
      position: relative;
      background: rgba(255, 255, 255, .98);
      border-radius: 28px;
      padding: 32px 28px 36px;
      width: 100%;
      max-width: 420px;
      text-align: center;
      box-shadow:
        0 30px 80px rgba(0, 0, 0, .55),
        0 0 0 1px rgba(255, 255, 255, .08),
        inset 0 1px 0 rgba(255, 255, 255, 1);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      animation: cardEnter .5s cubic-bezier(.32, .72, .26, 1.02);
    }
    @keyframes cardEnter {
      from { opacity: 0; transform: translateY(20px) scale(.96); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* Brand bar */
    .scan-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      padding-bottom: 18px;
      margin-bottom: 22px;
      border-bottom: 1px dashed #e9ecef;
    }
    .brand-logo { color: #1e3f80; flex-shrink: 0; }
    .brand-info { display: flex; flex-direction: column; align-items: flex-start; flex: 1; }
    .brand-name {
      font-size: 16px;
      font-weight: 800;
      color: #1e3f80;
      line-height: 1;
      letter-spacing: -0.03em;
    }
    .brand-sub {
      font-size: 10px;
      color: #ec4899;
      font-weight: 600;
      letter-spacing: 0.05em;
      margin-top: 2px;
    }

    .scan-status-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 10px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 999px;
      letter-spacing: 0.4px;
      background: #f1f3f5;
      color: #64748b;
      border: 1px solid #e9ecef;
    }
    .pill-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #94a3b8;
    }
    .scan-status-pill[data-status="loading"]   { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
    .scan-status-pill[data-status="loading"] .pill-dot { background: #3b82f6; animation: pillBlink 1.2s ease-in-out infinite; }
    .scan-status-pill[data-status="success"]   { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
    .scan-status-pill[data-status="success"] .pill-dot { background: #10b981; }
    .scan-status-pill[data-status="duplicate"] { background: #fffbeb; color: #b45309; border-color: #fcd34d; }
    .scan-status-pill[data-status="duplicate"] .pill-dot { background: #f59e0b; }
    .scan-status-pill[data-status="error"], .scan-status-pill[data-status="invalid"] {
      background: #fef2f2; color: #b91c1c; border-color: #fecaca;
    }
    .scan-status-pill[data-status="error"] .pill-dot, .scan-status-pill[data-status="invalid"] .pill-dot {
      background: #ef4444;
    }
    @keyframes pillBlink {
      0%, 100% { opacity: 1; }
      50% { opacity: .35; }
    }

    .status-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
    }
    .status-box h2 {
      font-size: 22px;
      font-weight: 800;
      margin: 0;
      color: #1f2937;
      letter-spacing: -0.02em;
    }
    .status-box p {
      margin: 0;
      color: #64748b;
      font-size: 14px;
      line-height: 1.55;
      max-width: 320px;
    }

    /* Loading pulse */
    .scan-pulse-ring {
      position: relative;
      width: 110px;
      height: 110px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .scan-pulse-ring .ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 2px solid rgba(99, 102, 241, .35);
    }
    .ring.r1 { animation: pulseRing 2.4s ease-out infinite; }
    .ring.r2 { animation: pulseRing 2.4s ease-out .8s infinite; }
    .ring.r3 { animation: pulseRing 2.4s ease-out 1.6s infinite; }
    @keyframes pulseRing {
      0%   { transform: scale(.5); opacity: 1; }
      100% { transform: scale(1); opacity: 0; }
    }
    .ring-icon {
      position: relative;
      width: 60px; height: 60px;
      border-radius: 50%;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 10px 28px rgba(99, 102, 241, .4);
    }

    .loading-bar {
      width: 100%;
      max-width: 280px;
      height: 4px;
      background: #f1f3f5;
      border-radius: 999px;
      overflow: hidden;
      margin-top: 8px;
    }
    .loading-bar-fill {
      height: 100%;
      width: 35%;
      background: linear-gradient(90deg, #6366f1, #ec4899);
      border-radius: inherit;
      animation: loadSlide 1.4s ease-in-out infinite;
    }
    @keyframes loadSlide {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(380%); }
    }

    /* Success burst */
    .scan-success-burst {
      position: relative;
      width: 100px; height: 100px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .burst-circle {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(16, 185, 129, .25) 0%, transparent 70%);
      animation: burstFade .8s ease-out;
    }
    @keyframes burstFade {
      from { transform: scale(.4); opacity: 1; }
      to   { transform: scale(2); opacity: 0; }
    }

    .icon-circle {
      width: 76px;
      height: 76px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .success-circle {
      background: linear-gradient(135deg, #10b981, #059669);
      color: #fff;
      box-shadow: 0 12px 28px rgba(16, 185, 129, .4);
      animation: successPop .55s cubic-bezier(.32, .72, .26, 1.04);
    }
    @keyframes successPop {
      0%   { transform: scale(.3); opacity: 0; }
      60%  { transform: scale(1.12); opacity: 1; }
      100% { transform: scale(1); }
    }
    .warn-circle {
      background: linear-gradient(135deg, #f59e0b, #d97706);
      color: #fff;
      box-shadow: 0 12px 28px rgba(245, 158, 11, .35);
    }
    .error-circle {
      background: linear-gradient(135deg, #ef4444, #dc2626);
      color: #fff;
      box-shadow: 0 12px 28px rgba(239, 68, 68, .35);
    }

    /* Confetti */
    .confetti {
      position: absolute;
      width: 8px; height: 8px;
      border-radius: 2px;
      opacity: 0;
      animation: confettiFly 1s ease-out forwards;
    }
    .confetti.c1 { background: #ec4899; top: 50%; left: 50%; --tx: -60px; --ty: -50px; --r: 240deg; animation-delay: .15s; }
    .confetti.c2 { background: #10b981; top: 50%; left: 50%; --tx: 70px; --ty: -40px; --r: 180deg; animation-delay: .2s; }
    .confetti.c3 { background: #f59e0b; top: 50%; left: 50%; --tx: -50px; --ty: 60px; --r: -180deg; animation-delay: .25s; border-radius: 50%; }
    .confetti.c4 { background: #3b82f6; top: 50%; left: 50%; --tx: 60px; --ty: 60px; --r: 120deg; animation-delay: .25s; }
    .confetti.c5 { background: #8b5cf6; top: 50%; left: 50%; --tx: -80px; --ty: 0px; --r: 90deg; animation-delay: .3s; border-radius: 50%; }
    .confetti.c6 { background: #f43f5e; top: 50%; left: 50%; --tx: 80px; --ty: 0px; --r: -90deg; animation-delay: .3s; }
    @keyframes confettiFly {
      0%   { opacity: 0; transform: translate(0, 0) rotate(0); }
      30%  { opacity: 1; }
      100% { opacity: 0; transform: translate(var(--tx), var(--ty)) rotate(var(--r)); }
    }

    /* Success card */
    .success-card {
      width: 100%;
      background: linear-gradient(180deg, #f8fafc 0%, #fff 100%);
      border: 1px solid #e9ecef;
      border-radius: 14px;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .success-row {
      display: grid;
      grid-template-columns: 16px 90px 1fr;
      align-items: center;
      gap: 10px;
      text-align: left;
    }
    .success-row svg { color: #10b981; }
    .row-label {
      font-size: 11px;
      font-weight: 700;
      color: #6b7280;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .row-value {
      font-size: 13px;
      font-weight: 700;
      color: #1f2937;
      word-break: break-word;
    }

    /* Buttons */
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      justify-content: center;
      padding: 12px 24px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 700;
      text-decoration: none;
      cursor: pointer;
      border: none;
      font-family: inherit;
      transition: all .2s;
      margin-top: 4px;
    }
    .btn-primary {
      background: linear-gradient(135deg, #1e3f80 0%, #ec4899 100%);
      color: #fff;
      box-shadow: 0 6px 18px rgba(30, 63, 128, .35);
    }
    .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 10px 24px rgba(30, 63, 128, .45); color: #fff; text-decoration: none; }
    .btn-secondary {
      background: #f1f3f5;
      color: #475569;
      border: 1px solid #e9ecef;
    }
    .btn-secondary:hover { background: #e9ecef; text-decoration: none; }

    @media (max-width: 480px) {
      .scan-card { padding: 24px 20px 28px; border-radius: 22px; }
      .status-box h2 { font-size: 19px; }
      .scan-pulse-ring, .scan-success-burst { width: 90px; height: 90px; }
      .icon-circle { width: 64px; height: 64px; }
      .success-row { grid-template-columns: 16px 80px 1fr; }
    }
  `]
})
export class ScanComponent implements OnInit, OnDestroy {
  status: 'loading' | 'success' | 'duplicate' | 'error' | 'invalid' = 'loading';
  studentName = '';
  courseName = '';
  scannedAt: Date | null = null;
  errorMessage = '';
  dashboardPath = '/dashboard';

  private destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private attendanceService: AttendanceService,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    const user = this.authService.getCurrentUser();
    if (user) {
      const roleMap: Record<string, string> = {
        student: '/dashboard/calendar',
        teacher: '/dashboard/teacher-calendar',
        manager: '/dashboard/manager-calendar',
        admin: '/dashboard/manager-calendar',
      };
      this.dashboardPath = roleMap[user.role] || '/dashboard';
    }

    this.route.queryParams.pipe(
      takeUntil(this.destroy$)
    ).subscribe(params => {
      const scheduleId = params['scheduleId'];
      const token = params['token'];

      if (!scheduleId || !token) {
        this.status = 'invalid';
        return;
      }

      this.submitScan(scheduleId, token);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  submitScan(scheduleId: string, token: string): void {
    this.status = 'loading';

    this.attendanceService.scanQR(scheduleId, token).subscribe({
      next: (res) => {
        this.status = 'success';
        this.studentName = (res.student as any)?.nickname || `${res.student?.firstName} ${res.student?.lastName}`;
        this.courseName = res.courseName || '';
        this.scannedAt = new Date();
      },
      error: (err) => {
        const statusCode = err.status;
        const msg = err.error?.message || '';

        if (statusCode === 409 || msg.toLowerCase().includes('already')) {
          this.status = 'duplicate';
        } else {
          this.status = 'error';
          this.errorMessage = msg || 'เกิดข้อผิดพลาดในการเช็คชื่อ';
        }
      }
    });
  }
}
