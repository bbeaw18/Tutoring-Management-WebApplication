import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { UserService } from '../../../services/user.service';
import { AuthService } from '../../../services/auth.service';
import { IUser } from '../../../interfaces/user.interface';
import { LoadingComponent } from '../../../shared/components/loading/loading.component';

@Component({
  selector: 'app-staff-list',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, LoadingComponent],
  templateUrl: './staff-list.component.html',
  styleUrls: ['./staff-list.component.css']
})
export class StaffListComponent implements OnInit, OnDestroy {
  users: IUser[] = [];
  filteredUsers: IUser[] = [];
  loading = false;
  searchForm!: FormGroup;
  roleFilter = 'all';
  currentUser: IUser | null = null;

  // Role change modal
  changeRoleLoading: { [key: string]: boolean } = {};
  selectedUserForRoleChange: IUser | null = null;
  newRole = '';
  showRoleChangeModal = false;

  // Approve modal
  showApproveModal = false;
  selectedUserForApprove: IUser | null = null;
  approveLoading = false;

  // Toast
  toastMessage = '';
  toastType: 'success' | 'error' = 'success';
  toastTimer: any;
  private destroy$ = new Subject<void>();
  private userSub!: Subscription;

  constructor(
    private userService: UserService,
    private formBuilder: FormBuilder,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    // Subscribe so currentUser stays up-to-date even after async loadStoredUser() resolves
    this.userSub = this.authService.currentUser$.subscribe(u => this.currentUser = u);
    this.initializeForm();
    this.loadUsers();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.userSub?.unsubscribe();
    clearTimeout(this.toastTimer);
  }

  initializeForm(): void {
    this.searchForm = this.formBuilder.group({ search: [''] });
    this.searchForm.get('search')?.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.filterUsers());
  }

  loadUsers(): void {
    this.loading = true;
    this.userService.getUsers().subscribe({
      next: (res) => {
        this.users = res.data;
        this.filterUsers();
        this.loading = false;
      },
      error: () => {
        this.showToast('ไม่สามารถโหลดข้อมูลบุคลากรได้', 'error');
        this.loading = false;
      }
    });
  }

  filterUsers(): void {
    let filtered = this.users;
    if (this.roleFilter !== 'all') {
      filtered = filtered.filter(u => u.role === this.roleFilter);
    }
    const searchTerm = this.searchForm.get('search')?.value?.toLowerCase() || '';
    if (searchTerm) {
      filtered = filtered.filter(u =>
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(searchTerm) ||
        u.email.toLowerCase().includes(searchTerm)
      );
    }
    this.filteredUsers = filtered;
  }

  onRoleFilterChange(role: string): void {
    this.roleFilter = role;
    this.filterUsers();
  }

  // ── Role Change ──────────────────────────────────────────────────────────
  openRoleChangeModal(user: IUser): void {
    this.selectedUserForRoleChange = user;
    // Pre-select ตำแหน่งตรงข้ามอัตโนมัติ: teacher → manager, manager → teacher
    this.newRole = user.role === 'teacher' ? 'manager' : 'teacher';
    this.showRoleChangeModal = true;
  }

  closeRoleChangeModal(): void {
    this.showRoleChangeModal = false;
    this.selectedUserForRoleChange = null;
    this.newRole = '';
  }

  changeUserRole(): void {
    if (!this.selectedUserForRoleChange || !this.newRole ||
        this.newRole === this.selectedUserForRoleChange.role) return;

    const userId = this.selectedUserForRoleChange.id;
    this.changeRoleLoading[userId] = true;

    this.userService.changeRole(userId, this.newRole).subscribe({
      next: (res) => {
        const idx = this.users.findIndex(u => u.id === userId);
        if (idx !== -1) {
          this.users[idx] = res.data;
          this.filterUsers();
        }
        this.changeRoleLoading[userId] = false;
        this.closeRoleChangeModal();
        this.showToast('เปลี่ยน Role สำเร็จ', 'success');
      },
      error: (err) => {
        const msg = err?.error?.message || 'เปลี่ยน Role ล้มเหลว โปรดลองอีกครั้ง';
        this.showToast(msg, 'error');
        this.changeRoleLoading[userId] = false;
      }
    });
  }

  // ── Approve Teacher Registration ─────────────────────────────────────────
  openApproveModal(user: IUser): void {
    this.selectedUserForApprove = user;
    this.showApproveModal = true;
  }

  closeApproveModal(): void {
    this.showApproveModal = false;
    this.selectedUserForApprove = null;
  }

  confirmApproveTeacher(): void {
    if (!this.selectedUserForApprove) return;
    const userId = this.selectedUserForApprove.id;
    this.approveLoading = true;

    this.userService.approveTeacher(userId).subscribe({
      next: (res) => {
        const idx = this.users.findIndex(u => u.id === userId);
        if (idx !== -1) {
          this.users[idx] = res.data;
          this.filterUsers();
        }
        this.approveLoading = false;
        this.closeApproveModal();
        this.showToast('อนุมัติครูสำเร็จ', 'success');
      },
      error: (err) => {
        const msg = err?.error?.message || 'อนุมัติครูล้มเหลว โปรดลองอีกครั้ง';
        this.showToast(msg, 'error');
        this.approveLoading = false;
      }
    });
  }

  // ── Delete ───────────────────────────────────────────────────────────────
  deleteUser(userId: string): void {
    if (!confirm('คุณแน่ใจหรือว่าต้องการปิดการใช้งานผู้ใช้นี้?')) return;
    this.userService.deleteUser(userId).subscribe({
      next: () => {
        this.loadUsers();
        this.showToast('ปิดการใช้งานผู้ใช้สำเร็จ', 'success');
      },
      error: () => this.showToast('ไม่สามารถดำเนินการได้ โปรดลองอีกครั้ง', 'error')
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  showToast(message: string, type: 'success' | 'error'): void {
    clearTimeout(this.toastTimer);
    this.toastMessage = message;
    this.toastType = type;
    this.toastTimer = setTimeout(() => this.toastMessage = '', 3500);
  }

  getRoleLabel(role: string): string {
    const labels: { [key: string]: string } = {
      admin: 'ผู้ดูแลระบบ',
      manager: 'ผู้จัดการ',
      teacher: 'อาจารย์',
      student: 'นักเรียน'
    };
    return labels[role] || role;
  }

  getRegistrationLabel(user: IUser): string {
    if (user.role !== 'teacher') return '';
    return user.registrationStatus === 'registered' ? 'อนุมัติแล้ว' : 'รออนุมัติ';
  }

  getRegistrationClass(user: IUser): string {
    if (user.role !== 'teacher') return '';
    return user.registrationStatus === 'registered' ? 'badge-success' : 'badge-warning';
  }

  // Show approve button only for admin or manager, and only for unregistered teachers
  canApproveTeacher(user: IUser): boolean {
    const myRole = this.currentUser?.role;
    return (myRole === 'admin' || myRole === 'manager') &&
           user.role === 'teacher' &&
           user.registrationStatus === 'unregistered';
  }

  // Show change-role button only for admin, and only for teacher/manager
  canChangeRole(user: IUser): boolean {
    return this.currentUser?.role === 'admin' &&
           (user.role === 'teacher' || user.role === 'manager');
  }

  // Count pending teachers
  get pendingCount(): number {
    return this.users.filter(u => u.role === 'teacher' && u.registrationStatus === 'unregistered').length;
  }

  // ── Stats Summary ───────────────────────────────────────────────
  get staffStats(): { total: number; admins: number; managers: number; teachers: number; students: number; pending: number } {
    return {
      total: this.users.length,
      admins: this.users.filter(u => u.role === 'admin').length,
      managers: this.users.filter(u => u.role === 'manager').length,
      teachers: this.users.filter(u => u.role === 'teacher').length,
      students: this.users.filter(u => u.role === 'student').length,
      pending: this.pendingCount
    };
  }

  // View toggle: cards vs table
  viewMode: 'cards' | 'table' = 'cards';
  setViewMode(m: 'cards' | 'table'): void { this.viewMode = m; }

  // Initial avatar text
  getInitials(u: IUser): string {
    const first = (u.firstName || '').charAt(0);
    const last = (u.lastName || '').charAt(0);
    return `${first}${last}`.toUpperCase() || '?';
  }

  /** Stable color hash for avatar background (8 distinct hues) */
  getAvatarHue(u: IUser): number {
    const seed = `${u.firstName || ''}${u.lastName || ''}${u.email || ''}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    const hues = [330, 280, 220, 195, 165, 135, 30, 10]; // pinks, purple, blue, teal, green, orange, red
    return hues[Math.abs(hash) % hues.length];
  }
}
