import { Component, OnInit, OnDestroy, CUSTOM_ELEMENTS_SCHEMA, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CourseService } from '../../../services/course.service';
import { UserService } from '../../../services/user.service';
import { ScheduleService } from '../../../services/schedule.service';
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
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './course-management.component.html',
  styleUrls: ['./course-management.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
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

  // ─── Series Modal (ชุดนัดสอนอัตโนมัติ) ─────────────────────────
  showSeriesModal = false;
  seriesModalCourses: ICourse[] = [];
  seriesModalAnchor: ICourse | null = null;

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

  /** schedule id currently being manager-confirmed */
  confirmingId = '';

  /** courseId ที่ส่งมาจาก master calendar ผ่าน query param `?edit=` — รอเปิด edit modal หลังโหลด courses เสร็จ */
  private pendingEditId = '';

  constructor(
    private courseService: CourseService,
    private userService: UserService,
    private scheduleService: ScheduleService,
    private route: ActivatedRoute,
    private router: Router,
    private fb: FormBuilder,
    private cdr: ChangeDetectorRef
  ) {}

  /** Manager/Admin confirms class completion (awaiting_confirmation → completed) */
  managerConfirmClass(course: any, ev?: Event): void {
    ev?.stopPropagation();
    const scheduleId = course?.scheduleId;
    const courseId = this.getId(course);
    if (!scheduleId || !courseId || this.confirmingId) return;
    this.confirmingId = courseId;
    this.scheduleService.managerConfirm(scheduleId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => { this.confirmingId = ''; this.loadAll(); this.cdr.markForCheck(); },
        error: () => { this.confirmingId = ''; this.cdr.markForCheck(); }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnInit(): void {
    this.initForm();
    // อ่าน query param `edit=<courseId>` จาก master calendar — จะเปิด edit modal หลังโหลดรายการ courses เสร็จ
    this.route.queryParamMap
      .pipe(takeUntil(this.destroy$))
      .subscribe(qp => {
        const id = qp.get('edit') || '';
        if (id) this.pendingEditId = id;
      });
    this.loadAll();
  }

  /** เปิด edit modal สำหรับ courseId ที่ส่งมาจาก master calendar — เคลียร์ query param หลังเปิด */
  private maybeOpenPendingEdit(): void {
    if (!this.pendingEditId) return;
    const target = this.courses.find(c => this.getId(c) === this.pendingEditId);
    if (!target) { this.pendingEditId = ''; return; }
    this.pendingEditId = '';
    this.openEditModal(target);
    this.router.navigate([], { queryParams: { edit: null }, queryParamsHandling: 'merge', replaceUrl: true });
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
    let minutes = (eh * 60 + em) - (sh * 60 + sm);
    if (minutes <= 0) minutes += 24 * 60; // ข้ามเที่ยงคืน (เลิกวันถัดไป)
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

  // ── Hourly-mode rollout cutoffs ──
  // เริ่มใช้การคิดต่อชม. ตั้งแต่วันที่กำหนด — คลาสก่อนหน้านี้ยังเป็น flat-rate เดิม
  private readonly TEACHER_HOURLY_FROM = new Date('2026-05-08T00:00:00+07:00'); // 8 พ.ค.
  private readonly PRICE_HOURLY_FROM   = new Date('2026-05-09T00:00:00+07:00'); // 9 พ.ค.

  /** ใช้รูปแบบ "ชม.ละ × ชม. = รวม" สำหรับ "รายได้ครู" หรือไม่ */
  isTeacherHourlyDisplay(course: any): boolean {
    const d = this.getCourseDate(course);
    return !!d && d >= this.TEACHER_HOURLY_FROM;
  }

  /** ใช้รูปแบบ "ชม.ละ × ชม. = รวม" สำหรับ "ค่าเรียน" หรือไม่ */
  isPriceHourlyDisplay(course: any): boolean {
    const d = this.getCourseDate(course);
    return !!d && d >= this.PRICE_HOURLY_FROM;
  }

  private getCourseDate(course: any): Date | null {
    const raw = course?.scheduledDate || course?.date;
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  // ── Card display helpers ── (อัตรา × ชม. = ยอดรวม) ──
  /** จำนวนชั่วโมงของคลาส คำนวณจาก startTime - endTime */
  getCardHours(course: any): number {
    if (!course?.startTime || !course?.endTime) return 0;
    const [sh, sm] = String(course.startTime).split(':').map(Number);
    const [eh, em] = String(course.endTime).split(':').map(Number);
    let minutes = (eh * 60 + em) - (sh * 60 + sm);
    if (minutes <= 0) minutes += 24 * 60; // ข้ามเที่ยงคืน (เลิกวันถัดไป)
    return minutes > 0 ? minutes / 60 : 0;
  }

  /** อัตรารายได้ครู/ชม. ตามประเภทคลาส */
  getTeacherRate(course: any): number {
    if (!course) return 0;
    return course.type === 'individual'
      ? Number(course.teacherIncomeIndividual || 0)
      : Number(course.teacherIncomeGroup || 0);
  }

  /** ยอดรายได้ครูรวม = อัตรา × ชม. */
  getTeacherTotal(course: any): number {
    return Math.round(this.getTeacherRate(course) * this.getCardHours(course));
  }

  /** อัตราค่าเรียน/ชม. */
  getCoursePriceRate(course: any): number {
    return Number(course?.coursePrice || 0);
  }

  /** ยอดค่าเรียนรวม (ต่อคน) = อัตรา × ชม. */
  getCoursePriceTotalForCard(course: any): number {
    return Math.round(this.getCoursePriceRate(course) * this.getCardHours(course));
  }

  /** Format ชั่วโมง — "2 ชม." หรือ "1.5 ชม." */
  formatHours(h: number): string {
    if (!h || h <= 0) return '0 ชม.';
    return Number.isInteger(h) ? `${h} ชม.` : `${h.toFixed(1)} ชม.`;
  }

  loadAll(): void {
    this.loading = true;
    this.courseService.getCourses({ limit: 10000 } as any)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.courses = res.data || [];
          this.onCoursesChanged();
          this.loading = false;
          this.maybeOpenPendingEdit();
          this.cdr.markForCheck();
        },
        error: () => { this.loading = false; this.cdr.markForCheck(); }
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
        this.cdr.markForCheck();
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
        next: (students) => { this.students = students || []; this.cdr.markForCheck(); },
        error: (err) => console.error('[CourseMgmt] getStudents failed:', err)
      });

    // โหลด autocomplete lists จาก DB
    this.courseService.getSubjects()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => { this.savedSubjects = data; this.cdr.markForCheck(); },
        error: (err) => console.error('[CourseMgmt] getSubjects failed:', err)
      });
    this.courseService.getTeachingTypes()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => { this.savedTeachingTypes = data; this.cdr.markForCheck(); },
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
            next: (d) => { this.savedSubjects = d; this.cdr.markForCheck(); },
            error: (err) => console.error('[CourseMgmt] reload subjects failed:', err)
          });
        this.courseService.getTeachingTypes()
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: (d) => { this.savedTeachingTypes = d; this.cdr.markForCheck(); },
            error: (err) => console.error('[CourseMgmt] reload teachingTypes failed:', err)
          });
        this.successMessage = 'สร้างนัดสอนสำเร็จ! ส่งแจ้งเตือนไปยังครูและนักเรียนแล้ว';
        this.loadAll();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        this.cdr.markForCheck();
        setTimeout(() => { this.successMessage = ''; this.cdr.markForCheck(); }, 6000);
      },
      error: (err) => {
        this.submitting = false;
        const raw: string = err?.error?.message || '';
        this.errorMessage = this.translateCourseError(raw);
        this.scrollToError();
        this.cdr.markForCheck();
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
        next: () => { this.loadAll(); this.cdr.markForCheck(); },
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
        this.cdr.markForCheck();
        setTimeout(() => { this.successMessage = ''; this.cdr.markForCheck(); }, 4000);
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'เกิดข้อผิดพลาดในการลบ';
        this.cdr.markForCheck();
      }
    });
  }

  // ─── Series helpers (ชุดนัดสอนอัตโนมัติ) ───────────────────────
  /** คอร์สนี้เป็นส่วนหนึ่งของชุดนัดสอนอัตโนมัติหรือไม่ */
  isSeriesCourse(course: any): boolean {
    return !!(course?.seriesId);
  }

  /** จำนวนคลาสทั้งหมดในชุดเดียวกัน — ใช้ค่าจาก backend (seriesSize) เป็นหลัก
   *  ถ้าไม่มี ให้นับจากคอร์สที่โหลดมาแล้วซึ่งมี seriesId เดียวกัน */
  getSeriesCount(course: any): number {
    if (!this.isSeriesCourse(course)) return 0;
    const fromField = Number(course.seriesSize) || 0;
    if (fromField > 0) return fromField;
    return this.courses.filter(c => (c as any).seriesId === course.seriesId).length;
  }

  /** คลาสทั้งหมดในชุดเดียวกัน เรียงตามวันที่ — อ่านจาก prebuilt Map (O(1) lookup)
   *  คืนค่า array ที่ cache ไว้ (read-only สำหรับผู้เรียก) */
  getSeriesCourses(seriesId: string): ICourse[] {
    if (!seriesId) return [];
    return this._seriesMap.get(seriesId) || [];
  }

  /** จำนวนคลาสในชุดที่ Manager ยืนยันเสร็จสิ้นแล้ว (displayStatus === 'completed') */
  getSeriesCompletedCount(course: any): number {
    if (!this.isSeriesCourse(course)) return 0;
    return this.getSeriesCourses(course.seriesId)
      .filter(c => resolveDisplayStatus(c) === 'completed')
      .length;
  }

  /** ลำดับของคลาสนี้ในชุด (1-based) — สำหรับแสดง "1/4" บนการ์ด */
  getSeriesIndex(course: any): number {
    if (!this.isSeriesCourse(course)) return 0;
    const all = this.getSeriesCourses(course.seriesId);
    const idx = all.findIndex(c => this.getId(c) === this.getId(course));
    return idx >= 0 ? idx + 1 : 0;
  }

  openSeriesModal(course: ICourse): void {
    if (!this.isSeriesCourse(course)) return;
    this.seriesModalAnchor = course;
    this.seriesModalCourses = this.getSeriesCourses((course as any).seriesId);
    this.showSeriesModal = true;
  }

  closeSeriesModal(): void {
    this.showSeriesModal = false;
    this.seriesModalCourses = [];
    this.seriesModalAnchor = null;
  }

  /** วันที่ของคลาสในชุด — รูปแบบสั้น "อา. 17 พ.ค." */
  formatSeriesDate(date: any): string {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('th-TH', {
      weekday: 'short', day: 'numeric', month: 'short'
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
        this.cdr.markForCheck();
        setTimeout(() => { this.successMessage = ''; this.cdr.markForCheck(); }, 6000);
      },
      error: (err) => {
        this.editSubmitting   = false;
        this.editErrorMessage = err?.error?.message || 'เกิดข้อผิดพลาดในการแก้ไข';
        this.cdr.markForCheck();
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

  // trackBy — กัน Angular rebuild DOM ทั้ง list ทุก change-detection
  trackByGroup = (_: number, g: { dateKey: string }): string => g.dateKey;
  trackByCourseId = (_: number, c: ICourse): string => this.getId(c);

  // ── Tab filtering / search ────────────────────────────────
  // ใช้ displayStatus ตัวเดียวกับ calendar/history/revenue (6 สถานะ)
  cmTab: 'all' | 'pending_teacher' | 'pending_students' | 'confirmed' | 'awaiting_manager' | 'completed' | 'cancelled' = 'all';
  cmSearch = '';

  // Quick date filter — limits the timeline to today / this week / this month
  cmDateFilter: 'all' | 'today' | 'week' | 'month' = 'all';

  setCmTab(t: typeof this.cmTab): void {
    this.cmTab = t;
  }

  setCmDateFilter(f: typeof this.cmDateFilter): void {
    this.cmDateFilter = f;
  }

  /** [startMs, endMs] for the active date filter, or null when filter is 'all'.
   *  - today: 00:00 → 23:59:59 ของวันนี้
   *  - week:  อาทิตย์ 00:00 → เสาร์ 23:59:59 ของสัปดาห์ปัจจุบัน
   *  - month: 1 → วันสุดท้ายของเดือนปัจจุบัน */
  private computeDateRange(): { start: number; end: number } | null {
    return this.rangeFor(this.cmDateFilter);
  }

  /** Pure: [startMs, endMs] สำหรับ preset ที่ระบุ — ไม่แตะ state */
  private rangeFor(filter: 'all' | 'today' | 'week' | 'month'): { start: number; end: number } | null {
    if (filter === 'all') return null;
    const now = new Date();
    if (filter === 'today') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      return { start: start.getTime(), end: end.getTime() };
    }
    if (filter === 'week') {
      const dow = now.getDay(); // 0 = Sun
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow, 0, 0, 0, 0);
      const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + 6, 23, 59, 59, 999);
      return { start: start.getTime(), end: end.getTime() };
    }
    // month
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start: start.getTime(), end: end.getTime() };
  }

  /** นับคลาสในแต่ละ preset ครั้งเดียวต่อ courses เปลี่ยน — for chip badges */
  private computeDateCounts(): { all: number; today: number; week: number; month: number } {
    const today = this.rangeFor('today')!;
    const week  = this.rangeFor('week')!;
    const month = this.rangeFor('month')!;
    const res = { all: this.courses.length, today: 0, week: 0, month: 0 };
    for (const c of this.courses) {
      const raw = (c as any).scheduledDate;
      if (!raw) continue;
      const t = new Date(raw).getTime();
      if (t >= today.start && t <= today.end) res.today++;
      if (t >= week.start  && t <= week.end)  res.week++;
      if (t >= month.start && t <= month.end) res.month++;
    }
    return res;
  }

  /** Count classes that match a given date-filter preset — อ่านจาก memo */
  cmDateFilterCount(filter: 'all' | 'today' | 'week' | 'month'): number {
    this.ensureCourseMemo();
    return this._courseMemo.dateCounts![filter];
  }

  /** รายการคอร์สสำหรับการแสดงผล — แสดงทุกคลาสจริง รวมทุก member ของชุด
   *  อัตโนมัติ เพื่อให้แต่ละคลาสไปอยู่ในช่องวันที่นัดสอนของตัวเอง และให้
   *  ตัวเลขแท็บ/ฟิลเตอร์นับตรงกับจำนวนการ์ดที่เห็นจริงใน timeline.
   *  modal "ดูทั้งชุด" ยังอ่านจาก this.courses ผ่าน getSeriesCourses เช่นเดิม */
  get representativeCourses(): ICourse[] {
    return this.courses;
  }

  // ─── Memoization — หลีกเลี่ยงการ recompute getter หนักทุก change-detection cycle ──
  //   coursesVersion bump เมื่อ `courses` เปลี่ยน → invalidate cache ที่ขึ้นกับ courses
  //   _viewMemo เก็บผลลัพธ์ filter/timeline ตาม signature ของ filter state
  private coursesVersion = 0;
  private _seriesMap = new Map<string, ICourse[]>();

  /** เรียกเมื่อ `courses` เปลี่ยน — rebuild series map + invalidate memo */
  private onCoursesChanged(): void {
    this.coursesVersion++;
    const m = new Map<string, ICourse[]>();
    for (const c of this.courses) {
      const sid = (c as any).seriesId;
      if (!sid) continue;
      if (!m.has(sid)) m.set(sid, []);
      m.get(sid)!.push(c);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => {
        const da = a.scheduledDate ? new Date(a.scheduledDate).getTime() : 0;
        const db = b.scheduledDate ? new Date(b.scheduledDate).getTime() : 0;
        return da - db;
      });
    }
    this._seriesMap = m;
    this._viewMemo.sig = undefined;
    this._courseMemo.version = -1;
  }

  // ── memo ที่ขึ้นกับ courses อย่างเดียว (counts, options, date-filter counts) ──
  private _courseMemo: {
    version: number;
    counts?: any;
    subjectOptions?: { value: string; count: number }[];
    teacherOptions?: { id: string; label: string; count: number }[];
    dateCounts?: { all: number; today: number; week: number; month: number };
  } = { version: -1 };

  private ensureCourseMemo(): void {
    if (this._courseMemo.version === this.coursesVersion) return;
    this._courseMemo = {
      version: this.coursesVersion,
      counts: this.computeCounts(),
      subjectOptions: this.computeSubjectOptions(),
      teacherOptions: this.computeTeacherOptions(),
      dateCounts: this.computeDateCounts()
    };
  }

  // ── memo ที่ขึ้นกับ filter state (filtered list + timeline) ──
  private _viewMemo: {
    sig?: string;
    filtered?: ICourse[];
    timeline?: any[];
  } = {};

  private filterSignature(): string {
    return [this.coursesVersion, this.cmTab, this.cmSearch, this.cmDateFilter,
            this.cmSubjectFilter, this.cmTeacherFilter].join('|');
  }

  private ensureViewMemo(): void {
    const sig = this.filterSignature();
    if (this._viewMemo.sig === sig) return;
    const filtered = this.computeFiltered();
    this._viewMemo = {
      sig,
      filtered,
      timeline: this.computeTimeline(filtered)
    };
  }

  get cmCounts(): {
    all: number;
    pending_teacher: number;
    pending_students: number;
    confirmed: number;
    awaiting_manager: number;
    completed: number;
    cancelled: number;
  } {
    this.ensureCourseMemo();
    return this._courseMemo.counts;
  }

  private computeCounts(): {
    all: number;
    pending_teacher: number;
    pending_students: number;
    confirmed: number;
    awaiting_manager: number;
    completed: number;
    cancelled: number;
  } {
    const byStatus = {
      pending_teacher: 0,
      pending_students: 0,
      confirmed: 0,
      awaiting_manager: 0,
      completed: 0,
      cancelled: 0
    };
    // นับจาก representative เพื่อให้ตัวเลขในแท็บตรงกับจำนวนการ์ดที่แสดง
    const reps = this.representativeCourses;
    for (const c of reps) {
      const status = resolveDisplayStatus(c);
      if (status in byStatus) (byStatus as any)[status]++;
    }
    return { all: reps.length, ...byStatus };
  }

  get cmFiltered(): ICourse[] {
    this.ensureViewMemo();
    return this._viewMemo.filtered!;
  }

  private computeFiltered(): ICourse[] {
    const term = this.cmSearch.trim().toLowerCase();
    const dateRange = this.computeDateRange();
    return this.representativeCourses.filter(c => {
      if (this.cmTab !== 'all' && resolveDisplayStatus(c) !== this.cmTab) return false;
      if (this.cmSubjectFilter && (c.subject || '') !== this.cmSubjectFilter) return false;
      if (this.cmTeacherFilter) {
        const t: any = c.teacher;
        const tid = (t && typeof t === 'object') ? (t._id || t.id || '') : (t || '');
        if (tid !== this.cmTeacherFilter) return false;
      }
      if (dateRange) {
        const raw = (c as any).scheduledDate;
        if (!raw) return false;
        const t = new Date(raw).getTime();
        if (t < dateRange.start || t > dateRange.end) return false;
      }
      if (term) {
        const teacher: any = c.teacher;
        const teacherName = teacher && typeof teacher === 'object' ? `${teacher.firstName} ${teacher.lastName}` : '';
        const hay = `${c.subject || ''} ${c.name || ''} ${teacherName} ${c.gradeLevel || ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }

  // ─── v2: Filter chips (subject + teacher) ──────────────────
  cmSubjectFilter = '';
  cmTeacherFilter = '';

  /** Distinct subject options from current courses. Sorted, plus a count badge. */
  get cmSubjectOptions(): { value: string; count: number }[] {
    this.ensureCourseMemo();
    return this._courseMemo.subjectOptions!;
  }
  private computeSubjectOptions(): { value: string; count: number }[] {
    const map = new Map<string, number>();
    for (const c of this.representativeCourses) {
      const s = (c.subject || '').trim();
      if (!s) continue;
      map.set(s, (map.get(s) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'th'));
  }
  /** Distinct teacher options from current courses. */
  get cmTeacherOptions(): { id: string; label: string; count: number }[] {
    this.ensureCourseMemo();
    return this._courseMemo.teacherOptions!;
  }
  private computeTeacherOptions(): { id: string; label: string; count: number }[] {
    const map = new Map<string, { label: string; count: number }>();
    for (const c of this.representativeCourses) {
      const t: any = c.teacher;
      if (!t || typeof t !== 'object') continue;
      const id = t._id || t.id;
      if (!id) continue;
      const label = (t.nickname || '').trim() || `${t.firstName || ''} ${t.lastName || ''}`.trim();
      const cur = map.get(id);
      if (cur) cur.count++;
      else map.set(id, { label: label || '—', count: 1 });
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, label: v.label, count: v.count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'th'));
  }

  toggleSubjectFilter(s: string): void {
    this.cmSubjectFilter = (this.cmSubjectFilter === s) ? '' : s;
  }
  toggleTeacherFilter(id: string): void {
    this.cmTeacherFilter = (this.cmTeacherFilter === id) ? '' : id;
  }
  clearAxisFilters(): void {
    this.cmSubjectFilter = '';
    this.cmTeacherFilter = '';
  }
  get hasAxisFilter(): boolean {
    return !!(this.cmSubjectFilter || this.cmTeacherFilter);
  }

  // ─── Timeline grouping — classes grouped by scheduled date,
  //     matching the date-spine pattern used by the history page. ──
  get cmTimelineGroups(): {
    dateKey: string;
    dateLabel: string;
    dayNum: string;
    weekday: string;
    items: ICourse[];
  }[] {
    this.ensureViewMemo();
    return this._viewMemo.timeline!;
  }

  private computeTimeline(list: ICourse[]): {
    dateKey: string;
    dateLabel: string;
    dayNum: string;
    weekday: string;
    items: ICourse[];
  }[] {
    const map = new Map<string, ICourse[]>();
    for (const c of list) {
      const raw = (c as any).scheduledDate;
      const key = raw
        ? (() => {
            const d = new Date(raw);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          })()
        : 'zzz-no-date';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    const monthShort = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const weekdays  = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
    const groups = Array.from(map.entries()).map(([key, items]) => {
      if (key === 'zzz-no-date') {
        return {
          dateKey: 'zzz-no-date',
          dateLabel: 'ไม่ระบุวันที่',
          dayNum: '–',
          weekday: '',
          items: items.sort((a, b) => ((a as any).startTime || '').localeCompare((b as any).startTime || ''))
        };
      }
      const d = new Date(key);
      const sortedItems = items.sort((a, b) =>
        ((a as any).startTime || '').localeCompare((b as any).startTime || '')
      );
      return {
        dateKey: key,
        dateLabel: `${d.getDate()} ${monthShort[d.getMonth()]} ${d.getFullYear() + 543}`,
        dayNum: String(d.getDate()),
        weekday: weekdays[d.getDay()],
        items: sortedItems
      };
    });
    // Descending: newest day first (most recent class on top).
    return groups.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  }

  // ─── v2: Expandable inline detail per card ─────────────────
  expandedIds = new Set<string>();
  toggleExpand(id: string, ev?: Event): void {
    ev?.stopPropagation();
    if (this.expandedIds.has(id)) this.expandedIds.delete(id);
    else this.expandedIds.add(id);
  }
  isExpanded(id: string): boolean { return this.expandedIds.has(id); }

  // ─── v2: Bulk selection ─────────────────────────────────────
  selectedIds = new Set<string>();
  bulkCancelling = false;

  toggleSelect(id: string, ev?: Event): void {
    ev?.stopPropagation();
    if (!id) return;
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
  }
  isSelected(id: string): boolean { return this.selectedIds.has(id); }
  clearSelection(): void { this.selectedIds.clear(); }
  get selectionCount(): number { return this.selectedIds.size; }

  /** Template-side accessor for the unified displayStatus. */
  resolveStatus(c: any): string {
    return resolveDisplayStatus(c) as string;
  }

  /** A class is "final" (read-only for cancel/delete) when its displayStatus
   *  is completed or cancelled. */
  isFinalStatus(c: any): boolean {
    const ds = resolveDisplayStatus(c);
    return ds === 'completed' || ds === 'cancelled';
  }

  /** Test classes (subject === "test") can be cancelled regardless of status,
   *  so they can then be permanently deleted — for cleaning up test data. */
  isTestClass(c: any): boolean {
    return (c?.subject || '').trim().toLowerCase() === 'test';
  }

  /** Editing-details is locked once a class is past the pending-confirm
   *  phases. Manager can still cancel a confirmed/awaiting class (use
   *  isFinalStatus for that), but the booking details (teacher, time,
   *  subject, students) must not change after both parties accepted. */
  isEditingLocked(c: any): boolean {
    const ds = resolveDisplayStatus(c);
    return ds === 'confirmed' ||
           ds === 'awaiting_manager' ||
           ds === 'completed' ||
           ds === 'cancelled';
  }

  /** Whether a card can be bulk-selected. Series cards aggregate many classes; skip them. */
  canSelectCard(c: ICourse): boolean {
    if (this.isSeriesCourse(c)) return false;
    return !this.isFinalStatus(c);
  }

  /** A class inside the series modal is selectable when it's not final. */
  canSelectSeriesItem(c: ICourse): boolean {
    return !this.isFinalStatus(c);
  }

  /** Count of cancellable (non-final) classes in the currently-open series. */
  get seriesCancellableCount(): number {
    return this.seriesModalCourses.filter(c => !this.isFinalStatus(c)).length;
  }

  /** Select every cancellable class in the open series. */
  selectAllSeriesCancellable(): void {
    for (const c of this.seriesModalCourses) {
      if (this.canSelectSeriesItem(c)) this.selectedIds.add(this.getId(c));
    }
  }

  /** Resolve which series-course list to act on:
   *  - if `anchor` is passed (e.g. clicked on a card outside the modal),
   *    fetch siblings via getSeriesCourses
   *  - otherwise use the currently-open modal's loaded list */
  private getSeriesActionList(anchor?: ICourse): ICourse[] {
    if (anchor) return this.getSeriesCourses((anchor as any).seriesId);
    return this.seriesModalCourses;
  }

  /** Bulk cancel an entire series. Used from both the series anchor card on
   *  the main grid and from inside the series modal. */
  bulkCancelSeries(anchor?: ICourse): void {
    const list = this.getSeriesActionList(anchor);
    const ids = list.filter(c => !this.isFinalStatus(c)).map(c => this.getId(c));
    if (this.bulkCancelling) return;
    if (ids.length === 0) {
      alert('ไม่มีคลาสที่ยกเลิกได้ในชุดนี้ (ทุกคลาสจบหรือถูกยกเลิกแล้ว)');
      return;
    }
    if (!confirm(`ยืนยันยกเลิกชุดทั้งหมด ${ids.length} คลาส?\n\nคลาสทุกตัวในชุดนี้ที่ยังไม่จบ/ยังไม่ยกเลิกจะถูกตั้งเป็น "ยกเลิก"`)) return;

    this.bulkCancelling = true;
    const next = (i: number) => {
      if (i >= ids.length) {
        this.bulkCancelling = false;
        this.successMessage = `ยกเลิกชุดเรียบร้อย — ${ids.length} คลาส`;
        if (this.showSeriesModal) this.closeSeriesModal();
        this.loadAll();
        this.cdr.markForCheck();
        setTimeout(() => { this.successMessage = ''; this.cdr.markForCheck(); }, 4000);
        return;
      }
      this.courseService.deleteCourse(ids[i])
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => next(i + 1),
          error: (err) => {
            console.error('[CourseMgmt] bulkCancelSeries item failed:', ids[i], err);
            next(i + 1);
          }
        });
    };
    next(0);
  }

  /** Bulk permanent-delete an entire series. Destructive: removes every
   *  class in the series regardless of status. Two-step confirmation. */
  bulkDeleteSeries(anchor?: ICourse): void {
    const list = this.getSeriesActionList(anchor);
    const ids = list.map(c => this.getId(c));
    if (this.bulkCancelling) return;
    if (ids.length === 0) return;
    if (!confirm(`⚠️ ลบชุดนัดสอนนี้ออกถาวร ${ids.length} คลาส?\n\nการลบนี้ไม่สามารถย้อนกลับได้ ข้อมูลคลาสทั้งหมดในชุดและการเช็คชื่อ/การชำระเงินที่เกี่ยวข้องจะหายไปจากระบบ`)) return;
    if (!confirm(`ยืนยันอีกครั้ง: ลบ ${ids.length} คลาสออกจากระบบถาวร?`)) return;

    this.bulkCancelling = true;
    const next = (i: number) => {
      if (i >= ids.length) {
        this.bulkCancelling = false;
        this.successMessage = `ลบชุดทั้งหมดออกถาวร — ${ids.length} คลาส`;
        if (this.showSeriesModal) this.closeSeriesModal();
        this.loadAll();
        this.cdr.markForCheck();
        setTimeout(() => { this.successMessage = ''; this.cdr.markForCheck(); }, 4000);
        return;
      }
      this.courseService.permanentDeleteCourse(ids[i])
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => next(i + 1),
          error: (err) => {
            console.error('[CourseMgmt] bulkDeleteSeries item failed:', ids[i], err);
            next(i + 1);
          }
        });
    };
    next(0);
  }

  /** Bulk cancel: confirm once, call cancelCourse-equivalent in sequence. */
  bulkCancelSelected(): void {
    if (this.selectionCount === 0) return;
    if (this.bulkCancelling) return;
    if (!confirm(`ยืนยันยกเลิกนัดสอนที่เลือก ${this.selectionCount} รายการ?\n\nรายการจะถูกตั้งเป็น "ยกเลิก" และสามารถลบออกถาวรได้ภายหลัง`)) return;

    const ids = Array.from(this.selectedIds);
    this.bulkCancelling = true;

    const next = (i: number) => {
      if (i >= ids.length) {
        this.bulkCancelling = false;
        this.selectedIds.clear();
        this.successMessage = `ยกเลิก ${ids.length} รายการเรียบร้อย`;
        this.loadAll();
        this.cdr.markForCheck();
        setTimeout(() => { this.successMessage = ''; this.cdr.markForCheck(); }, 4000);
        return;
      }
      this.courseService.deleteCourse(ids[i])
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => next(i + 1),
          error: (err) => {
            console.error('[CourseMgmt] bulkCancel item failed:', ids[i], err);
            next(i + 1);
          }
        });
    };
    next(0);
  }
}
