export interface IPayment {
  _id: string;
  id?: string;
  student: any;       // ObjectId or populated { _id, firstName, lastName, email }
  course: any;        // ObjectId or populated { _id, name, price }
  schedule?: any;     // ObjectId or null
  paymentType?: 'per_class' | 'monthly';
  paymentMonth?: string;
  amount: number;
  method: 'transfer' | 'promptpay' | 'credit_card' | 'gateway';
  slipImage?: string;
  transactionRef?: string;
  status: 'pending' | 'confirmed' | 'rejected';
  confirmedBy?: any;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRevenueSchedule {
  scheduleId: string;
  date: Date;
  startTime: string;
  endTime: string;
  // Course metadata (populated from related Course doc)
  courseId?: string | null;
  courseName: string;
  subject?: string;
  type?: 'group' | 'individual' | null;
  gradeLevel?: string;
  teachingType?: string;
  description?: string;
  // Teacher
  teacherId?: string | null;
  teacherName: string;
  teacherRole?: 'teacher' | 'manager' | 'admin' | null;
  // Confirmation state
  teacherConfirmed?: boolean;
  teacherConfirmedAt?: string | null;
  isFullyConfirmed?: boolean;
  managerConfirmedBy?: string | null;
  managerConfirmedAt?: string | null;
  totalDurationMinutes?: number;
  note?: string | null;
  // Per-student payment
  attendedStudents: {
    studentId: string;
    name: string;
    scannedAt: Date;
    paymentId?: string | null;
    paymentStatus?: 'unpaid' | 'pending' | 'confirmed' | 'rejected';
    paymentAmount?: number;
  }[];
  attendanceCount: number;
  coursePrice: number;            // effective total (rate × hours for hourly, else flat)
  coursePriceRaw?: number;        // raw stored value — rate-per-hour for hourly classes
  teacherIncomeIndividual?: number;
  teacherIncomeGroup?: number;
  total: number;
  paid: number;
  unpaid: number;
  status: string;
  actualTeacherIncome: number;
}

export interface IPaymentRequest {
  course: string;         // course ObjectId
  amount: number;
  method: string;         // 'transfer' | 'promptpay' | 'credit_card' | 'gateway'
  schedule?: string;
  paymentType?: string;
  paymentMonth?: string;
  transactionRef?: string;
}

// Keep for backward compatibility — methods now take (id, note) directly
export interface IPaymentConfirmRequest {
  paymentId: string;
  note?: string;
}

export interface IPaymentRejectRequest {
  paymentId: string;
  note?: string;
}
