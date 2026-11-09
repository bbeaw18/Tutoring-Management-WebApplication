import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, map } from 'rxjs';
import { environment } from '@environments/environment';
import { IApiResponse } from '../interfaces/api-response.interface';

interface ReviewPerson {
  _id: string;
  firstName: string;
  lastName: string;
  nickname?: string;
}

interface ReviewLesson {
  _id: string;
  course?: { name: string; subject: string; teachingType?: string; seriesSize?: number } | null;
  teacher?: ReviewPerson | null;
  date: string;
  startTime: string;
  endTime: string;
  room?: string;
  status: string;
  qrClosedAt?: string;
}

export interface StudentReview {
  lesson: ReviewLesson;
  scannedAt: string;
  submitted?: boolean;
}

export interface ClassReview extends ReviewLesson {
  displayStatus: string;
  studentCount: number;
  confirmedCount: number;
  createdAt?: string;
  teacherConfirmedAt?: string;
  qrGeneratedAt?: string;
  managerConfirmedAt?: string;
  actualTeacherIncome?: number | null;
  totalDurationMinutes?: number;
  paymentSummary: {
    attendanceCount: number;
    paidCount: number;
    pendingCount: number;
    unpaidCount: number;
    effectivePrice: number;
  };
  reviews: {
    _id: string;
    student?: ReviewPerson | null;
    rating: number;
    comment: string;
    createdAt: string;
  }[];
}

export interface ClassReviewDetails {
  checkIns: {
    student?: ReviewPerson | null;
    scannedAt: string;
    paymentStatus: 'confirmed' | 'pending' | 'unpaid';
  }[];
  teacherScore: { average: number; count: number };
}

@Injectable({ providedIn: 'root' })
export class ReviewService {
  private readonly url = `${environment.apiUrl}/reviews`;
  private readonly reviewRequest = new Subject<StudentReview>();
  readonly reviewRequested$ = this.reviewRequest.asObservable();

  constructor(private http: HttpClient) {}

  openReview(entry: StudentReview): void {
    this.reviewRequest.next(entry);
  }

  getPending(scheduleId?: string): Observable<StudentReview | null> {
    const params: Record<string, string> = { wait: '1' };
    if (scheduleId) params['scheduleId'] = scheduleId;
    return this.http.get<IApiResponse<StudentReview | null>>(`${this.url}/pending`, { params })
      .pipe(map(res => res.data));
  }

  getMine(scheduleId: string): Observable<StudentReview | null> {
    return this.http.get<IApiResponse<StudentReview | null>>(`${this.url}/mine/${scheduleId}`).pipe(map(res => res.data));
  }

  dismiss(scheduleId: string): Observable<IApiResponse<null>> {
    return this.http.post<IApiResponse<null>>(`${this.url}/${scheduleId}/dismiss`, {});
  }

  submit(scheduleId: string, rating: number, comment: string): Observable<IApiResponse<null>> {
    return this.http.post<IApiResponse<null>>(`${this.url}/${scheduleId}`, { rating, comment });
  }

  list(month: string): Observable<{ classes: ClassReview[]; newThisWeek: number }> {
    return this.http.get<IApiResponse<{ classes: ClassReview[]; newThisWeek: number }>>(
      this.url, { params: { month } }
    ).pipe(map(res => res.data));
  }

  getDetails(scheduleId: string): Observable<ClassReviewDetails> {
    return this.http.get<IApiResponse<ClassReviewDetails>>(`${this.url}/${scheduleId}/details`).pipe(map(res => res.data));
  }
}
