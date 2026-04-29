import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { UserService } from '../../../services/user.service';
import { IUser } from '../../../interfaces/user.interface';

@Component({
  selector: 'app-teacher-approval',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="approval-container">

      <!-- Header -->
      <div class="page-header">
        <div class="header-left">
          <h1>อนุมัติครู</h1>
          <p>ตรวจสอบและอนุมัติการลงทะเบียนของครูผู้สอน</p>
        </div>
        <div class="header-stats">
          <div class="stat-card stat-pending">
            <div class="stat-value">{{ pendingTeachers.length }}</div>
            <div class="stat-label">รออนุมัติ</div>
          </div>
          <div class="stat-card stat-approved">
            <div class="stat-value">{{ approvedTeachers.length }}</div>
            <div class="stat-label">อนุมัติแล้ว</div>
          </div>
          <div class="stat-card stat-total">
            <div class="stat-value">{{ allTeachers.length }}</div>
            <div class="stat-label">ครูทั้งหมด</div>
          </div>
        </div>
      </div>

      <!-- ── Insights Banner ───────────────────────────── -->
      <div *ngIf="!loading && pendingTeachers.length > 0" class="insights-banner">
        <div class="insights-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
          </svg>
        </div>
        <div class="insights-body">
          <div class="insights-title">มีคำขอ {{ pendingTeachers.length }} รายการที่ต้องตรวจสอบ</div>
          <div class="insights-meta">
            <span class="insights-chip">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              สมัคร 7 วันล่าสุด <strong>{{ approvalInsights.applied7d }}</strong>
            </span>
            <span class="insights-chip" *ngIf="approvalInsights.oldestPendingDays > 0">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              รอนานสุด <strong>{{ approvalInsights.oldestPendingDays }} วัน</strong>
            </span>
            <span class="insights-chip">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              โปรไฟล์เฉลี่ย <strong>{{ approvalInsights.completionAvg }}%</strong>
            </span>
          </div>
        </div>
        <button class="insights-jump" *ngIf="activeTab !== 'pending'" (click)="setTab('pending')">
          ตรวจสอบเลย
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </button>
      </div>

      <!-- Loading -->
      <div *ngIf="loading" class="loading-state">
        <div class="spinner"></div>
        <p>กำลังโหลดข้อมูล...</p>
      </div>

      <div *ngIf="!loading">

        <!-- Search + Tab Filter -->
        <div class="toolbar">
          <div class="search-wrapper">
            <span class="search-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </span>
            <input
              type="text"
              [(ngModel)]="searchTerm"
              (ngModelChange)="applyFilters()"
              placeholder="ค้นหาชื่อ อีเมล..."
              class="search-input"
            />
          </div>
          <div class="tabs">
            <button class="tab-btn" [class.active]="activeTab === 'all'"
              (click)="setTab('all')">ทั้งหมด ({{ allTeachers.length }})</button>
            <button class="tab-btn tab-pending" [class.active]="activeTab === 'pending'"
              (click)="setTab('pending')">
              รออนุมัติ
              <span class="tab-badge" *ngIf="pendingTeachers.length > 0">{{ pendingTeachers.length }}</span>
            </button>
            <button class="tab-btn" [class.active]="activeTab === 'approved'"
              (click)="setTab('approved')">อนุมัติแล้ว ({{ approvedTeachers.length }})</button>
          </div>
        </div>

        <!-- Empty state -->
        <div *ngIf="displayedTeachers.length === 0" class="empty-state">
          <div class="empty-icon">
            <svg *ngIf="activeTab === 'pending'" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <svg *ngIf="activeTab !== 'pending'" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><path d="M12 3 9 1M12 3l3-2"/></svg>
          </div>
          <h3>{{ activeTab === 'pending' ? 'ไม่มีคำขออนุมัติ' : 'ไม่พบครู' }}</h3>
          <p>{{ activeTab === 'pending' ? 'ทุกคำขออนุมัติของครูได้รับการประมวลผลแล้ว' : 'ลองเปลี่ยนตัวกรองหรือคำค้นหา' }}</p>
        </div>

        <!-- Teacher Cards -->
        <div *ngIf="displayedTeachers.length > 0" class="teachers-grid">
          <div *ngFor="let teacher of displayedTeachers" class="teacher-card"
            [class.card-pending]="teacher.registrationStatus === 'unregistered'">

            <!-- Card Header -->
            <div class="card-header">
              <div class="teacher-avatar" [class.avatar-pending]="teacher.registrationStatus === 'unregistered'">
                {{ getInitials(teacher.firstName, teacher.lastName) }}
              </div>
              <div class="teacher-header-info">
                <h3 class="teacher-name">{{ teacher.firstName }} {{ teacher.lastName }}</h3>
                <div class="teacher-meta">
                  <span class="status-badge"
                    [class.badge-warning]="teacher.registrationStatus === 'unregistered'"
                    [class.badge-success]="teacher.registrationStatus === 'registered'">
                    <ng-container *ngIf="teacher.registrationStatus === 'registered'; else tpPending">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      อนุมัติแล้ว
                    </ng-container>
                    <ng-template #tpPending>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      รออนุมัติ
                    </ng-template>
                  </span>
                  <span class="meta-date">สมัคร {{ teacher.createdAt | date: 'dd/MM/yyyy' }}</span>
                </div>
              </div>
            </div>

            <!-- Card Info -->
            <div class="card-content">
              <div class="info-row">
                <span class="label">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                  อีเมล
                </span>
                <span class="value">{{ teacher.email }}</span>
              </div>
              <div class="info-row" *ngIf="teacher.phone">
                <span class="label">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                  เบอร์โทร
                </span>
                <span class="value">{{ teacher.phone }}</span>
              </div>
              <div class="info-row" *ngIf="teacher.university">
                <span class="label">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
                  มหาวิทยาลัย
                </span>
                <span class="value">{{ teacher.university }}</span>
              </div>
              <div class="info-row" *ngIf="teacher.lineId">
                <span class="label">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  Line ID
                </span>
                <span class="value">{{ teacher.lineId }}</span>
              </div>
              <div class="info-row" *ngIf="teacher.paymentChannel">
                <span class="label">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
                  ช่องทางรับเงิน
                </span>
                <span class="value">{{ teacher.paymentChannel }}</span>
              </div>
              <div class="info-row" *ngIf="!teacher.phone && !teacher.university && !teacher.lineId && !teacher.paymentChannel">
                <span class="value no-data">ไม่มีข้อมูลเพิ่มเติม</span>
              </div>
            </div>

            <!-- Card Actions -->
            <div class="card-actions" *ngIf="teacher.registrationStatus === 'unregistered'">
              <button class="btn btn-review" (click)="openReviewDrawer(teacher)" [disabled]="processingId === teacher.id">
                <span class="btn-inline">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  ดู
                </span>
              </button>
              <button
                class="btn btn-approve"
                (click)="approveTeacher(teacher)"
                [disabled]="processingId === teacher.id">
                <span *ngIf="processingId !== teacher.id" class="btn-inline">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  อนุมัติ
                </span>
                <span *ngIf="processingId === teacher.id" class="loading-dots">กำลังดำเนินการ</span>
              </button>
              <button
                class="btn btn-reject"
                (click)="openRejectDialog(teacher)"
                [disabled]="processingId === teacher.id">
                <span class="btn-inline">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  ปฏิเสธ
                </span>
              </button>
            </div>
            <div class="card-approved-footer" *ngIf="teacher.registrationStatus === 'registered'">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              ได้รับการอนุมัติแล้ว
            </div>

          </div>
        </div><!-- /teachers-grid -->
      </div><!-- /!loading -->

      <!-- ── Review Drawer ───────────────────────────────────── -->
      <div *ngIf="showReviewDrawer" class="drawer-backdrop" (click)="closeReviewDrawer()"></div>
      <aside *ngIf="showReviewDrawer && reviewTeacher" class="review-drawer" role="dialog" aria-modal="true">

        <header class="rd-header">
          <div class="rd-avatar">{{ getInitials(reviewTeacher.firstName, reviewTeacher.lastName) }}</div>
          <div class="rd-id">
            <div class="rd-name">{{ reviewTeacher.firstName }} {{ reviewTeacher.lastName }}</div>
            <div class="rd-status-row">
              <span class="status-badge"
                [class.badge-warning]="reviewTeacher.registrationStatus === 'unregistered'"
                [class.badge-success]="reviewTeacher.registrationStatus === 'registered'">
                {{ reviewTeacher.registrationStatus === 'registered' ? 'อนุมัติแล้ว' : 'รออนุมัติ' }}
              </span>
              <span class="rd-applied">สมัครเมื่อ {{ getDaysSinceApply(reviewTeacher) }} วันที่ผ่านมา</span>
            </div>
          </div>
          <button class="rd-close" (click)="closeReviewDrawer()" aria-label="ปิด">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </header>

        <!-- Profile completeness -->
        <section class="rd-section rd-completeness">
          <div class="rd-comp-row">
            <span class="rd-comp-label">ความสมบูรณ์ของโปรไฟล์</span>
            <span class="rd-comp-num">{{ getProfileCompleteness(reviewTeacher) }}%</span>
          </div>
          <div class="rd-comp-bar">
            <div class="rd-comp-fill"
                 [style.width.%]="getProfileCompleteness(reviewTeacher)"
                 [class.rd-comp-warn]="getProfileCompleteness(reviewTeacher) < 60"
                 [class.rd-comp-ok]="getProfileCompleteness(reviewTeacher) >= 80"></div>
          </div>
          <div *ngIf="getProfileCompleteness(reviewTeacher) < 60" class="rd-comp-hint">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            ข้อมูลไม่ครบถ้วน ควรขอให้กรอกเพิ่มก่อนอนุมัติ
          </div>
        </section>

        <!-- Detail fields -->
        <section class="rd-section">
          <h4 class="rd-section-title">ข้อมูลติดต่อ</h4>
          <div class="rd-field" [class.rd-field-empty]="!reviewTeacher.email">
            <div class="rd-field-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            </div>
            <div class="rd-field-body">
              <div class="rd-field-label">อีเมล</div>
              <div class="rd-field-value">{{ reviewTeacher.email || '— ไม่มีข้อมูล —' }}</div>
            </div>
          </div>
          <div class="rd-field" [class.rd-field-empty]="!reviewTeacher.phone">
            <div class="rd-field-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.91.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            </div>
            <div class="rd-field-body">
              <div class="rd-field-label">เบอร์โทร</div>
              <div class="rd-field-value">{{ reviewTeacher.phone || '— ไม่มีข้อมูล —' }}</div>
            </div>
          </div>
          <div class="rd-field" [class.rd-field-empty]="!reviewTeacher.lineId">
            <div class="rd-field-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div class="rd-field-body">
              <div class="rd-field-label">Line ID</div>
              <div class="rd-field-value">{{ reviewTeacher.lineId || '— ไม่มีข้อมูล —' }}</div>
            </div>
          </div>
        </section>

        <section class="rd-section">
          <h4 class="rd-section-title">ข้อมูลการสอน</h4>
          <div class="rd-field" [class.rd-field-empty]="!reviewTeacher.university">
            <div class="rd-field-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
            </div>
            <div class="rd-field-body">
              <div class="rd-field-label">มหาวิทยาลัย</div>
              <div class="rd-field-value">{{ reviewTeacher.university || '— ไม่มีข้อมูล —' }}</div>
            </div>
          </div>
          <div class="rd-field" [class.rd-field-empty]="!reviewTeacher.paymentChannel">
            <div class="rd-field-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
            </div>
            <div class="rd-field-body">
              <div class="rd-field-label">ช่องทางรับเงิน</div>
              <div class="rd-field-value">{{ reviewTeacher.paymentChannel || '— ไม่มีข้อมูล —' }}</div>
            </div>
          </div>
        </section>

        <!-- Footer actions -->
        <footer class="rd-footer" *ngIf="reviewTeacher.registrationStatus === 'unregistered'">
          <button class="rd-btn rd-btn-reject"
                  (click)="openRejectDialog(reviewTeacher); closeReviewDrawer()"
                  [disabled]="processingId === reviewTeacher.id">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            ปฏิเสธ
          </button>
          <button class="rd-btn rd-btn-approve"
                  (click)="approveTeacher(reviewTeacher); closeReviewDrawer()"
                  [disabled]="processingId === reviewTeacher.id">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            อนุมัติคำขอนี้
          </button>
        </footer>
      </aside>

      <!-- Rejection Dialog -->
      <div *ngIf="showRejectDialog" class="dialog-overlay" (click)="closeRejectDialog()">
        <div class="dialog" (click)="$event.stopPropagation()">
          <div class="dialog-header">
            <h3>ปฏิเสธคำขอ</h3>
            <button class="close-btn" (click)="closeRejectDialog()" aria-label="ปิด">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="dialog-content">
            <p>คุณแน่ใจหรือไม่ว่าต้องการปฏิเสธคำขอของ
              <strong>{{ selectedTeacher?.firstName }} {{ selectedTeacher?.lastName }}</strong>?
            </p>
            <textarea
              [(ngModel)]="rejectReason"
              placeholder="เหตุผลในการปฏิเสธ (ไม่บังคับ)"
              class="reject-reason">
            </textarea>
          </div>
          <div class="dialog-actions">
            <button class="btn btn-ghost" (click)="closeRejectDialog()" [disabled]="processingId === selectedTeacher?.id">
              ยกเลิก
            </button>
            <button class="btn btn-reject" (click)="confirmRejectTeacher()" [disabled]="processingId === selectedTeacher?.id">
              <span *ngIf="processingId !== selectedTeacher?.id">ยืนยันการปฏิเสธ</span>
              <span *ngIf="processingId === selectedTeacher?.id">กำลังดำเนินการ...</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Toast -->
      <div *ngIf="successMessage" class="toast toast-success">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        {{ successMessage }}
      </div>
      <div *ngIf="errorMessage" class="toast toast-error">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        {{ errorMessage }}
      </div>

    </div><!-- /approval-container -->
  `,
  styles: [`
    /* ── Container ── */
    .approval-container {
      display: flex;
      flex-direction: column;
      gap: var(--sp-5);
      animation: fadeUp 400ms var(--ease-out) both;
    }

    /* ── Page Header ── */
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: var(--sp-4);
    }

    .header-left h1 {
      margin: 0 0 var(--sp-1);
      font-size: 2rem;
      font-weight: 800;
      letter-spacing: -0.04em;
      background: linear-gradient(135deg, var(--gray-900) 0%, var(--brand-700) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .header-left p { margin: 0; color: var(--text-secondary); font-size: var(--text-sm); }

    .header-stats { display: flex; gap: var(--sp-3); flex-wrap: wrap; }

    .stat-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: var(--sp-3) var(--sp-5);
      border-radius: var(--r-xl);
      text-align: center;
      min-width: 90px;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid;
      box-shadow: var(--shadow-sm);
      transition: transform var(--dur-base) var(--ease-out);
    }
    .stat-card:hover { transform: translateY(-2px); }

    .stat-pending  {
      background: linear-gradient(135deg, #fffbeb, #fef3c7);
      border-color: #fde68a;
    }
    .stat-approved {
      background: linear-gradient(135deg, #f0fdf4, #dcfce7);
      border-color: #86efac;
    }
    .stat-total    {
      background: linear-gradient(135deg, #eef2ff, #e0e7ff);
      border-color: var(--brand-200);
    }

    .stat-value { font-size: 1.75rem; font-weight: 800; line-height: 1; }
    .stat-pending  .stat-value { color: #b45309; }
    .stat-approved .stat-value { color: var(--success-700); }
    .stat-total    .stat-value { color: var(--brand-700); }

    .stat-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-tertiary);
      margin-top: var(--sp-1);
    }

    /* ── Toolbar ── */
    .toolbar {
      display: flex;
      gap: var(--sp-4);
      flex-wrap: wrap;
      align-items: center;
      background: var(--glass-white);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,0.7);
      border-radius: var(--r-2xl);
      padding: var(--sp-4) var(--sp-5);
      box-shadow: var(--shadow-sm);
    }

    .search-wrapper {
      position: relative;
      flex: 1;
      min-width: 200px;
    }
    .search-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      pointer-events: none;
      color: var(--gray-400);
      display: inline-flex;
      align-items: center;
    }
    .search-input {
      width: 100%;
      padding: var(--sp-2) var(--sp-4) var(--sp-2) 36px;
      border: 1.5px solid var(--gray-200);
      border-radius: var(--r-full);
      font-size: var(--text-sm);
      font-family: var(--font-th);
      background: white;
      color: var(--gray-900);
      height: 40px;
      box-sizing: border-box;
      transition: all var(--dur-fast) var(--ease-out);
    }
    .search-input::placeholder { color: var(--gray-400); }
    .search-input:focus {
      outline: none;
      border-color: var(--brand-400);
      box-shadow: 0 0 0 3px rgba(30,63,128,0.12);
    }

    .tabs { display: flex; gap: var(--sp-2); flex-wrap: wrap; }

    .tab-btn {
      padding: var(--sp-2) var(--sp-4);
      border: 1.5px solid var(--gray-200);
      border-radius: var(--r-full);
      background: white;
      font-size: var(--text-sm);
      font-family: var(--font-th);
      font-weight: 600;
      cursor: pointer;
      transition: all var(--dur-fast) var(--ease-out);
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: var(--sp-2);
      height: 36px;
      white-space: nowrap;
    }
    .tab-btn:hover {
      border-color: var(--brand-300);
      color: var(--brand-600);
      background: var(--brand-50);
    }
    .tab-btn.active {
      background: var(--gradient-brand);
      color: white;
      border-color: transparent;
      box-shadow: var(--shadow-brand);
    }
    .tab-pending.active {
      background: linear-gradient(135deg, #f59e0b, #d97706);
      box-shadow: 0 4px 16px rgba(245,158,11,0.3);
    }

    .tab-badge {
      background: rgba(255,255,255,0.25);
      border-radius: 50%;
      min-width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 700;
      padding: 0 4px;
    }
    .tab-btn:not(.active) .tab-badge {
      background: #f59e0b;
      color: white;
    }

    /* ── Loading / Empty ── */
    .loading-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: var(--sp-16);
      background: var(--glass-white);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,0.7);
      border-radius: var(--r-2xl);
      gap: var(--sp-3);
    }
    .spinner {
      width: 36px; height: 36px;
      border: 3px solid var(--gray-200);
      border-top-color: var(--brand-500);
      border-radius: 50%;
      animation: spin 0.75s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loading-state p { margin: 0; color: var(--text-secondary); }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: var(--sp-16) var(--sp-6);
      background: var(--glass-white);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1.5px dashed var(--gray-200);
      border-radius: var(--r-2xl);
      text-align: center;
    }
    .empty-icon { width: 96px; height: 96px; margin: 0 auto var(--sp-4); border-radius: 50%; background: radial-gradient(circle at 30% 30%, var(--brand-100), var(--brand-50) 60%, transparent); display: inline-flex; align-items: center; justify-content: center; color: var(--brand-400); }
    .empty-state h3 { margin: 0 0 var(--sp-2); font-size: var(--text-lg); font-weight: 700; color: var(--gray-700); }
    .empty-state p  { margin: 0; color: var(--text-tertiary); font-size: var(--text-sm); }

    /* ── Teachers Grid ── */
    .teachers-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: var(--sp-5);
    }

    /* ── Teacher Card ── */
    .teacher-card {
      background: var(--glass-white);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,0.7);
      border-radius: var(--r-2xl);
      overflow: hidden;
      transition: all var(--dur-base) var(--ease-out);
      box-shadow: var(--shadow-sm);
    }
    .teacher-card:hover {
      box-shadow: var(--shadow-lg);
      transform: translateY(-3px);
      border-color: rgba(30,63,128,0.15);
    }

    .card-pending {
      border-color: rgba(245,158,11,0.25);
      background: linear-gradient(135deg, rgba(255,251,235,0.9), rgba(255,247,237,0.9));
    }
    .card-pending:hover {
      border-color: rgba(245,158,11,0.4);
      box-shadow: 0 8px 32px rgba(245,158,11,0.15), var(--shadow-md);
    }

    .card-header {
      display: flex;
      gap: var(--sp-3);
      align-items: flex-start;
      padding: var(--sp-4) var(--sp-5);
      border-bottom: 1px solid rgba(226,232,240,0.6);
    }

    .teacher-avatar {
      width: 48px; height: 48px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--brand-500), var(--accent-500));
      color: white;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; font-weight: 700;
      flex-shrink: 0;
      text-transform: uppercase;
      box-shadow: 0 4px 12px rgba(30,63,128,0.3);
    }
    .avatar-pending {
      background: linear-gradient(135deg, #f59e0b, #d97706) !important;
      box-shadow: 0 4px 12px rgba(245,158,11,0.35) !important;
    }

    .teacher-header-info { flex: 1; min-width: 0; }
    .teacher-name {
      margin: 0 0 var(--sp-2);
      font-size: var(--text-sm);
      font-weight: 700;
      color: var(--gray-900);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .teacher-meta { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }

    .status-badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 10px;
      border-radius: var(--r-full);
      font-size: 11px; font-weight: 600;
    }
    .badge-warning { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
    .badge-success { background: var(--success-50); color: var(--success-700); border: 1px solid var(--success-100); }

    .meta-date { font-size: 11px; color: var(--text-tertiary); }

    .card-content {
      padding: var(--sp-4) var(--sp-5);
      display: flex;
      flex-direction: column;
      gap: var(--sp-2);
    }

    .info-row { display: flex; gap: var(--sp-3); font-size: var(--text-xs); line-height: 1.6; align-items: flex-start; }
    .info-row .label { color: var(--text-tertiary); min-width: 100px; flex-shrink: 0; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; }
    .info-row .label svg { color: var(--brand-500); opacity: 0.75; flex-shrink: 0; }
    .status-badge { display: inline-flex; align-items: center; gap: 4px; }
    .btn-inline { display: inline-flex; align-items: center; gap: 6px; }
    .toast { display: inline-flex; align-items: center; gap: 8px; }
    .card-approved-footer { display: inline-flex; align-items: center; gap: 6px; justify-content: center; }
    .info-row .value { color: var(--gray-800); word-break: break-word; font-weight: 500; }
    .info-row .no-data { color: var(--text-tertiary); font-style: italic; }

    /* ── Card Actions ── */
    .card-actions {
      display: flex;
      gap: var(--sp-2);
      padding: var(--sp-3) var(--sp-4);
      border-top: 1px solid rgba(226,232,240,0.6);
      background: rgba(245,158,11,0.04);
    }

    .card-approved-footer {
      padding: var(--sp-3) var(--sp-4);
      border-top: 1px solid rgba(226,232,240,0.6);
      background: rgba(16,185,129,0.05);
      font-size: var(--text-sm);
      color: var(--success-700);
      font-weight: 600;
      text-align: center;
      letter-spacing: 0.01em;
    }

    .btn {
      flex: 1;
      padding: var(--sp-2) var(--sp-3);
      border: none;
      border-radius: var(--r-lg);
      font-size: var(--text-xs);
      font-weight: 700;
      cursor: pointer;
      transition: all var(--dur-base) var(--ease-out);
      font-family: var(--font-th);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--sp-1);
    }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none !important; }

    .btn-approve {
      background: linear-gradient(135deg, #10b981, #059669);
      color: white;
      box-shadow: 0 2px 8px rgba(16,185,129,0.3);
    }
    .btn-approve:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 4px 14px rgba(16,185,129,0.4);
      filter: brightness(1.05);
    }

    .btn-reject {
      background: var(--danger-50);
      color: var(--danger-600);
      border: 1.5px solid var(--danger-100);
    }
    .btn-reject:hover:not(:disabled) {
      background: var(--danger-500);
      color: white;
      border-color: transparent;
      box-shadow: 0 2px 8px rgba(244,63,94,0.3);
      transform: translateY(-1px);
    }

    /* ── Dialog ── */
    .dialog-overlay {
      position: fixed; inset: 0;
      background: rgba(15,23,42,0.6);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
      z-index: var(--z-modal);
      padding: var(--sp-4);
      animation: fadeIn 200ms ease;
    }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

    .dialog {
      background: white;
      border-radius: var(--r-3xl);
      max-width: 440px;
      width: 100%;
      box-shadow: var(--shadow-2xl), 0 0 0 1px rgba(30,63,128,0.08);
      animation: scaleIn 250ms var(--ease-spring);
      overflow: hidden;
    }
    @keyframes scaleIn { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: scale(1); } }

    .dialog-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: var(--sp-5) var(--sp-6);
      border-bottom: 1px solid var(--gray-100);
      background: linear-gradient(135deg, var(--gray-50) 0%, var(--brand-50) 100%);
    }
    .dialog-header h3 {
      margin: 0;
      font-size: var(--text-lg);
      font-weight: 700;
      color: var(--gray-900);
      letter-spacing: -0.02em;
    }
    .close-btn {
      width: 32px; height: 32px;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.06);
      border: none;
      border-radius: var(--r-md);
      font-size: 18px;
      cursor: pointer;
      color: var(--gray-500);
      transition: all var(--dur-fast);
    }
    .close-btn:hover { background: var(--gray-200); color: var(--gray-800); }

    .dialog-content { padding: var(--sp-6); }
    .dialog-content p {
      margin: 0 0 var(--sp-4);
      color: var(--text-secondary);
      font-size: var(--text-sm);
      line-height: 1.7;
    }
    .dialog-content p strong { color: var(--gray-900); font-weight: 700; }

    .reject-reason {
      width: 100%;
      padding: var(--sp-3) var(--sp-4);
      border: 1.5px solid var(--gray-200);
      border-radius: var(--r-lg);
      font-family: var(--font-th);
      font-size: var(--text-sm);
      resize: vertical;
      min-height: 88px;
      transition: all var(--dur-fast);
      box-sizing: border-box;
      color: var(--gray-900);
    }
    .reject-reason:focus {
      outline: none;
      border-color: var(--brand-400);
      box-shadow: 0 0 0 3px rgba(30,63,128,0.12);
    }

    .dialog-actions {
      display: flex; gap: var(--sp-3); justify-content: flex-end;
      padding: var(--sp-4) var(--sp-6);
      border-top: 1px solid var(--gray-100);
      background: var(--gray-50);
    }

    .btn-ghost {
      flex: none;
      padding: var(--sp-3) var(--sp-6);
      background: white;
      color: var(--text-secondary);
      border: 1.5px solid var(--gray-200);
      border-radius: var(--r-lg);
      font-size: var(--text-sm);
      font-weight: 600;
      cursor: pointer;
      transition: all var(--dur-fast);
      font-family: var(--font-th);
    }
    .btn-ghost:hover:not(:disabled) { background: var(--gray-100); border-color: var(--gray-300); }
    .btn-ghost:disabled { opacity: 0.55; }

    .dialog-actions .btn-reject {
      flex: none;
      padding: var(--sp-3) var(--sp-6);
      background: linear-gradient(135deg, #f43f5e, #e11d48);
      color: white;
      border: none;
      border-radius: var(--r-lg);
      font-size: var(--text-sm);
      font-weight: 700;
      box-shadow: 0 4px 16px rgba(244,63,94,0.35);
    }
    .dialog-actions .btn-reject:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(244,63,94,0.45);
    }

    /* ── Toast ── */
    .toast {
      position: fixed;
      bottom: var(--sp-6);
      right: var(--sp-6);
      padding: var(--sp-3) var(--sp-5);
      border-radius: var(--r-xl);
      font-size: var(--text-sm);
      font-weight: 600;
      z-index: var(--z-toast);
      box-shadow: var(--shadow-xl);
      animation: toastIn 300ms var(--ease-spring);
      display: flex; align-items: center; gap: var(--sp-2);
      min-width: 220px;
    }
    @keyframes toastIn { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: translateX(0); } }
    .toast-success { background: linear-gradient(135deg, #10b981, #059669); color: white; box-shadow: 0 8px 24px rgba(16,185,129,0.4); }
    .toast-error   { background: linear-gradient(135deg, #f43f5e, #e11d48); color: white; box-shadow: 0 8px 24px rgba(244,63,94,0.4); }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      .page-header { flex-direction: column; }
      .header-stats { width: 100%; justify-content: stretch; }
      .stat-card { flex: 1; min-width: auto; padding: var(--sp-3) var(--sp-3); }
      .toolbar { flex-direction: column; align-items: stretch; gap: var(--sp-3); padding: var(--sp-3) var(--sp-4); }
      .tabs { width: 100%; }
      .tab-btn { flex: 1; justify-content: center; }
      .teachers-grid { grid-template-columns: 1fr; }
      .header-left h1 { font-size: 1.5rem; }
      .toast { bottom: var(--sp-4); right: var(--sp-3); min-width: auto; max-width: calc(100vw - var(--sp-6)); }
    }
    @media (max-width: 480px) {
      .header-left h1 { font-size: 1.25rem; }
      .stat-value { font-size: 1.4rem; }
    }

    .loading-dots::after {
      content: '';
      animation: dots 1.2s steps(3, end) infinite;
    }
    @keyframes dots {
      0%   { content: ''; }
      33%  { content: '.'; }
      66%  { content: '..'; }
      100% { content: '...'; }
    }

    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(12px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* ════════════════════════════════════════════════════════
       Insights Banner
       ════════════════════════════════════════════════════════ */
    .insights-banner {
      display: flex;
      align-items: center;
      gap: var(--sp-4);
      padding: var(--sp-4) var(--sp-5);
      background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 60%, #fff 100%);
      border: 1px solid #fcd34d;
      border-radius: var(--r-2xl);
      box-shadow: 0 6px 18px rgba(245, 158, 11, .12);
      animation: fadeUp 320ms ease both;
    }
    .insights-icon {
      width: 44px; height: 44px;
      border-radius: 12px;
      background: linear-gradient(135deg, #f59e0b, #ef4444);
      color: #fff;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      box-shadow: 0 6px 14px rgba(245, 158, 11, .35);
    }
    .insights-body { flex: 1; min-width: 0; }
    .insights-title {
      font-size: var(--text-base);
      font-weight: 800;
      color: #7c2d12;
      letter-spacing: -0.01em;
    }
    .insights-meta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px; }
    .insights-chip {
      display: inline-flex; align-items: center; gap: 5px;
      background: rgba(255,255,255,.85);
      border: 1px solid #fde68a;
      color: #92400e;
      font-size: 11px;
      font-weight: 600;
      padding: 4px 9px;
      border-radius: 999px;
    }
    .insights-chip strong { color: #7c2d12; font-weight: 800; }
    .insights-jump {
      display: inline-flex; align-items: center; gap: 6px;
      background: linear-gradient(135deg, #f59e0b, #d97706);
      color: #fff;
      border: none;
      font-size: 12px;
      font-weight: 700;
      padding: 8px 14px;
      border-radius: 999px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(245, 158, 11, .35);
      transition: transform .18s ease, box-shadow .18s ease;
      flex-shrink: 0;
    }
    .insights-jump:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(245, 158, 11, .45); }

    /* Review button on cards */
    .btn-review {
      background: #fff;
      color: var(--gray-700);
      border: 1.5px solid var(--gray-200);
      flex: 0 0 56px !important;
    }
    .btn-review:hover:not(:disabled) {
      background: var(--gray-50);
      border-color: var(--gray-300);
      color: var(--gray-900);
    }

    /* ════════════════════════════════════════════════════════
       Review Drawer
       ════════════════════════════════════════════════════════ */
    .drawer-backdrop {
      position: fixed; inset: 0;
      background: rgba(15, 23, 42, .55);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      z-index: var(--z-modal);
      animation: fadeIn 220ms ease;
    }
    .review-drawer {
      position: fixed;
      top: 0; right: 0; bottom: 0;
      width: min(440px, 100vw);
      background: #fff;
      box-shadow: -16px 0 40px rgba(15, 23, 42, .15);
      z-index: calc(var(--z-modal) + 1);
      display: flex; flex-direction: column;
      overflow: hidden;
      animation: rdSlideIn 280ms cubic-bezier(.32, .72, .26, 1);
    }
    @keyframes rdSlideIn {
      from { transform: translateX(100%); }
      to   { transform: translateX(0); }
    }

    .rd-header {
      display: flex; align-items: center; gap: 12px;
      padding: 18px 20px;
      border-bottom: 1px solid var(--gray-100);
      background: linear-gradient(135deg, #fff 0%, var(--brand-50) 100%);
    }
    .rd-avatar {
      width: 48px; height: 48px;
      border-radius: 50%;
      background: linear-gradient(135deg, #f59e0b, #d97706);
      color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-weight: 800; font-size: 17px;
      flex-shrink: 0;
      box-shadow: 0 4px 12px rgba(245, 158, 11, .35);
    }
    .rd-id { flex: 1; min-width: 0; }
    .rd-name {
      font-size: 15px; font-weight: 800;
      color: var(--gray-900);
      letter-spacing: -0.01em;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .rd-status-row {
      display: flex; align-items: center; gap: 8px;
      margin-top: 4px;
      flex-wrap: wrap;
    }
    .rd-applied { font-size: 11px; color: var(--text-tertiary); }
    .rd-close {
      width: 32px; height: 32px;
      background: var(--gray-100);
      border: none;
      border-radius: 8px;
      cursor: pointer;
      color: var(--gray-600);
      display: flex; align-items: center; justify-content: center;
      transition: all .18s ease;
      flex-shrink: 0;
    }
    .rd-close:hover { background: var(--gray-200); color: var(--gray-900); }

    .rd-section {
      padding: 16px 20px;
      border-bottom: 1px solid var(--gray-100);
    }
    .rd-section-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-tertiary);
      margin: 0 0 10px;
    }

    /* Completeness */
    .rd-completeness { background: linear-gradient(180deg, #f8fafc 0%, #fff 100%); }
    .rd-comp-row {
      display: flex; justify-content: space-between; align-items: baseline;
      margin-bottom: 8px;
    }
    .rd-comp-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
    .rd-comp-num { font-size: 18px; font-weight: 800; color: var(--gray-900); letter-spacing: -0.02em; }
    .rd-comp-bar {
      width: 100%; height: 8px;
      background: var(--gray-100);
      border-radius: 999px;
      overflow: hidden;
    }
    .rd-comp-fill {
      height: 100%;
      background: linear-gradient(90deg, #f59e0b, #d97706);
      border-radius: inherit;
      transition: width .35s cubic-bezier(.4, 0, .2, 1);
    }
    .rd-comp-fill.rd-comp-warn { background: linear-gradient(90deg, #ef4444, #f43f5e); }
    .rd-comp-fill.rd-comp-ok { background: linear-gradient(90deg, #10b981, #059669); }
    .rd-comp-hint {
      display: flex; align-items: center; gap: 6px;
      margin-top: 10px;
      padding: 8px 10px;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 8px;
      font-size: 11px;
      color: #b91c1c;
      font-weight: 500;
    }

    /* Field rows */
    .rd-field {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 10px 0;
      border-bottom: 1px dashed var(--gray-100);
    }
    .rd-field:last-child { border-bottom: none; }
    .rd-field-icon {
      width: 32px; height: 32px;
      border-radius: 8px;
      background: var(--brand-50);
      color: var(--brand-600);
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .rd-field-body { flex: 1; min-width: 0; }
    .rd-field-label {
      font-size: 11px; font-weight: 600;
      color: var(--text-tertiary);
      margin-bottom: 2px;
    }
    .rd-field-value {
      font-size: 13px; font-weight: 600;
      color: var(--gray-900);
      word-break: break-word;
    }
    .rd-field-empty .rd-field-icon { background: var(--gray-100); color: var(--gray-400); }
    .rd-field-empty .rd-field-value { color: var(--text-tertiary); font-weight: 500; font-style: italic; }

    /* Footer */
    .rd-footer {
      display: flex; gap: 8px;
      padding: 14px 20px;
      border-top: 1px solid var(--gray-100);
      background: var(--gray-50);
      margin-top: auto;
    }
    .rd-btn {
      flex: 1;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      padding: 11px 16px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      border: none;
      transition: all .18s ease;
      font-family: var(--font-th);
    }
    .rd-btn:disabled { opacity: .5; cursor: not-allowed; }
    .rd-btn-approve {
      background: linear-gradient(135deg, #10b981, #059669);
      color: #fff;
      flex: 1.5;
      box-shadow: 0 4px 12px rgba(16, 185, 129, .3);
    }
    .rd-btn-approve:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(16, 185, 129, .4); }
    .rd-btn-reject {
      background: #fff;
      color: var(--danger-600);
      border: 1.5px solid var(--danger-100);
    }
    .rd-btn-reject:hover:not(:disabled) {
      background: var(--danger-500);
      color: #fff;
      border-color: transparent;
    }

    @media (max-width: 768px) {
      .insights-banner { flex-direction: column; align-items: stretch; text-align: left; }
      .insights-jump { align-self: flex-start; }
      .review-drawer { width: 100vw; }
    }
  `]
})
export class TeacherApprovalComponent implements OnInit, OnDestroy {
  allTeachers: IUser[]     = [];
  pendingTeachers: IUser[] = [];
  approvedTeachers: IUser[] = [];
  displayedTeachers: IUser[] = [];

  loading = true;
  activeTab: 'all' | 'pending' | 'approved' = 'pending';
  searchTerm = '';

  processingId: string | null = null;
  successMessage = '';
  errorMessage = '';
  showRejectDialog = false;
  selectedTeacher: IUser | null = null;
  rejectReason = '';

  // Review drawer
  showReviewDrawer = false;
  reviewTeacher: IUser | null = null;

  private destroy$ = new Subject<void>();
  private toastTimer: any;

  constructor(private userService: UserService) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    clearTimeout(this.toastTimer);
  }

  ngOnInit(): void {
    this.loadAllTeachers();
  }

  loadAllTeachers(): void {
    this.loading = true;
    this.userService.getTeachers()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
      next: (res) => {
        this.allTeachers     = res.data || [];
        this.pendingTeachers = this.allTeachers.filter(t => t.registrationStatus === 'unregistered');
        this.approvedTeachers = this.allTeachers.filter(t => t.registrationStatus === 'registered');
        this.applyFilters();
        this.loading = false;
      },
      error: () => {
        this.showToast('ไม่สามารถโหลดข้อมูลครูได้', 'error');
        this.loading = false;
      }
    });
  }

  setTab(tab: 'all' | 'pending' | 'approved'): void {
    this.activeTab = tab;
    this.applyFilters();
  }

  applyFilters(): void {
    let base: IUser[];
    if      (this.activeTab === 'pending')  base = this.pendingTeachers;
    else if (this.activeTab === 'approved') base = this.approvedTeachers;
    else                                     base = this.allTeachers;

    const term = this.searchTerm.toLowerCase().trim();
    this.displayedTeachers = term
      ? base.filter(t =>
          `${t.firstName} ${t.lastName}`.toLowerCase().includes(term) ||
          t.email.toLowerCase().includes(term))
      : [...base];
  }

  approveTeacher(teacher: IUser): void {
    this.processingId = teacher.id;
    this.userService.approveTeacher(teacher.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
      next: (res) => {
        this.updateTeacherInLists(res.data);
        this.applyFilters();
        this.processingId = null;
        this.showToast('อนุมัติครูสำเร็จ', 'success');
      },
      error: (err) => {
        this.showToast(err?.error?.message || 'เกิดข้อผิดพลาดในการอนุมัติ', 'error');
        this.processingId = null;
      }
    });
  }

  openRejectDialog(teacher: IUser): void {
    this.selectedTeacher = teacher;
    this.rejectReason = '';
    this.showRejectDialog = true;
  }

  closeRejectDialog(): void {
    this.showRejectDialog = false;
    this.selectedTeacher = null;
    this.rejectReason = '';
  }

  confirmRejectTeacher(): void {
    if (!this.selectedTeacher) return;
    this.processingId = this.selectedTeacher.id;
    this.userService.rejectTeacher(this.selectedTeacher.id, this.rejectReason)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
      next: () => {
        // Remove from all lists
        this.allTeachers      = this.allTeachers.filter(t => t.id !== this.selectedTeacher!.id);
        this.pendingTeachers  = this.pendingTeachers.filter(t => t.id !== this.selectedTeacher!.id);
        this.approvedTeachers = this.approvedTeachers.filter(t => t.id !== this.selectedTeacher!.id);
        this.applyFilters();
        this.processingId = null;
        this.closeRejectDialog();
        this.showToast('ปฏิเสธคำขอสำเร็จ', 'success');
      },
      error: (err) => {
        this.showToast(err?.error?.message || 'เกิดข้อผิดพลาดในการปฏิเสธ', 'error');
        this.processingId = null;
      }
    });
  }

  private updateTeacherInLists(updated: IUser): void {
    const replaceIn = (arr: IUser[]) => {
      const idx = arr.findIndex(t => t.id === updated.id);
      if (idx !== -1) arr[idx] = updated;
    };
    replaceIn(this.allTeachers);
    this.pendingTeachers  = this.allTeachers.filter(t => t.registrationStatus === 'unregistered');
    this.approvedTeachers = this.allTeachers.filter(t => t.registrationStatus === 'registered');
  }

  private showToast(message: string, type: 'success' | 'error'): void {
    clearTimeout(this.toastTimer);
    if (type === 'success') {
      this.successMessage = message;
      this.errorMessage   = '';
    } else {
      this.errorMessage   = message;
      this.successMessage = '';
    }
    this.toastTimer = setTimeout(() => {
      this.successMessage = '';
      this.errorMessage   = '';
    }, 3500);
  }

  getInitials(firstName?: string, lastName?: string): string {
    return ((firstName || '').charAt(0) + (lastName || '').charAt(0)).toUpperCase() || 'U';
  }

  // ── Review Drawer ─────────────────────────────────────────
  openReviewDrawer(teacher: IUser): void {
    this.reviewTeacher = teacher;
    this.showReviewDrawer = true;
  }

  closeReviewDrawer(): void {
    this.showReviewDrawer = false;
    this.reviewTeacher = null;
  }

  /** Human-friendly relative time since registration */
  getDaysSinceApply(teacher: IUser | null): number {
    if (!teacher?.createdAt) return 0;
    const ms = Date.now() - new Date(teacher.createdAt).getTime();
    return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
  }

  /** Score completeness of teacher profile (0-100) */
  getProfileCompleteness(t: IUser | null): number {
    if (!t) return 0;
    const fields = [t.firstName, t.lastName, t.email, t.phone, t.university, t.lineId, t.paymentChannel];
    const filled = fields.filter(f => !!f && String(f).trim().length > 0).length;
    return Math.round((filled / fields.length) * 100);
  }

  /** Summary insights */
  get approvalInsights(): { applied7d: number; oldestPendingDays: number; completionAvg: number } {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const applied7d = this.allTeachers.filter(t =>
      t.createdAt && new Date(t.createdAt).getTime() >= sevenDaysAgo
    ).length;
    let oldestPendingDays = 0;
    for (const t of this.pendingTeachers) {
      const d = this.getDaysSinceApply(t);
      if (d > oldestPendingDays) oldestPendingDays = d;
    }
    const total = this.pendingTeachers.length;
    const avg = total === 0 ? 0 : Math.round(
      this.pendingTeachers.reduce((s, t) => s + this.getProfileCompleteness(t), 0) / total
    );
    return { applied7d, oldestPendingDays, completionAvg: avg };
  }
}
