import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AuthService } from '../../../services/auth.service';
import { IAuthResponse, IOtpVerifyResponse } from '../../../interfaces/user.interface';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnInit, OnDestroy {
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

  private destroy$ = new Subject<void>();

  constructor(
    private formBuilder: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

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
        this.errorMessage = error.error?.message || 'เข้าสู่ระบบล้มเหลว โปรดลองอีกครั้ง';
        this.loading = false;
      }
    });
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
        this.errorMessage = error.error?.message || 'รหัส OTP ไม่ถูกต้อง โปรดลองอีกครั้ง';
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
