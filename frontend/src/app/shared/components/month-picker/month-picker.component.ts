import { Component, Input, Output, EventEmitter, HostListener, ElementRef, forwardRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Custom month picker — replaces native <input type="month"> with a polished popup.
 *
 * Usage (template-driven):  <kms-month-picker [(ngModel)]="selectedMonth"></kms-month-picker>
 * Usage (event):             <kms-month-picker [value]="selectedMonth" (valueChange)="onChange($event)"></kms-month-picker>
 *
 * Value format: 'YYYY-MM' (e.g. '2026-04'). Empty string = no selection.
 */
@Component({
  selector: 'kms-month-picker',
  standalone: true,
  imports: [CommonModule],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => MonthPickerComponent), multi: true }
  ],
  template: `
    <div class="kms-mp" [class.is-open]="isOpen">
      <button type="button" class="kms-mp-trigger" (click)="toggle()" [disabled]="disabled" [attr.aria-expanded]="isOpen">
        <svg class="kms-mp-trigger-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <span class="kms-mp-trigger-label" *ngIf="value">{{ formatMonth(value) }}</span>
        <span class="kms-mp-trigger-label kms-mp-empty" *ngIf="!value">{{ placeholder }}</span>
        <svg class="kms-mp-chev" [class.flip]="isOpen" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      <div class="kms-mp-panel" *ngIf="isOpen" (click)="$event.stopPropagation()">
        <!-- Year nav -->
        <div class="kms-mp-year-nav">
          <button type="button" class="kms-mp-year-btn" (click)="changeYear(-1)" aria-label="ปีก่อนหน้า">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="kms-mp-year-display">
            <span class="kms-mp-year-label">พ.ศ.</span>
            <span class="kms-mp-year-num">{{ panelYear + 543 }}</span>
            <span class="kms-mp-year-sub">{{ panelYear }}</span>
          </div>
          <button type="button" class="kms-mp-year-btn" (click)="changeYear(1)" aria-label="ปีถัดไป">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>

        <!-- Month grid -->
        <div class="kms-mp-grid">
          <button type="button"
                  *ngFor="let m of months; let i = index"
                  class="kms-mp-month"
                  [class.selected]="isSelected(panelYear, i)"
                  [class.is-current]="isCurrent(panelYear, i)"
                  (click)="selectMonth(panelYear, i)">
            <span class="kms-mp-month-name">{{ m }}</span>
            <span *ngIf="isCurrent(panelYear, i)" class="kms-mp-current-dot"></span>
          </button>
        </div>

        <!-- Quick chips -->
        <div class="kms-mp-quick">
          <button type="button" class="kms-mp-chip" (click)="selectRelative(0)">เดือนนี้</button>
          <button type="button" class="kms-mp-chip" (click)="selectRelative(-1)">เดือนที่แล้ว</button>
          <button type="button" class="kms-mp-chip" (click)="selectRelative(-3)">3 เดือนก่อน</button>
          <button type="button" class="kms-mp-chip kms-mp-chip-clear" (click)="clearValue()" *ngIf="value && allowClear">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            ทั้งหมด
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: inline-block; position: relative; }
    .kms-mp { position: relative; display: inline-flex; }

    .kms-mp-trigger {
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
      min-width: 160px;
      justify-content: space-between;
    }
    .kms-mp-trigger:hover { border-color: #ec4899; background: #fdf2f8; }
    .kms-mp-trigger:disabled { opacity: .55; cursor: not-allowed; }
    .kms-mp.is-open .kms-mp-trigger {
      border-color: #ec4899;
      box-shadow: 0 0 0 3px rgba(236, 72, 153, .12);
    }
    .kms-mp-trigger-icon { color: #ec4899; flex-shrink: 0; }
    .kms-mp-trigger-label { flex: 1; text-align: left; }
    .kms-mp-empty { color: #9ca3af; font-weight: 500; }
    .kms-mp-chev { color: #94a3b8; transition: transform .2s ease; flex-shrink: 0; }
    .kms-mp-chev.flip { transform: rotate(180deg); color: #ec4899; }

    .kms-mp-panel {
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
      animation: kmsMpFadeIn .18s cubic-bezier(.32, .72, .26, 1);
    }
    @keyframes kmsMpFadeIn {
      from { opacity: 0; transform: translateY(-6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .kms-mp-year-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 12px;
    }
    .kms-mp-year-btn {
      width: 32px; height: 32px;
      border-radius: 8px;
      background: #f8f9fa;
      border: 1px solid #e9ecef;
      color: #4b5563;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: all .18s ease;
    }
    .kms-mp-year-btn:hover { background: #fdf2f8; color: #be185d; border-color: #fbcfe8; }
    .kms-mp-year-display { text-align: center; flex: 1; }
    .kms-mp-year-label {
      display: block;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.12em;
      color: #9ca3af;
      text-transform: uppercase;
    }
    .kms-mp-year-num {
      font-size: 18px;
      font-weight: 800;
      color: #1f2937;
      letter-spacing: -0.02em;
    }
    .kms-mp-year-sub {
      font-size: 10px;
      color: #6b7280;
      font-weight: 600;
      margin-left: 4px;
    }

    .kms-mp-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 4px;
      margin-bottom: 12px;
    }
    .kms-mp-month {
      position: relative;
      padding: 10px 8px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      color: #4b5563;
      cursor: pointer;
      transition: all .15s ease;
      font-family: inherit;
    }
    .kms-mp-month:hover { background: #f8f9fa; color: #1f2937; }
    .kms-mp-month.selected {
      background: linear-gradient(135deg, #ec4899, #be185d);
      color: #fff;
      box-shadow: 0 4px 12px rgba(236, 72, 153, .35);
    }
    .kms-mp-month.is-current:not(.selected) {
      border-color: #fbcfe8;
      color: #be185d;
    }
    .kms-mp-current-dot {
      position: absolute;
      bottom: 5px;
      left: 50%;
      transform: translateX(-50%);
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: #ec4899;
    }
    .kms-mp-month.selected .kms-mp-current-dot { background: #fff; }

    .kms-mp-quick {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      padding-top: 10px;
      border-top: 1px dashed #e9ecef;
    }
    .kms-mp-chip {
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
    .kms-mp-chip:hover { background: #fdf2f8; color: #be185d; border-color: #fbcfe8; }
    .kms-mp-chip-clear { margin-left: auto; background: #fef2f2; color: #b91c1c; border-color: #fecaca; }
    .kms-mp-chip-clear:hover { background: #fee2e2; color: #991b1b; }
  `]
})
export class MonthPickerComponent implements ControlValueAccessor {
  @Input() value = '';                  // 'YYYY-MM'
  @Input() placeholder = 'เลือกเดือน';
  @Input() disabled = false;
  @Input() allowClear = true;
  @Output() valueChange = new EventEmitter<string>();

  isOpen = false;
  panelYear = new Date().getFullYear();

  readonly months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

  // ── ControlValueAccessor ─────────────
  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};
  writeValue(v: string): void { this.value = v || ''; this.syncPanelYear(); }
  registerOnChange(fn: any): void { this.onChange = fn; }
  registerOnTouched(fn: any): void { this.onTouched = fn; }
  setDisabledState(d: boolean): void { this.disabled = d; }

  constructor(private elRef: ElementRef) {}

  ngOnInit(): void { this.syncPanelYear(); }

  private syncPanelYear(): void {
    if (this.value) {
      const [y] = this.value.split('-').map(Number);
      if (y && !isNaN(y)) this.panelYear = y;
    } else {
      this.panelYear = new Date().getFullYear();
    }
  }

  toggle(): void {
    if (this.disabled) return;
    this.isOpen = !this.isOpen;
    if (this.isOpen) this.syncPanelYear();
    else this.onTouched();
  }

  changeYear(delta: number): void {
    this.panelYear += delta;
  }

  selectMonth(year: number, monthIdx: number): void {
    const ym = `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
    this.setValue(ym);
    this.isOpen = false;
  }

  selectRelative(monthsOffset: number): void {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + monthsOffset);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    this.setValue(ym);
    this.panelYear = d.getFullYear();
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

  isSelected(year: number, monthIdx: number): boolean {
    if (!this.value) return false;
    const [y, m] = this.value.split('-').map(Number);
    return y === year && (m - 1) === monthIdx;
  }

  isCurrent(year: number, monthIdx: number): boolean {
    const now = new Date();
    return year === now.getFullYear() && monthIdx === now.getMonth();
  }

  formatMonth(ym: string): string {
    if (!ym) return '';
    const [y, m] = ym.split('-').map(Number);
    if (!y || !m) return ym;
    return `${this.months[m - 1]} ${y + 543}`;
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
