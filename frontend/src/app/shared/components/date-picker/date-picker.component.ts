import { Component, Input, Output, EventEmitter, HostListener, ElementRef, forwardRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Custom date picker — replaces native <input type="date"> with a calendar grid popup.
 *
 * Value format: 'YYYY-MM-DD' (e.g. '2026-04-26').
 */
@Component({
  selector: 'kms-date-picker',
  standalone: true,
  imports: [CommonModule],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DatePickerComponent), multi: true }
  ],
  template: `
    <div class="kms-dp" [class.is-open]="isOpen">
      <button type="button" class="kms-dp-trigger" (click)="toggle()" [disabled]="disabled" [attr.aria-expanded]="isOpen">
        <svg class="kms-dp-trigger-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <span class="kms-dp-trigger-label" *ngIf="value">{{ formatDate(value) }}</span>
        <span class="kms-dp-trigger-label kms-dp-empty" *ngIf="!value">{{ placeholder }}</span>
        <svg class="kms-dp-chev" [class.flip]="isOpen" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      <div class="kms-dp-panel" *ngIf="isOpen" (click)="$event.stopPropagation()">
        <!-- Month header -->
        <div class="kms-dp-header">
          <button type="button" class="kms-dp-nav" (click)="changeMonth(-1)" aria-label="เดือนก่อน">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="kms-dp-month-display">
            <span class="kms-dp-month-name">{{ monthsFull[panelMonth] }}</span>
            <span class="kms-dp-year">{{ panelYear + 543 }}</span>
          </div>
          <button type="button" class="kms-dp-nav" (click)="changeMonth(1)" aria-label="เดือนถัดไป">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>

        <!-- Weekday header -->
        <div class="kms-dp-weekdays">
          <span *ngFor="let w of weekdayLabels" class="kms-dp-wd">{{ w }}</span>
        </div>

        <!-- Day grid -->
        <div class="kms-dp-grid">
          <button type="button"
                  *ngFor="let cell of calendarCells"
                  class="kms-dp-day"
                  [class.outside]="cell.outside"
                  [class.today]="cell.today"
                  [class.selected]="cell.selected"
                  [class.weekend]="cell.weekend"
                  [disabled]="cell.disabled"
                  (click)="selectDate(cell)">
            {{ cell.day }}
          </button>
        </div>

        <!-- Quick chips -->
        <div class="kms-dp-quick">
          <button type="button" class="kms-dp-chip" (click)="selectRelative(0)">วันนี้</button>
          <button type="button" class="kms-dp-chip" (click)="selectRelative(1)">พรุ่งนี้</button>
          <button type="button" class="kms-dp-chip" (click)="selectRelative(7)">อีก 7 วัน</button>
          <button type="button" class="kms-dp-chip kms-dp-chip-clear" (click)="clearValue()" *ngIf="value && allowClear">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            ล้าง
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: inline-block; position: relative; }
    .kms-dp { position: relative; display: inline-flex; }

    .kms-dp-trigger {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #fff;
      border: 1.5px solid #e9ecef;
      color: #1f2937;
      font-size: 13px;
      font-weight: 600;
      padding: 9px 14px;
      border-radius: 10px;
      cursor: pointer;
      transition: all .18s ease;
      font-family: inherit;
      min-width: 180px;
      justify-content: space-between;
    }
    .kms-dp-trigger:hover { border-color: #ec4899; background: #fdf2f8; }
    .kms-dp-trigger:disabled { opacity: .55; cursor: not-allowed; }
    .kms-dp.is-open .kms-dp-trigger {
      border-color: #ec4899;
      box-shadow: 0 0 0 3px rgba(236, 72, 153, .12);
    }
    .kms-dp-trigger-icon { color: #ec4899; flex-shrink: 0; }
    .kms-dp-trigger-label { flex: 1; text-align: left; }
    .kms-dp-empty { color: #9ca3af; font-weight: 500; }
    .kms-dp-chev { color: #94a3b8; transition: transform .2s ease; flex-shrink: 0; }
    .kms-dp-chev.flip { transform: rotate(180deg); color: #ec4899; }

    .kms-dp-panel {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      z-index: 1000;
      width: 300px;
      background: #fff;
      border: 1px solid #e9ecef;
      border-radius: 14px;
      box-shadow: 0 18px 40px rgba(15, 23, 42, .14);
      padding: 14px;
      animation: kmsDpFadeIn .18s cubic-bezier(.32, .72, .26, 1);
    }
    @keyframes kmsDpFadeIn {
      from { opacity: 0; transform: translateY(-6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .kms-dp-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      margin-bottom: 10px;
    }
    .kms-dp-nav {
      width: 30px; height: 30px;
      border-radius: 8px;
      background: #f8f9fa;
      border: 1px solid #e9ecef;
      color: #4b5563;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: all .18s ease;
    }
    .kms-dp-nav:hover { background: #fdf2f8; color: #be185d; border-color: #fbcfe8; }
    .kms-dp-month-display { text-align: center; flex: 1; }
    .kms-dp-month-name { display: block; font-size: 14px; font-weight: 800; color: #1f2937; letter-spacing: -0.01em; }
    .kms-dp-year { font-size: 11px; font-weight: 600; color: #6b7280; }

    .kms-dp-weekdays {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2px;
      margin-bottom: 4px;
    }
    .kms-dp-wd {
      font-size: 10px;
      font-weight: 700;
      color: #9ca3af;
      text-align: center;
      padding: 4px 0;
      letter-spacing: 0.04em;
    }

    .kms-dp-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2px;
      margin-bottom: 12px;
    }
    .kms-dp-day {
      aspect-ratio: 1;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      color: #1f2937;
      cursor: pointer;
      transition: all .12s ease;
      font-family: inherit;
      font-variant-numeric: tabular-nums;
    }
    .kms-dp-day:hover:not(:disabled) { background: #fdf2f8; color: #be185d; }
    .kms-dp-day.outside { color: #cbd5e1; }
    .kms-dp-day.weekend:not(.outside):not(.selected) { color: #ef4444; }
    .kms-dp-day.today {
      border-color: #fbcfe8;
      color: #be185d;
      font-weight: 800;
    }
    .kms-dp-day.selected {
      background: linear-gradient(135deg, #ec4899, #be185d);
      color: #fff;
      box-shadow: 0 4px 10px rgba(236, 72, 153, .3);
      border-color: #ec4899;
    }
    .kms-dp-day:disabled { opacity: .35; cursor: not-allowed; }

    .kms-dp-quick {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      padding-top: 10px;
      border-top: 1px dashed #e9ecef;
    }
    .kms-dp-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #f1f3f5;
      border: 1px solid #e9ecef;
      color: #4b5563;
      font-size: 11px;
      font-weight: 600;
      padding: 5px 10px;
      border-radius: 999px;
      cursor: pointer;
      transition: all .15s ease;
      font-family: inherit;
    }
    .kms-dp-chip:hover { background: #fdf2f8; color: #be185d; border-color: #fbcfe8; }
    .kms-dp-chip-clear { margin-left: auto; background: #fef2f2; color: #b91c1c; border-color: #fecaca; }
  `]
})
export class DatePickerComponent implements ControlValueAccessor {
  @Input() value = '';                  // 'YYYY-MM-DD'
  @Input() placeholder = 'เลือกวันที่';
  @Input() disabled = false;
  @Input() allowClear = true;
  @Input() min = '';                    // 'YYYY-MM-DD'
  @Input() max = '';                    // 'YYYY-MM-DD'
  @Output() valueChange = new EventEmitter<string>();

  isOpen = false;
  panelYear = new Date().getFullYear();
  panelMonth = new Date().getMonth();

  readonly weekdayLabels = ['อา','จ','อ','พ','พฤ','ศ','ส'];
  readonly monthsFull = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  readonly monthsShort = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

  // ── ControlValueAccessor ─────────────
  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};
  writeValue(v: string): void { this.value = v || ''; this.syncPanel(); }
  registerOnChange(fn: any): void { this.onChange = fn; }
  registerOnTouched(fn: any): void { this.onTouched = fn; }
  setDisabledState(d: boolean): void { this.disabled = d; }

  constructor(private elRef: ElementRef) {}

  ngOnInit(): void { this.syncPanel(); }

  private syncPanel(): void {
    if (this.value) {
      const [y, m] = this.value.split('-').map(Number);
      if (y && m) { this.panelYear = y; this.panelMonth = m - 1; }
    }
  }

  toggle(): void {
    if (this.disabled) return;
    this.isOpen = !this.isOpen;
    if (this.isOpen) this.syncPanel();
    else this.onTouched();
  }

  changeMonth(delta: number): void {
    let m = this.panelMonth + delta;
    let y = this.panelYear;
    if (m < 0) { m = 11; y--; }
    else if (m > 11) { m = 0; y++; }
    this.panelMonth = m;
    this.panelYear = y;
  }

  /** Build 6×7 = 42 cells for the calendar grid (always fills 6 rows for stable height) */
  get calendarCells(): { day: number; outside: boolean; today: boolean; selected: boolean; weekend: boolean; disabled: boolean; year: number; month: number; }[] {
    const firstOfMonth = new Date(this.panelYear, this.panelMonth, 1);
    const startDayOfWeek = firstOfMonth.getDay(); // 0=Sun
    const daysInMonth = new Date(this.panelYear, this.panelMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(this.panelYear, this.panelMonth, 0).getDate();

    const cells: any[] = [];
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // Leading days from previous month
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      let py = this.panelYear, pm = this.panelMonth - 1;
      if (pm < 0) { pm = 11; py--; }
      cells.push(this.makeCell(d, py, pm, true, todayKey));
    }
    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(this.makeCell(d, this.panelYear, this.panelMonth, false, todayKey));
    }
    // Trailing days to fill 42 cells
    let nextDay = 1;
    while (cells.length < 42) {
      let ny = this.panelYear, nm = this.panelMonth + 1;
      if (nm > 11) { nm = 0; ny++; }
      cells.push(this.makeCell(nextDay++, ny, nm, true, todayKey));
    }
    return cells;
  }

  private makeCell(day: number, year: number, month: number, outside: boolean, todayKey: string) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dow = new Date(year, month, day).getDay();
    return {
      day, year, month,
      outside,
      today: key === todayKey,
      selected: this.value === key,
      weekend: dow === 0 || dow === 6,
      disabled: this.isOutOfRange(key),
    };
  }

  private isOutOfRange(key: string): boolean {
    if (this.min && key < this.min) return true;
    if (this.max && key > this.max) return true;
    return false;
  }

  selectDate(cell: { day: number; year: number; month: number; disabled: boolean }): void {
    if (cell.disabled) return;
    const v = `${cell.year}-${String(cell.month + 1).padStart(2, '0')}-${String(cell.day).padStart(2, '0')}`;
    this.setValue(v);
    this.panelYear = cell.year;
    this.panelMonth = cell.month;
    this.isOpen = false;
  }

  selectRelative(daysOffset: number): void {
    const d = new Date();
    d.setDate(d.getDate() + daysOffset);
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    this.setValue(v);
    this.panelYear = d.getFullYear();
    this.panelMonth = d.getMonth();
    this.isOpen = false;
  }

  clearValue(): void {
    this.setValue('');
    this.isOpen = false;
  }

  private setValue(v: string): void {
    this.value = v;
    this.onChange(v);
    this.valueChange.emit(v);
  }

  formatDate(v: string): string {
    if (!v) return '';
    const [y, m, d] = v.split('-').map(Number);
    if (!y || !m || !d) return v;
    return `${d} ${this.monthsShort[m - 1]} ${y + 543}`;
  }

  @HostListener('document:click', ['$event'])
  onDocClick(event: MouseEvent): void {
    if (!this.isOpen) return;
    if (!this.elRef.nativeElement.contains(event.target as Node)) {
      this.isOpen = false;
      this.onTouched();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen) { this.isOpen = false; this.onTouched(); }
  }
}
