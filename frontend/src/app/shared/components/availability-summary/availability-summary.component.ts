import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AvailabilitySlot, AvailabilityWeek, availabilityTime } from '../../../services/teacher-availability.service';

@Component({
  selector: 'app-availability-summary',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="availability-summary">
      <h2><span aria-hidden="true"></span>{{ heading }}</h2>
      <p *ngIf="!data.saved">ยังไม่มีการแจ้งเวลาว่างสำหรับสัปดาห์นี้</p>
      <p *ngIf="data.saved && !days.length">ไม่มีช่วงว่างในสัปดาห์นี้</p>
      <dl *ngIf="days.length">
        <div *ngFor="let day of days">
          <dt>{{ day.date | date:'EEE d MMM':undefined:'th' }}</dt>
          <dd>
            <span *ngFor="let slot of day.slots">{{ time(slot.start) }}–{{ time(slot.end) }} น.</span>
          </dd>
        </div>
      </dl>
    </section>
  `,
  styles: [`
    .availability-summary { padding: 12px 16px; margin-bottom: 14px; border: 1px solid oklch(88% .046 150); border-radius: 12px; background: oklch(98% .018 150); color: oklch(33% .07 150); }
    h2 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: var(--text-base, 1rem); }
    h2 span { width: 9px; height: 9px; border-radius: 50%; background: oklch(53% .14 150); }
    p { margin: 4px 0 0; }
    dl { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 8px 0 0; }
    dt { font-weight: 600; }
    dd { margin: 0; display: flex; flex-wrap: wrap; gap: 0 8px; }
    p, dl { font-size: var(--text-sm, .875rem); }
  `]
})
export class AvailabilitySummaryComponent implements OnChanges {
  @Input({ required: true }) data!: AvailabilityWeek;
  @Input({ required: true }) weekStart!: Date;
  @Input() heading = 'เวลาว่างสัปดาห์นี้';
  readonly time = availabilityTime;
  days: { date: Date; slots: AvailabilitySlot[] }[] = [];

  ngOnChanges(): void {
    this.days = Array.from({ length: 7 }, (_, day) => {
      const date = new Date(this.weekStart);
      date.setDate(date.getDate() + day);
      return { date, slots: this.data.freeSlots.filter(slot => slot.day === day) };
    }).filter(day => day.slots.length);
  }
}
