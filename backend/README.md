# KMS Backend - Knowledge Management System

Complete Node.js + Express + MongoDB backend for an online tutoring/teaching platform.

## Features

- Role-based access control (admin, manager, student, teacher)
- User management with JWT authentication
- Course creation and management
- Student enrollment system
- Payment tracking with slip verification
- Video recording storage and access control
- Class scheduling with calendar view
- Real-time notification system
- Comprehensive error handling and validation

## Installation

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file from `.env.example`:
```bash
cp .env.example .env
```

3. Configure your environment variables:
```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/kms_db
JWT_SECRET=your_super_secret_jwt_key_here_change_in_production
JWT_EXPIRE=7d
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
MAX_FILE_SIZE=52428800
UPLOAD_DIR=uploads
```

4. Start MongoDB service (if local):
```bash
mongod
```

5. Run the server:
```bash
npm start          # Production
npm run dev        # Development with nodemon
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user
- `POST /api/auth/refresh` - Refresh JWT token
- `PUT /api/auth/change-password` - Change password

### Users
- `GET /api/users` - List all users (admin/manager only)
- `GET /api/users/:id` - Get user details
- `PUT /api/users/:id` - Update user profile
- `DELETE /api/users/:id` - Deactivate user
- `GET /api/users/teachers` - List all teachers
- `GET /api/users/students` - List all students

### Courses
- `POST /api/courses` - Create course (manager/admin)
- `GET /api/courses` - List courses
- `GET /api/courses/:id` - Get course details
- `PUT /api/courses/:id` - Update course
- `PUT /api/courses/:id/accept` - Accept course (teacher)
- `DELETE /api/courses/:id` - Cancel course
- `GET /api/courses/teacher/:teacherId` - Get teacher's courses

### Enrollments
- `POST /api/enrollments` - Enroll student (manager/admin)
- `GET /api/enrollments` - List enrollments
- `GET /api/enrollments/student/:studentId` - Get student enrollments
- `PUT /api/enrollments/:id` - Update enrollment
- `DELETE /api/enrollments/:id` - Cancel enrollment

### Payments
- `POST /api/payments` - Submit payment
- `GET /api/payments` - List payments
- `GET /api/payments/:id` - Get payment details
- `PUT /api/payments/:id/confirm` - Confirm payment (manager/admin)
- `PUT /api/payments/:id/reject` - Reject payment
- `GET /api/payments/revenue/summary` - Revenue summary

### Videos
- `POST /api/videos` - Upload video (manager/admin)
- `GET /api/videos` - List videos
- `GET /api/videos/:id` - Get video details
- `PUT /api/videos/:id` - Update video
- `PUT /api/videos/:id/grant-access` - Grant student access
- `PUT /api/videos/:id/revoke-access` - Revoke student access
- `DELETE /api/videos/:id` - Deactivate video

### Schedules
- `POST /api/schedules` - Create schedule (manager/admin)
- `GET /api/schedules` - List schedules
- `GET /api/schedules/:id` - Get schedule details
- `PUT /api/schedules/:id` - Update schedule
- `DELETE /api/schedules/:id` - Cancel schedule
- `GET /api/schedules/calendar/view` - Calendar view data

### Notifications
- `GET /api/notifications` - Get user notifications
- `GET /api/notifications/unread-count` - Get unread count
- `PUT /api/notifications/:id/read` - Mark as read
- `PUT /api/notifications/read-all` - Mark all as read

## Project Structure

```
backend/
├── config/
│   └── db.js                 # Database connection
├── middleware/
│   ├── auth.js              # JWT verification
│   └── roleCheck.js         # Role-based access control
├── models/
│   ├── User.js              # User schema
│   ├── Course.js            # Course schema
│   ├── Enrollment.js        # Enrollment schema
│   ├── Payment.js           # Payment schema
│   ├── Video.js             # Video schema
│   ├── Schedule.js          # Schedule schema
│   └── Notification.js      # Notification schema
├── routes/
│   ├── auth.js              # Auth endpoints
│   ├── users.js             # User endpoints
│   ├── courses.js           # Course endpoints
│   ├── enrollments.js       # Enrollment endpoints
│   ├── payments.js          # Payment endpoints
│   ├── videos.js            # Video endpoints
│   ├── schedules.js         # Schedule endpoints
│   └── notifications.js     # Notification endpoints
├── utils/
│   └── helpers.js           # Helper functions
├── uploads/                 # File uploads directory
├── server.js                # Main server file
├── package.json             # Dependencies
├── .env.example             # Environment template
└── README.md                # This file
```

## Response Format

All API responses follow this format:

```json
{
  "success": true,
  "data": {},
  "message": "Success message",
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "pages": 10
  }
}
```

## Error Handling

- All endpoints include comprehensive error handling
- Validation of required fields
- Proper HTTP status codes
- User-friendly error messages
- Detailed error logging

## Authentication

- JWT tokens in Authorization header: `Bearer <token>`
- Token expiration: 7 days (configurable)
- Refresh token endpoint available
- Secure password hashing with bcryptjs

## File Uploads

- Payment slip images supported (JPEG, PNG, GIF, PDF)
- Max file size: 50MB
- Files stored in `uploads/` directory
- Automatic file type validation

## Database Models

### User
- firstName, lastName, email (unique)
- password (bcrypt hashed)
- role (admin, manager, student, teacher)
- profileImage, phone
- Teacher: teachingHours, subjects, bio
- Student: grade, parentContact
- isActive, timestamps

### Course
- name, description, subject
- teacher (ref User)
- maxStudents, price
- schedule (dayOfWeek, startTime, endTime)
- status (pending, approved, active, completed, cancelled)
- teacherAccepted, timestamps

### Enrollment
- student (ref User)
- course (ref Course)
- enrolledBy (ref User)
- status (pending, active, completed, cancelled)
- enrolledAt, completedAt, timestamps

### Payment
- student (ref User)
- course (ref Course)
- amount, method
- slipImage, transactionRef
- status (pending, confirmed, rejected)
- confirmedBy, note, timestamps

### Video
- title, description
- zoomRecordingUrl, zoomMeetingId
- course (ref Course)
- uploadedBy (ref User)
- allowedStudents (ref User array)
- duration, recordedAt, isActive, timestamps

### Schedule
- course (ref Course)
- teacher (ref User)
- students (ref User array)
- date, startTime, endTime
- zoomLink, room
- status (scheduled, completed, cancelled)
- note, timestamps

### Notification
- recipient (ref User)
- sender (ref User)
- type (payment, enrollment, schedule, course, general, video)
- title, message
- relatedId, isRead, timestamps

## Security Features

- CORS protection
- Helmet security headers
- Rate limiting (100 requests per 15 minutes)
- JWT token verification
- Role-based access control
- Password hashing with bcryptjs
- Input validation
- Soft delete implementation

## Pagination

All list endpoints support pagination:
```
GET /api/users?page=1&limit=10
```

Query parameters:
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 10)

Response includes pagination metadata:
```json
{
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "pages": 10
  }
}
```

## Deployment

1. Set `NODE_ENV=production`
2. Use secure JWT_SECRET
3. Configure MongoDB Atlas connection
4. Set appropriate CORS_ORIGIN
5. Enable HTTPS
6. Use environment variables for all secrets

## License

Proprietary - Knowledge Management System
