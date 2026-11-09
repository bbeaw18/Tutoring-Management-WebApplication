import { Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './forgot-password.component.html',
  styleUrls: ['../auth-simple.css']
})
export class ForgotPasswordComponent implements OnDestroy {
  form: FormGroup;
  otpForm: FormGroup;
  requestedEmail = '';
  loading = false;
  submitted = false;
  otpSubmitted = false;
  errorMessage = '';
  successMessage = '';

  private destroy$ = new Subject<void>();

  constructor(private fb: FormBuilder, private auth: AuthService, private router: Router) {
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email]]
    });
    this.otpForm = this.fb.group({
      code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]]
    });
  }

  get f() { return this.form.controls; }

  submit(): void {
    this.submitted = true;
    this.errorMessage = '';
    this.successMessage = '';
    if (this.form.invalid || this.loading) return;

    const email = this.form.value.email.trim();
    this.loading = true;
    this.auth.forgotPassword(email)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.requestedEmail = email;
          this.otpSubmitted = false;
          this.otpForm.reset({ code: '' });
          this.successMessage = res?.message || 'หากอีเมลนี้มีในระบบ คุณจะได้รับรหัส OTP 6 หลักทางอีเมล';
          this.loading = false;
        },
        error: (err) => {
          this.errorMessage = err.error?.message || 'เกิดข้อผิดพลาด โปรดลองอีกครั้ง';
          this.loading = false;
        }
      });
  }

  verifyOtp(): void {
    this.otpSubmitted = true;
    this.errorMessage = '';
    if (this.loading || this.otpForm.invalid || !this.requestedEmail) return;
    this.loading = true;
    this.auth.verifyResetOtp(this.requestedEmail, this.otpForm.value.code).pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ token }) => {
        this.loading = false;
        this.router.navigate(['/reset-password'], { state: { resetToken: token }, replaceUrl: true });
      },
      error: err => {
        this.loading = false;
        this.errorMessage = err.error?.message || 'ยืนยันรหัสไม่สำเร็จ กรุณาลองอีกครั้ง';
      }
    });
  }

  editEmail(): void {
    this.requestedEmail = '';
    this.successMessage = '';
    this.errorMessage = '';
    this.submitted = false;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
