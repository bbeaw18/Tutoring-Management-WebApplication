import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { guestGuard } from './guards/guest.guard';
import { roleGuard } from './guards/role.guard';
import { LoginComponent } from './pages/auth/login/login.component';
import { RegisterComponent } from './pages/auth/register/register.component';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { VideoReplayComponent } from './pages/student/video-replay/video-replay.component';
import { PaymentComponent } from './pages/student/payment/payment.component';
import { StudentNotificationsComponent } from './pages/student/student-notifications/student-notifications.component';
import { StudentCalendarComponent } from './pages/student/student-calendar/student-calendar.component';
import { StudentCoursesComponent } from './pages/student/student-courses/student-courses.component';
import { TeacherCalendarComponent } from './pages/teacher/teacher-calendar/teacher-calendar.component';
import { IncomeComponent } from './pages/teacher/income/income.component';
import { TeacherProfileComponent } from './pages/teacher/teacher-profile/teacher-profile.component';
import { ManagerCalendarComponent } from './pages/manager/manager-calendar/manager-calendar.component';
import { CourseManagementComponent } from './pages/manager/course-management/course-management.component';
import { RevenueComponent } from './pages/manager/revenue/revenue.component';
import { VideoManagementComponent } from './pages/manager/video-management/video-management.component';
import { VdoOnlineComponent } from './pages/manager/vdo-online/vdo-online.component';
import { StaffListComponent } from './pages/manager/staff-list/staff-list.component';
import { TeacherApprovalComponent } from './pages/manager/teacher-approval/teacher-approval.component';
import { QrDisplayComponent } from './pages/shared/qr-display/qr-display.component';
import { HistoryComponent } from './pages/shared/history/history.component';
import { ScanComponent } from './pages/shared/scan/scan.component';
import { HomeRedirectComponent } from './pages/shared/home-redirect/home-redirect.component';
import { DashboardHomeComponent } from './pages/shared/dashboard-home/dashboard-home.component';
import { MyProfileComponent } from './pages/shared/my-profile/my-profile.component';

export const appRoutes: Routes = [
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
  { path: 'login', component: LoginComponent, canActivate: [guestGuard] },
  { path: 'register', component: RegisterComponent, canActivate: [guestGuard] },

  // ─── QR Scan: นักเรียนสแกนแล้วเปิด URL นี้ → เช็คชื่ออัตโนมัติ ───────────
  { path: 'scan', component: ScanComponent, canActivate: [authGuard] },
  {
    path: 'dashboard',
    component: DashboardComponent,
    canActivate: [authGuard],
    children: [
      // Default child — แสดง Dashboard Home overview ทันที
      {
        path: '',
        component: DashboardHomeComponent,
        pathMatch: 'full'
      },

      // ─── Student ──────────────────────────────────────────────
      {
        path: 'payments',
        component: PaymentComponent,
        canActivate: [roleGuard],
        data: { roles: ['student'] }
      },
      {
        path: 'notifications',
        component: StudentNotificationsComponent,
        canActivate: [roleGuard],
        data: { roles: ['student'] }
      },
      {
        path: 'calendar',
        component: StudentCalendarComponent,
        canActivate: [roleGuard],
        data: { roles: ['student'] }
      },
      {
        path: 'my-courses',
        component: StudentCoursesComponent,
        canActivate: [roleGuard],
        data: { roles: ['student'] }
      },

      // ─── Teacher ──────────────────────────────────────────────
      {
        path: 'teacher-calendar',
        component: TeacherCalendarComponent,
        canActivate: [roleGuard],
        data: { roles: ['teacher'] }
      },
      {
        path: 'income',
        component: IncomeComponent,
        canActivate: [roleGuard],
        data: { roles: ['teacher'] }
      },
      {
        path: 'teacher-profile',
        component: TeacherProfileComponent,
        canActivate: [roleGuard],
        data: { roles: ['teacher'] }
      },
      // ─── ประวัติส่วนตัว (ทุก role) ─────────────────────────────
      {
        path: 'profile',
        component: MyProfileComponent,
        data: { roles: ['admin', 'manager', 'teacher', 'student'] }
      },

      // ─── Manager ──────────────────────────────────────────────
      {
        path: 'manager-calendar',
        component: ManagerCalendarComponent,
        canActivate: [roleGuard],
        data: { roles: ['manager', 'admin'] }
      },
      {
        path: 'course-management',
        component: CourseManagementComponent,
        canActivate: [roleGuard],
        data: { roles: ['manager', 'admin'] }
      },
      {
        path: 'revenue',
        component: RevenueComponent,
        canActivate: [roleGuard],
        data: { roles: ['manager', 'admin'] }
      },
      {
        path: 'video-management',
        component: VideoManagementComponent,
        canActivate: [roleGuard],
        data: { roles: ['manager', 'admin'] }
      },
      {
        path: 'vdo-online',
        component: VdoOnlineComponent,
        canActivate: [roleGuard],
        data: { roles: ['manager', 'admin'] }
      },
      {
        path: 'staff',
        component: StaffListComponent,
        canActivate: [roleGuard],
        data: { roles: ['manager', 'admin'] }
      },
      {
        path: 'teacher-approval',
        component: TeacherApprovalComponent,
        canActivate: [roleGuard],
        data: { roles: ['admin', 'manager'] }
      },

      // ─── Shared (teacher + manager) — QR Display ─────────────
      {
        path: 'qr-display/:id',
        component: QrDisplayComponent,
        canActivate: [roleGuard],
        data: { roles: ['teacher', 'manager', 'admin'] }
      },

      // ─── Shared (all roles) — History ────────────────────────
      {
        path: 'history',
        component: HistoryComponent,
        canActivate: [authGuard]
      }
    ]
  },
  { path: '**', redirectTo: '/dashboard' }
];
