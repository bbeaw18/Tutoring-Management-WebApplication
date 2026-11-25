import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, Output } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { IPayment } from '../../../interfaces/payment.interface';
import { LineTuitionService, ReminderPreview } from '../../../services/line-tuition.service';
import { PaymentReconciliation, PaymentService } from '../../../services/payment.service';

type ReviewMode = 'transfers' | 'reminders' | 'reconciliation';

@Component({
  selector: 'app-line-review',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './line-review.component.html',
  styles: [`
    :host { display: block; margin-block: 1rem; }
    nav { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    section { margin-top: 0.75rem; }
    article { padding-block: 0.75rem; border-bottom: 1px solid var(--color-border, #dfe3e9); }
    article p { margin: 0.25rem 0; }
    button { min-height: 44px; }
  `]
})
export class LineReviewComponent implements OnDestroy {
  @Output() reviewed = new EventEmitter<void>();
  private readonly destroy$ = new Subject<void>();
  mode?: ReviewMode;
  payments: IPayment[] = [];
  preview?: ReminderPreview;
  reconciliation?: PaymentReconciliation;
  busy = false;
  error = '';
  readonly status: Record<string, string> = {
    ready: 'เข้าเงื่อนไข', retry: 'รอลองใหม่', accepted: 'LINE รับคำขอแล้ว',
    failed: 'ส่งไม่สำเร็จ', skipped: 'ข้าม'
  };

  constructor(private line: LineTuitionService, private paymentService: PaymentService) {}

  load(mode: ReviewMode): void {
    if (this.busy) return;
    this.mode = mode;
    this.busy = true;
    this.error = '';
    if (mode === 'transfers') {
      this.paymentService.getPendingVerifications().pipe(takeUntil(this.destroy$)).subscribe({
        next: payments => { this.payments = payments.filter(payment => payment.tuitionQuote); this.busy = false; },
        error: err => this.fail(err)
      });
    } else if (mode === 'reconciliation') {
      this.paymentService.getReconciliation().pipe(takeUntil(this.destroy$)).subscribe({
        next: reconciliation => { this.reconciliation = reconciliation; this.busy = false; },
        error: err => this.fail(err)
      });
    } else {
      this.line.preview().pipe(takeUntil(this.destroy$)).subscribe({
        next: preview => { this.preview = preview; this.busy = false; },
        error: err => this.fail(err)
      });
    }
  }

  review(payment: IPayment, confirm: boolean): void {
    if (this.busy) return;
    const amounts = `ยอดที่แจ้งโอน ฿${payment.amount} · ยอดปัจจุบัน ${payment.currentAmount ?? 'ไม่พบคลาส'}`;
    const note = confirm
      ? window.prompt(`ยืนยันเมื่อเทียบยอดกับรายการเงินเข้าแล้ว\n${amounts}\nบันทึกการตรวจสอบ (ไม่บังคับ)`, '')
      : window.prompt(`ระบุเหตุผลที่ปฏิเสธการแจ้งโอน\n${amounts}`, '');
    if (note === null || (!confirm && !note.trim())) return;
    this.busy = true;
    this.error = '';
    const result = confirm ? this.paymentService.confirmPayment(payment._id, note)
      : this.paymentService.rejectPayment(payment._id, note);
    result.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.busy = false;
        this.payments = this.payments.filter(row => row._id !== payment._id);
        this.reviewed.emit();
      },
      error: err => this.fail(err)
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private fail(err: { error?: { message?: string } }): void {
    this.error = err.error?.message || 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่';
    this.busy = false;
  }
}
