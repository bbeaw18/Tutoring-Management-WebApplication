import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EMPTY, Observable, Subject, defer, distinctUntilChanged, expand, map, retry, shareReplay, switchMap, timer } from 'rxjs';
import { environment } from '@environments/environment';
import { IApiResponse } from '../interfaces/api-response.interface';

export interface AvailabilitySlot {
  day: number;
  start: number;
  end: number;
}

export interface AvailabilityClass {
  id: string;
  key: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  blocks: AvailabilitySlot[];
}

export interface AvailabilityWeek {
  saved: boolean;
  slots: AvailabilitySlot[];
  freeSlots: AvailabilitySlot[];
  classes: AvailabilityClass[];
}

interface AvailabilityStatus {
  enabled: boolean;
  startsAt: number;
  serverTime: number;
}

export function availabilityTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

@Injectable({ providedIn: 'root' })
export class TeacherAvailabilityService {
  private readonly url = `${environment.apiUrl}/teacher-availability`;
  private readonly editRequest = new Subject<string>();
  private readonly saved = new Subject<{ week: string; data: AvailabilityWeek }>();
  readonly editRequested$ = this.editRequest.asObservable();
  readonly saved$ = this.saved.asObservable();
  readonly enabled$ = defer(() => this.getStatus()).pipe(
    expand(status => status.enabled ? EMPTY : timer(Math.min(status.startsAt - status.serverTime, 86_400_000))
      .pipe(switchMap(() => this.getStatus()))),
    map(status => status.enabled),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(private http: HttpClient) {}

  private getStatus(): Observable<AvailabilityStatus> {
    return this.http.get<IApiResponse<AvailabilityStatus>>(`${this.url}/status`).pipe(
      map(response => response.data),
      retry({ delay: 30_000 })
    );
  }

  edit(week: string): void {
    this.editRequest.next(week);
  }

  get(week: string, teacherId?: string): Observable<AvailabilityWeek> {
    return this.http.get<IApiResponse<AvailabilityWeek>>(`${this.url}/${week}`, {
      params: teacherId ? { teacherId } : {}
    }).pipe(map(response => response.data));
  }

  save(week: string, slots: AvailabilitySlot[], confirmedConflicts: string[]): Observable<AvailabilityWeek> {
    return this.http.put<IApiResponse<AvailabilityWeek>>(`${this.url}/${week}`, { slots, confirmedConflicts })
      .pipe(map(response => response.data));
  }

  notifySaved(week: string, data: AvailabilityWeek): void {
    this.saved.next({ week, data });
  }
}
