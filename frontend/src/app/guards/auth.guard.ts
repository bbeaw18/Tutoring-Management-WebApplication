import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isLoggedIn()) {
    return true;
  }

  // L1: คืนค่า UrlTree แทน router.navigate() + return false
  // UrlTree เป็นวิธีที่ Angular แนะนำ — router จะ redirect atomic
  // ไม่มีช่องโหว่ที่ component จะ render ค้างชั่วครู่
  //
  // รักษา returnUrl เฉพาะ QR scan flow เพื่อให้นักเรียนสแกน QR
  // แล้วกลับมาเช็คชื่อได้หลังล็อคอิน
  if (state.url.startsWith('/scan')) {
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  }
  return router.createUrlTree(['/login']);
};
