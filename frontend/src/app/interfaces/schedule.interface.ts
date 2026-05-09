export interface IStudentConfirmation {
  student: { _id: string; firstName: string; lastName: string };
  status: 'pending' | 'accepted' | 'declined';
  confirmedAt: Date | null;
}

export interface IPaymentSummary {
  attendanceCount: number;
  total: number;            // ยอดรวมที่นักเรียนทั้งหมดต้องจ่าย (สำหรับคลาสนี้)
  paid: number;             // ยอดที่ชำระแล้ว (รวม)
  unpaid: number;           // ยอดยังไม่ชำระ
  pending: number;          // ยอดรอ Manager ยืนยัน
  paidCount: number;        // จำนวนนักเรียนที่ชำระแล้ว
  unpaidCount: number;
  pendingCount: number;
  effectivePrice: number;   // coursePrice × hours (ตาม incomeHourly)
}

export interface ISchedule {
  _id: string;
  id?: string;
  // Course is now populated with the full set of metadata used across calendar/history/revenue
  course: {
    _id: string;
    name: string;
    subject: string;
    type?: 'group' | 'individual';
    gradeLevel?: string;
    teachingType?: string;
    description?: string;
    coursePrice?: number;
    teacherIncomeGroup?: number;
    teacherIncomeIndividual?: number;
    incomeHourly?: boolean;
  } | string;
  teacher: { _id: string; firstName: string; lastName: string; nickname?: string; email: string; role?: string } | string;
  students: Array<{ _id: string; firstName: string; lastName: string; nickname?: string; email: string; grade?: string; academicYear?: string }>;
  date: Date | string;
  startTime: string;
  endTime: string;
  zoomLink?: string;
  room?: string;
  status: 'pending' | 'confirmed' | 'scheduled' | 'completed' | 'cancelled' | 'awaiting_confirmation';
  note?: string;

  // Confirmation
  teacherConfirmed: boolean;
  teacherConfirmedAt?: Date | null;
  studentConfirmations: IStudentConfirmation[];
  isFullyConfirmed: boolean;
  managerConfirmedBy?: { _id: string; firstName: string; lastName: string; nickname?: string } | string | null;
  managerConfirmedAt?: Date | string | null;

  // Income
  teacherIncomeGroup: number;
  teacherIncomeIndividual: number;
  actualTeacherIncome?: number | null;
  incomeHourly?: boolean;

  // Course pricing
  coursePrice: number;
  totalDurationMinutes: number;

  // QR
  qrToken?: string | null;
  qrGeneratedAt?: Date | null;
  qrExpiresAt?: Date | null;
  qrActive: boolean;

  // Aggregated payment data — included by /calendar response so consumers can show
  // payment status without an extra round-trip.
  paymentSummary?: IPaymentSummary | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export interface IScheduleCreateRequest {
  course: string;
  teacher: string;
  date: string;
  startTime: string;
  endTime: string;
  zoomLink?: string;
  room?: string;
  note?: string;
  teacherIncomeGroup?: number;
  teacherIncomeIndividual?: number;
  coursePrice?: number;
}

export interface ICalendarEvent {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  courseId: string;
  teacherId?: string;
  studentId?: string;
  resourceId?: string;
}

export interface IQRStatus {
  qrActive: boolean;
  qrExpiresAt?: Date;
  attendances: IAttendanceRecord[];
  count: number;
}

export interface IAttendanceRecord {
  _id: string;
  schedule: string;
  student: { _id: string; firstName: string; lastName: string; profileImage?: string; email?: string };
  scannedAt: Date;
}
