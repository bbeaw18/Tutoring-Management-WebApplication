import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AuthService } from '../../../services/auth.service';
import { LineConnection, LineTuitionService } from '../../../services/line-tuition.service';
import { TermsAgreementComponent } from '../../../shared/components/terms-agreement/terms-agreement.component';
import { getRequiredTermsForRole, TERMS_VERSION } from '../../../shared/constants/terms';
import { PaymentComponent } from '../payment/payment.component';

interface LiffSdk {
  init(config: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  login(options: { redirectUri: string }): void;
  getIDToken(): string | null;
  getAccessToken(): string | null;
}

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PaymentComponent, TermsAgreementComponent],
  templateUrl: './line-tuition.component.html',
  styles: [`
    :host { display: block; max-width: 65rem; margin: 0 auto; padding: clamp(0.75rem, 3vw, 2rem); }
    section { margin-bottom: 1rem; }
    button, a { display: inline-flex; align-items: center; min-height: 44px; }
    label { display: flex; align-items: center; min-height: 44px; gap: 0.5rem; width: fit-content; }
    summary { min-height: 44px; cursor: pointer; }
    .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  `]
})
export class LineTuitionComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();
  private sdk?: LiffSdk;
  private destroyed = false;
  returnUrl = '/line/tuition';
  reminderRound = '';
  reminderMonth = '';
  ready = false;
  busy = false;
  error = '';
  connection?: LineConnection;
  optedIn = false;
  submittingTerms = false;

  constructor(public auth: AuthService, private line: LineTuitionService) {}

  ngOnInit(): void {
    this.line.config().pipe(takeUntil(this.destroy$)).subscribe({
      next: async ({ liffId }) => {
        if (!liffId) {
          this.error = 'ระบบยังไม่ได้ตั้งค่าการเปิดบิลผ่าน LINE';
          return;
        }
        try {
          this.sdk = await this.loadLiff();
          if (this.destroyed) return;
          await this.sdk.init({ liffId });
          if (this.destroyed) return;
          const query = new URLSearchParams(window.location.search);
          const round = query.get('tuitionRound') || '';
          const month = query.get('tuitionMonth') || '';
          const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/;
          if (validMonth.test(round)) {
            this.reminderRound = round;
            const returnQuery = new URLSearchParams({ tuitionRound: round });
            if (validMonth.test(month) && month < round) {
              this.reminderMonth = month;
              returnQuery.set('tuitionMonth', month);
            }
            this.returnUrl = `/line/tuition?${returnQuery}`;
          }
          this.ready = true;
          if (this.auth.getUserRole() === 'student' && this.lineLoggedIn) this.loadConnection();
        } catch {
          if (!this.destroyed) this.error = 'เปิดหน้าค่าเรียนใน LINE ไม่สำเร็จ กรุณาลองเปิดจากเมนูอีกครั้ง';
        }
      },
      error: () => { this.error = 'โหลดการตั้งค่า LINE ไม่สำเร็จ'; }
    });
  }

  get lineLoggedIn(): boolean {
    return this.sdk?.isLoggedIn() === true;
  }

  get studentName(): string {
    const user = this.auth.getCurrentUser();
    return user ? `${user.firstName} ${user.lastName}` : '';
  }

  get termsDoc() {
    const user = this.auth.getCurrentUser();
    return user?.role === 'student' ? getRequiredTermsForRole(user.role).find(
      doc => user.acceptedTerms?.[doc.docType]?.version !== TERMS_VERSION
    ) : undefined;
  }

  acceptTerms(): void {
    const doc = this.termsDoc;
    if (!doc || this.submittingTerms) return;
    this.submittingTerms = true;
    this.auth.acceptTerms(doc.docType, TERMS_VERSION).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.submittingTerms = false; },
      error: () => { this.submittingTerms = false; }
    });
  }

  loginLine(): void {
    this.sdk?.login({ redirectUri: new URL(this.returnUrl, window.location.origin).href });
  }

  save(): void {
    const idToken = this.sdk?.getIDToken();
    if (this.busy || !idToken || !this.sdk) return;
    this.busy = true;
    this.error = '';
    this.line.save(idToken, this.sdk.getAccessToken(), this.optedIn)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: connection => this.displayConnection(connection),
        error: err => this.showError(err)
      });
  }

  unlink(): void {
    if (this.busy || !window.confirm('ยกเลิกการผูก LINE กับบัญชีนักเรียนนี้หรือไม่')) return;
    this.busy = true;
    this.error = '';
    this.line.unlink().pipe(takeUntil(this.destroy$)).subscribe({
      next: () => this.displayConnection({ linked: false, matches: false, optedIn: false, friend: false }),
      error: err => this.showError(err)
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadConnection(): void {
    const token = this.sdk?.getIDToken();
    if (!token) {
      this.error = 'LINE ไม่ส่งข้อมูลยืนยันตัวตน กรุณาเปิดเมนูใหม่';
      return;
    }
    this.busy = true;
    this.line.status(token).pipe(takeUntil(this.destroy$)).subscribe({
      next: connection => this.displayConnection(connection),
      error: err => this.showError(err)
    });
  }

  private displayConnection(connection: LineConnection): void {
    this.connection = connection;
    this.optedIn = connection.optedIn;
    this.busy = false;
  }

  private showError(err: { error?: { message?: string } }): void {
    this.error = err.error?.message || 'ติดต่อระบบ LINE ไม่สำเร็จ กรุณาลองใหม่';
    this.busy = false;
  }

  private loadLiff(): Promise<LiffSdk> {
    const sdkWindow = window as Window & { liff?: LiffSdk };
    if (sdkWindow.liff) return Promise.resolve(sdkWindow.liff);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
      script.onload = () => sdkWindow.liff ? resolve(sdkWindow.liff) : reject();
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
}
