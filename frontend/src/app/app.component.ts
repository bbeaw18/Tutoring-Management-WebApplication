import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { Subject } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  template: '<router-outlet></router-outlet>',
  styles: []
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'KMS Web Application';
  private tokenCheckInterval: any = null;
  private isCheckingToken = false;   // M4: กัน race — interval fire ซ้อน
  private currentUrl = '';
  private destroy$ = new Subject<void>();

  constructor(private authService: AuthService, private router: Router) {}

  ngOnInit(): void {
    // ตรวจสอบ route ปัจจุบัน — กัน logout ซ้ำเมื่อ user อยู่หน้า login/register/otp แล้ว
    this.currentUrl = this.router.url;
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd), takeUntil(this.destroy$))
      .subscribe((e: any) => { this.currentUrl = e.urlAfterRedirects || e.url || ''; });

    // M4: ตรวจสอบ token expiry ทุก 1 นาที — auto logout เมื่อ session หมด 12 ชม.
    // ป้องกัน race: (1) ใช้ flag กัน re-entry, (2) ข้ามเมื่อ user อยู่หน้า auth อยู่แล้ว
    this.tokenCheckInterval = setInterval(() => {
      if (this.isCheckingToken) return;          // กัน interval fire ซ้อน
      this.isCheckingToken = true;
      try {
        // ข้ามถ้า user อยู่หน้า auth อยู่แล้ว (ไม่ต้อง logout ซ้ำ)
        const authPages = ['/login', '/register', '/otp-verify', '/totp-setup', '/forgot-password'];
        if (authPages.some(p => this.currentUrl.startsWith(p))) return;

        // atomic check: ถ้ามี token แต่หมดอายุ → logout
        const token = this.authService.getToken();
        if (token && this.authService.isTokenExpired()) {
          console.log('[Auth] Token expired — logging out automatically');
          this.authService.logout();
        }
      } finally {
        this.isCheckingToken = false;
      }
    }, 60 * 1000);
  }

  ngOnDestroy(): void {
    if (this.tokenCheckInterval) {
      clearInterval(this.tokenCheckInterval);
      this.tokenCheckInterval = null;
    }
    this.destroy$.next();
    this.destroy$.complete();
  }
}
