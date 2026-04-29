import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CourseService } from '../../../services/course.service';
import { AuthService } from '../../../services/auth.service';
import { ICourse } from '../../../interfaces/course.interface';
import { IUser } from '../../../interfaces/user.interface';
import { LoadingComponent } from '../../../shared/components/loading/loading.component';

type CourseFilterMode = 'all' | 'pending' | 'approved' | 'completed' | 'cancelled';

@Component({
  selector: 'app-student-courses',
  standalone: true,
  imports: [CommonModule, FormsModule, LoadingComponent],
  templateUrl: './student-courses.component.html',
  styleUrls: ['./student-courses.component.css']
})
export class StudentCoursesComponent implements OnInit, OnDestroy {
  courses: ICourse[] = [];
  loading = false;
  expandedId: string | null = null;
  currentUser: IUser | null = null;

  // Filter state
  filterMode: CourseFilterMode = 'all';
  searchTerm = '';

  private destroy$ = new Subject<void>();

  constructor(
    private courseService: CourseService,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    // H4: Subscribe currentUser$ แทน getCurrentUser() snapshot
    // ป้องกันกรณีที่ component โหลดก่อน initializeAuth() เสร็จ → user=null
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => { this.currentUser = user; });

    this.loadCourses();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadCourses(): void {
    this.loading = true;
    this.courseService.getCourses().subscribe({
      next: (res) => {
        this.courses = res.data || [];
        this.loading = false;
      },
      error: (err) => {
        console.error('Load courses error:', err);
        this.loading = false;
      }
    });
  }

  toggle(courseId: string): void {
    this.expandedId = this.expandedId === courseId ? null : courseId;
  }

  getId(obj: any): string {
    return obj?.id || obj?._id || '';
  }

  getTeacherName(teacher: any): string {
    if (!teacher) return '—';
    if (typeof teacher === 'object') return `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim();
    return String(teacher);
  }

  formatDate(d: any): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('th-TH', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  getStatusLabel(status: string): string {
    const map: Record<string, string> = {
      pending:   'รอครูยืนยัน',
      approved:  'ครูยืนยันแล้ว',
      active:    'กำลังดำเนินการ',
      completed: 'เสร็จสิ้น',
      cancelled: 'ยกเลิก'
    };
    return map[status] || status;
  }

  getStatusClass(status: string): string {
    const map: Record<string, string> = {
      pending:   'badge-warning',
      approved:  'badge-success',
      active:    'badge-success',
      completed: 'badge-info',
      cancelled: 'badge-error'
    };
    return map[status] || 'badge-info';
  }

  getDifficultyLabel(d: string): string {
    return ({ easy: 'ง่าย', medium: 'ปานกลาง', hard: 'ยาก' } as any)[d] || d;
  }

  setFilter(mode: CourseFilterMode): void {
    this.filterMode = mode;
  }

  /** Status counts for filter chips */
  get courseCounts(): { all: number; pending: number; approved: number; completed: number; cancelled: number } {
    return {
      all: this.courses.length,
      pending: this.courses.filter(c => c.status === 'pending').length,
      approved: this.courses.filter(c => c.status === 'approved' || c.status === 'active').length,
      completed: this.courses.filter(c => c.status === 'completed').length,
      cancelled: this.courses.filter(c => c.status === 'cancelled').length
    };
  }

  /** Filtered + searched courses */
  get filteredCourses(): ICourse[] {
    const term = this.searchTerm.trim().toLowerCase();
    return this.courses.filter(c => {
      // Filter by mode
      if (this.filterMode === 'pending' && c.status !== 'pending') return false;
      if (this.filterMode === 'approved' && c.status !== 'approved' && c.status !== 'active') return false;
      if (this.filterMode === 'completed' && c.status !== 'completed') return false;
      if (this.filterMode === 'cancelled' && c.status !== 'cancelled') return false;
      // Search
      if (term) {
        const hay = `${c.subject || ''} ${c.name || ''} ${this.getTeacherName(c.teacher)} ${c.gradeLevel || ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }

  /** Days until scheduledDate; negative = past, 0 = today */
  getDaysUntil(d: any): number | null {
    if (!d) return null;
    const target = new Date(d);
    target.setHours(0, 0, 0, 0);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - now.getTime()) / 86400000);
  }

  /** Friendly relative date label */
  getRelativeLabel(d: any): string {
    const days = this.getDaysUntil(d);
    if (days === null) return '';
    if (days === 0) return 'วันนี้';
    if (days === 1) return 'พรุ่งนี้';
    if (days === -1) return 'เมื่อวาน';
    if (days > 0 && days <= 7) return `อีก ${days} วัน`;
    if (days < 0 && days >= -7) return `${Math.abs(days)} วันที่แล้ว`;
    return '';
  }
}
