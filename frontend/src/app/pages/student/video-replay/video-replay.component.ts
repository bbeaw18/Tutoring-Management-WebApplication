import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { VideoService } from '../../../services/video.service';
import { AuthService } from '../../../services/auth.service';
import { IVideo } from '../../../interfaces/video.interface';
import { LoadingComponent } from '../../../shared/components/loading/loading.component';
import { SafePipe } from '../../../shared/pipes/safe.pipe';

@Component({
  selector: 'app-video-replay',
  standalone: true,
  imports: [CommonModule, FormsModule, LoadingComponent, SafePipe],
  templateUrl: './video-replay.component.html',
  styleUrls: ['./video-replay.component.css']
})
export class VideoReplayComponent implements OnInit {
  videos: IVideo[] = [];
  loading = false;
  selectedVideo: IVideo | null = null;
  currentUser = this.authService.getCurrentUser();

  // Filters
  vrSearch = '';
  vrCourseFilter = 'all';

  private readonly WATCHED_KEY = 'vr_watched_videos';
  watchedSet = new Set<string>();

  constructor(
    private videoService: VideoService,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    this.loadWatched();
    this.loadVideos();
  }

  loadVideos(): void {
    this.loading = true;
    const userId = this.currentUser?.id;
    if (userId) {
      this.videoService.getGrantedVideos(userId).subscribe({
        next: (videos) => {
          this.videos = videos || [];
          // Auto-select most recent as the featured player
          if (!this.selectedVideo && this.videos.length > 0) {
            this.selectedVideo = this.sortedVideos[0];
          }
          this.loading = false;
        },
        error: (error) => {
          console.error(error);
          this.loading = false;
        }
      });
    } else {
      this.loading = false;
    }
  }

  selectVideo(video: IVideo): void {
    this.selectedVideo = video;
    this.markWatched(video.id);
    // Smooth scroll to top so player is visible
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  closeVideoPlayer(): void {
    this.selectedVideo = null;
  }

  formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}ชม ${mins}นาที`;
    }
    return `${mins}นาที`;
  }

  formatDate(date: Date): string {
    return new Date(date).toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  // ── Library helpers ──────────────────────────────────────
  private loadWatched(): void {
    try {
      const raw = localStorage.getItem(this.WATCHED_KEY);
      if (raw) {
        const arr: string[] = JSON.parse(raw);
        this.watchedSet = new Set(arr);
      }
    } catch { /* ignore */ }
  }

  private markWatched(id: string): void {
    if (!id || this.watchedSet.has(id)) return;
    this.watchedSet.add(id);
    try {
      localStorage.setItem(this.WATCHED_KEY, JSON.stringify(Array.from(this.watchedSet)));
    } catch { /* ignore */ }
  }

  isWatched(v: IVideo): boolean { return this.watchedSet.has(v.id); }
  isFeatured(v: IVideo): boolean { return this.selectedVideo?.id === v.id; }

  get sortedVideos(): IVideo[] {
    return [...this.videos].sort((a, b) =>
      new Date(b.uploadedDate || b.recordedDate).getTime() -
      new Date(a.uploadedDate || a.recordedDate).getTime()
    );
  }

  get vrCourseOptions(): { id: string; label: string; count: number }[] {
    const seen = new Map<string, { label: string; count: number }>();
    for (const v of this.videos) {
      const key = v.courseId || 'unknown';
      const label = v.courseName || 'ไม่ระบุวิชา';
      const cur = seen.get(key);
      if (cur) cur.count++;
      else seen.set(key, { label, count: 1 });
    }
    return Array.from(seen.entries()).map(([id, val]) => ({ id, label: val.label, count: val.count }));
  }

  get filteredVideos(): IVideo[] {
    let list = this.sortedVideos;
    if (this.vrCourseFilter !== 'all') {
      list = list.filter(v => (v.courseId || 'unknown') === this.vrCourseFilter);
    }
    const term = this.vrSearch.trim().toLowerCase();
    if (term) {
      list = list.filter(v =>
        (v.title || '').toLowerCase().includes(term) ||
        (v.description || '').toLowerCase().includes(term) ||
        (v.courseName || '').toLowerCase().includes(term)
      );
    }
    return list;
  }

  get vrStats(): { total: number; watched: number; remaining: number; hours: number } {
    const total = this.videos.length;
    const watched = this.videos.filter(v => this.watchedSet.has(v.id)).length;
    const totalMinutes = this.videos.reduce((s, v) => s + (v.duration || 0), 0);
    return {
      total,
      watched,
      remaining: total - watched,
      hours: Math.round((totalMinutes / 60) * 10) / 10,
    };
  }

  get watchedProgressPct(): number {
    const t = this.videos.length;
    if (t === 0) return 0;
    return Math.round((this.vrStats.watched / t) * 100);
  }

  /** Continue-watching: unwatched videos sorted by recency */
  get continueList(): IVideo[] {
    return this.sortedVideos.filter(v => !this.watchedSet.has(v.id)).slice(0, 6);
  }

  setCourseFilter(id: string): void { this.vrCourseFilter = id; }

  /** Stable hue for thumbnail color */
  getVideoHue(v: IVideo): number {
    const seed = `${v.title || ''}${v.id || ''}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    const hues = [340, 300, 260, 220, 195, 165, 135, 30, 12];
    return hues[Math.abs(hash) % hues.length];
  }

  isRecentlyAdded(v: IVideo): boolean {
    if (!v.uploadedDate) return false;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return new Date(v.uploadedDate).getTime() >= sevenDaysAgo;
  }
}
