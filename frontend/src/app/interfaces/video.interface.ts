export interface IVideo {
  id: string;
  courseId: string;
  courseName?: string;
  title: string;
  description?: string;
  zoomRecordingUrl: string;
  duration: number;
  recordedDate: Date;
  uploadedBy: string;
  uploadedDate: Date;
  grantedStudents: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IVideoCreateRequest {
  courseId: string;
  title: string;
  description?: string;
  zoomRecordingUrl: string;
  duration: number;
  recordedDate: Date;
}

export interface IVideoGrantAccessRequest {
  videoId: string;
  studentIds: string[];
}

export interface IVideoRevokeAccessRequest {
  videoId: string;
  studentId: string;
}
