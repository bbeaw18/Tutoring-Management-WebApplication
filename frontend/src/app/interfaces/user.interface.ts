export type UserRole = 'admin' | 'manager' | 'teacher' | 'student';
export type Gender = 'male' | 'female' | 'other';

export interface IUser {
  id: string;
  _id?: string;          // MongoDB raw _id (available at runtime from backend)
  firstName: string;
  lastName: string;
  nickname?: string;     // ชื่อเล่น — ใช้เป็นชื่อหลักในการแสดงผล (ยกเว้นแท็บบุคลากร)
  email: string;
  phone?: string;
  role: UserRole;
  profileImageUrl?: string;
  profileImage?: string;
  bio?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  teachingHours?: number;
  subjects?: string[];   // Teacher subjects array
  grade?: string;        // Student grade level
  studentCourses?: string[];
  lineId?: string;
  age?: number;
  gender?: Gender;
  university?: string;
  paymentChannel?: string;
  academicYear?: string;
  totpEnabled?: boolean;
  registrationStatus?: 'registered' | 'unregistered';
  approvedBy?: string;
  approvedAt?: Date;
}

export interface ILoginRequest {
  email: string;
  password: string;
}

export interface IRegisterRequest {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  phone: string;
  role: 'teacher' | 'student';
  lineId?: string;
  age?: number;
  gender?: Gender;
  university?: string;
  paymentChannel?: string;
  academicYear?: string;
}

export interface IAuthResponse {
  token?: string;
  user?: IUser;
  requireOtp?: boolean;
  userId?: string;
  qrCode?: string;
  secret?: string;
}

export interface ITotpSetupResponse {
  qrCode: string;
  secret: string;
}

export interface IOtpVerifyResponse {
  token: string;
  user: IUser;
}
