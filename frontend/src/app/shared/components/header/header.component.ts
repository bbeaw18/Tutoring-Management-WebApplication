import { Component, OnInit, OnDestroy, Input, Output, EventEmitter, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AuthService } from '../../../services/auth.service';
import { NotificationService } from '../../../services/notification.service';
import { IUser, UserRole } from '../../../interfaces/user.interface';
import { DisplayNamePipe } from '../../pipes/display-name.pipe';

interface CmdItem {
  label: string;
  path: string;
  group: string;
  keywords: string;
  roles: UserRole[];
  icon: string;
}

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, DisplayNamePipe],
  template: `
    <header class="header" [class.sidebar-collapsed]="sidebarCollapsed">
      <div class="header-inner">

        <!-- Left -->
        <div class="header-left">
          <button class="hamburger" (click)="onToggleSidebar()" aria-label="Toggle menu">
            <span></span><span></span><span></span>
          </button>
          <div class="page-breadcrumb">
            <span class="page-title">{{ getPageTitle() }}</span>
          </div>
        </div>

        <!-- Center — Search (opens command palette) -->
        <div class="header-center">
          <button class="search-wrap" (click)="openCmdK()" type="button" aria-label="เปิดเมนูค้นหา">
            <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <span class="search-placeholder">ค้นหาเมนู, คอร์ส, บุคคล…</span>
            <span class="search-kbd"><kbd class="kbd">Ctrl</kbd><kbd class="kbd">K</kbd></span>
          </button>
        </div>

        <!-- Right -->
        <div class="header-right">
          <!-- Notifications -->
          <div class="dropdown-wrap" [class.open]="showNotifications">
            <button class="icon-action" (click)="toggleNotifications()" aria-label="Notifications">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              <span *ngIf="unreadCount > 0" class="badge-dot">{{ unreadCount > 9 ? '9+' : unreadCount }}</span>
            </button>

            <div class="dropdown-panel notif-panel" *ngIf="showNotifications">
              <div class="dropdown-header">
                <span>การแจ้งเตือน</span>
                <button class="text-link" *ngIf="unreadCount > 0" (click)="markAllNotificationsRead()">อ่านทั้งหมด</button>
              </div>
              <div class="notif-list">
                <div *ngIf="!notifications.length" class="notif-empty">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                  </svg>
                  <p>ไม่มีการแจ้งเตือน</p>
                </div>
                <div *ngFor="let n of notifications" class="notif-item"
                     [class.unread]="!n.isRead"
                     (click)="markNotificationRead(n)">
                  <div class="notif-dot"></div>
                  <div class="notif-body">
                    <p class="notif-title">{{ n.title }}</p>
                    <p class="notif-msg">{{ n.message }}</p>
                    <span class="notif-time">{{ n.createdAt | date:'short' }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- User Menu -->
          <div class="dropdown-wrap" [class.open]="showUserMenu">
            <button class="user-btn" (click)="toggleUserMenu()">
              <div class="user-avatar">{{ getInitials(currentUser?.firstName, currentUser?.lastName) }}</div>
              <div class="user-text">
                <span class="user-name">{{ currentUser?.firstName }}</span>
                <span class="user-role">{{ getRoleLabel(currentUser?.role) }}</span>
              </div>
              <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>

            <div class="dropdown-panel user-panel" *ngIf="showUserMenu">
              <div class="user-panel-top">
                <div class="panel-avatar">{{ getInitials(currentUser?.firstName, currentUser?.lastName) }}</div>
                <div>
                  <div class="panel-name">{{ currentUser | displayName }}</div>
                  <div class="panel-email">{{ currentUser?.email }}</div>
                </div>
              </div>
              <div class="dropdown-divider"></div>
              <button class="drop-item" (click)="onProfile()">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                โปรไฟล์
              </button>
              <button class="drop-item" (click)="onSettings()">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                ตั้งค่า
              </button>
              <div class="dropdown-divider"></div>
              <button class="drop-item danger" (click)="onLogout()">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                ออกจากระบบ
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>

    <!-- Backdrop -->
    <div *ngIf="showNotifications || showUserMenu" class="header-backdrop" (click)="closeAll()"></div>

    <!-- Command Palette (⌘K) -->
    <div *ngIf="showCmdK" class="cmdk-backdrop" (click)="closeCmdK()">
      <div class="cmdk-panel" (click)="$event.stopPropagation()">
        <div class="cmdk-input-wrap">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input type="text" class="cmdk-input" placeholder="ค้นหาเมนู, คอร์ส, บุคคล, คำสั่ง…"
                 [(ngModel)]="cmdKQuery"
                 (keydown.escape)="closeCmdK()"
                 (keydown.arrowDown)="$event.preventDefault(); cmdKNext()"
                 (keydown.arrowUp)="$event.preventDefault(); cmdKPrev()"
                 (keydown.enter)="cmdKSelect()"
                 autofocus #cmdkInputRef/>
          <button class="btn-icon-circle" style="width:30px;height:30px;" (click)="closeCmdK()" aria-label="ปิด">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="cmdk-list">
          <ng-container *ngFor="let group of getCmdGroups()">
            <div class="cmdk-group-label">{{ group }}</div>
            <div *ngFor="let item of filteredCmds(group); let i = index"
                 class="cmdk-item"
                 [class.active]="isActiveCmd(item)"
                 (click)="cmdKGo(item)">
              <div class="cmdk-icon" [innerHTML]="item.icon"></div>
              <div class="cmdk-label">{{ item.label }}</div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:.45">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </div>
          </ng-container>
          <div *ngIf="!hasCmdResults()" class="empty-prem" style="padding: 32px 16px;">
            <div class="empty-art" style="width:80px;height:80px;">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            </div>
            <div class="empty-title" style="font-size:14px;">ไม่พบผลลัพธ์</div>
            <div class="empty-desc" style="font-size:12px;">ลองคำค้นอื่น เช่น "ปฏิทิน" หรือ "รายได้"</div>
          </div>
        </div>
        <div class="cmdk-footer">
          <span><kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> เลือก</span>
          <span><kbd class="kbd">↵</kbd> ไป</span>
          <span><kbd class="kbd">Esc</kbd> ปิด</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    /* ── Header Shell ─────────────────────────────────────────────────── */
    .header {
      position: fixed;
      top: 0;
      left: var(--sidebar-w);
      right: 0;
      height: var(--header-h);
      background: rgba(248, 250, 252, 0.88);
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      border-bottom: 1px solid rgba(226, 232, 240, 0.6);
      z-index: var(--z-header);
      transition: left 280ms cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 0 1px 0 rgba(226,232,240,0.5), 0 4px 16px rgba(15,23,42,0.04);
    }

    .header.sidebar-collapsed { left: var(--sidebar-collapsed); }

    .header-inner {
      height: 100%;
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 0 24px;
    }

    /* ── Left ─────────────────────────────────────────────────────────── */
    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .hamburger {
      width: 36px; height: 36px;
      background: transparent;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 5px;
      transition: all 150ms ease;
      padding: 0;
    }
    .hamburger:hover { background: rgba(30, 63, 128, 0.08); }
    .hamburger span {
      display: block;
      width: 20px; height: 2px;
      background: var(--gray-500);
      border-radius: 2px;
      transition: all 150ms ease;
    }
    .hamburger:hover span { background: var(--brand-500); }

    .page-breadcrumb { display: none; }
    .page-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--gray-900);
      letter-spacing: -0.01em;
    }

    /* ── Center Search ────────────────────────────────────────────────── */
    .header-center {
      flex: 1;
      max-width: 440px;
    }

    .search-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 7px 10px 7px 14px;
      background: white;
      border: 1.5px solid var(--gray-200);
      border-radius: 999px;
      transition: all 200ms cubic-bezier(0.16, 1, 0.3, 1);
      cursor: pointer;
      box-shadow: var(--shadow-xs);
      text-align: left;
      font-family: var(--font-th);
    }
    .search-wrap:hover {
      border-color: var(--brand-300);
      box-shadow: 0 2px 8px rgba(30, 63, 128, 0.12);
      transform: translateY(-1px);
    }

    .search-icon { color: var(--gray-400); flex-shrink: 0; }

    .search-placeholder {
      flex: 1;
      font-size: 13px;
      color: var(--gray-400);
      font-weight: 500;
    }

    .search-kbd {
      display: inline-flex;
      gap: 3px;
      flex-shrink: 0;
    }

    /* ── Right ────────────────────────────────────────────────────────── */
    .header-right {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
    }

    /* ── Dropdown Wrap ────────────────────────────────────────────────── */
    .dropdown-wrap { position: relative; }

    /* ── Icon Action ──────────────────────────────────────────────────── */
    .icon-action {
      width: 38px; height: 38px;
      border-radius: 11px;
      background: white;
      border: 1.5px solid var(--gray-200);
      color: var(--gray-500);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer;
      position: relative;
      transition: all 180ms ease;
      box-shadow: var(--shadow-xs);
    }
    .icon-action:hover {
      border-color: var(--brand-300);
      color: var(--brand-600);
      background: var(--brand-50);
      box-shadow: 0 2px 8px rgba(30,63,128,0.12);
    }

    .badge-dot {
      position: absolute;
      top: -4px; right: -4px;
      min-width: 18px; height: 18px;
      background: linear-gradient(135deg, var(--danger-500), var(--danger-600));
      color: white;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      border: 2px solid var(--gray-50);
      padding: 0 3px;
      box-shadow: 0 2px 6px rgba(244,63,94,0.4);
    }

    /* ── User Button ──────────────────────────────────────────────────── */
    .user-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 10px 4px 4px;
      background: white;
      border: 1.5px solid var(--gray-200);
      border-radius: 14px;
      cursor: pointer;
      transition: all 180ms ease;
      box-shadow: var(--shadow-xs);
    }
    .user-btn:hover {
      border-color: var(--brand-300);
      background: var(--brand-50);
      box-shadow: 0 2px 8px rgba(30,63,128,0.12);
    }

    .user-avatar {
      width: 30px; height: 30px;
      border-radius: 9px;
      background: linear-gradient(135deg, #1e3f80, #ec4899);
      color: white;
      display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 700;
      flex-shrink: 0;
      box-shadow: 0 2px 6px rgba(30,63,128,0.35);
    }

    .user-text {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 1px;
    }
    .user-name  { font-size: 13px; font-weight: 700; color: var(--gray-900); line-height: 1.2; }
    .user-role  { font-size: 10px; color: var(--gray-500); font-weight: 500; line-height: 1; }

    .chevron { color: var(--gray-400); flex-shrink: 0; transition: transform 200ms ease; }
    .dropdown-wrap.open .chevron { transform: rotate(180deg); }

    /* ── Dropdown Panel ───────────────────────────────────────────────── */
    .dropdown-panel {
      position: absolute;
      top: calc(100% + 10px);
      right: 0;
      background: rgba(255,255,255,0.96);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(226,232,240,0.8);
      border-radius: 20px;
      box-shadow: 0 24px 48px rgba(15, 23, 42, 0.14), 0 4px 8px rgba(15,23,42,0.06), 0 0 0 1px rgba(30,63,128,0.04);
      z-index: var(--z-modal);
      overflow: hidden;
      animation: headerDropDown 160ms var(--ease-out);
    }

    .dropdown-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 16px;
      border-bottom: 1px solid var(--gray-100);
      font-size: 13px;
      font-weight: 700;
      color: var(--gray-900);
      background: linear-gradient(135deg, var(--gray-50) 0%, var(--brand-50) 100%);
    }

    .text-link {
      background: none; border: none;
      color: var(--primary); font-size: 12px; font-weight: 600;
      cursor: pointer; padding: 0;
      transition: color 150ms;
    }
    .text-link:hover { color: var(--primary-hover); }

    /* Notification Panel */
    .notif-panel { width: 360px; }

    .notif-list { max-height: 360px; overflow-y: auto; }

    .notif-empty {
      padding: 36px 16px;
      text-align: center;
      color: var(--gray-400);
      display: flex; flex-direction: column; align-items: center; gap: 10px;
      font-size: 13px;
    }

    .notif-item {
      display: flex; gap: 12px; padding: 12px 16px;
      border-bottom: 1px solid rgba(226,232,240,0.5);
      cursor: pointer; transition: background 120ms;
      align-items: flex-start;
    }
    .notif-item:hover { background: var(--gray-50); }
    .notif-item.unread { background: rgba(30,63,128,0.04); }
    .notif-item.unread:hover { background: rgba(30,63,128,0.08); }

    .notif-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--brand-500); flex-shrink: 0; margin-top: 5px;
      box-shadow: 0 0 6px rgba(30,63,128,0.4);
    }

    .notif-body { flex: 1; min-width: 0; }
    .notif-title { font-size: 13px; font-weight: 600; color: var(--gray-900); margin: 0 0 3px; }
    .notif-msg   { font-size: 12px; color: var(--gray-600); margin: 0 0 4px; line-height: 1.5; }
    .notif-time  { font-size: 11px; color: var(--gray-400); }

    /* User Panel */
    .user-panel { width: 248px; }

    .user-panel-top {
      display: flex; align-items: center; gap: 12px;
      padding: 16px;
      background: linear-gradient(135deg, var(--gray-50) 0%, var(--brand-50) 100%);
      border-bottom: 1px solid var(--gray-100);
    }

    .panel-avatar {
      width: 42px; height: 42px;
      border-radius: 13px;
      background: linear-gradient(135deg, #1e3f80, #ec4899);
      color: white; font-weight: 700; font-size: 15px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      box-shadow: 0 4px 12px rgba(30,63,128,0.3);
    }

    .panel-name  { font-size: 14px; font-weight: 700; color: var(--gray-900); }
    .panel-email { font-size: 11px; color: var(--gray-500); margin-top: 2px; }

    .dropdown-divider { height: 1px; background: var(--gray-100); margin: 4px 0; }

    .drop-item {
      display: flex; align-items: center; gap: 10px;
      width: 100%;
      padding: 9px 16px;
      background: none; border: none;
      font-size: 13px; font-weight: 500;
      color: var(--gray-700);
      cursor: pointer; text-align: left;
      transition: all 120ms ease;
      font-family: var(--font-th);
    }
    .drop-item:hover { background: var(--gray-50); color: var(--brand-600); }
    .drop-item svg   { color: var(--gray-400); flex-shrink: 0; transition: color 120ms; }
    .drop-item:hover svg { color: var(--brand-500); }
    .drop-item.danger { color: var(--danger-600); }
    .drop-item.danger:hover { background: var(--danger-50); color: var(--danger-700); }
    .drop-item.danger svg { color: var(--danger-400); }
    .drop-item.danger:hover svg { color: var(--danger-600); }

    /* ── Backdrop ─────────────────────────────────────────────────────── */
    .header-backdrop {
      position: fixed; inset: 0;
      z-index: calc(var(--z-header) - 1);
    }

    /* ── Responsive: iPad (≤1024px) ──────────────────────────────────── */
    @media (max-width: 1024px) {
      .header { left: var(--sidebar-collapsed); }
      .header.sidebar-collapsed { left: var(--sidebar-collapsed); }
      .header-center { display: none; }
    }

    /* ── Responsive: Mobile (≤768px) ─────────────────────────────────── */
    @media (max-width: 768px) {
      .header { left: 0; }
      .header.sidebar-collapsed { left: 0; }
      .page-breadcrumb { display: flex; }
      .header-center  { display: none; }
      .user-text      { display: none; }
      .chevron        { display: none; }
      .user-btn       { padding: 4px; border-radius: 11px; }
      .notif-panel    { width: calc(100vw - 32px); max-width: 340px; }
    }

    /* ── Responsive: Phone (≤480px) ──────────────────────────────────── */
    @media (max-width: 480px) {
      .header-inner   { padding: 0 12px; gap: 8px; }
      .search-kbd     { display: none; }
      .notif-panel    { right: -60px; }
    }

    @keyframes headerDropDown {
      from { opacity: 0; transform: translateY(-10px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
  `]
})
export class HeaderComponent implements OnInit, OnDestroy {
  @Input() sidebarOpen = false;
  @Input() sidebarCollapsed = false;
  @Output() toggleSidebar = new EventEmitter<void>();

  currentUser: IUser | null = null;
  unreadCount = 0;
  notifications: any[] = [];
  showNotifications = false;
  showUserMenu = false;
  searchQuery = '';

  // Command palette state
  showCmdK = false;
  cmdKQuery = '';
  cmdKActiveIdx = 0;

  private readonly _I = (p: string) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;

  private readonly ALL_CMDS: CmdItem[] = [
    // NAVIGATE
    { label: 'หน้าหลัก',           path: '/dashboard',                group: 'ไปยัง', keywords: 'home dashboard หน้าแรก',  roles: ['student','teacher','manager','admin'], icon: this._I(`<path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/>`) },
    // Student
    { label: 'นัดสอนของฉัน',      path: '/dashboard/my-courses',     group: 'ไปยัง', keywords: 'my courses student class',  roles: ['student'], icon: this._I(`<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>`) },
    { label: 'ปฏิทินตารางเรียน',  path: '/dashboard/calendar',       group: 'ไปยัง', keywords: 'calendar schedule ปฏิทิน', roles: ['student'], icon: this._I(`<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`) },
    { label: 'ประวัติการเรียน',    path: '/dashboard/history',        group: 'ไปยัง', keywords: 'history ประวัติ',          roles: ['student','teacher','manager','admin'], icon: this._I(`<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>`) },
    { label: 'การชำระเงิน',        path: '/dashboard/payments',       group: 'ไปยัง', keywords: 'payment money ชำระ จ่าย', roles: ['student'], icon: this._I(`<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>`) },
    { label: 'การแจ้งเตือน',       path: '/dashboard/notifications',  group: 'ไปยัง', keywords: 'notifications alert',      roles: ['student'], icon: this._I(`<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>`) },
    // Teacher
    { label: 'ปฏิทินตารางสอน',     path: '/dashboard/teacher-calendar', group: 'ไปยัง', keywords: 'teacher calendar สอน',   roles: ['teacher'], icon: this._I(`<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>`) },
    { label: 'คลาสวิชาของฉัน',     path: '/dashboard/teacher-courses',  group: 'ไปยัง', keywords: 'teacher courses class',  roles: ['teacher'], icon: this._I(`<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>`) },
    { label: 'ประวัติชั่วโมง',      path: '/dashboard/teacher-profile',  group: 'ไปยัง', keywords: 'profile teacher hours',  roles: ['teacher'], icon: this._I(`<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`) },
    // Manager / Admin
    { label: 'ปฏิทินมาสเตอร์',     path: '/dashboard/manager-calendar', group: 'ไปยัง', keywords: 'manager master calendar', roles: ['manager','admin'], icon: this._I(`<rect x="3" y="4" width="18" height="18" rx="2"/>`) },
    { label: 'จัดการรายวิชา',      path: '/dashboard/course-management', group: 'ไปยัง', keywords: 'course management admin', roles: ['manager','admin'], icon: this._I(`<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>`) },
    { label: 'รายรับ/รายจ่าย',       path: '/dashboard/revenue',         group: 'ไปยัง', keywords: 'revenue income expense เงิน รายจ่าย รายรับ', roles: ['manager','admin'], icon: this._I(`<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 10h5.5a1.5 1.5 0 0 1 0 3H9m0 0h5.5a1.5 1.5 0 0 1 0 3H9"/>`) },
    { label: 'อัพโหลด VDO',         path: '/dashboard/video-management', group: 'ไปยัง', keywords: 'video upload manage',    roles: ['manager','admin'], icon: this._I(`<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>`) },
    { label: 'VDO Online',          path: '/dashboard/vdo-online',      group: 'ไปยัง', keywords: 'vdo online live',         roles: ['manager','admin'], icon: this._I(`<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/>`) },
    { label: 'บุคลากร',             path: '/dashboard/staff',           group: 'ไปยัง', keywords: 'staff people user',      roles: ['manager','admin'], icon: this._I(`<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>`) },
    { label: 'อนุมัติครู',           path: '/dashboard/teacher-approval', group: 'ไปยัง', keywords: 'approve teacher',       roles: ['manager','admin'], icon: this._I(`<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>`) },
    // ACTIONS
    { label: 'ออกจากระบบ',          path: '__logout__',                 group: 'คำสั่ง', keywords: 'logout signout ออก',    roles: ['student','teacher','manager','admin'], icon: this._I(`<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>`) },
  ];

  private destroy$ = new Subject<void>();

  constructor(
    private authService: AuthService,
    private notificationService: NotificationService,
    private router: Router
  ) {}

  @HostListener('window:keydown', ['$event'])
  onGlobalKey(ev: KeyboardEvent): void {
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      this.openCmdK();
    } else if (ev.key === 'Escape' && this.showCmdK) {
      this.closeCmdK();
    }
  }

  openCmdK(): void {
    this.showCmdK = true;
    this.cmdKQuery = '';
    this.cmdKActiveIdx = 0;
    this.closeAll();
  }

  closeCmdK(): void { this.showCmdK = false; }

  private availableCmds(): CmdItem[] {
    const role = this.currentUser?.role as UserRole | undefined;
    if (!role) return [];
    return this.ALL_CMDS.filter(c => c.roles.includes(role));
  }

  private matchedCmds(): CmdItem[] {
    const q = this.cmdKQuery.trim().toLowerCase();
    const base = this.availableCmds();
    if (!q) return base;
    return base.filter(c =>
      c.label.toLowerCase().includes(q) ||
      c.keywords.toLowerCase().includes(q) ||
      c.group.toLowerCase().includes(q)
    );
  }

  getCmdGroups(): string[] {
    return [...new Set(this.matchedCmds().map(c => c.group))];
  }

  filteredCmds(group: string): CmdItem[] {
    return this.matchedCmds().filter(c => c.group === group);
  }

  hasCmdResults(): boolean {
    return this.matchedCmds().length > 0;
  }

  isActiveCmd(item: CmdItem): boolean {
    return this.matchedCmds()[this.cmdKActiveIdx] === item;
  }

  cmdKNext(): void {
    const len = this.matchedCmds().length;
    if (!len) return;
    this.cmdKActiveIdx = (this.cmdKActiveIdx + 1) % len;
  }

  cmdKPrev(): void {
    const len = this.matchedCmds().length;
    if (!len) return;
    this.cmdKActiveIdx = (this.cmdKActiveIdx - 1 + len) % len;
  }

  cmdKSelect(): void {
    const arr = this.matchedCmds();
    if (!arr.length) return;
    this.cmdKGo(arr[this.cmdKActiveIdx] || arr[0]);
  }

  cmdKGo(item: CmdItem): void {
    this.closeCmdK();
    if (item.path === '__logout__') {
      this.authService.logout();
    } else {
      this.router.navigateByUrl(item.path);
    }
  }

  ngOnInit(): void {
    this.authService.currentUser$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(user => { this.currentUser = user; });

    this.notificationService.getUnreadCount().pipe(
      takeUntil(this.destroy$)
    ).subscribe(count => { this.unreadCount = count; });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  getPageTitle(): string {
    const path = window.location.pathname;
    const titles: Record<string, string> = {
      '/dashboard/my-courses':       'นัดสอนของฉัน',
      '/dashboard/calendar':        'ปฏิทินตารางเรียน',
      '/dashboard/videos':          'เรียนย้อนหลัง',
      '/dashboard/payments':        'ชำระเงิน',
      '/dashboard/notifications':   'การแจ้งเตือน',
      '/dashboard/teacher-calendar': 'ปฏิทินตารางสอน',
      '/dashboard/teacher-courses': 'คลาสวิชาของฉัน',
      '/dashboard/teacher-profile': 'ประวัติชั่วโมง',
      '/dashboard/manager-calendar': 'ปฏิทินมาสเตอร์',
      '/dashboard/course-management': 'จัดการรายวิชา',
      '/dashboard/revenue':         'รายรับ/รายจ่าย',
      '/dashboard/video-management': 'อัพโหลด VDO',
      '/dashboard/staff':           'บุคลากร',
      '/dashboard/teacher-approval': 'อนุมัติครู',
    };
    return titles[path] || 'KMS';
  }

  toggleNotifications(): void {
    this.showNotifications = !this.showNotifications;
    this.showUserMenu = false;
    if (this.showNotifications) {
      this.notificationService.getNotifications().subscribe(res => {
        this.notifications = res.data || [];
      });
      // Refresh unread count when opening (กันกรณีอัปเดตจากแท็บอื่น)
      this.notificationService.getUnreadCount().subscribe(c => { this.unreadCount = c; });
    }
  }

  /** กดที่การแจ้งเตือน 1 รายการ → mark as read + ลด badge ทันที */
  markNotificationRead(n: any): void {
    if (!n || n.isRead) return;
    const id = n._id || n.id;
    if (!id) return;
    // Optimistic update — ลด badge ทันทีไม่รอ server
    n.isRead = true;
    if (this.unreadCount > 0) this.unreadCount--;
    this.notificationService.markAsRead(id).subscribe({
      error: () => {
        // rollback ถ้า server error
        n.isRead = false;
        this.notificationService.getUnreadCount().subscribe(c => { this.unreadCount = c; });
      }
    });
  }

  /** กดปุ่ม "อ่านทั้งหมด" → mark ทุกรายการ + เคลียร์ badge */
  markAllNotificationsRead(): void {
    if (this.unreadCount === 0) return;
    // Optimistic
    this.notifications = this.notifications.map(n => ({ ...n, isRead: true }));
    const prevCount = this.unreadCount;
    this.unreadCount = 0;
    this.notificationService.markAllAsRead().subscribe({
      error: () => {
        // rollback
        this.unreadCount = prevCount;
        this.notificationService.getNotifications().subscribe(res => { this.notifications = res.data || []; });
      }
    });
  }

  toggleUserMenu(): void {
    this.showUserMenu = !this.showUserMenu;
    this.showNotifications = false;
  }

  closeAll(): void {
    this.showNotifications = false;
    this.showUserMenu = false;
  }

  onToggleSidebar(): void { this.toggleSidebar.emit(); }
  onProfile(): void { this.closeAll(); }
  onSettings(): void { this.closeAll(); }
  onLogout(): void { this.closeAll(); this.authService.logout(); }

  getInitials(firstName?: string, lastName?: string): string {
    return ((firstName || '').charAt(0) + (lastName || '').charAt(0)).toUpperCase() || 'U';
  }

  getRoleLabel(role?: string): string {
    const labels: Record<string, string> = {
      admin: 'ผู้ดูแลระบบ', manager: 'ผู้จัดการ',
      teacher: 'อาจารย์',   student: 'นักเรียน'
    };
    return labels[role || ''] || '';
  }
}
