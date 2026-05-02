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

@Component({
  selector: 'app-teacher-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, LoadingComponent, DisplayNamePipe],
  templateUrl: './teacher-profile.component.html',
  styleUrls: ['./teacher-profile.component.css']
})
export class TeacherProfileComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  profile: IUser | null = null;
  loading = false;
  currentUser = this.authService.getCurrentUser();

  // Inline-edit state
  editingField: string | null = null;
  editValue: any = '';
  saving = false;
  toastMessage = '';
  toastType: 'success' | 'error' = 'success';
  toastTimer: any;

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

  getPaymentLabel(channel?: string): string {
    const map: Record<string, string> = {
      bank: 'บัญชีธนาคาร',
      promptpay: 'PromptPay',
      paypal: 'PayPal',
      other: 'อื่นๆ'
    };
    return map[channel || ''] || channel || '—';
  }

  loadProfile(): void {
    this.loading = true;
    const userId = this.currentUser?.id;
    if (userId) {
      this.userService.getUserById(userId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
        next: (user) => {
          this.profile = user;
          this.loading = false;
        },
        error: (error) => {
          console.error(error);
          this.loading = false;
        }
      });
    }
  }

  // ── Inline edit ─────────────────────────────────────────
  startEdit(field: string, currentValue: any): void {
    this.editingField = field;
    this.editValue = currentValue ?? '';
  }
  cancelEdit(): void {
    this.editingField = null;
    this.editValue = '';
  }
  saveEdit(): void {
    if (!this.profile || !this.editingField) return;
    const id = this.profile.id;
    const field = this.editingField;
    const payload: any = { [field]: this.editValue };
    this.saving = true;
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
          const msg = err?.error?.message || 'บันทึกล้มเหลว โปรดลองอีกครั้ง';
          this.showToast(msg, 'error');
        }
      });
  }

  showToast(msg: string, type: 'success' | 'error'): void {
    clearTimeout(this.toastTimer);
    this.toastMessage = msg;
    this.toastType = type;
    this.toastTimer = setTimeout(() => this.toastMessage = '', 3500);
  }

  // ── Stable cover background hue ─────────────────────────
  get coverHue(): number {
    const seed = `${this.profile?.firstName || ''}${this.profile?.lastName || ''}${this.profile?.email || ''}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    const hues = [330, 280, 220, 195, 165, 135, 30, 10];
    return hues[Math.abs(hash) % hues.length];
  }

  /** Profile completeness percentage */
  get completeness(): number {
    if (!this.profile) return 0;
    const fields = [
      this.profile.firstName, this.profile.lastName, this.profile.email,
      this.profile.phone, this.profile.university, this.profile.lineId,
      this.profile.paymentChannel, (this.profile as any).bio,
      (this.profile.subjects && this.profile.subjects.length ? 'x' : null)
    ];
    const filled = fields.filter(f => !!f && String(f).trim().length > 0).length;
    return Math.round((filled / fields.length) * 100);
  }

  get isComplete(): boolean { return this.completeness >= 90; }
}
