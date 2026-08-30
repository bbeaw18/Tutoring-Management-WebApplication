import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { HeaderComponent } from '../../shared/components/header/header.component';
import { SidebarComponent } from '../../shared/components/sidebar/sidebar.component';
import { TermsAgreementComponent } from '../../shared/components/terms-agreement/terms-agreement.component';
import { AuthService } from '../../services/auth.service';
import { IUser } from '../../interfaces/user.interface';
import { TermsDocument, getRequiredTermsForRole, TERMS_VERSION } from '../../shared/constants/terms';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterOutlet, HeaderComponent, SidebarComponent, TermsAgreementComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit, OnDestroy {
  sidebarOpen = false;
  sidebarCollapsed = false;
  currentUser: IUser | null = null;

  // ── ข้อตกลงการใช้บริการ ──
  termsDoc: TermsDocument | null = null;   // เอกสารที่ต้องแสดง (null = ไม่ต้องแสดง)
  submittingTerms = false;

  private destroy$ = new Subject<void>();

  constructor(private authService: AuthService) {}

  ngOnInit(): void {
    this.authService.currentUser$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(user => {
      this.currentUser = user;
      this.evaluateTerms(user);
    });
  }

  /** หาชุดข้อตกลงถัดไปที่ยังไม่ยอมรับฉบับปัจจุบัน (admin/manager มี 2 ชุด แสดงทีละชุด) */
  private evaluateTerms(user: IUser | null): void {
    if (!user) {
      this.termsDoc = null;
      return;
    }
    const pending = getRequiredTermsForRole(user.role).filter(
      doc => user.acceptedTerms?.[doc.docType]?.version !== TERMS_VERSION
    );
    this.termsDoc = pending[0] || null;
  }

  onAcceptTerms(): void {
    if (!this.termsDoc) return;
    this.submittingTerms = true;
    // เมื่อสำเร็จ currentUser$ จะอัปเดต → evaluateTerms รันใหม่ → แสดงชุดถัดไปหรือปิด
    this.authService.acceptTerms(this.termsDoc.docType, TERMS_VERSION).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => { this.submittingTerms = false; },
      error: () => { this.submittingTerms = false; }
    });
  }

  onDeclineTerms(): void {
    this.authService.logout();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen;
  }

  closeSidebar(): void {
    this.sidebarOpen = false;
  }

  toggleSidebarCollapse(collapsed: boolean): void {
    this.sidebarCollapsed = collapsed;
  }
}
