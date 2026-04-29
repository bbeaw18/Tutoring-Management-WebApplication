import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { VideoService } from '../../../services/video.service';
import { CourseService } from '../../../services/course.service';
import { ICourse } from '../../../interfaces/course.interface';
import { IVideo } from '../../../interfaces/video.interface';
import { LoadingComponent } from '../../../shared/components/loading/loading.component';
import { DatePickerComponent } from '../../../shared/components/date-picker/date-picker.component';

@Component({
  selector: 'app-video-management',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, LoadingComponent, DatePickerComponent],
  templateUrl: './video-management.component.html',
  styleUrls: ['./video-management.component.css']
})
export class VideoManagementComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  videos: IVideo[] = [];
  courses: ICourse[] = [];
  videoForm!: FormGroup;
  loading = false;
  submitting = false;
  showForm = false;

  // Filter / search
  vmSearch = '';
  vmCourseFilter = 'all';
  vmSortBy: 'recent' | 'duration' | 'title' = 'recent';

  constructor(
    private videoService: VideoService,
    private courseService: CourseService,
    private formBuilder: FormBuilder
  ) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnInit(): void {
    this.initializeForm();
    this.loadVideos();
    this.loadCourses();
  }

  initializeForm(): void {
    this.videoForm = this.formBuilder.group({
      courseId: ['', Validators.required],
      title: ['', Validators.required],
      description: [''],
      zoomRecordingUrl: ['', [Validators.required, Validators.pattern(/^https?:\/\/.+/)]],
      duration: [0, [Validators.required, Validators.min(1)]],
      recordedDate: ['', Validators.required]
    });
  }

  loadVideos(): void {
    this.loading = true;
    this.videoService.getVideos()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
      next: (res) => {
        this.videos = res.data;
        this.loading = false;
      },
      error: (error) => {
        console.error(error);
        this.loading = false;
      }
    });
  }

  loadCourses(): void {
    this.courseService.getCourses()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
      next: (res) => {
        this.courses = res.data;
      },
      error: (error) => {
        console.error(error);
      }
    });
  }

  submitForm(): void {
    if (this.videoForm.invalid) {
      return;
    }

    this.submitting = true;
    this.videoService.createVideo(this.videoForm.value)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
      next: () => {
        this.submitting = false;
        this.showForm = false;
        this.videoForm.reset();
        this.loadVideos();
      },
      error: (error) => {
        console.error(error);
        this.submitting = false;
      }
    });
  }

  deleteVideo(videoId: string): void {
    if (confirm('คุณแน่ใจหรือว่าต้องการลบวิดีโอนี้?')) {
      this.videoService.deleteVideo(videoId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
        next: () => {
          this.loadVideos();
        },
        error: (error) => {
          console.error(error);
        }
      });
    }
  }

  getCourseName(courseId: string): string {
    const course = this.courses.find(c => c.id === courseId);
    return course ? (course.name || course.subject || course.courseName || '-') : '-';
  }

  formatDate(date: Date): string {
    return new Date(date).toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}ชม ${mins}นาที`;
    }
    return `${mins}นาที`;
  }

  // ── Library helpers ─────────────────────────────────────────
  get vmStats(): { total: number; hours: number; courses: number; recent: number } {
    const totalMinutes = this.videos.reduce((s, v) => s + (v.duration || 0), 0);
    const courseIds = new Set(this.videos.map(v => v.courseId));
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = this.videos.filter(v => {
      const t = v.uploadedDate ? new Date(v.uploadedDate).getTime() : 0;
      return t >= sevenDaysAgo;
    }).length;
    return {
      total: this.videos.length,
      hours: Math.round((totalMinutes / 60) * 10) / 10,
      courses: courseIds.size,
      recent
    };
  }

  get vmCourseOptions(): { id: string; label: string; count: number }[] {
    const courseIds = Array.from(new Set(this.videos.map(v => v.courseId)));
    return courseIds.map(id => ({
      id,
      label: this.getCourseName(id),
      count: this.videos.filter(v => v.courseId === id).length
    }));
  }

  get vmFiltered(): IVideo[] {
    let list = [...this.videos];
    if (this.vmCourseFilter !== 'all') {
      list = list.filter(v => v.courseId === this.vmCourseFilter);
    }
    const term = this.vmSearch.trim().toLowerCase();
    if (term) {
      list = list.filter(v =>
        (v.title || '').toLowerCase().includes(term) ||
        (v.description || '').toLowerCase().includes(term) ||
        this.getCourseName(v.courseId).toLowerCase().includes(term)
      );
    }
    if (this.vmSortBy === 'recent') {
      list.sort((a, b) => new Date(b.uploadedDate || b.recordedDate).getTime() - new Date(a.uploadedDate || a.recordedDate).getTime());
    } else if (this.vmSortBy === 'duration') {
      list.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    } else if (this.vmSortBy === 'title') {
      list.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'th'));
    }
    return list;
  }

  setCourseFilter(id: string): void { this.vmCourseFilter = id; }
  setSort(s: 'recent' | 'duration' | 'title'): void { this.vmSortBy = s; }

  /** Stable hue per video for thumbnail color */
  getVideoHue(v: IVideo): number {
    const seed = `${v.title || ''}${v.id || ''}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    const hues = [340, 300, 260, 220, 195, 165, 135, 30, 12];
    return hues[Math.abs(hash) % hues.length];
  }

  isRecentlyUploaded(v: IVideo): boolean {
    if (!v.uploadedDate) return false;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return new Date(v.uploadedDate).getTime() >= sevenDaysAgo;
  }

  getRelativeUpload(v: IVideo): string {
    const d = v.uploadedDate ? new Date(v.uploadedDate) : null;
    if (!d) return '';
    const diffMs = Date.now() - d.getTime();
    const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    if (days === 0) return 'วันนี้';
    if (days === 1) return 'เมื่อวาน';
    if (days < 7) return `${days} วันก่อน`;
    if (days < 30) return `${Math.floor(days / 7)} สัปดาห์ก่อน`;
    if (days < 365) return `${Math.floor(days / 30)} เดือนก่อน`;
    return this.formatDate(v.uploadedDate);
  }

  /** Open video URL in new tab */
  openVideo(url: string): void {
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }
}
