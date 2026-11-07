import { ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule, formatDate } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Subject, catchError, map, of, switchMap, takeUntil } from 'rxjs';
import {
  AvailabilityClass, AvailabilitySlot, TeacherAvailabilityService, availabilityTime
} from '../../../services/teacher-availability.service';

interface Selection {
  pointerId: number;
  day: number;
  anchor: number;
  x: number;
  y: number;
  armed: boolean;
  moved: boolean;
}

@Component({
  selector: 'app-availability-editor',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './availability-editor.component.html',
  styleUrls: ['./availability-editor.component.css']
})
export class AvailabilityEditorComponent implements OnInit, OnDestroy {
  @ViewChild('dialog', { static: true }) private dialog!: ElementRef<HTMLDialogElement>;
  @ViewChild('gridScroll') private gridScroll?: ElementRef<HTMLDivElement>;
  @ViewChild('conflictTitle') private conflictTitle?: ElementRef<HTMLElement>;
  private readonly destroy$ = new Subject<void>();
  private readonly load$ = new Subject<{ week: string; automatic: boolean }>();
  private holdTimer?: ReturnType<typeof setTimeout>;
  private selection: Selection | null = null;

  readonly hours = Array.from({ length: 24 }, (_, hour) => hour);
  readonly time = availabilityTime;
  readonly form = new FormGroup({
    day: new FormControl(0, { nonNullable: true }),
    start: new FormControl('17:00', { nonNullable: true }),
    end: new FormControl('18:00', { nonNullable: true })
  });
  week = '';
  dates: Date[] = [];
  slots: AvailabilitySlot[] = [];
  busyByDay: { lesson: AvailabilityClass; slot: AvailabilitySlot }[][] = [];
  conflicts: AvailabilityClass[] = [];
  dragPreview: AvailabilitySlot | null = null;
  holdDay: number | null = null;
  holdingReady = false;
  loading = false;
  loadFailed = false;
  saving = false;
  copying = false;
  error = '';
  rangeError = '';

  constructor(private availability: TeacherAvailabilityService, private changeDetector: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.load$.pipe(
      switchMap(request => this.availability.get(request.week).pipe(
        map(data => ({ ...request, data })),
        catchError(() => of({ ...request, data: null }))
      )),
      takeUntil(this.destroy$)
    ).subscribe(({ week, automatic, data }) => {
      if (automatic && (!data || data.saved)) return;
      this.week = week;
      this.dates = Array.from({ length: 7 }, (_, day) => this.dateAt(week, day));
      this.slots = data?.slots || [];
      this.setClasses(data?.classes || []);
      this.form.reset({ day: 0, start: '17:00', end: '18:00' });
      this.loading = false;
      this.loadFailed = !data;
      this.showDialog();
    });
    this.availability.editRequested$.pipe(takeUntil(this.destroy$)).subscribe(week => this.open(week));

    const today = formatDate(Date.now(), 'yyyy-MM-dd', 'en-US', '+0700');
    if (this.dateAt(today, 0).getUTCDay() === 1) this.load$.next({ week: today, automatic: true });
  }

  private dateAt(week: string, day: number): Date {
    const date = new Date(`${week}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + day);
    return date;
  }

  open(week: string): void {
    this.week = week;
    this.loading = true;
    this.loadFailed = false;
    this.error = '';
    this.rangeError = '';
    this.conflicts = [];
    this.showDialog();
    this.load$.next({ week, automatic: false });
  }

  private showDialog(): void {
    this.changeDetector.detectChanges();
    if (!this.dialog.nativeElement.open) this.dialog.nativeElement.showModal();
    const scroll = this.gridScroll?.nativeElement;
    const column = scroll?.querySelector<HTMLElement>('.time-column');
    if (scroll && column) scroll.scrollTop = column.offsetHeight / 3;
  }

  private setClasses(classes: AvailabilityClass[]): void {
    this.busyByDay = Array.from({ length: 7 }, (_, day) =>
      classes.flatMap(lesson => lesson.blocks.filter(slot => slot.day === day).map(slot => ({ lesson, slot }))));
  }

  addRange(): void {
    const { day, start, end } = this.form.getRawValue();
    const startMinute = this.toMinutes(start);
    const endMinute = end === '00:00' ? 1440 : this.toMinutes(end);
    if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute) || endMinute <= startMinute) {
      this.rangeError = 'กรุณาเลือกเวลาสิ้นสุดให้หลังเวลาเริ่ม';
      return;
    }
    this.rangeError = '';
    this.addSlot({ day, start: startMinute, end: endMinute });
  }

  private toMinutes(time: string): number {
    const [hour, minute] = time.split(':').map(Number);
    return hour * 60 + minute;
  }

  private addSlot(slot: AvailabilitySlot): void {
    const sorted = [...this.slots, slot].sort((a, b) => a.day - b.day || a.start - b.start);
    const merged: AvailabilitySlot[] = [];
    for (const item of sorted) {
      const previous = merged[merged.length - 1];
      if (previous?.day === item.day && previous.end >= item.start) previous.end = Math.max(previous.end, item.end);
      else merged.push({ ...item });
    }
    this.slots = merged;
  }

  removeSlot(index: number): void {
    this.slots = this.slots.filter((_, i) => i !== index);
  }

  copyLastWeek(): void {
    const previous = this.dateAt(this.week, -7).toISOString().slice(0, 10);
    this.copying = true;
    this.error = '';
    this.availability.get(previous).pipe(takeUntil(this.destroy$)).subscribe({
      next: data => {
        this.copying = false;
        if (data.saved) this.slots = data.slots;
        else this.error = 'ยังไม่มีเวลาว่างที่บันทึกไว้ในสัปดาห์ก่อน';
      },
      error: () => { this.copying = false; this.error = 'โหลดเวลาว่างของสัปดาห์ก่อนไม่สำเร็จ'; }
    });
  }

  evenings(): void {
    this.slots = this.dates.map((_, day) => ({ day, start: 17 * 60, end: 20 * 60 }));
  }

  startHold(event: PointerEvent, day: number): void {
    if (!event.isPrimary || event.button !== 0 || this.selection || this.saving || this.copying) return;
    const column = event.currentTarget as HTMLElement;
    const anchor = this.pointerMinute(event, column);
    column.setPointerCapture(event.pointerId);
    this.selection = { pointerId: event.pointerId, day, anchor, x: event.clientX, y: event.clientY, armed: false, moved: false };
    this.holdDay = day;
    this.holdTimer = setTimeout(() => {
      if (!this.selection) return;
      this.selection.armed = true;
      this.holdingReady = true;
      this.dragPreview = { day, start: anchor, end: anchor + 30 };
    }, 2000);
  }

  moveHold(event: PointerEvent): void {
    const selection = this.selection;
    if (!selection || selection.pointerId !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - selection.x, event.clientY - selection.y) > 7;
    if (!selection.armed) {
      if (moved) this.clearHold();
      return;
    }
    if (!moved && !selection.moved) return;
    selection.moved = true;
    const minute = this.pointerMinute(event, event.currentTarget as HTMLElement);
    this.dragPreview = { day: selection.day, start: Math.min(selection.anchor, minute), end: Math.max(selection.anchor, minute) + 30 };
  }

  finishHold(event: PointerEvent): void {
    if (this.selection?.pointerId !== event.pointerId) return;
    this.moveHold(event);
    if (this.selection?.moved && this.dragPreview) this.addSlot(this.dragPreview);
    this.clearHold();
  }

  clearHold(): void {
    clearTimeout(this.holdTimer);
    this.selection = null;
    this.holdDay = null;
    this.holdingReady = false;
    this.dragPreview = null;
  }

  private pointerMinute(event: PointerEvent, column: HTMLElement): number {
    const rect = column.getBoundingClientRect();
    const minute = (event.clientY - rect.top) * 1440 / rect.height;
    return Math.max(0, Math.min(1410, Math.floor(minute / 30) * 30));
  }

  save(confirmed = false): void {
    if (this.saving || this.copying || this.loading || this.loadFailed) return;
    this.clearHold();
    this.saving = true;
    this.error = '';
    const keys = confirmed ? this.conflicts.map(lesson => lesson.key) : [];
    this.availability.save(this.week, this.slots, keys).pipe(takeUntil(this.destroy$)).subscribe({
      next: data => {
        this.saving = false;
        this.availability.notifySaved(this.week, data);
        this.close();
      },
      error: err => {
        this.saving = false;
        const data = err.error?.data;
        if (err.status === 409 && Array.isArray(data?.conflicts)) {
          this.conflicts = data.conflicts;
          this.setClasses(data.classes);
          this.changeDetector.detectChanges();
          this.conflictTitle?.nativeElement.focus();
        } else {
          this.error = 'บันทึกเวลาว่างไม่สำเร็จ กรุณาลองอีกครั้ง';
        }
      }
    });
  }

  backToEdit(): void {
    this.conflicts = [];
    this.error = '';
    this.showDialog();
  }

  close(event?: Event): void {
    event?.preventDefault();
    if (this.saving || this.loading || this.copying) return;
    this.clearHold();
    this.conflicts = [];
    this.error = '';
    this.dialog.nativeElement.close();
  }

  ngOnDestroy(): void {
    this.clearHold();
    this.destroy$.next();
    this.destroy$.complete();
  }
}
