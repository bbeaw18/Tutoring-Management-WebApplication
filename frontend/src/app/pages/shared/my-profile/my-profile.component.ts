import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { UserService } from '../../../services/user.service';
import { AuthService } from '../../../services/auth.service';
import { IUser } from '../../../interfaces/user.interface';
import { LoadingComponent } from '../../../shared/components/loading/loading.component';
import { DisplayNamePipe } from '../../../shared/pipes/display-name.pipe';
import { getPaymentChannelGroups, getPaymentChannelLabel } from '../../../shared/constants/payment-channels';

interface FieldError {
  message: string;
  field: string;
}

@Component({
  selector: 'app-my-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, LoadingComponent, DisplayNamePipe],
  templateUrl: './my-profile.component.html',
  styleUrls: ['./my-profile.component.css']
})
export class MyProfileComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  profile: IUser | null = null;
  loading = false;
  currentUser = this.authService.getCurrentUser();

  // Inline-edit state
  editingField: string | null = null;
  editValue: any = '';
  editError = '';
  saving = false;

  // Toast
  toastMessage = '';
  toastType: 'success' | 'error' = 'success';
  toastTimer: any;

  // For subjects array editing
  newSubjectInput = '';

  /** ตัวเลือกช่องทางรับเงิน (จัดกลุ่ม) */
  readonly paymentGroups = getPaymentChannelGroups();

  constructor(
    private userService: UserService,
    private authService: AuthService
  ) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    clearTimeout(this.toastTimer);
  }

  ngOnInit(): void {
    this.loadProfile();
  }

  // ─── Loading ──────────────────────────────────────────────
  loadProfile(): void {
    this.loading = true;
    const userId = this.currentUser?.id || this.currentUser?._id;
    if (!userId) { this.loading = false; return; }
    this.userService.getUserById(userId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (user) => { this.profile = user; this.loading = false; },
        error: () => { this.loading = false; }
      });
  }

  // ─── Inline edit ──────────────────────────────────────────
  startEdit(field: string, currentValue: any): void {
    this.editingField = field;
    this.editValue = currentValue ?? '';
    this.editError = '';
  }
  cancelEdit(): void {
    this.editingField = null;
    this.editValue = '';
    this.editError = '';
  }

  /** Validate field client-side ก่อนส่งไป backend */
  private validateField(field: string, value: any): string {
    const v = (value === null || value === undefined) ? '' : String(value).trim();
    switch (field) {
      case 'firstName':
      case 'lastName':
        if (!v) return 'กรุณาระบุข้อมูล';
        return '';
      case 'phone':
        if (v && !/^[0-9]{9,10}$/.test(v)) return 'เบอร์โทรต้องเป็นตัวเลข 9-10 หลัก';
        return '';
      case 'age': {
        const n = Number(v);
        if (v && (isNaN(n) || n < 1 || n > 120)) return 'อายุต้องอยู่ระหว่าง 1-120 ปี';
        return '';
      }
      case 'bankAccountNumber':
        if (v && !/^\d{10,15}$/.test(v)) return 'เลขบัญชีต้องเป็นตัวเลข 10-15 หลัก';
        return '';
      case 'bankAccountName': {
        if (!v) return '';
        const expected = `${(this.profile?.firstName || '').trim()} ${(this.profile?.lastName || '').trim()}`.toLowerCase();
        if (v.toLowerCase() !== expected) return `ชื่อบัญชีต้องตรงกับ "${this.profile?.firstName} ${this.profile?.lastName}"`;
        return '';
      }
      case 'postalCode':
        if (v && !/^\d{5}$/.test(v)) return 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก';
        return '';
      default: return '';
    }
  }

  saveEdit(): void {
    if (!this.profile || !this.editingField) return;
    const field = this.editingField;

    const error = this.validateField(field, this.editValue);
    if (error) { this.editError = error; return; }

    const id = this.profile.id || this.profile._id;
    if (!id) return;

    let value: any = this.editValue;
    if (field === 'age') value = value === '' ? null : Number(value);

    const payload: any = { [field]: value };
    this.saving = true;
    this.editError = '';

    this.userService.updateUser(id, payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updated) => {
          this.profile = { ...this.profile!, ...payload, ...updated };
          this.saving = false;
          this.editingField = null;
          this.showToast('บันทึกสำเร็จ', 'success');
        },
        error: (err) => {
          this.saving = false;
          this.editError = err?.error?.message || 'บันทึกล้มเหลว โปรดลองอีกครั้ง';
        }
      });
  }

  // ─── Subjects (array) ──────────────────────────────────────
  addSubject(): void {
    if (!this.profile || !this.newSubjectInput.trim()) return;
    const newList = [...(this.profile.subjects || []), this.newSubjectInput.trim()];
    this.persistSubjects(newList);
  }
  removeSubject(idx: number): void {
    if (!this.profile?.subjects) return;
    const newList = this.profile.subjects.filter((_, i) => i !== idx);
    this.persistSubjects(newList);
  }
  private persistSubjects(subjects: string[]): void {
    if (!this.profile) return;
    const id = this.profile.id || this.profile._id;
    if (!id) return;
    this.saving = true;
    this.userService.updateUser(id, { subjects } as any)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updated) => {
          this.profile = { ...this.profile!, subjects, ...updated };
          this.newSubjectInput = '';
          this.saving = false;
          this.showToast('อัพเดทวิชาที่สอนสำเร็จ', 'success');
        },
        error: (err) => {
          this.saving = false;
          this.showToast(err?.error?.message || 'บันทึกล้มเหลว', 'error');
        }
      });
  }

  // ─── Helpers ──────────────────────────────────────────────
  showToast(msg: string, type: 'success' | 'error'): void {
    clearTimeout(this.toastTimer);
    this.toastMessage = msg;
    this.toastType = type;
    this.toastTimer = setTimeout(() => this.toastMessage = '', 3500);
  }

  getRoleLabel(role?: string): string {
    return ({
      admin: 'ผู้ดูแลระบบ',
      manager: 'ผู้จัดการ',
      teacher: 'อาจารย์',
      student: 'นักเรียน'
    } as any)[role || ''] || role || '';
  }

  getGenderLabel(g?: string): string {
    return ({ male: 'ชาย', female: 'หญิง', other: 'อื่นๆ' } as any)[g || ''] || 'ยังไม่ระบุ';
  }

  getPaymentLabel(channel?: string): string {
    if (!channel) return 'ยังไม่ระบุ';
    return getPaymentChannelLabel(channel) || channel;
  }

  /** Mask National ID — show last 4 digits only */
  maskNationalId(id?: string): string {
    if (!id) return 'ยังไม่ระบุ';
    if (id.length < 8) return id;
    return id.replace(/^(\d{1})(\d{4})(\d{5})(\d{2})(\d)$/, '$1-$2-$3-$4-$5')
              .replace(/^(\d)-(\d{4})-(\d{5})-(\d{2})-(\d)$/, '$1-XXXX-X$3'.slice(0, 9) + '-' + '$4'.slice(0, 2) + '-X');
  }

  /** Stable cover hue */
  get coverHue(): number {
    const seed = `${this.profile?.firstName || ''}${this.profile?.lastName || ''}${this.profile?.email || ''}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    const hues = [330, 280, 220, 195, 165, 135, 30, 10];
    return hues[Math.abs(hash) % hues.length];
  }

  get isStudent(): boolean { return this.profile?.role === 'student'; }
  get isTeacher(): boolean { return this.profile?.role === 'teacher'; }

  /** Profile completeness — fields filled */
  get completeness(): number {
    if (!this.profile) return 0;
    const baseFields = [
      this.profile.firstName, this.profile.lastName, this.profile.nickname,
      this.profile.email, this.profile.phone, this.profile.lineId,
      this.profile.age, this.profile.gender, (this.profile as any).bio
    ];
    const roleFields = this.isStudent
      ? [this.profile.academicYear, this.profile.grade]
      : this.isTeacher
        ? [this.profile.university, this.profile.paymentChannel,
           this.profile.bankAccountNumber, this.profile.bankAccountName,
           (this.profile.subjects && this.profile.subjects.length ? 'x' : null)]
        : [];
    const all = [...baseFields, ...roleFields];
    const filled = all.filter(f => f !== null && f !== undefined && String(f).trim().length > 0).length;
    return Math.round((filled / all.length) * 100);
  }

  get isComplete(): boolean { return this.completeness >= 90; }
}
