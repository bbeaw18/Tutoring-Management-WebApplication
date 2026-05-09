import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CourseService } from '../../../services/course.service';
import { UserService } from '../../../services/user.service';
import { ICourse } from '../../../interfaces/course.interface';
import { IUser } from '../../../interfaces/user.interface';
import { LoadingComponent } from '../../../shared/components/loading/loading.component';
import { DatePickerComponent } from '../../../shared/components/date-picker/date-picker.component';
import { TimePickerComponent } from '../../../shared/components/time-picker/time-picker.component';
import { DisplayNamePipe } from '../../../shared/pipes/display-name.pipe';
import { resolveDisplayStatus, getDisplayStatusLabel, getDisplayStatusClass } from '../../../shared/constants/schedule-status';

@Component({
  selector: 'app-course-management',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, LoadingComponent, DatePickerComponent, TimePickerComponent, DisplayNamePipe],
  templateUrl: './course-management.component.html',
  styleUrls: ['./course-management.component.css']
})
export class CourseManagementComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  courses: ICourse[] = [];
  teachers: IUser[] = [];
  students: IUser[] = [];
  selectedStudentIds: string[] = [];

  bookingForm!: FormGroup;
  loading = false;
  submitting = false;
  showForm = false;
  successMessage = '';
  errorMessage = '';

  // ─── Edit Modal ───────────────────────────────────────────────
  showEditModal = false;
  editingCourse: ICourse | null = null;
  editSubmitting = false;
  editErrorMessage = '';
  // Edit form fields (two-way binding for simplicity)
  editDate        = '';
  editStartTime   = '';
  editEndTime     = '';
  editSubject     = '';
  editTeachingType = '';
  editGradeLevel  = '';
  editDescription = '';
  editTeacherId   = '';
  editIncomeInd: number | null = null;
  editIncomeGrp: number | null = null;
  editPrice: number | null = null;
  editType: 'individual' | 'group' = 'group';

  // Autocomplete lists (โหลดจาก DB)
  savedSubjects: string[] = [];
  savedTeachingTypes: string[] = [];

  gradeLevelOptions = [
    'ป.1', 'ป.2', 'ป.3', 'ป.4', 'ป.5', 'ป.6',
    'ม.1', 'ม.2', 'ม.3', 'ม.4', 'ม.5', 'ม.6',
    'มหาวิทยาลัย', 'อื่นๆ'
  ];

  constructor(
    private courseService: CourseService,
    private userService: UserService,
    private fb: FormBuilder
  ) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnInit(): void {
    this.initForm();
    this.loadAll();
  }

  initForm(): void {
    this.bookingForm = this.fb.group({
      subject:                ['', Validators.required],
      teacher:                ['', Validators.required],
      scheduledDate:          ['', Validators.required],
      startTime:              ['', Validators.required],
      endTime:                ['', Validators.required],
      type:                   ['group', Validators.required],
      teachingType:           [''],
      gradeLevel:             ['', Validators.required],
      description:            [''],
      // Default null → input ว่างเปล่า (ไม่มี 0 ให้ลบครั้งแรก)
      teacherIncomeIndividual:[null, [Validators.min(0)]],
      teacherIncomeGroup:     [null, [Validators.min(0)]],
      coursePrice:            [null, [Validators.min(0)]],
      // ── ทำซ้ำรายสัปดาห์จนถึงสิ้นเดือน ──
      repeatWeeklyUntilEndOfMonth: [false]
    });
  }

  /** วันที่ทั้งหมดที่จะนัดสอน (รวมวันแรก) เมื่อติ๊ก "ทำซ้ำรายสัปดาห์จนถึงสิ้นเดือน" */
  get repeatPreviewDates(): Date[] {
    const v = this.bookingForm?.get('scheduledDate')?.value;
    if (!v) return [];
    const base = new Date(v);
    if (isNaN(base.getTime())) return [];
    const dates: Date[] = [new Date(base)];
    if (!this.bookingForm.get('repeatWeeklyUntilEndOfMonth')?.value) return dates;
    const month = base.getMonth();
    const year  = base.getFullYear();
    const lastDay = new Date(year, month + 1, 0);  // last day of current month
    const next = new Date(base);
    next.setDate(next.getDate() + 7);
    while (next.getMonth() === month && next <= lastDay) {
      dates.push(new Date(next));
      next.setDate(next.getDate() + 7);
    }
    return dates;
  }

  /** "7, 14, 21, 28 พ.ค." */
  get repeatPreviewLabel(): string {
    const dates = this.repeatPreviewDates;
    if (dates.length === 0) return '';
    const monthShort = dates[0].toLocaleDateString('th-TH', { month: 'short' });
    return dates.map(d => d.getDate()).join(', ') + ' ' + monthShort;
  }

  /** ระยะเวลาคลาสในหน่วยชั่วโมง (จาก startTime - endTime) */
  get classDurationHours(): number {
    const s = this.bookingForm?.get('startTime')?.value;
    const e = this.bookingForm?.get('endTime')?.value;
    if (!s || !e) return 0;
    const [sh, sm] = String(s).split(':').map(Number);
    const [eh, em] = String(e).split(':').map(Number);
    if ([sh, sm, eh, em].some(n => isNaN(n))) return 0;
    const minutes = (eh * 60 + em) - (sh * 60 + sm);
    return minutes > 0 ? minutes / 60 : 0;
  }

  /** อัตรา/ชม. ที่เลือก (เดี่ยว vs กลุ่ม) */
  get teacherIncomeRate(): number {
    const t = this.bookingForm?.get('type')?.value;
    if (t === 'individual') {
      return Number(this.bookingForm?.get('teacherIncomeIndividual')?.value) || 0;
    }
    return Number(this.bookingForm?.get('teacherIncomeGroup')?.value) || 0;
  }

  /** รายได้ครูทั้งหมด = อัตรา/ชม. × duration (ชั่วโมง) — ปัดเป็นจำนวนเต็ม */
  get teacherIncomeTotal(): number {
    return Math.round(this.teacherIncomeRate * this.classDurationHours);
  }

  /** อัตราค่าเรียน/ชม. ที่ Manager กรอก */
  get coursePriceRate(): number {
    return Number(this.bookingForm?.get('coursePrice')?.value) || 0;
  }

  /** ค่าเรียนทั้งหมดที่นักเรียนต้องจ่าย = อัตรา/ชม. × duration (ชั่วโมง) — ปัดเป็นจำนวนเต็ม */
  get coursePriceTotal(): number {
    return Math.round(this.coursePriceRate * this.classDurationHours);
  }

  loadAll(): void {
    this.loading = true;
    this.courseService.getCourses({ limit: 100 } as any)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.courses = res.data || [];
          this.loading = false;
        },
        error: () => { this.loading = false; }
      });

    // โหลดทั้ง teacher และ manager (manager ก็สามารถสอนได้)
    let teacherList: IUser[] = [];
    let managerList: IUser[] = [];
    let loaded = 0;
    const mergeTeachers = () => {
      loaded++;
      if (loaded === 2) {
        // manager ขึ้นก่อน แล้วตามด้วย teacher
        this.teachers = [
          ...managerList.map(u => ({ ...u, _displayRole: 'ผู้จัดการ' } as any)),
          ...teacherList.map(u => ({ ...u, _displayRole: 'ครู' } as any))
        ];
      }
    };
    // รวม manager ที่สอนได้ในรายชื่อครูด้วย (ครูในระบบ + manager)
    this.userService.getTeachingStaff()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => { teacherList = res.data || []; mergeTeachers(); },
        error: () => { mergeTeachers(); }
      });
    this.userService.getUsers({ role: 'manager' } as any)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => { managerList = res.data || []; mergeTeachers(); },
        error: () => { mergeTeachers(); }
      });

    this.userService.getStudents()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (students) => { this.students = students || []; },
        error: (err) => console.error('[CourseMgmt] getStudents failed:', err)
      });

    // โหลด autocomplete lists จาก DB
    this.courseService.getSubjects()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => { this.savedSubjects = data; },
        error: (err) => console.error('[CourseMgmt] getSubjects failed:', err)
      });
    this.courseService.getTeachingTypes()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => { this.savedTeachingTypes = data; },
        error: (err) => console.error('[CourseMgmt] getTeachingTypes failed:', err)
      });
  }

  toggleStudentSelection(studentId: string): void {
    const idx = this.selectedStudentIds.indexOf(studentId);
    if (idx === -1) {
      // เดี่ยว: เลือกได้แค่ 1 คน
      if (this.bookingForm.get('type')?.value === 'individual') {
        this.selectedStudentIds = [studentId];
      } else {
        this.selectedStudentIds.push(studentId);
      }
    } else {
      this.selectedStudentIds.splice(idx, 1);
    }
  }

  isStudentSelected(studentId: string): boolean {
    return this.selectedStudentIds.includes(studentId);
  }

  onTypeChange(): void {
    const type = this.bookingForm.get('type')?.value;
    if (type === 'individual') {
      // เหลือแค่คนแรก
      if (this.selectedStudentIds.length > 1) {
        this.selectedStudentIds = [this.selectedStudentIds[0]];
      }
      // สอนเดี่ยวไม่ต้องใช้รายได้กลุ่ม → เคลียร์ทิ้ง
      this.bookingForm.patchValue({ teacherIncomeGroup: null }, { emitEvent: false });
    }
    // เมื่อเปลี่ยนเป็น 'group' ไม่ต้องเคลียร์ field ใด — manager กรอกได้ทั้งสองอัตรา
    // (เผื่อกรณีนักเรียนมาคนเดียว ระบบจะใช้อัตราสอนเดี่ยวอัตโนมัติ)
  }

  getSelectedStudentNames(): string {
    return this.selectedStudentIds
      .map(id => {
        const s: any = this.students.find(st => (st as any)._id === id || st.id === id);
        if (!s) return id;
        const nick = s.nickname || `${s.firstName} ${s.lastName}`;
        return `น้อง${nick}`;
      })
      .join(', ');
  }

  getTeacherName(teacher: any): string {
    if (!teacher) return '-';
    if (typeof teacher === 'object') {
      const nick = teacher.nickname || `${teacher.firstName} ${teacher.lastName}`;
      return `ครู${nick}`;
    }
    const t: any = this.teachers.find(t => t.id === teacher || (t as any)._id === teacher);
    if (!t) return '-';
    const nick = t.nickname || `${t.firstName} ${t.lastName}`;
    return `ครู${nick}`;
  }

  submitBooking(): void {
    this.successMessage = '';
    this.errorMessage = '';

    if (this.bookingForm.invalid) {
      this.bookingForm.markAllAsTouched();
      // รวบรวม field ที่ขาด
      const missing: string[] = [];
      const c = this.bookingForm.controls;
      if (c['subject']?.invalid)       missing.push('วิชา');
      if (c['teacher']?.invalid)       missing.push('ครูผู้สอน');
      if (c['scheduledDate']?.invalid) missing.push('วันที่นัดสอน');
      if (c['startTime']?.invalid)     missing.push('เวลาเริ่ม');
      if (c['endTime']?.invalid)       missing.push('เวลาสิ้นสุด');
      if (c['gradeLevel']?.invalid)    missing.push('ระดับชั้น');
      this.errorMessage = missing.length > 0
        ? `กรุณากรอกข้อมูลให้ครบ: ${missing.join(', ')}`
        : 'กรุณากรอกข้อมูลให้ครบทุกช่อง';
      this.scrollToError();
      return;
    }

    if (this.selectedStudentIds.length === 0) {
      this.errorMessage = 'กรุณาเลือกนักเรียนอย่างน้อย 1 คน (คลิกที่การ์ดนักเรียนด้านล่าง)';
      this.scrollToError();
      return;
    }

    const v = this.bookingForm.value;
    const payload = {
      subject:                v.subject,
      teacher:                v.teacher,
      students:               this.selectedStudentIds,
      scheduledDate:          v.scheduledDate,
      startTime:              v.startTime,
      endTime:                v.endTime,
      type:                   v.type,
      teachingType:           v.teachingType || '',
      gradeLevel:             v.gradeLevel,
      description:            v.description || '',
      teacherIncomeIndividual: Number(v.teacherIncomeIndividual) || 0,
      teacherIncomeGroup:      Number(v.teacherIncomeGroup) || 0,
      coursePrice:             Number(v.coursePrice) || 0,
      repeatWeeklyUntilEndOfMonth: !!v.repeatWeeklyUntilEndOfMonth
    };

    this.submitting = true;
    this.courseService.createCourse(payload as any)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
      next: () => {
        this.submitting = false;
        this.showForm = false;
        this.bookingForm.reset({ type: 'group', teacherIncomeIndividual: null, teacherIncomeGroup: null, coursePrice: null, repeatWeeklyUntilEndOfMonth: false });
        this.selectedStudentIds = [];
        // โหลด autocomplete ใหม่หลังสร้าง (เผื่อมีวิชาหรือประเภทการสอนใหม่)
        // H3: ใช้ takeUntil(destroy$) ป้องกัน memory leak
        this.courseService.getSubjects()
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: (d) => { this.savedSubjects = d; },
            error: (err) => console.error('[CourseMgmt] reload subjects failed:', err)
          });
        this.courseService.getTeachingTypes()
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: (d) => { this.savedTeachingTypes = d; },
            error: (err) => console.error('[CourseMgmt] reload teachingTypes failed:', err)
          });
        this.successMessage = 'สร้างนัดสอนสำเร็จ! ส่งแจ้งเตือนไปยังครูและนักเรียนแล้ว';
        this.loadAll();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => { this.successMessage = ''; }, 6000);
      },
      error: (err) => {
        this.submitting = false;
        const raw: string = err?.error?.message || '';
        this.errorMessage = this.translateCourseError(raw);
        this.scrollToError();
      }
    });
  }

  private translateCourseError(msg: string): string {
    if (!msg) return 'เกิดข้อผิดพลาดในการสร้างนัดสอน กรุณาลองใหม่';
    if (msg.includes('ไม่พบครูที่เลือก') || msg.includes('Invalid teacher'))
      return 'ไม่พบครูที่เลือก กรุณาเลือกครูใหม่';
    if (msg.includes('พบนักเรียนบางคนไม่ถูกต้อง'))
      return 'พบนักเรียนบางคนไม่ถูกต้อง กรุณาเลือกนักเรียนใหม่';
    if (msg.includes('Missing required') || msg.includes('กรุณากรอกข้อมูลให้ครบ'))
      return 'กรุณากรอกข้อมูลให้ครบทุกช่อง (วิชา, ครู, วันที่, เวลา)';
    if (msg.includes('Unauthorized') || msg.includes('401'))
      return 'หมดเวลาเข้าสู่ระบบ กรุณา Login ใหม่';
    if (msg.includes('403'))
      return 'ไม่มีสิทธิ์ดำเนินการนี้';
    return msg;
  }

  private scrollToError(): void {
    setTimeout(() => {
      const el = document.querySelector('.alert-error');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }

  cancelCourse(courseId: string): void {
    if (!confirm('ยืนยันการยกเลิกนัดสอนนี้?\n\nนัดสอนจะถูกตั้งเป็น "ยกเลิก" และสามารถลบออกถาวรได้ในภายหลัง')) return;
    this.courseService.deleteCourse(courseId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => { this.loadAll(); },
        error: (err) => console.error('[CourseMgmt] cancelCourse failed:', err)
      });
  }

  permanentDelete(courseId: string): void {
    if (!confirm('ยืนยันการลบออกถาวร?\n\nการดำเนินการนี้ไม่สามารถย้อนกลับได้ รายการนัดสอนและข้อมูลที่เกี่ยวข้องจะถูกลบออกจากระบบทั้งหมด')) return;
    this.courseService.permanentDeleteCourse(courseId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
      next: () => {
        this.successMessage = 'ลบนัดสอนออกจากระบบเรียบร้อยแล้ว';
        this.loadAll();
        setTimeout(() => { this.successMessage = ''; }, 4000);
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'เกิดข้อผิดพลาดในการลบ';
      }
    });
  }

  // ─── Edit Modal ───────────────────────────────────────────────
  openEditModal(course: ICourse): void {
    this.editingCourse   = course;
    this.showEditModal   = true;
    this.editErrorMessage = '';

    // Pre-fill fields from existing course data
    const dateObj = course.scheduledDate ? new Date(course.scheduledDate) : null;
    this.editDate         = dateObj ? this.toInputDate(dateObj) : '';
    this.editStartTime    = course.startTime   || '';
    this.editEndTime      = course.endTime     || '';
    this.editSubject      = course.subject     || '';
    this.editTeachingType = course.teachingType || '';
    this.editGradeLevel   = course.gradeLevel  || '';
    this.editDescription  = course.description || '';
    this.editTeacherId    = this.getId(course.teacher);
    // Use null instead of 0 so the input shows empty (no "0" to delete)
    this.editIncomeInd    = course.teacherIncomeIndividual ? course.teacherIncomeIndividual : null;
    this.editIncomeGrp    = course.teacherIncomeGroup      ? course.teacherIncomeGroup      : null;
    this.editPrice        = course.coursePrice             ? course.coursePrice             : null;
    this.editType         = (course as any).type === 'individual' ? 'individual' : 'group';
  }

  /** เมื่อสลับประเภทใน edit modal — เคลียร์เฉพาะ "เดี่ยว" → "กลุ่ม" ไม่ต้องเคลียร์
   *  เพราะ group สามารถมีทั้ง 2 อัตราเป็น fallback ได้ */
  onEditTypeChange(): void {
    if (this.editType === 'individual') this.editIncomeGrp = null;
    // group: keep both rates (fallback for solo attendance)
  }

  closeEditModal(): void {
    this.showEditModal   = false;
    this.editingCourse   = null;
    this.editErrorMessage = '';
  }

  submitEdit(): void {
    if (!this.editingCourse) return;
    if (!this.editDate || !this.editStartTime || !this.editEndTime || !this.editSubject) {
      this.editErrorMessage = 'กรุณากรอกข้อมูลที่จำเป็น: วิชา, วันที่, เวลาเริ่ม, เวลาสิ้นสุด';
      return;
    }
    this.editSubmitting   = true;
    this.editErrorMessage = '';

    const payload = {
      scheduledDate:          this.editDate,
      startTime:              this.editStartTime,
      endTime:                this.editEndTime,
      subject:                this.editSubject,
      teachingType:           this.editTeachingType,
      gradeLevel:             this.editGradeLevel,
      description:            this.editDescription,
      teacher:                this.editTeacherId || undefined,
      type:                    this.editType,
      teacherIncomeIndividual: Number(this.editIncomeInd) || 0,
      teacherIncomeGroup:      Number(this.editIncomeGrp) || 0,
      coursePrice:             Number(this.editPrice)     || 0
    };

    this.courseService.editCourseBooking(this.getId(this.editingCourse), payload as any)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
      next: () => {
        this.editSubmitting = false;
        this.closeEditModal();
        this.successMessage = 'แก้ไขนัดสอนสำเร็จ — ส่งอีเมลแจ้งเตือนครูและนักเรียนแล้ว';
        this.loadAll();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => { this.successMessage = ''; }, 6000);
      },
      error: (err) => {
        this.editSubmitting   = false;
        this.editErrorMessage = err?.error?.message || 'เกิดข้อผิดพลาดในการแก้ไข';
      }
    });
  }

  private toInputDate(d: Date): string {
    const y  = d.getFullYear();
    const m  = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  resetForm(): void {
    this.bookingForm.reset({
      type: 'group',
      teacherIncomeIndividual: null,
      teacherIncomeGroup: null,
      coursePrice: null
    });
    this.selectedStudentIds = [];
    this.showForm = false;
    this.errorMessage = '';
  }

  /**
   * Use unified displayStatus from backend (attached on GET /courses).
   * Falls back to deriving from raw fields if missing.
   */
  getStatusLabel(course: any): string {
    return getDisplayStatusLabel(resolveDisplayStatus(course));
  }

  getStatusClass(course: any): string {
    return getDisplayStatusClass(resolveDisplayStatus(course));
  }

  getDifficultyLabel(d: string): string {
    return { easy: 'ง่าย', medium: 'ปานกลาง', hard: 'ยาก' }[d] || d;
  }

  getTypeLabel(t: string): string {
    return t === 'individual' ? 'เดี่ยว' : 'กลุ่ม';
  }

  formatDateTime(date: any): string {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }

  isFieldInvalid(field: string): boolean {
    const ctrl = this.bookingForm.get(field);
    return !!(ctrl && ctrl.invalid && ctrl.touched);
  }

  // Safe ID getter — avoids TypeScript `string | undefined` errors in templates
  getId(obj: any): string {
    return obj?.id || obj?._id || '';
  }

  // ── Tab filtering / search ────────────────────────────────
  cmTab: 'all' | 'pending' | 'approved' | 'completed' | 'cancelled' = 'all';
  cmSearch = '';

  setCmTab(t: 'all' | 'pending' | 'approved' | 'completed' | 'cancelled'): void {
    this.cmTab = t;
  }

  get cmCounts(): { all: number; pending: number; approved: number; completed: number; cancelled: number } {
    return {
      all: this.courses.length,
      pending: this.courses.filter(c => c.status === 'pending').length,
      approved: this.courses.filter(c => c.status === 'approved' || c.status === 'active').length,
      completed: this.courses.filter(c => c.status === 'completed').length,
      cancelled: this.courses.filter(c => c.status === 'cancelled').length
    };
  }

  get cmFiltered(): ICourse[] {
    const term = this.cmSearch.trim().toLowerCase();
    return this.courses.filter(c => {
      if (this.cmTab === 'pending'   && c.status !== 'pending') return false;
      if (this.cmTab === 'approved'  && c.status !== 'approved' && c.status !== 'active') return false;
      if (this.cmTab === 'completed' && c.status !== 'completed') return false;
      if (this.cmTab === 'cancelled' && c.status !== 'cancelled') return false;
      if (term) {
        const teacher: any = c.teacher;
        const teacherName = teacher && typeof teacher === 'object' ? `${teacher.firstName} ${teacher.lastName}` : '';
        const hay = `${c.subject || ''} ${c.name || ''} ${teacherName} ${c.gradeLevel || ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }
}
