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
}
