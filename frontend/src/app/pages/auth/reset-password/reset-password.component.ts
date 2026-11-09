import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subject, timer } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AuthService } from '../../../services/auth.service';

function matchPasswords(group: AbstractControl): ValidationErrors | null {
  const a = group.get('password')?.value;
  const b = group.get('confirmPassword')?.value;
  return a && b && a !== b ? { passwordMismatch: true } : null;
}

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './reset-password.component.html',
  styleUrls: ['../auth-simple.css']
})
export class ResetPasswordComponent implements OnInit, OnDestroy {
  form: FormGroup;
  loading = false;
  submitted = false;
  errorMessage = '';
  successMessage = '';
  showPassword = false;
  token = '';
  tokenMissing = false;

  private destroy$ = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private route: ActivatedRoute,
    private router: Router
  ) {
    this.form = this.fb.group({
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]]
    }, { validators: matchPasswords });
  }

  ngOnInit(): void {
    const stateToken = history.state?.resetToken;
    this.token = (typeof stateToken === 'string' ? stateToken : this.route.snapshot.queryParamMap.get('token') || '').trim();
    if (!this.token) {
      this.tokenMissing = true;
      this.errorMessage = 'กรุณายืนยันรหัส OTP ก่อนตั้งรหัสผ่านใหม่';
    }
  }

  get f() { return this.form.controls; }

  submit(): void {
    this.submitted = true;
    this.errorMessage = '';
    if (this.tokenMissing) return;
    if (this.form.invalid) return;

    this.loading = true;
    this.auth.resetPassword(this.token, this.form.value.password)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.successMessage = res?.message || 'ตั้งรหัสผ่านใหม่สำเร็จ';
          this.loading = false;
          this.form.disable();
          timer(1800).pipe(takeUntil(this.destroy$)).subscribe(() => {
            this.router.navigate(['/login'], {
              replaceUrl: true,
              queryParams: { message: 'ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่' }
            });
          });
        },
        error: (err) => {
          this.errorMessage = err.error?.message || 'เกิดข้อผิดพลาด โปรดลองอีกครั้ง';
          this.loading = false;
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
