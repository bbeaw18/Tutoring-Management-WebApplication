import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { NotificationService } from '../../../services/notification.service';
import { INotification } from '../../../interfaces/notification.interface';
import { LoadingComponent } from '../../../shared/components/loading/loading.component';

@Component({
  selector: 'app-student-notifications',
  standalone: true,
  imports: [CommonModule, LoadingComponent],
  templateUrl: './student-notifications.component.html',
  styleUrls: ['./student-notifications.component.css']
})
export class StudentNotificationsComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  notifications: INotification[] = [];
  loading = false;

  // Inbox filter
  nFilter: 'all' | 'unread' | 'today' | 'archive' = 'all';
  nTypeFilter: 'all' | 'info' | 'success' | 'warning' | 'error' = 'all';

  constructor(private notificationService: NotificationService) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnInit(): void {
    this.loadNotifications();
  }

  loadNotifications(): void {
    this.loading = true;
    this.notificationService.getNotifications()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
      next: (res) => {
        this.notifications = res.data;
        this.loading = false;
      },
      error: (error) => {
        console.error(error);
        this.loading = false;
      }
    });
  }

  markAsRead(notificationId: string): void {
    this.notificationService.markAsRead(notificationId).subscribe({
      next: () => {
        const notif = this.notifications.find(n => n.id === notificationId);
        if (notif) {
          notif.isRead = true;
        }
      },
      error: (error) => {
        console.error(error);
      }
    });
  }

  markAllAsRead(): void {
    this.notificationService.markAllAsRead().subscribe({
      next: () => {
        this.notifications.forEach(n => n.isRead = true);
      },
      error: (error) => {
        console.error(error);
      }
    });
  }

  deleteNotification(notificationId: string): void {
    this.notificationService.deleteNotification(notificationId).subscribe({
      next: () => {
        this.notifications = this.notifications.filter(n => n.id !== notificationId);
      },
      error: (error) => {
        console.error(error);
      }
    });
  }

  getNotificationIcon(type: string): string {
    const icons: { [key: string]: string } = {
      'info': 'ℹ',
      'warning': '⚠',
      'success': '✓',
      'error': '✕'
    };
    return icons[type] || 'ℹ';
  }

  formatDate(date: Date): string {
    const now = new Date();
    const notifDate = new Date(date);
    const diffTime = now.getTime() - notifDate.getTime();
    const diffMinutes = Math.floor(diffTime / (1000 * 60));
    const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffMinutes < 1) return 'เมื่อสักครู่';
    if (diffMinutes < 60) return `${diffMinutes} นาทีที่แล้ว`;
    if (diffHours < 24) return `${diffHours} ชั่วโมงที่แล้ว`;
    if (diffDays < 7) return `${diffDays} วันที่แล้ว`;

    return notifDate.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  // ── Inbox helpers ────────────────────────────────────────
  setFilter(f: 'all' | 'unread' | 'today' | 'archive'): void { this.nFilter = f; }
  setTypeFilter(t: 'all' | 'info' | 'success' | 'warning' | 'error'): void { this.nTypeFilter = t; }

  get unreadCount(): number {
    return this.notifications.filter(n => !n.isRead).length;
  }
  get todayCount(): number {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return this.notifications.filter(n => new Date(n.createdAt).getTime() >= start.getTime()).length;
  }

  get nFilterCounts(): { all: number; unread: number; today: number; archive: number } {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return {
      all: this.notifications.length,
      unread: this.notifications.filter(n => !n.isRead).length,
      today: this.notifications.filter(n => new Date(n.createdAt).getTime() >= start.getTime()).length,
      archive: this.notifications.filter(n => n.isRead).length,
    };
  }

  get nTypeCounts(): { info: number; success: number; warning: number; error: number } {
    return {
      info: this.notifications.filter(n => n.type === 'info').length,
      success: this.notifications.filter(n => n.type === 'success').length,
      warning: this.notifications.filter(n => n.type === 'warning').length,
      error: this.notifications.filter(n => n.type === 'error').length,
    };
  }

  /** Notifications visible after primary + type filters */
  get visibleNotifications(): INotification[] {
    let list = this.notifications;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    if (this.nFilter === 'unread')   list = list.filter(n => !n.isRead);
    else if (this.nFilter === 'today')  list = list.filter(n => new Date(n.createdAt).getTime() >= start.getTime());
    else if (this.nFilter === 'archive') list = list.filter(n => n.isRead);
    if (this.nTypeFilter !== 'all') list = list.filter(n => n.type === this.nTypeFilter);
    return list;
  }

  /** Group visible notifications into time buckets */
  get groupedNotifications(): { label: string; items: INotification[] }[] {
    const list = this.visibleNotifications;
    const now = new Date();
    const startOfToday = new Date(now); startOfToday.setHours(0,0,0,0);
    const startOfYesterday = new Date(startOfToday); startOfYesterday.setDate(startOfToday.getDate() - 1);
    const startOfWeek = new Date(startOfToday); startOfWeek.setDate(startOfToday.getDate() - 7);

    const today: INotification[] = [];
    const yesterday: INotification[] = [];
    const thisWeek: INotification[] = [];
    const earlier: INotification[] = [];

    for (const n of list) {
      const t = new Date(n.createdAt).getTime();
      if (t >= startOfToday.getTime()) today.push(n);
      else if (t >= startOfYesterday.getTime()) yesterday.push(n);
      else if (t >= startOfWeek.getTime()) thisWeek.push(n);
      else earlier.push(n);
    }

    const groups: { label: string; items: INotification[] }[] = [];
    if (today.length)     groups.push({ label: 'วันนี้',       items: today });
    if (yesterday.length) groups.push({ label: 'เมื่อวาน',     items: yesterday });
    if (thisWeek.length)  groups.push({ label: 'สัปดาห์นี้',    items: thisWeek });
    if (earlier.length)   groups.push({ label: 'ก่อนหน้านี้',  items: earlier });
    return groups;
  }

  getTypeLabel(type: string): string {
    return ({ info: 'ข้อมูล', success: 'สำเร็จ', warning: 'แจ้งเตือน', error: 'ข้อผิดพลาด' } as any)[type] || type;
  }
}
