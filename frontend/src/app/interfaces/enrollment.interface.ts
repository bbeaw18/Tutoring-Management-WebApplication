export interface IEnrollment {
  id: string;
  studentId: string;
  studentName?: string;
  courseId: string;
  courseName?: string;
  enrollmentDate: Date;
  status: 'pending' | 'active' | 'completed' | 'dropped';
  grade?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IEnrollmentRequest {
  studentId: string;
  courseId: string;
}
