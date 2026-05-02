import { Pipe, PipeTransform } from '@angular/core';

/**
 * แสดงชื่อผู้ใช้ — รับ user object หรือ fragment ที่มี firstName / lastName / nickname / role
 *
 *   {{ user | displayName }}            → "ชื่อเล่น" (fallback: firstName)
 *   {{ user | displayName:'full' }}     → "firstName lastName (ชื่อเล่น)" — สำหรับแท็บบุคลากร
 *   {{ user | displayName:'nickOnly' }} → "ชื่อเล่น" เท่านั้น (คืนค่าว่างถ้าไม่มี)
 *   {{ user | displayName:'role' }}     → prefix ตาม role:
 *                                          • teacher/manager/admin → "ครู<ชื่อเล่น>"
 *                                          • student              → "น้อง<ชื่อเล่น>"
 *   {{ user | displayName:'teacher' }}  → "ครู<ชื่อเล่น>" (force prefix)
 *   {{ user | displayName:'student' }}  → "น้อง<ชื่อเล่น>" (force prefix)
 */
@Pipe({
  name: 'displayName',
  standalone: true,
  pure: true
})
export class DisplayNamePipe implements PipeTransform {
  transform(
    user: { firstName?: string; lastName?: string; nickname?: string; role?: string } | null | undefined,
    mode: 'nick' | 'full' | 'nickOnly' | 'role' | 'teacher' | 'student' = 'nick'
  ): string {
    if (!user) return '';
    const first = (user.firstName || '').trim();
    const last  = (user.lastName  || '').trim();
    const nick  = (user.nickname  || '').trim();
    const baseName = nick || first || last || '';

    if (mode === 'full') {
      const full = `${first} ${last}`.trim();
      if (!full) return nick || '';
      return nick ? `${full} (${nick})` : full;
    }
    if (mode === 'nickOnly') {
      return nick;
    }
    if (mode === 'teacher') {
      return baseName ? `ครู${baseName}` : '';
    }
    if (mode === 'student') {
      return baseName ? `น้อง${baseName}` : '';
    }
    if (mode === 'role') {
      if (!baseName) return '';
      const r = (user.role || '').toLowerCase();
      if (r === 'teacher' || r === 'manager' || r === 'admin') return `ครู${baseName}`;
      if (r === 'student') return `น้อง${baseName}`;
      return baseName;
    }
    // default 'nick'
    return baseName;
  }
}
