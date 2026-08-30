export interface ICourse {
  id: string;
  _id?: string;
  name: string;
  description?: string;
  subject: string;
  teacher: any; // populated User object or ObjectId string
  teacherId?: string;
  students?: any[]; // populated User objects or ObjectId strings
  scheduledDate?: Date | string;
  startTime?: string;
  endTime?: string;
  type?: 'group' | 'individual';
  difficulty?: string;
  teachingType?: string;
  gradeLevel?: string;
  maxStudents?: number;
  price?: number;
  teacherIncomeIndividual?: number;
  teacherIncomeGroup?: number;
  coursePrice?: number;
  /** true = ราคา/รายได้เป็นอัตราต่อชั่วโมง (คลาสใหม่); false/undefined = flat per-class (คลาสเก่า) */
  incomeHourly?: boolean;
  /** id ของชุดนัดสอนอัตโนมัติ (สร้างซ้ำรายสัปดาห์จนถึงสิ้นเดือน) — คอร์สทั้งชุดจะมีค่านี้เหมือนกัน */
  seriesId?: string | null;
  /** จำนวนคลาสทั้งหมดในชุด */
  seriesSize?: number;
  /** Unified display status — แนบโดย backend (GET /courses) เพื่อให้ทุกหน้าใช้ค่าตรงกัน */
  displayStatus?: 'pending_teacher' | 'pending_students' | 'confirmed' | 'awaiting_manager' | 'completed' | 'cancelled';
  /** id ของ Schedule ล่าสุดที่ผูกกับคอร์สนี้ — แนบโดย backend (GET /courses)
   *  ใช้สำหรับ action ที่ต้องอ้าง Schedule (เช่น manager-confirm) */
  scheduleId?: string | null;
  status: 'pending' | 'approved' | 'active' | 'completed' | 'cancelled';
  teacherAccepted?: boolean;
  createdBy?: any;
  createdAt: Date;
  updatedAt: Date;

  // legacy fields (kept for backwards compat)
  courseCode?: string;
  courseName?: string;
  teacherName?: string;
  credits?: number;
  startDate?: Date;
  endDate?: Date;
  roomNumber?: string;
  enrollmentCount?: number;
}

export interface ICourseCreateRequest {
  subject: string;
  teacher: string;           // teacher ID
  students: string[];        // student IDs
  scheduledDate: string;
  startTime: string;
  endTime: string;
  type: 'group' | 'individual';
  teachingType?: string;
  gradeLevel: string;
  name?: string;
  description?: string;
  maxStudents?: number;
  price?: number;
  teacherIncomeIndividual?: number;
  teacherIncomeGroup?: number;
  coursePrice?: number;
  /** ตั้งค่าการทำซ้ำแบบ Google Calendar (ถ้าไม่ส่ง = สร้างคลาสเดียว) */
  recurrence?: IRecurrence;
}

export interface IRecurrence {
  frequency: 'daily' | 'weekly' | 'monthly';
  interval: number;             // ทุก N วัน/สัปดาห์/เดือน
  weekdays?: number[];          // 0=อาทิตย์..6=เสาร์ — เฉพาะ weekly
  endType: 'count' | 'until';
  count?: number;               // จบหลัง N ครั้ง
  until?: string;               // จบภายในวันที่ (YYYY-MM-DD)
}
