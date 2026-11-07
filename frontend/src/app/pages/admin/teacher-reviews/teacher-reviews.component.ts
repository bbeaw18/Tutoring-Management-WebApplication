import { ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule, formatDate } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, catchError, of, startWith, switchMap, takeUntil, tap } from 'rxjs';
import { ClassReview, ClassReviewDetails, ReviewService } from '../../../services/review.service';
import { MonthPickerComponent } from '../../../shared/components/month-picker/month-picker.component';
import { DisplayNamePipe } from '../../../shared/pipes/display-name.pipe';
import { getDisplayStatusLabel } from '../../../shared/constants/schedule-status';

@Component({
  selector: 'app-teacher-reviews',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MonthPickerComponent, DisplayNamePipe],
  templateUrl: './teacher-reviews.component.html',
  styleUrls: ['./teacher-reviews.component.css']
})
export class TeacherReviewsComponent implements OnInit, OnDestroy {
  @ViewChild('detail', { static: true }) private detail!: ElementRef<HTMLDialogElement>;
  private readonly destroy$ = new Subject<void>();
  private readonly reload$ = new Subject<void>();
  private readonly details$ = new Subject<string>();

  month = formatDate(Date.now(), 'yyyy-MM', 'en-US', '+0700');
  classes: ClassReview[] = [];
  newThisWeek = 0;
  loading = true;
  loadError = false;
  teacherId = '';
  search = '';
  selected: ClassReview | null = null;
  selectedDetails: ClassReviewDetails | null = null;
  detailsError = false;
  readonly statusLabel = getDisplayStatusLabel;
  readonly paymentLabels = { confirmed: 'ชำระแล้ว', pending: 'รอตรวจสอบ', unpaid: 'ค้างชำระ' };
  readonly ratings = [5, 4, 3, 2, 1];
  readonly filters = [
    { key: 'all', label: 'ทั้งหมด' },
    { key: 'five', label: '5 ดาว' },
    { key: 'low', label: 'ต่ำกว่า 3 ดาว' },
    { key: 'comment', label: 'มีความคิดเห็น' }
  ];
  filter = 'all';

  constructor(private reviewService: ReviewService, private changeDetector: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.reload$.pipe(
      startWith(undefined),
      tap(() => { this.loading = true; this.loadError = false; }),
      switchMap(() => this.reviewService.list(this.month).pipe(catchError(() => of(null)))),
      takeUntil(this.destroy$)
    ).subscribe(result => {
      this.loading = false;
      this.loadError = !result;
      this.classes = result?.classes || [];
      this.newThisWeek = result?.newThisWeek || 0;
    });
    this.details$.pipe(
      tap(() => { this.selectedDetails = null; this.detailsError = false; }),
      switchMap(id => this.reviewService.getDetails(id).pipe(catchError(() => of(null)))),
      takeUntil(this.destroy$)
    ).subscribe(result => {
      this.selectedDetails = result;
      this.detailsError = !result;
    });
  }

  get teachers() {
    return [...new Map(this.classes.flatMap(lesson => lesson.teacher ? [[lesson.teacher._id, lesson.teacher] as const] : [])).values()];
  }

  get filteredClasses(): ClassReview[] {
    const search = this.search.trim().toLocaleLowerCase('th');
    return this.classes.filter(lesson => {
      if (this.teacherId && lesson.teacher?._id !== this.teacherId) return false;
      if (this.filter === 'five' && !lesson.reviews.some(review => review.rating === 5)) return false;
      if (this.filter === 'low' && !lesson.reviews.some(review => review.rating < 3)) return false;
      if (this.filter === 'comment' && !lesson.reviews.some(review => review.comment)) return false;
      if (!search) return true;
      const people = [lesson.teacher, ...lesson.reviews.map(review => review.student)];
      const names = people.map(person => [person?.firstName, person?.lastName, person?.nickname].join(' '));
      return [lesson.course?.name, lesson.course?.subject, ...names].join(' ').toLocaleLowerCase('th').includes(search);
    });
  }

  changeMonth(month: string): void {
    this.month = month;
    this.teacherId = '';
    this.reload();
  }

  reload(): void {
    this.reload$.next();
  }

  average(lesson: ClassReview): number {
    return lesson.reviews.reduce((sum, review) => sum + review.rating, 0) / lesson.reviews.length;
  }

  ratingCount(lesson: ClassReview, rating: number): number {
    return lesson.reviews.filter(review => review.rating === rating).length;
  }

  openDetail(lesson: ClassReview): void {
    this.selected = lesson;
    this.loadDetails(lesson._id);
    this.changeDetector.detectChanges();
    this.detail.nativeElement.showModal();
  }

  loadDetails(id: string): void {
    this.details$.next(id);
  }

  checkedInAt(studentId: string | undefined): string | undefined {
    if (!studentId) return undefined;
    return this.selectedDetails?.checkIns.find(item => item.student?._id === studentId)?.scannedAt;
  }

  closeDetail(): void {
    this.detail.nativeElement.close();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
