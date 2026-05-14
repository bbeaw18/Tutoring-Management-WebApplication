import { Component, OnInit, OnDestroy, AfterViewInit, ElementRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { gsap } from 'gsap';
import { AuthService } from '../../../services/auth.service';
import { IAuthResponse, IOtpVerifyResponse } from '../../../interfaces/user.interface';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnInit, OnDestroy, AfterViewInit {
  currentStep: 'login' | 'otp' = 'login';
  loginForm!: FormGroup;
  otpForm!: FormGroup;
  loading = false;
  submitted = false;
  otpSubmitted = false;
  errorMessage = '';
  successMessage = '';
  showPassword = false;
  returnUrl = '/dashboard';

  // Polish features
  capsLockOn = false;
  rememberMe = false;
  passwordStrength = 0; // 0-3: weak, fair, strong, very strong
  otpCountdown = 0;
  private otpCountdownInterval: any;

  // Pending-approval modal (teachers awaiting manager confirmation)
  showPendingModal = false;
  pendingModalMessage = '';

  private destroy$ = new Subject<void>();

  // Animation hooks (Phase 0 v2)
  private reducedMotion = false;
  private heroTl?: gsap.core.Timeline;
  private mouseMoveCleanup?: () => void;

  constructor(
    private formBuilder: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private host: ElementRef<HTMLElement>,
    private zone: NgZone
  ) {}

  ngAfterViewInit(): void {
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this.reducedMotion) return;
    this.zone.runOutsideAngular(() => {
      this.runHeroTimeline();
      this.runFormEntrance();
      this.bindInteractions();
    });
  }

  private runHeroTimeline(): void {
    const root = this.host.nativeElement;
    const title = root.querySelectorAll<SVGTextElement>('.board-title text');
    const eqParts = root.querySelectorAll<SVGTextElement>('.board-eq .eq-part');
    const bonds = root.querySelectorAll<SVGLineElement>('.board-mol .bond');
    const atoms = root.querySelectorAll<SVGGElement>('.board-mol .atom');
    const orbit = root.querySelector<SVGEllipseElement>('.board-mol .orbit');
    if (!eqParts.length) return;

    this.heroTl = gsap.timeline({ delay: 0.25 });
    this.heroTl
      .to(title, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' })
      .to(eqParts, { opacity: 1, y: 0, duration: 0.5, stagger: 0.07, ease: 'power2.out' }, '-=0.35')
      .to(bonds, { strokeDashoffset: 0, duration: 0.6, stagger: 0.2, ease: 'power2.out' }, '-=0.4')
      .to(atoms, { opacity: 1, scale: 1, duration: 0.55, stagger: 0.12, ease: 'power3.out' }, '-=0.5');

    if (orbit) {
      gsap.to(orbit, { opacity: 0.4, duration: 0.6, delay: 1.6, ease: 'power2.out' });
      gsap.to(orbit, {
        rotate: 360, duration: 24, ease: 'none', repeat: -1,
        transformOrigin: '60px 0px'
      });
    }
  }

  private runFormEntrance(): void {
    const items = this.host.nativeElement.querySelectorAll<HTMLElement>('[data-anim]');
    if (!items.length) return;
    gsap.fromTo(items,
      { opacity: 0, y: 14 },
      { opacity: 1, y: 0, duration: 0.45, stagger: 0.07, ease: 'power3.out', delay: 0.15 });
  }

  private bindInteractions(): void {
    const root = this.host.nativeElement;

    const onMove = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      const btn = t.closest('.cta:not(.cta-ghost):not(:disabled)') as HTMLElement | null;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      gsap.to(btn, { x: dx * 4, y: dy * 2.5, duration: 0.4, ease: 'power3.out' });
    };
    const onOut = (e: Event) => {
      const t = e.target as HTMLElement;
      const btn = t.closest?.('.cta') as HTMLElement | null;
      if (!btn) return;
      gsap.to(btn, { x: 0, y: 0, duration: 0.5, ease: 'power3.out' });
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      const btn = t.closest('.cta:not(.cta-ghost)') as HTMLElement | null;
      if (!btn) return;
      btn.classList.remove('is-rippling');
      void btn.offsetWidth;
      btn.classList.add('is-rippling');
      window.setTimeout(() => btn.classList.remove('is-rippling'), 700);
    };

    root.addEventListener('mousemove', onMove);
    root.addEventListener('mouseleave', onOut, true);
    root.addEventListener('pointerdown', onDown);
    this.mouseMoveCleanup = () => {
      root.removeEventListener('mousemove', onMove);
      root.removeEventListener('mouseleave', onOut, true);
      root.removeEventListener('pointerdown', onDown);
    };
  }

  ngOnInit(): void {
    this.initializeForm();
    this.checkSuccessMessage();
    // Restore remembered email
    try {
      const remembered = localStorage.getItem('login_remember_email');
      if (remembered) {
        this.loginForm.patchValue({ email: remembered });
        this.rememberMe = true;
      }
    } catch { /* ignore */ }
  }

  // ── Polish helpers ─────────────────────────────────────
  get greeting(): string {
    const h = new Date().getHours();
    if (h < 12) return 'อรุณสวัสดิ์';
    if (h < 17) return 'สวัสดีตอนบ่าย';
    if (h < 20) return 'สวัสดีตอนเย็น';
    return 'สวัสดีตอนค่ำ';
  }

  detectCapsLock(event: KeyboardEvent): void {
    this.capsLockOn = event.getModifierState && event.getModifierState('CapsLock');
  }

  onPasswordInput(value: string): void {
    let s = 0;
    if (value.length >= 6) s++;
    if (/[A-Z]/.test(value) && /[a-z]/.test(value)) s++;
    if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) s++;
    if (value.length >= 12) s = Math.min(3, s + 1);
    this.passwordStrength = Math.min(3, s);
  }

  toggleRemember(): void {
    this.rememberMe = !this.rememberMe;
  }

  startOtpCountdown(): void {
    this.otpCountdown = 30;
    clearInterval(this.otpCountdownInterval);
    this.otpCountdownInterval = setInterval(() => {
      this.otpCountdown--;
      if (this.otpCountdown <= 0) {
        clearInterval(this.otpCountdownInterval);
      }
    }, 1000);
  }

  /** Auto-submit when 6 digits entered */
  onOtpInput(value: string): void {
    const digits = (value || '').replace(/\D/g, '');
    if (digits.length === 6 && !this.loading) {
      this.otpForm.patchValue({ otp: digits });
      this.verifyOtp();
    }
  }

  checkSuccessMessage(): void {
    this.route.queryParams.pipe(
      takeUntil(this.destroy$)
    ).subscribe(params => {
      if (params['message']) {
        this.successMessage = params['message'];
        setTimeout(() => { this.successMessage = ''; }, 5000);
      }
      // บันทึก returnUrl ถ้ามี (เช่น กรณีนักเรียนสแกน QR แล้วถูก redirect มา login)
      if (params['returnUrl']) {
        this.returnUrl = params['returnUrl'];
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    clearInterval(this.otpCountdownInterval);
    this.heroTl?.kill();
    this.mouseMoveCleanup?.();
    gsap.killTweensOf(this.host.nativeElement.querySelectorAll('*'));
  }

  initializeForm(): void {
    this.loginForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });

    this.otpForm = this.formBuilder.group({
      otp: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]]
    });
  }

  get f() {
    return this.loginForm.controls;
  }

  get otpf() {
    return this.otpForm.controls;
  }

  onSubmit(): void {
    this.submitted = true;
    this.errorMessage = '';

    if (this.loginForm.invalid) {
      return;
    }

    this.loading = true;
    // Save / clear remembered email
    try {
      if (this.rememberMe) {
        localStorage.setItem('login_remember_email', this.loginForm.value.email || '');
      } else {
        localStorage.removeItem('login_remember_email');
      }
    } catch { /* ignore */ }
    this.authService.login(this.loginForm.value).subscribe({
      next: (response: IAuthResponse) => {
        if (response.token) {
          // redirect กลับหน้าเดิม (เช่น /scan?...) ถ้ามี returnUrl
          this.router.navigateByUrl(this.returnUrl).catch(() => {
            this.loading = false;
          });
        } else if (response.requireOtp && response.userId) {
          this.currentStep = 'otp';
          this.loading = false;
          this.startOtpCountdown();
        } else {
          this.errorMessage = 'เกิดข้อผิดพลาด โปรดลองอีกครั้ง';
          this.loading = false;
        }
      },
      error: (error: any) => {
        const data = error.error?.data;
        if (error.status === 403 && data?.pendingApproval) {
          this.pendingModalMessage = error.error?.message
            || 'บัญชีของคุณอยู่ในสถานะรอการยืนยันจาก Manager โปรดติดต่อ Manager เพื่อขออนุมัติการลงทะเบียน';
          this.showPendingModal = true;
          this.errorMessage = '';
        } else {
          this.errorMessage = error.error?.message || 'เข้าสู่ระบบล้มเหลว โปรดลองอีกครั้ง';
        }
        this.loading = false;
      }
    });
  }

  closePendingModal(): void {
    this.showPendingModal = false;
    this.pendingModalMessage = '';
  }

  verifyOtp(): void {
    this.otpSubmitted = true;
    this.errorMessage = '';

    if (this.otpForm.invalid) {
      return;
    }

    this.loading = true;
    const userId = this.authService.getTempUserId();
    const token = this.otpForm.get('otp')?.value;

    if (!userId) {
      this.errorMessage = 'เกิดข้อผิดพลาด โปรดเข้าสู่ระบบใหม่';
      this.loading = false;
      return;
    }

    this.authService.verifyTotp(userId, token).subscribe({
      next: (response: any) => {
        // redirect กลับหน้าเดิมถ้ามี returnUrl (กรณี OTP)
        this.router.navigateByUrl(this.returnUrl).catch(() => {
          this.loading = false;
        });
      },
      error: (error: any) => {
        const data = error.error?.data;
        if (error.status === 403 && data?.pendingApproval) {
          this.pendingModalMessage = error.error?.message
            || 'บัญชีของคุณอยู่ในสถานะรอการยืนยันจาก Manager โปรดติดต่อ Manager เพื่อขออนุมัติการลงทะเบียน';
          this.showPendingModal = true;
          this.errorMessage = '';
          this.currentStep = 'login';
        } else {
          this.errorMessage = error.error?.message || 'รหัส OTP ไม่ถูกต้อง โปรดลองอีกครั้ง';
        }
        this.loading = false;
      }
    });
  }

  goBackToLogin(): void {
    this.currentStep = 'login';
    this.otpSubmitted = false;
    this.otpForm.reset();
    this.errorMessage = '';
  }
}
