import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@environments/environment';
import { IApiResponse } from '../interfaces/api-response.interface';
import { AuthService } from './auth.service';

/**
 * เก็บ map ของ managerAlias (ชื่อเล่น private ที่ผู้จัดการตั้ง) → override ชื่อเล่นที่แสดงทั่วเว็บ
 * โหลดเฉพาะตอน login เป็น admin/manager เท่านั้น (endpoint กันด้วย roleCheck)
 * student/teacher: map ว่างเสมอ → เห็นชื่อเล่นเดิม
 *
 * DisplayNamePipe อ่านค่าจากที่นี่ (ผ่าน getAlias) — ต้องเป็น pipe แบบ impure เพื่อให้เห็นค่าล่าสุด
 */
@Injectable({ providedIn: 'root' })
export class AliasService {
  private apiUrl = `${environment.apiUrl}/users`;
  private aliasMap = new Map<string, string>();

  constructor(private http: HttpClient, private authService: AuthService) {}

  /** เรียกครั้งเดียวตอน bootstrap (AppComponent) — ตาม role ของ current user */
  init(): void {
    this.authService.currentUser$.subscribe(user => {
      const role = user?.role;
      if (role === 'admin' || role === 'manager') {
        this.loadAliases();
      } else {
        this.aliasMap.clear();
      }
    });
  }

  loadAliases(): void {
    this.http.get<IApiResponse<{ [id: string]: string }>>(`${this.apiUrl}/aliases`).subscribe({
      next: (res) => {
        this.aliasMap.clear();
        const data = res.data || {};
        for (const id of Object.keys(data)) this.aliasMap.set(id, data[id]);
      },
      error: () => { /* เงียบ — ถ้าโหลดไม่ได้ก็ fallback เป็นชื่อเล่นเดิม */ }
    });
  }

  /** อัปเดต 1 รายการทันทีหลัง manager แก้ (ไม่ต้องรอ reload) */
  setAlias(id: string, alias: string): void {
    if (!id) return;
    if (alias && alias.trim()) this.aliasMap.set(id, alias.trim());
    else this.aliasMap.delete(id);
  }

  getAlias(id?: string): string {
    if (!id) return '';
    return this.aliasMap.get(id) || '';
  }
}
