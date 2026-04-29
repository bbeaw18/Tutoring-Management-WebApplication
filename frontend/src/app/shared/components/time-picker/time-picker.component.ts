import { Component, Input, Output, EventEmitter, HostListener, ElementRef, forwardRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Custom time picker — replaces native <input type="time"> with a polished hour+minute panel.
 *
 * Features:
 * - Hour column scroller (00–23) with current-hour highlight
 * - Minute column with configurable step (default 30 min)
 * - Period chips (เช้า/บ่าย/เย็น) for quick navigation
 * - Quick presets row
 *
 * Value format: 'HH:mm' (e.g. '09:30').
 */
@Component({
  selector: 'kms-time-picker',
  standalone: true,
  imports: [CommonModule],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => TimePickerComponent), multi: true }
  ],
  template: `
    <div class="kms-tp" [class.is-open]="isOpen">
      <button type="button" class="kms-tp-trigger" (click)="toggle()" [disabled]="disabled" [attr.aria-expanded]="isOpen">
        <svg class="kms-tp-trigger-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <span class="kms-tp-trigger-label" *ngIf="value">{{ value }}</span>
        <span class="kms-tp-trigger-label kms-tp-empty" *ngIf="!value">{{ placeholder }}</span>
        <svg class="kms-tp-chev" [class.flip]="isOpen" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      <div class="kms-tp-panel" *ngIf="isOpen" (click)="$event.stopPropagation()">
        <!-- Big preview -->
        <div class="kms-tp-preview">
          <span class="kms-tp-preview-h">{{ pickedHour | number:'2.0-0' }}</span>
          <span class="kms-tp-preview-sep">:</span>
          <span class="kms-tp-preview-m">{{ pickedMinute | number:'2.0-0' }}</span>
          <span class="kms-tp-preview-meta">{{ getPeriodLabel(pickedHour) }}</span>
        </div>

        <!-- Period chips -->
        <div class="kms-tp-period">
          <button type="button" *ngFor="let p of periods"
                  class="kms-tp-period-chip"
                  [class.active]="isPeriodActive(p)"
                  (click)="jumpToPeriod(p.startHour)">
            <span class="kms-tp-period-icon">{{ p.icon }}</span>
            {{ p.label }}
          </button>
        </div>

        <!-- Hour & Minute columns -->
        <div class="kms-tp-cols">
          <div class="kms-tp-col">
            <div class="kms-tp-col-label">ชั่วโมง</div>
            <div class="kms-tp-col-scroll" #hourCol>
              <button type="button" *ngFor="let h of hours"
                      class="kms-tp-cell"
                      [class.selected]="pickedHour === h"
                      [attr.data-hour]="h"
                      (click)="pickHour(h)">
                {{ h | number:'2.0-0' }}
              </button>
            </div>
          </div>
          <div class="kms-tp-col">
            <div class="kms-tp-col-label">นาที</div>
            <div class="kms-tp-col-scroll">
              <button type="button" *ngFor="let m of minutes"
                      class="kms-tp-cell"
                      [class.selected]="pickedMinute === m"
                      (click)="pickMinute(m)">
                {{ m | number:'2.0-0' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Action row -->
        <div class="kms-tp-actions">
          <button type="button" class="kms-tp-act kms-tp-cancel" (click)="cancel()">ยกเลิก</button>
          <button type="button" class="kms-tp-act kms-tp-confirm" (click)="confirm()">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            ยืนยัน
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: inline-block; position: relative; }
    .kms-tp { position: relative; display: inline-flex; }

    .kms-tp-trigger {
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
      min-width: 130px;
      justify-content: space-between;
    }
    .kms-tp-trigger:hover { border-color: #ec4899; background: #fdf2f8; }
    .kms-tp-trigger:disabled { opacity: .55; cursor: not-allowed; }
    .kms-tp.is-open .kms-tp-trigger {
      border-color: #ec4899;
      box-shadow: 0 0 0 3px rgba(236, 72, 153, .12);
    }
    .kms-tp-trigger-icon { color: #ec4899; flex-shrink: 0; }
    .kms-tp-trigger-label { flex: 1; text-align: left; letter-spacing: 0.02em; }
    .kms-tp-empty { color: #9ca3af; font-weight: 500; }
    .kms-tp-chev { color: #94a3b8; transition: transform .2s ease; flex-shrink: 0; }
    .kms-tp-chev.flip { transform: rotate(180deg); color: #ec4899; }

    .kms-tp-panel {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      z-index: 1000;
      width: 280px;
      background: #fff;
      border: 1px solid #e9ecef;
      border-radius: 14px;
      box-shadow: 0 18px 40px rgba(15, 23, 42, .14);
      padding: 14px;
      animation: kmsTpFadeIn .18s cubic-bezier(.32, .72, .26, 1);
    }
    @keyframes kmsTpFadeIn {
      from { opacity: 0; transform: translateY(-6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* Big preview */
    .kms-tp-preview {
      display: flex;
      align-items: baseline;
      justify-content: center;
      gap: 4px;
      padding: 14px 0 12px;
      border-bottom: 1px dashed #e9ecef;
      margin-bottom: 12px;
    }
    .kms-tp-preview-h, .kms-tp-preview-m {
      font-size: 36px;
      font-weight: 800;
      color: #be185d;
      letter-spacing: -0.04em;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }
    .kms-tp-preview-sep {
      font-size: 32px;
      color: #ec4899;
      font-weight: 700;
      animation: kmsTpBlink 1s ease-in-out infinite;
    }
    @keyframes kmsTpBlink { 50% { opacity: .35; } }
    .kms-tp-preview-meta {
      position: absolute;
      right: 14px;
      top: 14px;
      font-size: 10px;
      font-weight: 700;
      color: #6b7280;
      background: #fdf2f8;
      padding: 3px 8px;
      border-radius: 999px;
      border: 1px solid #fbcfe8;
      letter-spacing: 0.5px;
    }

    /* Period chips */
    .kms-tp-period {
      display: flex;
      gap: 4px;
      margin-bottom: 12px;
    }
    .kms-tp-period-chip {
      flex: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      background: #f8f9fa;
      border: 1px solid #e9ecef;
      color: #6b7280;
      font-size: 11px;
      font-weight: 600;
      padding: 6px 4px;
      border-radius: 8px;
      cursor: pointer;
      transition: all .15s ease;
      font-family: inherit;
    }
    .kms-tp-period-chip:hover { background: #fdf2f8; color: #be185d; border-color: #fbcfe8; }
    .kms-tp-period-chip.active {
      background: linear-gradient(135deg, #ec4899, #be185d);
      color: #fff;
      border-color: #ec4899;
      box-shadow: 0 4px 10px rgba(236, 72, 153, .3);
    }
    .kms-tp-period-icon { font-size: 12px; line-height: 1; }

    /* Hour/Minute columns */
    .kms-tp-cols {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 12px;
    }
    .kms-tp-col-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.1em;
      color: #9ca3af;
      text-transform: uppercase;
      text-align: center;
      margin-bottom: 4px;
    }
    .kms-tp-col-scroll {
      max-height: 156px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 4px;
      background: #f8f9fa;
      border: 1px solid #e9ecef;
      border-radius: 10px;
      scrollbar-width: thin;
      scrollbar-color: #ec4899 transparent;
    }
    .kms-tp-col-scroll::-webkit-scrollbar { width: 5px; }
    .kms-tp-col-scroll::-webkit-scrollbar-thumb { background: #ec4899; border-radius: 999px; }
    .kms-tp-col-scroll::-webkit-scrollbar-track { background: transparent; }

    .kms-tp-cell {
      flex-shrink: 0;
      padding: 7px 0;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      color: #4b5563;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: all .12s ease;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.02em;
      font-family: inherit;
    }
    .kms-tp-cell:hover { background: #fff; color: #be185d; border-color: #fbcfe8; }
    .kms-tp-cell.selected {
      background: linear-gradient(135deg, #ec4899, #be185d);
      color: #fff;
      border-color: #ec4899;
      box-shadow: 0 4px 10px rgba(236, 72, 153, .3);
    }

    /* Actions */
    .kms-tp-actions {
      display: flex;
      gap: 6px;
      padding-top: 10px;
      border-top: 1px dashed #e9ecef;
    }
    .kms-tp-act {
      flex: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 9px 12px;
      border-radius: 9px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      border: none;
      transition: all .18s ease;
      font-family: inherit;
    }
    .kms-tp-cancel { background: #f1f3f5; color: #4b5563; border: 1px solid #e9ecef; }
    .kms-tp-cancel:hover { background: #e9ecef; }
    .kms-tp-confirm {
      background: linear-gradient(135deg, #ec4899, #be185d);
      color: #fff;
      box-shadow: 0 4px 10px rgba(236, 72, 153, .3);
    }
    .kms-tp-confirm:hover { transform: translateY(-1px); box-shadow: 0 6px 14px rgba(236, 72, 153, .4); }
  `]
})
export class TimePickerComponent implements ControlValueAccessor {
  @Input() value = '';                  // 'HH:mm'
  @Input() placeholder = 'เลือกเวลา';
  @Input() disabled = false;
  @Input() minuteStep = 30;             // 5 / 10 / 15 / 30
  @Output() valueChange = new EventEmitter<string>();

  isOpen = false;
  pickedHour = 9;
  pickedMinute = 0;

  hours: number[] = Array.from({ length: 24 }, (_, i) => i);
  get minutes(): number[] {
    const arr: number[] = [];
    for (let m = 0; m < 60; m += this.minuteStep) arr.push(m);
    return arr;
  }

  readonly periods = [
    { label: 'เช้า',  icon: '🌅', startHour: 6 },
    { label: 'กลางวัน', icon: '☀️', startHour: 12 },
    { label: 'เย็น',  icon: '🌆', startHour: 17 },
    { label: 'กลางคืน', icon: '🌙', startHour: 20 },
  ];

  // ── ControlValueAccessor ─────────────
  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};
  writeValue(v: string): void { this.value = v || ''; this.syncFromValue(); }
  registerOnChange(fn: any): void { this.onChange = fn; }
  registerOnTouched(fn: any): void { this.onTouched = fn; }
  setDisabledState(d: boolean): void { this.disabled = d; }

  constructor(private elRef: ElementRef) {}

  ngOnInit(): void { this.syncFromValue(); }

  private syncFromValue(): void {
    if (this.value) {
      const [h, m] = this.value.split(':').map(Number);
      if (!isNaN(h)) this.pickedHour = h;
      if (!isNaN(m)) this.pickedMinute = m;
    }
  }

  toggle(): void {
    if (this.disabled) return;
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.syncFromValue();
      // Scroll selected hour into view after render
      setTimeout(() => {
        const sel = this.elRef.nativeElement.querySelector('.kms-tp-col-scroll .kms-tp-cell.selected');
        sel?.scrollIntoView({ block: 'center', behavior: 'auto' });
      }, 0);
    } else {
      this.onTouched();
    }
  }

  pickHour(h: number): void { this.pickedHour = h; }
  pickMinute(m: number): void { this.pickedMinute = m; }

  jumpToPeriod(startHour: number): void {
    this.pickedHour = startHour;
    setTimeout(() => {
      const sel = this.elRef.nativeElement.querySelector(`.kms-tp-cell[data-hour="${startHour}"]`);
      sel?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 0);
  }

  isPeriodActive(p: { startHour: number }): boolean {
    const idx = this.periods.findIndex(x => x.startHour === p.startHour);
    if (idx < 0) return false;
    const next = this.periods[idx + 1]?.startHour ?? 24;
    const start = p.startHour;
    if (idx === this.periods.length - 1) {
      // Last period wraps around to next morning
      return this.pickedHour >= start || this.pickedHour < this.periods[0].startHour;
    }
    return this.pickedHour >= start && this.pickedHour < next;
  }

  getPeriodLabel(h: number): string {
    if (h >= 6 && h < 12) return 'เช้า';
    if (h >= 12 && h < 17) return 'กลางวัน';
    if (h >= 17 && h < 20) return 'เย็น';
    return 'กลางคืน';
  }

  confirm(): void {
    const v = `${String(this.pickedHour).padStart(2, '0')}:${String(this.pickedMinute).padStart(2, '0')}`;
    this.value = v;
    this.onChange(v);
    this.valueChange.emit(v);
    this.isOpen = false;
    this.onTouched();
  }

  cancel(): void {
    this.syncFromValue();
    this.isOpen = false;
    this.onTouched();
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
