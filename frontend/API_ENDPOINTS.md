# KMS Backend API Endpoints Reference

This document describes all API endpoints expected by the frontend application. Ensure your backend implements these endpoints exactly as specified.

## Base URL
```
http://localhost:5000/api
```

Configure this in: `src/environments/environment.ts`

## Authentication Endpoints

### POST `/auth/login`
User login with email and password.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "user_id_123",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john@example.com",
      "phone": "0812345678",
      "role": "student",
      "profileImageUrl": "https://...",
      "bio": "...",
      "isActive": true,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z",
      "teachingHours": 0,
      "studentCourses": []
    }
  },
  "message": "Login successful"
}
```

### POST `/auth/register`
New user registration.

**Request Body:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "password": "password123",
  "confirmPassword": "password123",
  "phone": "0812345678"
}
```

**Response (201 Created):**
Same as login response.

### POST `/auth/refresh-token`
Refresh JWT token.

**Request Body:**
```json
{}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs..."
  },
  "message": "Token refreshed"
}
```

### GET `/auth/me`
Get current authenticated user.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "user_id_123",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "0812345678",
    "role": "student",
    "profileImageUrl": "https://...",
    "bio": "...",
    "isActive": true,
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z",
    "teachingHours": 0,
    "studentCourses": []
  },
  "message": "Current user retrieved"
}
```

## User Endpoints

### GET `/users`
List all users with pagination.

**Query Parameters:**
```
?page=1&pageSize=20&role=student&search=John&sortBy=createdAt&sortOrder=desc
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "user_id_123",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john@example.com",
      "phone": "0812345678",
      "role": "student",
      "isActive": true,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ],
  "message": "Users retrieved",
  "pagination": {
    "total": 100,
    "page": 1,
    "pageSize": 20,
    "totalPages": 5
  }
}
```

### GET `/users/:id`
Get user by ID.

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "user_id_123",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "0812345678",
    "role": "student",
    "isActive": true,
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z",
    "teachingHours": 0
  },
  "message": "User retrieved"
}
```

### POST `/users`
Create new user.

**Request Body:**
```json
{
  "firstName": "Jane",
  "lastName": "Smith",
  "email": "jane@example.com",
  "password": "password123",
  "phone": "0898765432",
  "role": "student"
}
```

**Response (201 Created):**
Same as GET user response.

### PUT `/users/:id`
Update user.

**Request Body:**
```json
{
  "firstName": "Jane",
  "lastName": "Smith",
  "phone": "0898765432",
  "bio": "Updated bio"
}
```

**Response (200 OK):**
Same as GET user response.

### DELETE `/users/:id`
Delete user.

**Response (200 OK):**
```json
{
  "success": true,
  "data": null,
  "message": "User deleted"
}
```

## Course Endpoints

### GET `/courses`
List all courses with pagination.

**Query Parameters:**
```
?page=1&pageSize=20&teacherId=teacher_id&search=Python
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "course_id_123",
      "courseCode": "CS101",
      "courseName": "Introduction to Programming",
      "description": "Learn the basics of programming...",
      "teacherId": "teacher_id_123",
      "teacherName": "John Doe",
      "credits": 3,
      "maxStudents": 30,
      "startDate": "2024-01-15T00:00:00Z",
      "endDate": "2024-05-15T00:00:00Z",
      "roomNumber": "101",
      "status": "active",
      "enrollmentCount": 25,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ],
  "message": "Courses retrieved",
  "pagination": {
    "total": 50,
    "page": 1,
    "pageSize": 20,
    "totalPages": 3
  }
}
```

### GET `/courses/:id`
Get course by ID.

**Response (200 OK):**
Same course object structure as above.

### POST `/courses`
Create new course.

**Request Body:**
```json
{
  "courseCode": "CS102",
  "courseName": "Advanced Python",
  "description": "Learn advanced Python concepts...",
  "teacherId": "teacher_id_123",
  "credits": 4,
  "maxStudents": 25,
  "startDate": "2024-02-01",
  "endDate": "2024-06-01",
  "roomNumber": "202"
}
```

**Response (201 Created):**
Same course object structure as above.

### PUT `/courses/:id`
Update course.

**Request Body:**
```json
{
  "courseName": "Advanced Python Programming",
  "maxStudents": 30
}
```

**Response (200 OK):**
Same course object structure as above.

### DELETE `/courses/:id`
Delete course.

**Response (200 OK):**
```json
{
  "success": true,
  "data": null,
  "message": "Course deleted"
}
```

### POST `/courses/:id/accept`
Teacher accepts course assignment.

**Response (200 OK):**
```json
{
  "success": true,
  "data": { /* course object */ },
  "message": "Course accepted",
  "status": "active"
}
```

### POST `/courses/:id/reject`
Teacher rejects course assignment.

**Response (200 OK):**
Same as accept, with `status: "cancelled"`.

### GET `/courses/student/:studentId`
Get courses enrolled by student.

**Response (200 OK):**
```json
{
  "success": true,
  "data": [ /* array of course objects */ ],
  "message": "Student courses retrieved"
}
```

## Enrollment Endpoints

### GET `/enrollments`
List all enrollments.

**Query Parameters:**
```
?studentId=student_id&courseId=course_id&page=1&pageSize=20
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "enrollment_id_123",
      "studentId": "student_id_123",
      "studentName": "John Doe",
      "courseId": "course_id_123",
      "courseName": "Introduction to Programming",
      "enrollmentDate": "2024-01-15T00:00:00Z",
      "status": "active",
      "grade": "A",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ],
  "message": "Enrollments retrieved",
  "pagination": { /* ... */ }
}
```

### GET `/enrollments/:id`
Get enrollment by ID.

**Response (200 OK):**
Same enrollment object structure as above.

### POST `/enrollments`
Create new enrollment.

**Request Body:**
```json
{
  "studentId": "student_id_123",
  "courseId": "course_id_123"
}
```

**Response (201 Created):**
Same enrollment object structure as above.

### PUT `/enrollments/:id`
Update enrollment.

**Request Body:**
```json
{
  "status": "completed",
  "grade": "A+"
}
```

**Response (200 OK):**
Same enrollment object structure as above.

### DELETE `/enrollments/:id`
Delete enrollment.

**Response (200 OK):**
```json
{
  "success": true,
  "data": null,
  "message": "Enrollment deleted"
}
```

## Payment Endpoints

### GET `/payments`
List all payments.

**Query Parameters:**
```
?studentId=student_id&status=pending&page=1&pageSize=20
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "payment_id_123",
      "studentId": "student_id_123",
      "studentName": "John Doe",
      "courseId": "course_id_123",
      "courseName": "Introduction to Programming",
      "amount": 1500,
      "paymentMethod": "bank_transfer",
      "slipUrl": "https://...",
      "status": "pending",
      "submittedDate": "2024-01-15T00:00:00Z",
      "confirmedDate": null,
      "rejectionReason": null,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ],
  "message": "Payments retrieved",
  "pagination": { /* ... */ }
}
```

### GET `/payments/:id`
Get payment by ID.

**Response (200 OK):**
Same payment object structure as above.

### POST `/payments`
Submit new payment.

**Request Body:**
```json
{
  "studentId": "student_id_123",
  "courseId": "course_id_123",
  "amount": 1500,
  "paymentMethod": "bank_transfer",
  "slipUrl": "https://example.com/slip.jpg"
}
```

**Response (201 Created):**
Same payment object structure as above.

### PUT `/payments/:id`
Update payment.

**Request Body:**
```json
{
  "amount": 1600,
  "slipUrl": "https://example.com/new-slip.jpg"
}
```

**Response (200 OK):**
Same payment object structure as above.

### POST `/payments/confirm`
Confirm/approve payment.

**Request Body:**
```json
{
  "paymentId": "payment_id_123",
  "confirmedDate": "2024-01-20T00:00:00Z"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": { /* updated payment object with status: "confirmed" */ },
  "message": "Payment confirmed"
}
```

### POST `/payments/reject`
Reject payment.

**Request Body:**
```json
{
  "paymentId": "payment_id_123",
  "rejectionReason": "Slip image is not clear"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": { /* updated payment object with status: "rejected" */ },
  "message": "Payment rejected"
}
```

### GET `/payments/revenue`
Get revenue statistics.

**Query Parameters:**
```
?startDate=2024-01-01&endDate=2024-12-31&status=confirmed
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "totalRevenue": 50000,
    "paymentsByStatus": {
      "confirmed": 50000,
      "pending": 10000,
      "rejected": 0
    }
  },
  "message": "Revenue retrieved"
}
```

### DELETE `/payments/:id`
Delete payment.

**Response (200 OK):**
```json
{
  "success": true,
  "data": null,
  "message": "Payment deleted"
}
```

## Video Endpoints

### GET `/videos`
List all videos.

**Query Parameters:**
```
?courseId=course_id&page=1&pageSize=20
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "video_id_123",
      "courseId": "course_id_123",
      "courseName": "Introduction to Programming",
      "title": "Lesson 1: Variables and Data Types",
      "description": "Learn about variables and data types...",
      "zoomRecordingUrl": "https://zoom.us/rec/play/...",
      "duration": 45,
      "recordedDate": "2024-01-15T10:00:00Z",
      "uploadedBy": "teacher@example.com",
      "uploadedDate": "2024-01-15T12:00:00Z",
      "grantedStudents": ["student_id_1", "student_id_2"],
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ],
  "message": "Videos retrieved",
  "pagination": { /* ... */ }
}
```

### GET `/videos/:id`
Get video by ID.

**Response (200 OK):**
Same video object structure as above.

### POST `/videos`
Upload new video.

**Request Body:**
```json
{
  "courseId": "course_id_123",
  "title": "Lesson 2: Functions",
  "description": "Learn about functions...",
  "zoomRecordingUrl": "https://zoom.us/rec/play/...",
  "duration": 50,
  "recordedDate": "2024-01-20T10:00:00Z"
}
```

**Response (201 Created):**
Same video object structure as above.

### PUT `/videos/:id`
Update video.

**Request Body:**
```json
{
  "title": "Lesson 2: Functions and Scope",
  "description": "Updated description..."
}
```

**Response (200 OK):**
Same video object structure as above.

### POST `/videos/grant-access`
Grant student access to video.

**Request Body:**
```json
{
  "videoId": "video_id_123",
  "studentIds": ["student_id_1", "student_id_2", "student_id_3"]
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": { /* updated video object */ },
  "message": "Access granted"
}
```

### POST `/videos/revoke-access`
Revoke student access to video.

**Request Body:**
```json
{
  "videoId": "video_id_123",
  "studentId": "student_id_1"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": { /* updated video object */ },
  "message": "Access revoked"
}
```

### GET `/videos/student/:studentId`
Get videos accessible to student.

**Response (200 OK):**
```json
{
  "success": true,
  "data": [ /* array of video objects */ ],
  "message": "Student videos retrieved"
}
```

### DELETE `/videos/:id`
Delete video.

**Response (200 OK):**
```json
{
  "success": true,
  "data": null,
  "message": "Video deleted"
}
```

## Schedule Endpoints

### GET `/schedules`
List all schedules.

**Query Parameters:**
```
?courseId=course_id&teacherId=teacher_id&page=1&pageSize=20
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "schedule_id_123",
      "courseId": "course_id_123",
      "courseName": "Introduction to Programming",
      "teacherId": "teacher_id_123",
      "teacherName": "John Doe",
      "dayOfWeek": "Monday",
      "startTime": "09:00",
      "endTime": "11:00",
      "roomNumber": "101",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ],
  "message": "Schedules retrieved",
  "pagination": { /* ... */ }
}
```

### GET `/schedules/:id`
Get schedule by ID.

**Response (200 OK):**
Same schedule object structure as above.

### POST `/schedules`
Create new schedule.

**Request Body:**
```json
{
  "courseId": "course_id_123",
  "dayOfWeek": "Monday",
  "startTime": "09:00",
  "endTime": "11:00",
  "roomNumber": "101"
}
```

**Response (201 Created):**
Same schedule object structure as above.

### PUT `/schedules/:id`
Update schedule.

**Request Body:**
```json
{
  "startTime": "10:00",
  "endTime": "12:00",
  "roomNumber": "102"
}
```

**Response (200 OK):**
Same schedule object structure as above.

### DELETE `/schedules/:id`
Delete schedule.

**Response (200 OK):**
```json
{
  "success": true,
  "data": null,
  "message": "Schedule deleted"
}
```

### GET `/schedules/calendar`
Get calendar events.

**Query Parameters:**
```
?teacherId=teacher_id&studentId=student_id&startDate=2024-01-01&endDate=2024-12-31
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "schedule_id_123",
      "title": "Introduction to Programming",
      "startTime": "2024-01-15T09:00:00Z",
      "endTime": "2024-01-15T11:00:00Z",
      "courseId": "course_id_123",
      "teacherId": "teacher_id_123",
      "studentId": "student_id_123",
      "resourceId": "resource_123"
    }
  ],
  "message": "Calendar events retrieved"
}
```

## Notification Endpoints

### GET `/notifications`
List user notifications.

**Query Parameters:**
```
?page=1&pageSize=20&isRead=false
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "notification_id_123",
      "userId": "user_id_123",
      "title": "Payment Confirmed",
      "message": "Your payment has been confirmed",
      "type": "success",
      "isRead": false,
      "relatedResourceId": "payment_id_123",
      "relatedResourceType": "payment",
      "createdAt": "2024-01-20T10:00:00Z",
      "updatedAt": "2024-01-20T10:00:00Z"
    }
  ],
  "message": "Notifications retrieved",
  "pagination": { /* ... */ }
}
```

### GET `/notifications/:id`
Get notification by ID.

**Response (200 OK):**
Same notification object structure as above.

### POST `/notifications`
Create new notification.

**Request Body:**
```json
{
  "userId": "user_id_123",
  "title": "Course Reminder",
  "message": "Your course starts in 1 hour",
  "type": "info",
  "relatedResourceId": "course_id_123",
  "relatedResourceType": "course"
}
```

**Response (201 Created):**
Same notification object structure as above.

### POST `/notifications/:id/read`
Mark notification as read.

**Request Body:**
```json
{}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": { /* updated notification object with isRead: true */ },
  "message": "Notification marked as read"
}
```

### POST `/notifications/read-all`
Mark all notifications as read.

**Request Body:**
```json
{}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": null,
  "message": "All notifications marked as read"
}
```

### GET `/notifications/unread-count`
Get unread notification count.

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "count": 5
  },
  "message": "Unread count retrieved"
}
```

### DELETE `/notifications/:id`
Delete notification.

**Response (200 OK):**
```json
{
  "success": true,
  "data": null,
  "message": "Notification deleted"
}
```

## Error Responses

All endpoints may return error responses in this format:

**400 Bad Request:**
```json
{
  "success": false,
  "data": null,
  "message": "Invalid request data"
}
```

**401 Unauthorized:**
```json
{
  "success": false,
  "data": null,
  "message": "Unauthorized - please login"
}
```

**403 Forbidden:**
```json
{
  "success": false,
  "data": null,
  "message": "You don't have permission to access this resource"
}
```

**404 Not Found:**
```json
{
  "success": false,
  "data": null,
  "message": "Resource not found"
}
```

**500 Internal Server Error:**
```json
{
  "success": false,
  "data": null,
  "message": "Internal server error"
}
```

## Headers

All requests must include:
```
Content-Type: application/json
```

For authenticated endpoints, include:
```
Authorization: Bearer <jwt_token>
```

## Notes

1. All timestamps are in ISO 8601 format (UTC)
2. Pagination defaults: page=1, pageSize=20
3. Token should be stored in localStorage and sent with every request
4. If token expires (401), frontend will automatically logout and redirect to login
5. All role-based access control is enforced on the backend
