import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CourseService } from '../../../services/course.service';
import { EnrollmentService } from '../../../services/enrollment.service';
import { AuthService } from '../../../services/auth.service';
import { ICourse } from '../../../interfaces/course.interface';
import { IEnrollment } from '../../../interfaces/enrollment.interface';
import { LoadingComponent } from '../../../shared/components/loading/loading.component';
import { FormsModule } from '@angular/forms';
import { DisplayNamePipe } from '../../../shared/pipes/display-name.pipe';

@Component({
  selector: 'app-teacher-courses',
  standalone: true,
  imports: [CommonModule, LoadingComponent, FormsModule, DisplayNamePipe],
  templateUrl: './teacher-courses.component.html',
  styleUrls: ['./teacher-courses.component.css']
})
export class TeacherCoursesComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  courses: ICourse[] = [];
  courseEnrollments: { [courseId: string]: IEnrollment[] } = {};
  loading = false;
  actionLoading: { [courseId: string]: boolean } = {};
  successMessage = '';
  expandedCourseId: string | null = null;
  currentUser = this.authService.getCurrentUser();

  constructor(
    private courseService: CourseService,
    private enrollmentService: EnrollmentService,
    private authService: AuthService
  ) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnInit(): void {
    this.loadCourses();
  }

  loadCourses(): void {
    this.loading = true;
    const teacherId = this.currentUser?.id;
    if (teacherId) {
      this.courseService.getCoursesByTeacher(teacherId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
        next: (res) => {
          this.courses = res;
          this.loading = false;
          this.courses.forEach(course => {
            this.loadEnrollments(course.id);
          });
        },
        error: (error) => {
          console.error(error);
          this.loading = false;
        }
      });
    }
  }

  loadEnrollments(courseId: string): void {
    this.enrollmentService.getEnrollmentsByCourse(courseId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
      next: (enrollments) => {
        this.courseEnrollments[courseId] = enrollments;
      },
      error: (error) => {
        console.error(error);
      }
    });
  }

  acceptCourse(courseId: string): void {
    if (!confirm('ยืนยันรับการสอนนัดนี้?')) return;
    this.actionLoading[courseId] = true;
    this.courseService.acceptCourse(courseId).subscribe({
      next: (updatedCourse) => {
        this.actionLoading[courseId] = false;
        // อัพเดต local array ด้วย spread (trigger Angular CD)
        const idx = this.courses.findIndex(
          c => this.getId(c) === courseId
        );
        if (idx !== -1) {
          const base = updatedCourse || {};
          this.courses[idx] = {
            ...this.courses[idx],
            ...base,
            status: (base as any).status || 'approved',
            teacherAccepted: true
          } as ICourse;
          // reassign array reference เพื่อ force CD
          this.courses = [...this.courses];
        } else {
          // fallback: reload ทั้งหมด
          this.loadCourses();
        }
        this.showSuccess('ยืนยันรับการสอนเรียบร้อย — เพิ่มในปฏิทินแล้ว');
      },
      error: (error) => {
        this.actionLoading[courseId] = false;
        console.error('Accept error:', error);
        alert('เกิดข้อผิดพลาด: ' + (error?.error?.message || error?.message || 'กรุณาลองใหม่'));
      }
    });
  }

  rejectCourse(courseId: string): void {
    const reason = prompt('เหตุผลในการปฏิเสธ (ไม่บังคับ):') ?? '';
    this.actionLoading[courseId] = true;
    this.courseService.rejectCourse(courseId, reason).subscribe({
      next: () => {
        this.actionLoading[courseId] = false;
        const idx = this.courses.findIndex(c => this.getId(c) === courseId);
        if (idx !== -1) {
          this.courses[idx] = { ...this.courses[idx], status: 'cancelled' } as ICourse;
          this.courses = [...this.courses];
        } else {
          this.loadCourses();
        }
        this.showSuccess('การปฏิเสธบันทึกเรียบร้อยแล้ว');
      },
      error: (error) => {
        this.actionLoading[courseId] = false;
        console.error('Reject error:', error);
        alert('เกิดข้อผิดพลาด: ' + (error?.error?.message || error?.message || 'กรุณาลองใหม่'));
      }
    });
  }

  showSuccess(msg: string): void {
    this.successMessage = msg;
    setTimeout(() => { this.successMessage = ''; }, 4000);
  }

  toggleCourseDetails(courseId: string): void {
    this.expandedCourseId = this.expandedCourseId === courseId ? null : courseId;
  }

  formatDate(date: Date): string {
    return new Date(date).toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  getStatusBadgeClass(status: string): string {
    const statusMap: { [key: string]: string } = {
      'pending':   'badge-warning',
      'approved':  'badge-success',
      'active':    'badge-success',
      'completed': 'badge-primary',
      'cancelled': 'badge-error'
    };
    return statusMap[status] || 'badge-primary';
  }

  getStatusLabel(status: string): string {
    // Course-level status mapping (ใช้กับ Course)
    const labels: { [key: string]: string } = {
      'pending':   'รอครูยืนยัน',
      'approved':  'ครูยืนยันแล้ว',
      'active':    'กำลังสอน',
      'completed': 'เสร็จสิ้น',
      'cancelled': 'ยกเลิก'
    };
    return labels[status] || status;
  }

  getTeacherName(teacher: any): string {
    if (!teacher) return '-';
    if (typeof teacher === 'object') return (teacher.nickname || `${teacher.firstName} ${teacher.lastName}`);
    return teacher;
  }

  getStudentNames(students: any[]): string {
    if (!students || students.length === 0) return 'ยังไม่มีนักเรียน';
    return students.map((s: any) => s.nickname || `${s.firstName} ${s.lastName}`).join(', ');
  }

  formatScheduledDate(course: any): string {
    if (course.scheduledDate) {
      return new Date(course.scheduledDate).toLocaleDateString('th-TH', {
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
      });
    }
    if (course.startDate) return this.formatDate(course.startDate);
    return 'ไม่ระบุ';
  }

  // Safe ID getter — avoids TypeScript `string | undefined` in templates
  getId(obj: any): string {
    return obj?.id || obj?._id || '';
  }

  // ── Filter / Search state ────────────────────────────────────────
  filterMode: 'all' | 'pending' | 'approved' | 'completed' | 'cancelled' = 'all';
  searchTerm = '';

  setFilter(mode: 'all' | 'pending' | 'approved' | 'completed' | 'cancelled'): void {
    this.filterMode = mode;
  }

  get courseStats(): { all: number; pending: number; approved: number; completed: number; cancelled: number; students: number } {
    const allEnrollments = Object.values(this.courseEnrollments).flat();
    const uniqueStudentIds = new Set(allEnrollments.map(e => (e as any).studentId || (e as any).student?._id || (e as any).student?.id));
    return {
      all: this.courses.length,
      pending: this.courses.filter(c => c.status === 'pending').length,
      approved: this.courses.filter(c => c.status === 'approved' || c.status === 'active').length,
      completed: this.courses.filter(c => c.status === 'completed').length,
      cancelled: this.courses.filter(c => c.status === 'cancelled').length,
      students: uniqueStudentIds.size
    };
  }

  get filteredCourses(): ICourse[] {
    const term = this.searchTerm.trim().toLowerCase();
    return this.courses.filter(c => {
      if (this.filterMode === 'pending'   && c.status !== 'pending') return false;
      if (this.filterMode === 'approved'  && c.status !== 'approved' && c.status !== 'active') return false;
      if (this.filterMode === 'completed' && c.status !== 'completed') return false;
      if (this.filterMode === 'cancelled' && c.status !== 'cancelled') return false;
      if (term) {
        const hay = `${c.subject || ''} ${c.name || ''} ${this.getStudentNames((c as any).students || [])} ${c.gradeLevel || ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }

  /** Pending count — drives the alert banner */
  get pendingActionCount(): number {
    return this.courseStats.pending;
  }
}
