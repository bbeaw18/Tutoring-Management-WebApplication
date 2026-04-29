import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from '../../../services/auth.service';
import { CourseService } from '../../../services/course.service';
import { PaymentService } from '../../../services/payment.service';
import { NotificationService } from '../../../services/notification.service';
import { ScheduleService } from '../../../services/schedule.service';
import { IUser } from '../../../interfaces/user.interface';

interface QuickStat {
  label: string;
  value: string | number;
  sub?: string;
  icon: string;
  color: 'brand' | 'success' | 'warning' | 'danger' | 'info';
}

interface QuickAction {
  label: string;
  desc: string;
  icon: string;
  route: string;
  color: string;
}

@Component({
  selector: 'app-dashboard-home',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard-home.component.html',
  styleUrls: ['./dashboard-home.component.css']
})
export class DashboardHomeComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  currentUser: IUser | null = null;
  greeting = '';
  greetingIcon = ''; // SVG string
  tipOfDay = '';
  loading = true;

  stats: QuickStat[] = [];
  actions: QuickAction[] = [];

  upcomingItems: any[] = [];
  recentNotifications: any[] = [];
  todaySchedules: any[] = [];
  nextFocus: any = null;

  today = new Date();
  currentHourPct = 0; // 0..100 for today's timeline "now" indicator
  readonly DAY_START_HOUR = 8;
  readonly DAY_END_HOUR = 21;

  constructor(
    private authService: AuthService,
    private courseService: CourseService,
    private paymentService: PaymentService,
    private notificationService: NotificationService,
    private scheduleService: ScheduleService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();
    this.buildGreeting();
    this.buildActions();
    this.loadData();
    this.updateNowIndicator();
    setInterval(() => this.updateNowIndicator(), 60_000);
  }

  updateNowIndicator(): void {
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const startM = this.DAY_START_HOUR * 60;
    const endM   = this.DAY_END_HOUR * 60;
    const pct = ((mins - startM) / (endM - startM)) * 100;
    this.currentHourPct = Math.max(0, Math.min(100, pct));
  }

  getEventLeftPct(item: any): number {
    const t = (item.startTime || '').split(':');
    if (t.length < 2) return 0;
    const mins = Number(t[0]) * 60 + Number(t[1]);
    const startM = this.DAY_START_HOUR * 60;
    const endM = this.DAY_END_HOUR * 60;
    return Math.max(0, Math.min(95, ((mins - startM) / (endM - startM)) * 100));
  }

  getEventWidthPct(item: any): number {
    const s = (item.startTime || '').split(':');
    const e = (item.endTime   || '').split(':');
    if (s.length < 2 || e.length < 2) return 4;
    const sMin = Number(s[0]) * 60 + Number(s[1]);
    const eMin = Number(e[0]) * 60 + Number(e[1]);
    const dur = Math.max(30, eMin - sMin);
    const spanMin = (this.DAY_END_HOUR - this.DAY_START_HOUR) * 60;
    return Math.min(40, (dur / spanMin) * 100);
  }

  isToday(d: any): boolean {
    if (!d) return false;
    const dt = new Date(d);
    const t = new Date();
    return dt.getFullYear() === t.getFullYear() && dt.getMonth() === t.getMonth() && dt.getDate() === t.getDate();
  }

  computeTodayAndNext(list: any[]): void {
    const now = new Date();
    // today's schedules
    this.todaySchedules = list
      .filter(s => s.date && this.isToday(s.date))
      .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

    // next upcoming (future or today after now)
    const future = list
      .filter(s => {
        if (!s.date) return false;
        const d = new Date(s.date);
        if (d > now) return true;
        if (this.isToday(s.date) && s.endTime) {
          const [h,m] = s.endTime.split(':').map(Number);
          const endDt = new Date(s.date); endDt.setHours(h, m, 0, 0);
          return endDt > now;
        }
        return false;
      })
      .sort((a, b) => {
        const A = new Date(a.date).getTime() + this.toMinutes(a.startTime) * 60_000;
        const B = new Date(b.date).getTime() + this.toMinutes(b.startTime) * 60_000;
        return A - B;
      });
    this.nextFocus = future[0] || null;
  }

  private toMinutes(t: string | undefined): number {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  getMinutesUntil(item: any): string {
    if (!item?.date || !item?.startTime) return '';
    const [h, m] = item.startTime.split(':').map(Number);
    const dt = new Date(item.date); dt.setHours(h, m, 0, 0);
    const diff = dt.getTime() - Date.now();
    if (diff <= 0) return 'กำลังดำเนินการ';
    const mins = Math.round(diff / 60_000);
    if (mins < 60) return `อีก ${mins} นาที`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `อีก ${hrs} ชม. ${mins % 60} นาที`;
    const days = Math.floor(hrs / 24);
    return `อีก ${days} วัน`;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  buildGreeting(): void {
    const hour = new Date().getHours();
    const ICON_SUNRISE = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/><line x1="23" y1="22" x2="1" y2="22"/><polyline points="8 6 12 2 16 6"/></svg>`;
    const ICON_SUN     = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
    const ICON_MOON    = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
    const tips = [
      'ทุกก้าวเล็กๆ คือความก้าวหน้าครั้งใหญ่',
      'พักสักนิด หายใจลึกๆ แล้วลุยต่อ',
      'วันนี้คือโอกาสใหม่ในการเรียนรู้',
      'ความสำเร็จเริ่มจากการลงมือทำ',
      'เรียนรู้ทุกวัน เติบโตทุกวัน',
    ];
    this.tipOfDay = tips[new Date().getDate() % tips.length];
    if (hour < 12) {
      this.greeting = 'อรุณสวัสดิ์';
      this.greetingIcon = ICON_SUNRISE;
    } else if (hour < 17) {
      this.greeting = 'สวัสดีตอนบ่าย';
      this.greetingIcon = ICON_SUN;
    } else {
      this.greeting = 'สวัสดีตอนเย็น';
      this.greetingIcon = ICON_MOON;
    }
  }

  buildActions(): void {
    const role = this.currentUser?.role;
    if (role === 'student') {
      this.actions = [
        { label: 'นัดสอนของฉัน', desc: 'ดูรายการนัดสอนทั้งหมด', icon: ICONS.book, route: '/dashboard/my-courses', color: 'brand' },
        { label: 'ปฏิทิน', desc: 'ตารางเรียนรายสัปดาห์', icon: ICONS.calendar, route: '/dashboard/calendar', color: 'info' },
        { label: 'ชำระเงิน', desc: 'ตรวจสอบและชำระค่าเรียน', icon: ICONS.payment, route: '/dashboard/payments', color: 'success' },
        { label: 'การแจ้งเตือน', desc: 'ข้อความและการอัปเดต', icon: ICONS.bell, route: '/dashboard/notifications', color: 'warning' },
      ];
    } else if (role === 'teacher') {
      this.actions = [
        { label: 'ปฏิทินสอน', desc: 'ตารางสอนรายสัปดาห์', icon: ICONS.calendar, route: '/dashboard/teacher-calendar', color: 'brand' },
        { label: 'คลาสของฉัน', desc: 'รายการคลาสที่รับผิดชอบ', icon: ICONS.book, route: '/dashboard/teacher-courses', color: 'info' },
        { label: 'ประวัติชั่วโมง', desc: 'สรุปชั่วโมงการสอน', icon: ICONS.clock, route: '/dashboard/teacher-profile', color: 'success' },
        { label: 'ประวัติการสอน', desc: 'บันทึกคลาสที่ผ่านมา', icon: ICONS.history, route: '/dashboard/history', color: 'warning' },
      ];
    } else {
      this.actions = [
        { label: 'ปฏิทินมาสเตอร์', desc: 'ตารางเรียนทุกคลาส', icon: ICONS.calendar, route: '/dashboard/manager-calendar', color: 'brand' },
        { label: 'จัดการรายวิชา', desc: 'เพิ่ม/แก้ไข/ลบคลาส', icon: ICONS.book, route: '/dashboard/course-management', color: 'info' },
        { label: 'รายได้', desc: 'สถิติและรายงานการเงิน', icon: ICONS.revenue, route: '/dashboard/revenue', color: 'success' },
        { label: 'บุคลากร', desc: 'จัดการครูและนักเรียน', icon: ICONS.people, route: '/dashboard/staff', color: 'warning' },
        { label: 'อนุมัติครู', desc: 'ตรวจสอบและอนุมัติ', icon: ICONS.check, route: '/dashboard/teacher-approval', color: 'danger' },
        { label: 'VDO Online', desc: 'จัดการวิดีโอออนไลน์', icon: ICONS.video, route: '/dashboard/vdo-online', color: 'brand' },
      ];
    }
  }

  loadData(): void {
    const role = this.currentUser?.role;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const notif$ = this.notificationService.getNotifications().pipe(catchError(() => of({ data: [] })));

    if (role === 'student') {
      forkJoin({
        courses: this.courseService.getCourses().pipe(catchError(() => of({ data: [] }))),
        payments: this.paymentService.getPayments({ limit: 50 } as any).pipe(catchError(() => of({ data: [] }))),
        notifs: notif$
      }).pipe(takeUntil(this.destroy$)).subscribe(({ courses, payments, notifs }) => {
        const courseList = (courses as any).data || [];
        const paymentList = (payments as any).data || [];
        const pending = paymentList.filter((p: any) => p.status === 'pending').length;
        const paid    = paymentList.filter((p: any) => p.status === 'confirmed').length;

        this.stats = [
          { label: 'นัดสอนทั้งหมด', value: courseList.length, sub: 'คลาส', icon: ICONS.book, color: 'brand' },
          { label: 'รอชำระเงิน', value: pending, sub: 'รายการ', icon: ICONS.payment, color: pending > 0 ? 'warning' : 'success' },
          { label: 'ชำระแล้ว', value: paid, sub: 'รายการ', icon: ICONS.check, color: 'success' },
          { label: 'การแจ้งเตือน', value: ((notifs as any).data || []).filter((n: any) => !n.isRead).length, sub: 'ยังไม่อ่าน', icon: ICONS.bell, color: 'info' },
        ];

        this.recentNotifications = ((notifs as any).data || []).slice(0, 4);
        this.upcomingItems = courseList.filter((c: any) => c.status === 'approved' || c.status === 'active').slice(0, 4);
        this.computeTodayAndNext(courseList);
        this.loading = false;
      });

    } else if (role === 'teacher') {
      forkJoin({
        courses: this.courseService.getCourses().pipe(catchError(() => of({ data: [] }))),
        notifs: notif$
      }).pipe(takeUntil(this.destroy$)).subscribe(({ courses, notifs }) => {
        const list = (courses as any).data || [];
        const pending  = list.filter((c: any) => c.status === 'pending').length;
        const active   = list.filter((c: any) => c.status === 'active' || c.status === 'approved').length;

        this.stats = [
          { label: 'คลาสทั้งหมด', value: list.length, sub: 'คลาส', icon: ICONS.book, color: 'brand' },
          { label: 'รอยืนยัน', value: pending, sub: 'คลาส', icon: ICONS.clock, color: pending > 0 ? 'warning' : 'success' },
          { label: 'กำลังสอน', value: active, sub: 'คลาส', icon: ICONS.check, color: 'success' },
          { label: 'การแจ้งเตือน', value: ((notifs as any).data || []).filter((n: any) => !n.isRead).length, sub: 'ใหม่', icon: ICONS.bell, color: 'info' },
        ];

        this.upcomingItems = list.filter((c: any) => c.status !== 'cancelled').slice(0, 4);
        this.recentNotifications = ((notifs as any).data || []).slice(0, 4);
        this.computeTodayAndNext(list);
        this.loading = false;
      });

    } else {
      forkJoin({
        revenue: this.paymentService.getRevenueReport({ month: `${year}-${String(month).padStart(2,'0')}` }).pipe(catchError(() => of({ kpi: { total: 0, paid: 0, unpaid: 0 }, schedules: [] }))),
        courses: this.courseService.getCourses({ limit: 50 } as any).pipe(catchError(() => of({ data: [] }))),
        notifs: notif$
      }).pipe(takeUntil(this.destroy$)).subscribe(({ revenue, courses, notifs }) => {
        const courseList = (courses as any).data || [];
        const kpi = (revenue as any).kpi || { total: 0, paid: 0, unpaid: 0 };
        const schedList: any[] = (revenue as any).schedules || [];

        this.stats = [
          { label: 'รายได้เดือนนี้', value: kpi.total.toLocaleString('th-TH'), sub: 'บาท', icon: ICONS.revenue, color: 'success' },
          { label: 'ยอดชำระแล้ว', value: kpi.paid.toLocaleString('th-TH'), sub: 'บาท', icon: ICONS.check, color: 'brand' },
          { label: 'คลาสทั้งหมด', value: courseList.length, sub: 'คลาส', icon: ICONS.book, color: 'info' },
          { label: 'การแจ้งเตือน', value: ((notifs as any).data || []).filter((n: any) => !n.isRead).length, sub: 'ใหม่', icon: ICONS.bell, color: 'warning' },
        ];

        this.upcomingItems = schedList.slice(0, 4);
        this.recentNotifications = ((notifs as any).data || []).slice(0, 4);
        this.computeTodayAndNext(schedList);
        this.loading = false;
      });
    }
  }

  navigate(route: string): void {
    this.router.navigate([route]);
  }

  getRoleLabel(): string {
    const map: Record<string, string> = { admin: 'ผู้ดูแลระบบ', manager: 'ผู้จัดการ', teacher: 'อาจารย์', student: 'นักเรียน' };
    return map[this.currentUser?.role || ''] || '';
  }

  getInitials(): string {
    const f = (this.currentUser?.firstName || '').charAt(0);
    const l = (this.currentUser?.lastName  || '').charAt(0);
    return (f + l).toUpperCase() || 'U';
  }

  formatDate(d: any): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('th-TH', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  formatTime(d: any): string {
    if (!d) return '';
    const dt = new Date(d);
    return dt.toLocaleDateString('th-TH', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  getStatusLabel(s: string): string {
    // รองรับทั้ง Course.status (pending/approved/active/...) และ Schedule.status
    const m: Record<string, string> = {
      // Course-level
      pending: 'รอครูยืนยัน', approved: 'ครูยืนยันแล้ว', active: 'กำลังดำเนินการ',
      // Schedule-level (ในกรณีที่ใช้กับ schedule)
      confirmed: 'ครูยืนยันแล้ว', scheduled: 'นัดแล้ว',
      awaiting_confirmation: 'รอ Manager ยืนยัน',
      completed: 'เสร็จสิ้น', cancelled: 'ยกเลิก'
    };
    return m[s] || s;
  }

  getStatusClass(s: string): string {
    const m: Record<string, string> = { pending: 'warning', approved: 'success', active: 'success', completed: 'info', cancelled: 'danger' };
    return m[s] || 'neutral';
  }

  getUpcomingLabel(item: any): string {
    return item.courseName || item.subject || item.name || 'คลาส';
  }

  getUpcomingDate(item: any): string {
    return this.formatDate(item.scheduledDate || item.date);
  }

  getUpcomingTime(item: any): string {
    if (item.startTime) return `${item.startTime}–${item.endTime}`;
    return '';
  }
}

const ICONS = {
  book: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
  calendar: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  payment: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`,
  bell: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
  clock: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  check: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  history: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-5H1"/></svg>`,
  revenue: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
  people: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  video: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`,
};
