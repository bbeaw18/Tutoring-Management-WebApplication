import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { IAuthResponse } from '../../../interfaces/user.interface';
import { getPaymentChannelGroups } from '../../../shared/constants/payment-channels';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css']
})
export class RegisterComponent implements OnInit {
  currentStep: 'role' | 'form' | 'totp' = 'role';
  selectedRole: 'student' | 'teacher' | null = null;
  registerForm!: FormGroup;
  loading = false;
  submitted = false;
  errorMessage = '';
  totpQrCode = '';
  totpSubmitted = false;
  totpForm!: FormGroup;
  showPassword = false;

  /** ตัวเลือกช่องทางรับเงิน (จัดกลุ่ม) */
  readonly paymentGroups = getPaymentChannelGroups();

  // Form sub-steps (multi-step wizard within the form step)
  formSubStep = 1;
  readonly totalFormSubSteps = 4;

  getStepProgress(): number {
    if (this.currentStep === 'role') return 8;
    if (this.currentStep === 'form') {
      // 16% per sub-step, between 16% and 80%
      return 16 + (this.formSubStep - 1) * 16;
    }
    return 100;
  }

  // Sub-step labels (changes for student vs teacher on step 3)
  get subStepLabels(): string[] {
    return ['ข้อมูลส่วนตัว', 'ข้อมูลติดต่อ',
            this.selectedRole === 'teacher' ? 'ข้อมูลการสอน' : 'ข้อมูลการเรียน',
            'ตั้งรหัสผ่าน'];
  }

  /** Required fields per sub-step */
  private subStepFields(step: number): string[] {
    if (step === 1) return ['firstName', 'lastName', 'nickname', 'age', 'gender'];
    if (step === 2) return ['email', 'phone', 'lineId', 'nationalId'];
    if (step === 3) {
      return this.selectedRole === 'teacher'
        ? ['university', 'paymentChannel', 'bankAccountNumber', 'bankAccountName']
        : ['academicYear'];
    }
    if (step === 4) return ['password', 'confirmPassword'];
    return [];
  }

  /** True if current sub-step's fields are all valid */
  isSubStepValid(step: number): boolean {
    if (!this.registerForm) return false;
    const fields = this.subStepFields(step);
    for (const f of fields) {
      const ctrl = this.registerForm.get(f);
      if (ctrl && ctrl.invalid) return false;
    }
    if (step === 4 && this.registerForm.hasError('passwordMismatch')) return false;
    if (step === 3 && this.selectedRole === 'teacher' && this.registerForm.hasError('bankAccountNameMismatch')) return false;
    return true;
  }

  goNextSubStep(): void {
    // Mark fields touched for validation feedback
    const fields = this.subStepFields(this.formSubStep);
    fields.forEach(f => this.registerForm.get(f)?.markAsTouched());
    if (!this.isSubStepValid(this.formSubStep)) {
      this.errorMessage = 'กรุณากรอกข้อมูลในขั้นตอนนี้ให้ครบถ้วนก่อนดำเนินการต่อ';
      return;
    }
    this.errorMessage = '';
    if (this.formSubStep < this.totalFormSubSteps) this.formSubStep++;
  }

  goPrevSubStep(): void {
    this.errorMessage = '';
    if (this.formSubStep > 1) this.formSubStep--;
  }

  constructor(
    private formBuilder: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.initializeTotpForm();
  }

  selectRole(role: 'student' | 'teacher'): void {
    this.selectedRole = role;
    this.currentStep = 'form';
    this.formSubStep = 1;
    this.initializeForm();
    this.errorMessage = '';
  }

  initializeTotpForm(): void {
    this.totpForm = this.formBuilder.group({
      otp: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]]
    });
  }

  initializeForm(): void {
    const commonValidators = {
      firstName: ['', Validators.required],
      lastName: ['', Validators.required],
      nickname: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', [Validators.required, Validators.pattern(/^[0-9]{9,10}$/)]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', Validators.required],
      lineId: ['', Validators.required],
      age: ['', [Validators.required, Validators.min(1), Validators.max(120)]],
      gender: ['', Validators.required],
      nationalId: ['', [Validators.required, Validators.pattern(/^\d{13}$/)]]
    };

    if (this.selectedRole === 'student') {
      this.registerForm = this.formBuilder.group({
        ...commonValidators,
        academicYear: ['', Validators.required]
      }, {
        validators: this.passwordMatchValidator
      });
    } else {
      this.registerForm = this.formBuilder.group({
        ...commonValidators,
        paymentChannel: ['', Validators.required],
        university: ['', Validators.required],
        bankAccountNumber: ['', [Validators.required, Validators.pattern(/^\d{10,15}$/)]],
        bankAccountName: ['', Validators.required]
      }, {
        validators: [this.passwordMatchValidator, this.bankAccountNameValidator]
      });
    }
  }

  passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
    const password = control.get('password');
    const confirmPassword = control.get('confirmPassword');
    if (!password || !confirmPassword) return null;
    return password.value === confirmPassword.value ? null : { passwordMismatch: true };
  }

  bankAccountNameValidator(control: AbstractControl): ValidationErrors | null {
    const firstName  = control.get('firstName')?.value?.trim()  || '';
    const lastName   = control.get('lastName')?.value?.trim()   || '';
    const accountName = control.get('bankAccountName')?.value?.trim() || '';
    if (!firstName || !lastName || !accountName) return null;
    const expected = `${firstName} ${lastName}`.toLowerCase();
    return accountName.toLowerCase() === expected ? null : { bankAccountNameMismatch: true };
  }

  get f() {
    return this.registerForm.controls;
  }

  get otpf() {
    return this.totpForm.controls;
  }

  goBackToRole(): void {
    this.currentStep = 'role';
    this.selectedRole = null;
    this.submitted = false;
    this.errorMessage = '';
  }

  goBackToForm(): void {
    this.currentStep = 'form';
    this.totpSubmitted = false;
    this.errorMessage = '';
  }

  onSubmit(): void {
    this.submitted = true;
    this.errorMessage = '';

    if (this.registerForm.invalid) {
      // รวบรวม field ที่ยังไม่กรอก เพื่อแสดงให้ชัดเจน
      const missing: string[] = [];
      const ctrl = this.registerForm.controls;
      if (ctrl['firstName']?.invalid)      missing.push('ชื่อ');
      if (ctrl['lastName']?.invalid)       missing.push('นามสกุล');
      if (ctrl['nickname']?.invalid)       missing.push('ชื่อเล่น');
      if (ctrl['email']?.invalid)          missing.push('อีเมล');
      if (ctrl['phone']?.invalid)          missing.push('เบอร์โทร');
      if (ctrl['lineId']?.invalid)         missing.push('Line ID');
      if (ctrl['age']?.invalid)            missing.push('อายุ');
      if (ctrl['gender']?.invalid)         missing.push('เพศ');
      if (ctrl['nationalId']?.invalid)     missing.push('เลขบัตรประชาชน (13 หลัก)');
      if (ctrl['password']?.invalid)       missing.push('รหัสผ่าน');
      if (ctrl['confirmPassword']?.invalid) missing.push('ยืนยันรหัสผ่าน');
      if (this.registerForm.hasError('passwordMismatch')) missing.push('รหัสผ่านไม่ตรงกัน');
      // Role-specific
      if (this.selectedRole === 'student' && ctrl['academicYear']?.invalid) missing.push('ชั้นปี/ระดับชั้น');
      if (this.selectedRole === 'teacher' && ctrl['university']?.invalid)    missing.push('มหาวิทยาลัย');
      if (this.selectedRole === 'teacher' && ctrl['paymentChannel']?.invalid) missing.push('ช่องทางรับเงิน');
      if (this.selectedRole === 'teacher' && ctrl['bankAccountNumber']?.invalid) missing.push('เลขบัญชีธนาคาร (10-15 หลัก)');
      if (this.selectedRole === 'teacher' && ctrl['bankAccountName']?.invalid)   missing.push('ชื่อบัญชีธนาคาร');
      if (this.selectedRole === 'teacher' && this.registerForm.hasError('bankAccountNameMismatch'))
        missing.push('ชื่อบัญชีต้องตรงกับชื่อ-นามสกุล');

      if (missing.length > 0) {
        this.errorMessage = `กรุณากรอกข้อมูลให้ครบถ้วน: ${missing.join(', ')}`;
      } else {
        this.errorMessage = 'กรุณาตรวจสอบข้อมูลให้ถูกต้องก่อนดำเนินการต่อ';
      }
      // Scroll to top of form to show error
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    this.loading = true;
    const { confirmPassword, ...registerData } = this.registerForm.value;
    const payload = {
      ...registerData,
      role: this.selectedRole
    };

    this.authService.register(payload).subscribe({
      next: (response: IAuthResponse) => {
        this.loading = false;

        const userId = response.userId || (response as any).user?._id?.toString();

        if (!userId) {
          // L2: explicit return — กันสับสนเมื่อมีคน extend logic ข้างล่าง
          this.errorMessage = 'สมัครสมาชิกสำเร็จแต่ไม่ได้รับ QR Code โปรดติดต่อผู้ดูแลระบบ';
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        localStorage.setItem('tempUserId', userId);
        this.currentStep = 'totp';
        this.totpQrCode = response.qrCode || (response as any).totp?.qrCode || '';
      },
      error: (error: any) => {
        this.loading = false;
        // แปลงข้อความ error จาก backend ให้เป็นภาษาไทยเมื่อเป็นไปได้
        const raw: string = error.error?.message || '';
        const thaiMessage = this.translateBackendError(raw);
        this.errorMessage = thaiMessage;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  private translateBackendError(msg: string): string {
    if (!msg) return 'สมัครสมาชิกล้มเหลว โปรดลองอีกครั้ง';
    if (msg.includes('Email already registered') || msg.includes('อีเมลนี้ถูกใช้งานแล้ว'))
      return 'อีเมลนี้ถูกใช้งานแล้ว กรุณาใช้อีเมลอื่น หรือเข้าสู่ระบบด้วยอีเมลนี้';
    if (msg.includes('เบอร์โทรนี้ถูกใช้งาน') || msg.includes('phone already'))
      return 'เบอร์โทรนี้ถูกใช้งานในระบบแล้ว กรุณาใช้เบอร์อื่น (1 เบอร์ ต่อ 1 บัญชี)';
    if (msg.includes('รูปแบบอีเมลไม่ถูกต้อง'))
      return 'รูปแบบอีเมลไม่ถูกต้อง (ตัวอย่าง: name@gmail.com)';
    if (msg.includes('รูปแบบเบอร์โทรไม่ถูกต้อง'))
      return 'รูปแบบเบอร์โทรไม่ถูกต้อง กรุณากรอก 10 หลัก เช่น 0812345678';
    if (msg.includes('Missing required fields'))
      return 'กรุณากรอกข้อมูลให้ครบทุกช่อง';
    if (msg.includes('Invalid role'))
      return 'ประเภทบัญชีไม่ถูกต้อง กรุณาเริ่มสมัครใหม่';
    if (msg.includes('Teacher requires'))
      return 'กรุณากรอกข้อมูลครูให้ครบ: Line ID, ช่องทางรับเงิน, อายุ, เพศ, มหาวิทยาลัย';
    if (msg.includes('Student requires'))
      return 'กรุณากรอกข้อมูลนักเรียนให้ครบ: Line ID, อายุ, เพศ, ชั้นปี';
    // L2: specific check ต้องมาก่อน generic check (เดิม generic match ก่อน ทำให้ข้อความ specific ไม่ทำงาน)
    if (msg.includes('เลขบัตรประชาชนนี้ถูกใช้งาน') || msg.includes('nationalId already'))
      return 'เลขบัตรประชาชนนี้ถูกลงทะเบียนในระบบแล้ว กรุณาตรวจสอบอีกครั้ง';
    if (msg.includes('เลขบัตรประชาชน') || msg.includes('nationalId'))
      return msg;
    if (msg.includes('ชื่อบัญชีธนาคารต้องตรงกับ') || msg.includes('bankAccountName'))
      return msg;
    if (msg.includes('ครูต้องกรอกเลขบัญชี'))
      return 'กรุณากรอกเลขบัญชีธนาคารและชื่อบัญชีให้ครบ';
    // ถ้าไม่ตรงเงื่อนไขข้างบน ส่งคืน message เดิมของ backend
    return msg;
  }

  verifyTotp(): void {
    this.totpSubmitted = true;
    this.errorMessage = '';

    if (this.totpForm.invalid) {
      return;
    }

    this.loading = true;
    const userId = localStorage.getItem('tempUserId');
    const token = this.totpForm.get('otp')?.value;

    if (!userId) {
      this.errorMessage = 'เกิดข้อผิดพลาด โปรดสมัครสมาชิกใหม่';
      this.loading = false;
      return;
    }

    this.authService.verifyTotpSetup(userId, token).subscribe({
      next: () => {
        this.loading = false;
        localStorage.removeItem('tempUserId');
        this.router.navigate(['/login'], {
          queryParams: { message: 'ตั้งค่า Google Authenticator สำเร็จแล้ว กรุณาเข้าสู่ระบบ' }
        });
      },
      error: (error: any) => {
        this.loading = false;
        this.errorMessage = error.error?.message || 'รหัส OTP ไม่ถูกต้อง โปรดลองอีกครั้ง';
      }
    });
  }
}
