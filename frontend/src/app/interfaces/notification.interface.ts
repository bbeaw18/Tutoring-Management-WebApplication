export interface INotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'error';
  isRead: boolean;
  relatedResourceId?: string;
  relatedResourceType?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface INotificationRequest {
  userId: string;
  title: string;
  message: string;
  type: string;
  relatedResourceId?: string;
  relatedResourceType?: string;
}

export interface IMarkReadRequest {
  notificationId: string;
}
