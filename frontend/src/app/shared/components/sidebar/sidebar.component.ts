import { Component, OnInit, OnDestroy, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AuthService } from '../../../services/auth.service';
import { IUser, UserRole } from '../../../interfaces/user.interface';
import { DisplayNamePipe } from '../../pipes/display-name.pipe';

interface MenuItem {
  label: string;
  path: string;
  icon: string;
  roles: UserRole[];
  badge?: string;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule, DisplayNamePipe],
  template: `
    <!-- Overlay (mobile) -->
    <div *ngIf="isOpen" class="sidebar-overlay" (click)="closeSidebar()"></div>

    <aside class="sidebar" [class.collapsed]="isCollapsed" [class.open]="isOpen">
      <!-- Header -->
      <div class="sidebar-header">
        <div class="brand-wrap">
          <div class="brand-icon">
            <!-- KMS Graduation Cap Logo -->
            <svg width="24" height="24" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <!-- Board (flat top of cap) -->
              <polygon points="24,8 44,18 24,28 4,18" fill="white" opacity="0.95"/>
              <!-- Body of cap -->
              <path d="M14,22 L14,34 C14,34 18,40 24,40 C30,40 34,34 34,34 L34,22 L24,28 Z" fill="white" opacity="0.8"/>
              <!-- Tassel string -->
              <line x1="44" y1="18" x2="44" y2="30" stroke="white" stroke-width="2" stroke-linecap="round"/>
              <!-- Tassel end -->
              <circle cx="44" cy="32" r="2" fill="#f9a8d4"/>
            </svg>
          </div>
          <div class="brand-text-wrap">
            <span class="brand-text">KMS</span>
            <span class="brand-sub">Know More Sci</span>
          </div>
        </div>
        <button class="collapse-btn" (click)="toggleCollapse()" [title]="isCollapsed ? 'ขยาย' : 'ย่อ'">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline *ngIf="!isCollapsed" points="15 18 9 12 15 6"></polyline>
            <polyline *ngIf="isCollapsed"  points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
      </div>

      <!-- User Card -->
      <div class="user-card" *ngIf="currentUser">
        <div class="user-avatar-wrap">
          <div class="user-avatar">{{ getInitials(currentUser.firstName, currentUser.lastName) }}</div>
          <div class="status-dot"></div>
        </div>
        <div class="user-info">
          <div class="user-name">{{ currentUser | displayName }}</div>
          <div class="user-role-badge">{{ getRoleLabel(currentUser.role) }}</div>
        </div>
      </div>

      <!-- Navigation -->
      <nav class="sidebar-nav">
        <div class="nav-label-group">หลัก</div>
        <ul class="nav-list">
          <li *ngFor="let item of getMenuItems()" class="nav-item">
            <a [routerLink]="item.path" routerLinkActive="active"
               [routerLinkActiveOptions]="{exact: false}"
               (click)="onNavigate()" class="nav-link" [title]="isCollapsed ? item.label : ''">
              <div class="nav-icon-wrap">
                <span class="nav-icon" [innerHTML]="safeIcon(item.icon)"></span>
              </div>
              <span class="nav-label">{{ item.label }}</span>
              <span *ngIf="item.badge" class="nav-badge">{{ item.badge }}</span>
            </a>
          </li>
        </ul>
      </nav>

      <!-- Logout -->
      <div class="sidebar-bottom">
        <button class="logout-btn" (click)="logout()">
          <div class="nav-icon-wrap">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </div>
          <span class="nav-label">ออกจากระบบ</span>
        </button>
        <div class="version-tag">v1.0.0</div>
      </div>
    </aside>
  `,
  styles: [`
    /* ── Overlay ──────────────────────────────────────────────────────── */
    .sidebar-overlay {
      display: none;
      position: fixed; inset: 0;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      z-index: calc(var(--z-sidebar) - 1);
      animation: fadeIn 200ms ease;
    }

    /* ── Sidebar Shell ────────────────────────────────────────────────── */
    .sidebar {
      width: var(--sidebar-w);
      height: 100vh;
      background: linear-gradient(180deg, #0a0f1e 0%, #131a2e 30%, #1a1040 65%, #0d0a20 100%);
      display: flex;
      flex-direction: column;
      position: fixed;
      left: 0; top: 0;
      z-index: var(--z-sidebar);
      overflow: hidden;
      transition: width 360ms cubic-bezier(0.22, 1, 0.36, 1),
                  transform 360ms cubic-bezier(0.22, 1, 0.36, 1);
      border-right: 1px solid rgba(30, 63, 128, 0.12);
      box-shadow: 4px 0 32px rgba(0, 0, 0, 0.4);
    }

    /* Subtle ambient glow on sidebar */
    .sidebar::before {
      content: '';
      position: absolute;
      top: -120px; left: -80px;
      width: 280px; height: 280px;
      background: radial-gradient(circle, rgba(30,63,128,0.18) 0%, transparent 65%);
      border-radius: 50%;
      pointer-events: none;
    }

    .sidebar::after {
      content: '';
      position: absolute;
      bottom: 80px; right: -80px;
      width: 200px; height: 200px;
      background: radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 65%);
      border-radius: 50%;
      pointer-events: none;
    }

    .sidebar.collapsed { width: var(--sidebar-collapsed); }

    /* ── Header ───────────────────────────────────────────────────────── */
    .sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 18px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      min-height: var(--header-h);
      flex-shrink: 0;
      position: relative;
      z-index: 1;
    }

    .brand-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
      overflow: hidden;
    }

    .brand-icon {
      width: 36px; height: 36px;
      background: linear-gradient(135deg, #1e3f80, #0d2050);
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      box-shadow: 0 4px 16px rgba(30, 63, 128, 0.5), 0 0 0 1px rgba(255,255,255,0.1) inset;
    }

    .brand-text-wrap {
      display: flex;
      flex-direction: column;
      opacity: 1;
      transition: opacity 200ms, width 200ms;
      overflow: hidden;
      white-space: nowrap;
    }

    .brand-text {
      font-size: 18px;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: -0.03em;
      line-height: 1.1;
    }

    .brand-sub {
      font-size: 9px;
      font-weight: 500;
      color: #f9a8d4;
      letter-spacing: 0.04em;
      line-height: 1.2;
    }

    .sidebar.collapsed .brand-text-wrap { opacity: 0; width: 0; overflow: hidden; }

    .collapse-btn {
      width: 28px; height: 28px;
      border-radius: 8px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
      color: rgba(255,255,255,0.4);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer;
      transition: all 150ms ease;
      flex-shrink: 0;
    }
    .collapse-btn:hover {
      background: rgba(30,63,128,0.3);
      border-color: rgba(30,63,128,0.4);
      color: rgba(255,255,255,0.9);
    }

    /* ── User Card ────────────────────────────────────────────────────── */
    .user-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 14px;
      margin: 10px 10px 0;
      border-radius: 14px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.06);
      overflow: hidden;
      flex-shrink: 0;
      position: relative;
      z-index: 1;
    }

    .user-avatar-wrap {
      position: relative;
      flex-shrink: 0;
    }

    .user-avatar {
      width: 38px; height: 38px;
      border-radius: 50%;
      background: linear-gradient(135deg, #1e3f80, #ec4899);
      color: white;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700;
      font-size: 13px;
      box-shadow: 0 4px 12px rgba(30, 63, 128, 0.45), 0 0 0 2px rgba(255,255,255,0.08);
    }

    .status-dot {
      position: absolute;
      bottom: 0; right: 0;
      width: 10px; height: 10px;
      background: #22c55e;
      border-radius: 50%;
      border: 2px solid #0d1220;
      box-shadow: 0 0 6px rgba(34,197,94,0.5);
    }

    .user-info {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      opacity: 1;
      transition: opacity 200ms;
    }

    .sidebar.collapsed .user-info { opacity: 0; }

    .user-name {
      font-size: 13px;
      font-weight: 600;
      color: rgba(255,255,255,0.92);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.3;
    }

    .user-role-badge {
      font-size: 11px;
      color: rgba(249,168,212,0.8);
      margin-top: 2px;
      white-space: nowrap;
    }

    /* ── Navigation ───────────────────────────────────────────────────── */
    .sidebar-nav {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 16px 10px;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.08) transparent;
      position: relative;
      z-index: 1;
    }

    .sidebar-nav::-webkit-scrollbar { width: 4px; }
    .sidebar-nav::-webkit-scrollbar-track { background: transparent; }
    .sidebar-nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 99px; }

    .nav-label-group {
      font-size: 10px;
      font-weight: 700;
      color: rgba(255,255,255,0.2);
      text-transform: uppercase;
      letter-spacing: 0.12em;
      padding: 0 10px;
      margin-bottom: 6px;
      white-space: nowrap;
      overflow: hidden;
      opacity: 1;
      transition: opacity 200ms;
    }
    .sidebar.collapsed .nav-label-group { opacity: 0; }

    .nav-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .nav-link {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 10px;
      border-radius: 12px;
      color: rgba(255,255,255,0.5);
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      transition: all 180ms ease;
      position: relative;
      overflow: hidden;
      white-space: nowrap;
    }

    .nav-link:hover {
      color: rgba(255,255,255,0.9);
      background: rgba(255,255,255,0.07);
      text-decoration: none;
    }

    .nav-link.active {
      color: white;
      background: rgba(30,63,128,0.32);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.06);
    }

    .nav-icon-wrap {
      width: 32px; height: 32px;
      border-radius: 9px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.04);
      color: rgba(255,255,255,0.55);
      transition: all 240ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    .nav-link:hover .nav-icon-wrap {
      background: rgba(255,255,255,0.09);
      color: rgba(255,255,255,0.95);
      transform: scale(1.04);
    }

    .nav-link.active .nav-icon-wrap {
      background: rgba(236, 72, 153, 0.18);
      border-color: rgba(236, 72, 153, 0.32);
      color: #f9a8d4;
      box-shadow: 0 4px 14px rgba(236, 72, 153, 0.18), inset 0 1px 0 rgba(255,255,255,0.06);
    }

    .nav-icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 18px;
    }
    .nav-icon ::ng-deep svg { width: 18px; height: 18px; display: block; }

    /* Sliding active indicator beside active link */
    .nav-link.active::after {
      content: '';
      position: absolute;
      right: 10px;
      top: 50%;
      transform: translateY(-50%);
      width: 4px; height: 4px;
      border-radius: 50%;
      background: #f9a8d4;
      box-shadow: 0 0 8px rgba(249, 168, 212, 0.8);
      animation: prem-ring 1.8s ease-out infinite;
    }
    .sidebar.collapsed .nav-link.active::after { display: none; }

    .nav-label {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      opacity: 1;
      transition: opacity 200ms;
    }
    .sidebar.collapsed .nav-label { opacity: 0; }

    .nav-badge {
      background: linear-gradient(135deg, rgba(236,72,153,0.6), rgba(30,63,128,0.4));
      color: #f9a8d4;
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 999px;
      border: 1px solid rgba(236,72,153,0.3);
      opacity: 1;
      transition: opacity 200ms;
    }
    .sidebar.collapsed .nav-badge { opacity: 0; }

    /* ── Bottom ───────────────────────────────────────────────────────── */
    .sidebar-bottom {
      padding: 10px 10px 16px;
      border-top: 1px solid rgba(255,255,255,0.05);
      flex-shrink: 0;
      position: relative;
      z-index: 1;
    }

    .logout-btn {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 10px 10px;
      border-radius: 12px;
      background: none;
      border: none;
      color: rgba(255,255,255,0.4);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      text-align: left;
      transition: all 180ms ease;
      white-space: nowrap;
      overflow: hidden;
      font-family: var(--font-th);
    }
    .logout-btn:hover {
      color: #fca5a5;
      background: rgba(248, 113, 113, 0.12);
      border: none;
      box-shadow: none;
    }

    .version-tag {
      text-align: center;
      font-size: 10px;
      color: rgba(255,255,255,0.12);
      margin-top: 8px;
      opacity: 1;
      transition: opacity 200ms;
      letter-spacing: 0.04em;
    }
    .sidebar.collapsed .version-tag { opacity: 0; }

    /* ── Tooltip for collapsed ────────────────────────────────────────── */
    .sidebar.collapsed .nav-link:hover::after {
      content: attr(title);
      position: absolute;
      left: calc(100% + 14px);
      top: 50%; transform: translateY(-50%);
      background: rgba(15, 20, 40, 0.96);
      backdrop-filter: blur(12px);
      color: white;
      font-size: 12px;
      font-weight: 500;
      padding: 5px 12px;
      border-radius: 8px;
      white-space: nowrap;
      pointer-events: none;
      z-index: 99;
      border: 1px solid rgba(30,63,128,0.25);
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    }

    /* ── Responsive: iPad / Tablet ────────────────────────────────────── */
    @media (max-width: 1024px) {
      .sidebar { width: var(--sidebar-collapsed); }
      .brand-text-wrap { opacity: 0; width: 0; }
      .user-info   { opacity: 0; }
      .nav-label   { opacity: 0; }
      .nav-badge   { opacity: 0; }
      .nav-label-group { opacity: 0; }
      .version-tag { opacity: 0; }
      .collapse-btn { display: none; }
    }

    /* ── Responsive: Mobile ───────────────────────────────────────────── */
    @media (max-width: 768px) {
      .sidebar {
        width: 280px;
        transform: translateX(-100%);
        box-shadow: 6px 0 32px rgba(0,0,0,0.5);
      }
      .sidebar.open {
        transform: translateX(0);
      }
      /* Show all text on mobile when open */
      .sidebar.open .brand-text-wrap { opacity: 1; width: auto; }
      .sidebar.open .user-info    { opacity: 1; }
      .sidebar.open .nav-label    { opacity: 1; }
      .sidebar.open .nav-badge    { opacity: 1; }
      .sidebar.open .nav-label-group { opacity: 1; }
      .sidebar.open .version-tag  { opacity: 1; }

      .sidebar-overlay { display: block; }
      .collapse-btn    { display: none; }
    }

    @media (max-width: 480px) {
      .sidebar { width: 85vw; max-width: 300px; }
    }

    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  `]
})
export class SidebarComponent implements OnInit, OnDestroy {
  @Input() isOpen = false;
  @Input() isCollapsed = false;
  @Output() close = new EventEmitter<void>();
  @Output() toggleCollapsed = new EventEmitter<boolean>();

  currentUser: IUser | null = null;
  private destroy$ = new Subject<void>();

  // SVG icons (Lucide-style, 18x18, strokeWidth=2)
  private readonly ICON_BOOK      = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>`;
  private readonly ICON_CALENDAR  = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
  private readonly ICON_HISTORY   = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>`;
  private readonly ICON_CARD      = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`;
  private readonly ICON_MONEY     = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;
  private readonly ICON_BELL      = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`;
  private readonly ICON_CLOCK     = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  private readonly ICON_OPENBOOK  = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;
  private readonly ICON_COIN      = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 10h5.5a1.5 1.5 0 0 1 0 3H9m0 0h5.5a1.5 1.5 0 0 1 0 3H9"/></svg>`;
  private readonly ICON_VIDEO     = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`;
  private readonly ICON_PLAY      = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/></svg>`;
  private readonly ICON_USERS     = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
  private readonly ICON_CHECK     = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;

  private allMenuItems: MenuItem[] = [
    // Student
    { label: 'นัดสอนของฉัน',      path: '/dashboard/my-courses',       icon: this.ICON_BOOK,      roles: ['student'] },
    { label: 'ปฏิทินตารางเรียน', path: '/dashboard/calendar',        icon: this.ICON_CALENDAR,  roles: ['student'] },
    { label: 'ประวัติการเรียน',    path: '/dashboard/history',          icon: this.ICON_HISTORY,   roles: ['student'] },
    { label: 'การชำระเงิน',       path: '/dashboard/payments',         icon: this.ICON_CARD,      roles: ['student'] },
    { label: 'การแจ้งเตือน',      path: '/dashboard/notifications',    icon: this.ICON_BELL,      roles: ['student'] },
    // Teacher
    { label: 'ปฏิทินตารางสอน',  path: '/dashboard/teacher-calendar', icon: this.ICON_CALENDAR,  roles: ['teacher'] },
    { label: 'รายได้',           path: '/dashboard/income',           icon: this.ICON_MONEY,     roles: ['teacher'] },
    { label: 'ประวัติการสอน',     path: '/dashboard/history',          icon: this.ICON_HISTORY,   roles: ['teacher'] },
    // ประวัติส่วนตัว — student/teacher (อยู่ในตำแหน่งปัจจุบันของแต่ละ role)
    { label: 'ประวัติส่วนตัว',    path: '/dashboard/profile',          icon: this.ICON_CLOCK,     roles: ['student', 'teacher'] },
    // Manager & Admin
    { label: 'ปฏิทินมาสเตอร์',  path: '/dashboard/manager-calendar', icon: this.ICON_CALENDAR,  roles: ['manager', 'admin'] },
    { label: 'ประวัติการสอน',     path: '/dashboard/history',          icon: this.ICON_HISTORY,   roles: ['manager', 'admin'] },
    { label: 'จัดการรายวิชา',    path: '/dashboard/course-management', icon: this.ICON_OPENBOOK,  roles: ['manager', 'admin'] },
    { label: 'รายรับ/รายจ่าย',     path: '/dashboard/revenue',          icon: this.ICON_COIN,      roles: ['manager', 'admin'] },
    { label: 'อัพโหลด VDO',      path: '/dashboard/video-management', icon: this.ICON_VIDEO,     roles: ['manager', 'admin'] },
    { label: 'VDO Online',        path: '/dashboard/vdo-online',       icon: this.ICON_PLAY,      roles: ['manager', 'admin'] },
    { label: 'บุคลากร',           path: '/dashboard/staff',            icon: this.ICON_USERS,     roles: ['manager', 'admin'] },
    { label: 'อนุมัติครู',        path: '/dashboard/teacher-approval', icon: this.ICON_CHECK,     roles: ['admin', 'manager'] },
    // ประวัติส่วนตัว — manager/admin (วางล่างสุด)
    { label: 'ประวัติส่วนตัว',    path: '/dashboard/profile',          icon: this.ICON_CLOCK,     roles: ['manager', 'admin'] },
  ];

  constructor(
    private authService: AuthService,
    private sanitizer: DomSanitizer
  ) {}

  /** Cache sanitized SVG so we don't re-sanitize on every change-detection tick */
  private iconCache = new Map<string, SafeHtml>();
  safeIcon(svg: string): SafeHtml {
    let cached = this.iconCache.get(svg);
    if (!cached) {
      cached = this.sanitizer.bypassSecurityTrustHtml(svg);
      this.iconCache.set(svg, cached);
    }
    return cached;
  }

  ngOnInit(): void {
    this.authService.currentUser$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(user => {
      this.currentUser = user;
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  getMenuItems(): MenuItem[] {
    if (!this.currentUser) return [];
    // Deduplicate by path for admin who might have duplicate paths
    const seen = new Set<string>();
    return this.allMenuItems
      .filter(item => item.roles.includes(this.currentUser!.role))
      .filter(item => {
        if (seen.has(item.path + item.label)) return false;
        seen.add(item.path + item.label);
        return true;
      });
  }

  getInitials(firstName?: string, lastName?: string): string {
    const first = (firstName || '').charAt(0).toUpperCase();
    const last  = (lastName  || '').charAt(0).toUpperCase();
    return (first + last) || 'U';
  }

  getRoleLabel(role?: string): string {
    const labels: Record<string, string> = {
      admin:   'ผู้ดูแลระบบ',
      manager: 'ผู้จัดการ',
      teacher: 'อาจารย์',
      student: 'นักเรียน'
    };
    return labels[role || ''] || '';
  }

  logout(): void {
    this.authService.logout();
  }

  onNavigate(): void { this.closeSidebar(); }
  closeSidebar(): void { this.close.emit(); }

  toggleCollapse(): void {
    this.isCollapsed = !this.isCollapsed;
    this.toggleCollapsed.emit(this.isCollapsed);
  }
}
