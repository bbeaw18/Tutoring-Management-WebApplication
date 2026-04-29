export interface IStudentConfirmation {
  student: { _id: string; firstName: string; lastName: string };
  status: 'pending' | 'accepted' | 'declined';
  confirmedAt: Date | null;
}

export interface ISchedule {
  _id: string;
  id?: string;
  course: { _id: string; name: string; subject: string } | string;
  teacher: { _id: string; firstName: string; lastName: string; email: string } | string;
  students: Array<{ _id: string; firstName: string; lastName: string; email: string }>;
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

  // Income
  teacherIncomeGroup: number;
  teacherIncomeIndividual: number;
  actualTeacherIncome?: number | null;

  // Course pricing
  coursePrice: number;
  totalDurationMinutes: number;

  // QR
  qrToken?: string | null;
  qrGeneratedAt?: Date | null;
  qrExpiresAt?: Date | null;
  qrActive: boolean;

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
