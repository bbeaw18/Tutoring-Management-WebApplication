import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, map, tap, first } from 'rxjs/operators';
import { environment } from '@environments/environment';
import { IUser, ILoginRequest, IRegisterRequest, IAuthResponse, UserRole, ITotpSetupResponse, IOtpVerifyResponse } from '../interfaces/user.interface';
import { IApiResponse } from '../interfaces/api-response.interface';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private apiUrl = `${environment.apiUrl}/auth`;
  private currentUserSubject = new BehaviorSubject<IUser | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();
  private _isLoggingOut = false;   // ป้องกัน logout ซ้ำซ้อนจาก concurrent 401

  constructor(private http: HttpClient, private router: Router) {}

  /** ตรวจว่า JWT หมดอายุแล้วหรือยัง */
  isTokenExpired(): boolean {
    const token = this.getToken();
    if (!token) return true;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (!payload.exp) return false;
      // exp เป็น Unix seconds
      return Date.now() / 1000 > payload.exp;
    } catch {
      return true;
    }
  }

  login(request: ILoginRequest): Observable<IAuthResponse> {
    return this.http.post<IApiResponse<IAuthResponse>>(`${this.apiUrl}/login`, request).pipe(
      map(res => res.data),
      tap(response => {
        if (response.token) {
          localStorage.setItem('token', response.token);
          this.currentUserSubject.next(response.user || null);
        } else if (response.requireOtp && response.userId) {
          localStorage.setItem('tempUserId', response.userId);
        }
      })
    );
  }

  register(request: IRegisterRequest): Observable<IAuthResponse> {
    return this.http.post<IApiResponse<IAuthResponse>>(`${this.apiUrl}/register`, request).pipe(
      map(res => res.data),
      tap(response => {
        if (response.userId) {
          localStorage.setItem('tempUserId', response.userId);
        }
      })
    );
  }

  verifyTotpSetup(userId: string, token: string): Observable<IApiResponse<any>> {
    return this.http.post<IApiResponse<any>>(`${this.apiUrl}/verify-totp-setup`, { userId, token });
  }

  verifyTotp(userId: string, token: string): Observable<IApiResponse<IOtpVerifyResponse>> {
    return this.http.post<IApiResponse<IOtpVerifyResponse>>(`${this.apiUrl}/verify-totp`, { userId, token }).pipe(
      tap(res => {
        if (res.data.token) {
          localStorage.setItem('token', res.data.token);
          this.currentUserSubject.next(res.data.user);
          localStorage.removeItem('tempUserId');
        }
      })
    );
  }

  logout(): void {
    if (this._isLoggingOut) return;   // ป้องกัน concurrent 401 ทำให้ logout ซ้ำ
    this._isLoggingOut = true;
    localStorage.removeItem('token');
    // ลบ tempUserId เฉพาะตอนที่ logout จริง ๆ (มี token อยู่ก่อน)
    // ถ้าไม่มี token แสดงว่า logout ไปแล้ว และอาจกำลังอยู่ใน OTP flow
    // → ไม่ควรลบ tempUserId ทิ้ง
    localStorage.removeItem('tempUserId');
    this.currentUserSubject.next(null);
    // Safety: reset flag หลัง 3 วินาที กรณี navigation พังกลางคัน
    const safetyTimer = setTimeout(() => { this._isLoggingOut = false; }, 3000);
    this.router.navigate(['/login']).then(() => {
      clearTimeout(safetyTimer);
      this._isLoggingOut = false;
    }).catch(() => {
      clearTimeout(safetyTimer);
      this._isLoggingOut = false;
    });
  }

  getCurrentUser(): IUser | null {
    return this.currentUserSubject.value;
  }

  isLoggedIn(): boolean {
    return !!this.getToken() && !this.isTokenExpired();
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }

  getTempUserId(): string | null {
    return localStorage.getItem('tempUserId');
  }

  getUserRole(): UserRole | null {
    // Read role directly from JWT payload — works even before loadStoredUser() resolves
    const token = this.getToken();
    if (!token) return null;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return (payload.role as UserRole) || null;
    } catch {
      return null;
    }
  }

  forgotPassword(email: string): Observable<IApiResponse<null>> {
    return this.http.post<IApiResponse<null>>(`${this.apiUrl}/forgot-password`, { email });
  }

  resetPassword(token: string, password: string): Observable<IApiResponse<null>> {
    return this.http.post<IApiResponse<null>>(`${this.apiUrl}/reset-password`, { token, password });
  }

  refreshToken(): Observable<string> {
    return this.http.post<IApiResponse<{ token: string }>>(`${this.apiUrl}/refresh-token`, {}).pipe(
      map(res => res.data.token),
      tap(token => {
        localStorage.setItem('token', token);
      })
    );
  }

  /**
   * เรียกจาก APP_INITIALIZER — รอให้ /auth/me เสร็จก่อน Angular เริ่ม routing
   * แก้ race condition ที่ Sidebar/Header render ก่อน currentUser โหลด
   */
  initializeAuth(): Promise<void> {
    const token = localStorage.getItem('token');
    if (!token) return Promise.resolve();

    // ถ้า token หมดอายุแล้ว → clear ทันที ไม่ต้องเรียก /auth/me
    if (this.isTokenExpired()) {
      localStorage.removeItem('token');
      localStorage.removeItem('tempUserId');
      return Promise.resolve();
    }

    return new Promise(resolve => {
      this.http.get<IApiResponse<IUser>>(`${this.apiUrl}/me`).pipe(
        tap(res => this.currentUserSubject.next(res.data)),
        catchError(() => {
          // 401 → token ไม่ valid → clear
          localStorage.removeItem('token');
          this.currentUserSubject.next(null);
          return of(null);
        }),
        first()
      ).subscribe(() => resolve());
    });
  }
}
