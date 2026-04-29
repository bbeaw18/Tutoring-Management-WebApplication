import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

@Injectable()
export class ErrorInterceptor implements HttpInterceptor {
  // ป้องกัน toast 429 แสดงซ้ำกันถี่ ๆ (rate limit มักจะโดนหลาย request พร้อม ๆ กัน)
  private last429Alert = 0;

  constructor(private authService: AuthService) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    return next.handle(req).pipe(
      catchError((error: HttpErrorResponse) => {
        if (error.status === 401) {
          // ไม่ logout ถ้าเป็น auth endpoint เอง (login / register / verify-totp)
          // เพราะ error เหล่านี้หมายถึง credentials ผิด ไม่ใช่ session หมดอายุ
          const isAuthEndpoint = req.url.includes('/auth/login')
            || req.url.includes('/auth/register')
            || req.url.includes('/auth/verify-totp');

          // ตรวจสอบว่ายังมี token อยู่ก่อน logout
          // กันกรณี HTTP request ที่ค้างอยู่ (in-flight) กลับมาด้วย 401
          // หลังจาก logout ไปแล้ว — ป้องกันไม่ให้ลบ tempUserId ระหว่าง OTP flow
          const hasToken = !!this.authService.getToken();

          if (!isAuthEndpoint && hasToken) {
            this.authService.logout();  // มี _isLoggingOut guard อยู่แล้ว
          }
        }

        // ── Rate limit (429 Too Many Requests) ────────────────────────────
        // ไม่ logout — แค่แจ้งผู้ใช้ว่าระบบกำลังคับคั่ง กรุณารอสักครู่
        // ปัญหาที่เคยเกิด: UI เพี้ยน/หายเพราะ component โหลดข้อมูลไม่ได้
        if (error.status === 429) {
          const now = Date.now();
          // แสดง alert ได้ทุก 10 วินาที (กันสแปม)
          if (now - this.last429Alert > 10000) {
            this.last429Alert = now;
            console.warn('[RateLimit] HTTP 429:', error.error?.message || 'Too many requests');
            // ใช้ setTimeout เพื่อไม่ block interceptor pipeline
            setTimeout(() => {
              alert('ระบบกำลังใช้งานหนาแน่น กรุณารอสักครู่แล้วลองใหม่ (Rate limit exceeded)');
            }, 0);
          }
        }

        // Re-throw original HttpErrorResponse เพื่อให้ component อ่าน
        // error.error?.message, error.status ได้ตามปกติ
        return throwError(() => error);
      })
    );
  }
}
