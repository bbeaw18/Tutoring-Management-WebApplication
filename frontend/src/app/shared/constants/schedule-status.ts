/**
 * Unified schedule display status — shared across course management, master
 * calendar, teaching history, and revenue page. Backend computes this in
 * scheduleAggregation.js and attaches `displayStatus` to every schedule/course
 * response.
 *
 * If the backend hasn't attached displayStatus yet (older payload), use
 * deriveDisplayStatus() to compute it client-side from raw status + flags.
 */

export type DisplayStatus =
  | 'pending_teacher'   // รอครูยืนยัน
  | 'pending_students'  // รอนักเรียนยืนยัน  ← NEW
  | 'confirmed'         // ยืนยันแล้ว (ทั้งครู + นักเรียน)
  | 'awaiting_manager'  // รอ Manager ยืนยันเสร็จสิ้น
  | 'completed'         // เสร็จสิ้น
  | 'cancelled';        // ยกเลิก

const STATUS_LABEL: Record<DisplayStatus, string> = {
  pending_teacher:  'รอครูยืนยัน',
  pending_students: 'รอนักเรียนยืนยัน',
  confirmed:        'ยืนยันแล้ว',
  awaiting_manager: 'รอ Manager ยืนยัน',
  completed:        'เสร็จสิ้น',
  cancelled:        'ยกเลิก'
};

/** CSS class hint — pages can map to their own badge stylesheet */
const STATUS_CLASS: Record<DisplayStatus, string> = {
  pending_teacher:  'status-pending-teacher',
  pending_students: 'status-pending-students',
  confirmed:        'status-confirmed',
  awaiting_manager: 'status-awaiting-manager',
  completed:        'status-completed',
  cancelled:        'status-cancelled'
};

/**
 * Compute displayStatus client-side from raw schedule fields.
 * Mirror of backend deriveDisplayStatus() — keep in sync.
 */
export function deriveDisplayStatus(input: {
  status?: string;
  teacherConfirmed?: boolean;
  isFullyConfirmed?: boolean;
  students?: any[];
} | null | undefined): DisplayStatus {
  if (!input) return 'pending_teacher';
  const s = input.status;

  if (s === 'cancelled')             return 'cancelled';
  if (s === 'completed')             return 'completed';
  if (s === 'awaiting_confirmation') return 'awaiting_manager';

  if (!input.teacherConfirmed)       return 'pending_teacher';

  const hasStudents = Array.isArray(input.students) && input.students.length > 0;
  if (hasStudents && !input.isFullyConfirmed) return 'pending_students';
  return 'confirmed';
}

/** Resolve the displayStatus — prefer backend-attached field, fall back to derive() */
export function resolveDisplayStatus(obj: any): DisplayStatus {
  if (obj?.displayStatus) return obj.displayStatus as DisplayStatus;
  return deriveDisplayStatus(obj);
}

export function getDisplayStatusLabel(status: DisplayStatus | string | null | undefined): string {
  if (!status) return '-';
  return STATUS_LABEL[status as DisplayStatus] || String(status);
}

export function getDisplayStatusClass(status: DisplayStatus | string | null | undefined): string {
  if (!status) return '';
  return STATUS_CLASS[status as DisplayStatus] || '';
}
