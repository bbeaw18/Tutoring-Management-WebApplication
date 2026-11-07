import { ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, Subject, catchError, exhaustMap, filter, takeUntil, timer } from 'rxjs';
import { ReviewService, StudentReview } from '../../../services/review.service';
import { DisplayNamePipe } from '../../pipes/display-name.pipe';

@Component({
  selector: 'app-review-prompt',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, DisplayNamePipe],
  templateUrl: './review-prompt.component.html',
  styleUrls: ['./review-prompt.component.css']
})
export class ReviewPromptComponent implements OnInit, OnDestroy {
  @ViewChild('dialog', { static: true }) private dialog!: ElementRef<HTMLDialogElement>;
  @ViewChild('doneButton') private doneButton?: ElementRef<HTMLButtonElement>;
  private readonly destroy$ = new Subject<void>();
  private readonly handled = new Set<string>();
  private automatic = false;

  readonly stars = [1, 2, 3, 4, 5];
  readonly ratingLabels = ['เลือกคะแนน', 'ควรปรับปรุงมาก', 'ควรปรับปรุง', 'พอใช้', 'ดี', 'ดีมาก'];
  readonly form = new FormGroup({
    rating: new FormControl(0, { nonNullable: true, validators: [Validators.min(1), Validators.max(5)] }),
    comment: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] })
  });
  entry: StudentReview | null = null;
  busy = false;
  done = false;
  error = '';

  constructor(private reviews: ReviewService, private changeDetector: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.reviews.reviewRequested$.pipe(takeUntil(this.destroy$)).subscribe(entry => this.open(entry, false));
    timer(0, 30_000).pipe(
      filter(() => !this.entry && !document.hidden),
      exhaustMap(() => this.reviews.getPending().pipe(catchError(() => EMPTY))),
      takeUntil(this.destroy$)
    ).subscribe(entry => {
      if (entry && !this.handled.has(entry.lesson._id)) this.open(entry, true);
    });
  }

  private open(entry: StudentReview, automatic: boolean): void {
    if (this.entry || entry.submitted) return;
    this.automatic = automatic;
    this.form.reset();
    this.done = false;
    this.error = '';
    this.entry = entry;
    this.changeDetector.detectChanges();
    this.dialog.nativeElement.showModal();
  }

  submit(): void {
    if (!this.entry || this.busy || this.form.invalid) return;
    const id = this.entry.lesson._id;
    const { rating, comment } = this.form.getRawValue();
    this.busy = true;
    this.error = '';
    this.reviews.submit(id, rating, comment).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => this.showThanks(id),
      error: err => {
        if (err.status === 409) {
          this.showThanks(id);
        } else {
          this.busy = false;
          this.error = err.status === 403
            ? 'คลาสนี้ไม่เปิดให้ส่งรีวิวแล้ว'
            : 'ส่งรีวิวไม่สำเร็จ กรุณาลองอีกครั้ง';
        }
      }
    });
  }

  private showThanks(id: string): void {
    this.handled.add(id);
    this.busy = false;
    this.done = true;
    this.changeDetector.detectChanges();
    this.doneButton?.nativeElement.focus();
  }

  dismiss(event?: Event): void {
    event?.preventDefault();
    if (!this.entry || this.busy) return;
    if (this.done || !this.automatic) {
      this.close();
      return;
    }
    const id = this.entry.lesson._id;
    this.busy = true;
    this.error = '';
    this.reviews.dismiss(id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.handled.add(id);
        this.busy = false;
        this.close();
      },
      error: () => {
        this.busy = false;
        this.error = 'บันทึกการเลื่อนไม่สำเร็จ กรุณาลองอีกครั้ง';
      }
    });
  }

  private close(): void {
    this.dialog.nativeElement.close();
    this.entry = null;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
