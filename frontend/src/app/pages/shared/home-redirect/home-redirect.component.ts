import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../services/auth.service';

/**
 * Component กลาง — พา user ไปหน้าที่ถูกต้องตาม role
 * ใช้เป็น default child route ของ /dashboard
 * แก้บัค: user เข้า /dashboard แล้วเห็นหน้าว่าง ไม่รู้จะทำอะไร
 */
@Component({
  standalone: true,
  template: ''   // ไม่แสดง UI — redirect ทันที
})
export class HomeRedirectComponent implements OnInit {
  constructor(private authService: AuthService, private router: Router) {}

  ngOnInit(): void {
    const role = this.authService.getUserRole();
    const roleRoutes: Record<string, string> = {
      student: '/dashboard/calendar',
      teacher: '/dashboard/teacher-calendar',
      manager: '/dashboard/manager-calendar',
      admin:   '/dashboard/manager-calendar'
    };
    const target = roleRoutes[role || ''] || '/dashboard/calendar';
    this.router.navigate([target], { replaceUrl: true });
  }
}
