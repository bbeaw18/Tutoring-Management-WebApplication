import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const roleGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isLoggedIn()) {
    router.navigate(['/login']);
    return false;
  }

  const allowedRoles = route.data['roles'] as string[];
  const userRole = authService.getUserRole();

  // H1: ถ้า userRole เป็น null (token ผิดปกติ / decode ไม่ได้) → ปฏิเสธทันที
  // ไม่ใช้ non-null assertion (userRole!) ที่อาจทำให้ crash ได้
  if (!userRole) {
    router.navigate(['/login']);
    return false;
  }

  if (allowedRoles && allowedRoles.includes(userRole)) {
    return true;
  }

  router.navigate(['/dashboard']);
  return false;
};
