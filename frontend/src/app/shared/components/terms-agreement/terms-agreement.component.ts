import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, AfterViewInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TermsDocument } from '../../constants/terms';

/**
 * Popup ข้อตกลงการใช้บริการ — บังคับให้ผู้ใช้อ่านจริงก่อนยอมรับ
 *  - Scroll-gate: ปุ่มยอมรับติดเมื่อเลื่อนอ่านถึงล่างสุด
 *  - สรุปข้อสำคัญด้านบน + เนื้อหาฉบับเต็มด้านล่าง
 *  - checkbox ยืนยัน 1 อัน
 * เป็น blocking modal — ปิดได้ทางเดียวคือยอมรับ หรือกดออกจากระบบ
 */
@Component({
  selector: 'app-terms-agreement',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './terms-agreement.component.html',
  styleUrls: ['./terms-agreement.component.css']
})
export class TermsAgreementComponent implements AfterViewInit, OnChanges {
  @Input() doc!: TermsDocument;
  @Input() submitting = false;

  @Output() accepted = new EventEmitter<void>();
  @Output() declined = new EventEmitter<void>();

  @ViewChild('scrollBody') scrollBody!: ElementRef<HTMLElement>;

  scrolledToBottom = false;
  agreed = false;

  ngAfterViewInit(): void {
    // ถ้าเนื้อหาสั้นจนไม่ต้อง scroll → ปลดล็อกทันที (กันปุ่มค้าง disabled)
    setTimeout(() => this.checkScroll(), 0);
  }

  ngOnChanges(changes: SimpleChanges): void {
    // เมื่อสลับชุดเอกสาร (เช่น admin: ครู→นักเรียน) ต้อง reset gate ให้อ่านใหม่
    if (changes['doc'] && !changes['doc'].firstChange) {
      this.scrolledToBottom = false;
      this.agreed = false;
      setTimeout(() => {
        if (this.scrollBody) this.scrollBody.nativeElement.scrollTop = 0;
        this.checkScroll();
      }, 0);
    }
  }

  onScroll(): void {
    this.checkScroll();
  }

  private checkScroll(): void {
    const el = this.scrollBody?.nativeElement;
    if (!el) return;
    // เผื่อ 24px ให้กดได้แม้ scroll ไม่ถึง pixel สุดท้ายพอดี
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= 24) {
      this.scrolledToBottom = true;
    }
  }

  get canAccept(): boolean {
    return this.scrolledToBottom && this.agreed && !this.submitting;
  }

  onAccept(): void {
    if (this.canAccept) this.accepted.emit();
  }

  onDecline(): void {
    this.declined.emit();
  }
}
