# KMS Web Application - Frontend

A complete Angular 17+ Knowledge Management System (KMS) web application with role-based access control for Students, Teachers, Managers, and Administrators.

## Project Structure

```
frontend/
├── src/
│   ├── app/
│   │   ├── interfaces/           # TypeScript interfaces
│   │   ├── services/             # Angular services
│   │   ├── guards/               # Route guards
│   │   ├── interceptors/         # HTTP interceptors
│   │   ├── shared/               # Shared components & pipes
│   │   ├── pages/
│   │   │   ├── auth/             # Login & Register pages
│   │   │   ├── dashboard/        # Main layout
│   │   │   ├── student/          # Student pages
│   │   │   ├── teacher/          # Teacher pages
│   │   │   └── manager/          # Manager/Admin pages
│   │   ├── app.routes.ts         # Route configuration
│   │   ├── app.config.ts         # App configuration
│   │   └── app.component.ts      # Root component
│   ├── environments/             # Environment configuration
│   ├── styles.css                # Global styles
│   ├── main.ts                   # Bootstrap file
│   └── index.html                # HTML entry point
├── package.json
├── tsconfig.json
├── angular.json
└── README.md
```

## Features

### Role-Based Access Control
- **Student**: View recorded lessons, submit payments, check notifications, view schedule
- **Teacher**: View teaching schedule, manage assigned courses, check teaching hours
- **Manager/Admin**: Manage courses, view revenue, upload videos, manage staff

### Key Modules
- **Authentication**: Login, Register with JWT token management
- **Video Management**: Stream Zoom recordings with student access control
- **Payment Processing**: Track and confirm student payments
- **Schedule Management**: Calendar view using FullCalendar
- **Notifications**: Real-time notifications for users
- **Course Management**: Create and manage courses with teacher assignments

## Technologies

- Angular 17+
- TypeScript
- Reactive Forms
- RxJS
- FullCalendar
- CSS3 (custom styling, no Bootstrap)
- Thai Language Support

## Getting Started

### Prerequisites
- Node.js 18+ and npm 9+

### Installation

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Update environment configuration:
```bash
# Edit src/environments/environment.ts
# Change apiUrl to match your backend API
```

### Development Server

Run the development server:
```bash
npm start
```

Navigate to `http://localhost:4200/`. The application will automatically reload if you change any source files.

### Build

Build the project for production:
```bash
npm run build
```

The build artifacts will be stored in the `dist/` directory.

## Configuration

### API Endpoint
Edit `src/environments/environment.ts`:
```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:5000/api'  // Change this to your API
};
```

### Authentication
- Login endpoint: `/api/auth/login`
- Register endpoint: `/api/auth/register`
- Token stored in localStorage
- Automatically attaches Bearer token to all API requests

## Authentication Flow

1. User visits `/login` or `/register`
2. Credentials sent to backend
3. Token and user data returned and stored in localStorage
4. Token automatically attached to subsequent requests via AuthInterceptor
5. Protected routes checked with AuthGuard
6. Role-based access controlled with RoleGuard

## Styling

The application uses a modern custom CSS design without Bootstrap:

- **Color Scheme**:
  - Primary: #1a73e8 (Blue)
  - Secondary: #34a853 (Green)
  - Accent: #ea4335 (Red)
  - Background: #f8f9fa

- **Typography**: Thai-friendly fonts (Prompt, Sarabun) from Google Fonts

- **Responsive Design**: Mobile-first approach with breakpoints at 768px and 480px

## User Roles & Routes

### Student Routes
- `/dashboard/videos` - View recorded lessons
- `/dashboard/payments` - Submit and track payments
- `/dashboard/notifications` - View notifications
- `/dashboard/calendar` - Class schedule

### Teacher Routes
- `/dashboard/teacher-calendar` - Teaching schedule
- `/dashboard/teacher-courses` - Assigned courses
- `/dashboard/teacher-profile` - Profile and teaching hours

### Manager/Admin Routes
- `/dashboard/manager-calendar` - Master calendar
- `/dashboard/course-management` - Create/edit courses
- `/dashboard/revenue` - Revenue dashboard
- `/dashboard/video-management` - Upload videos
- `/dashboard/staff` - Manage users

## Services

### AuthService
- `login(credentials)` - User login
- `register(data)` - New user registration
- `logout()` - User logout
- `getCurrentUser()` - Get current user
- `getToken()` - Get JWT token
- `isLoggedIn()` - Check authentication status

### CourseService
- `getCourses()` - List all courses
- `getCourseById(id)` - Get course details
- `createCourse(data)` - Create new course
- `updateCourse(id, data)` - Update course
- `deleteCourse(id)` - Delete course

### PaymentService
- `getPayments()` - List payments
- `createPayment(data)` - Submit new payment
- `confirmPayment(data)` - Confirm payment
- `rejectPayment(data)` - Reject payment

### VideoService
- `getVideos()` - List videos
- `createVideo(data)` - Upload video
- `grantAccess(data)` - Grant student access
- `revokeAccess(data)` - Revoke access

### ScheduleService
- `getSchedules()` - List schedules
- `getCalendarEvents()` - Get calendar events

### NotificationService
- `getNotifications()` - List notifications
- `markAsRead(id)` - Mark notification as read
- `getUnreadCount()` - Get unread count

## Components

### Shared Components
- `HeaderComponent` - Top navigation with user menu and notifications
- `SidebarComponent` - Left sidebar with role-based menu
- `LoadingComponent` - Loading spinner
- `ConfirmDialogComponent` - Confirmation modal

### Standalone Components
All components are Angular 17+ standalone components with proper TypeScript typing.

## Error Handling

- HTTP errors automatically handled by ErrorInterceptor
- 401 errors trigger logout and redirect to login
- User-friendly error messages displayed
- Console logging for debugging

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Performance

- Lazy loading of components via routing
- OnPush change detection strategy ready
- Optimized HTTP requests with RxJS operators
- CSS variables for theme switching
- Responsive images and layouts

## Future Enhancements

- Dark mode theme toggle
- Multi-language support
- Advanced analytics dashboard
- Real-time notifications via WebSocket
- File upload for payment slips
- Email notifications
- Two-factor authentication
- API rate limiting indicator

## License

Private Project - All rights reserved

## Support

For issues and questions, contact the development team.
