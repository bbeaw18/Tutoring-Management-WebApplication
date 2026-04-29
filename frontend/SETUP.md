# KMS Frontend - Complete Setup Guide

## Project Overview

This is a production-ready Angular 17+ frontend for a Knowledge Management System with role-based access control for 4 user types: Students, Teachers, Managers, and Administrators.

## Project Statistics

- **Total Components**: 20+ standalone components
- **Services**: 8 API services
- **Routes**: 20+ protected routes
- **Interfaces**: 8 TypeScript interfaces
- **Lines of Code**: 5000+

## Prerequisites

### System Requirements
- Node.js: v18.0.0 or higher
- npm: v9.0.0 or higher
- Git: v2.0.0 or higher

### Install Node.js
```bash
# Using NVM (recommended)
nvm install 18
nvm use 18

# Or download from https://nodejs.org/
```

### Verify Installation
```bash
node --version    # Should be v18+
npm --version     # Should be v9+
```

## Installation Steps

### 1. Navigate to Project Directory
```bash
cd /sessions/busy-quirky-gates/mnt/KMS_WebAPP/frontend
```

### 2. Install Dependencies
```bash
npm install
```

This will install:
- Angular 17 and related packages
- FullCalendar for calendar functionality
- TypeScript compiler
- Build tools and development dependencies

**Installation time**: ~3-5 minutes

### 3. Configure Environment

Edit `src/environments/environment.ts`:
```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:5000/api'  // Match your backend API URL
};
```

For production, edit `src/environments/environment.prod.ts`:
```typescript
export const environment = {
  production: true,
  apiUrl: 'https://api.your-domain.com/api'  // Your production API
};
```

### 4. Start Development Server

```bash
npm start
```

This will:
- Compile TypeScript files
- Bundle the application
- Start dev server at http://localhost:4200
- Watch for file changes and auto-reload

**Server startup time**: ~20-30 seconds

### 5. Access the Application

1. Open browser: http://localhost:4200
2. You should see the KMS login page
3. Login with test credentials (provided by backend)

## Available Commands

### Development
```bash
npm start              # Start development server
npm run watch         # Build and watch for changes
npm test              # Run unit tests
```

### Production
```bash
npm run build         # Build for production
ng build --prod       # Alternative build command
```

### Project Info
```bash
npm list              # Show installed dependencies
npm list --depth=0    # Show top-level packages only
```

## Project Structure Explanation

### `/src`
Contains all source code and assets.

### `/src/app/interfaces`
TypeScript interfaces defining data models:
- `user.interface.ts` - User model with roles
- `course.interface.ts` - Course model
- `payment.interface.ts` - Payment model
- `video.interface.ts` - Video model
- `schedule.interface.ts` - Schedule model
- `notification.interface.ts` - Notification model
- `enrollment.interface.ts` - Enrollment model
- `api-response.interface.ts` - API response wrapper

### `/src/app/services`
HTTP services for API communication:
- `auth.service.ts` - Authentication & token management
- `user.service.ts` - User CRUD operations
- `course.service.ts` - Course management
- `enrollment.service.ts` - Enrollment management
- `payment.service.ts` - Payment processing
- `video.service.ts` - Video management
- `schedule.service.ts` - Schedule & calendar
- `notification.service.ts` - Notifications

### `/src/app/guards`
Route protection:
- `auth.guard.ts` - Verify user is logged in
- `role.guard.ts` - Verify user has required role
- `guest.guard.ts` - Redirect logged-in users away from login/register

### `/src/app/interceptors`
HTTP request/response processing:
- `auth.interceptor.ts` - Attach JWT token to requests
- `error.interceptor.ts` - Handle HTTP errors & logout on 401

### `/src/app/shared/components`
Reusable components:
- `header/` - Top navigation bar
- `sidebar/` - Left navigation menu
- `loading/` - Loading spinner
- `confirm-dialog/` - Confirmation modal

### `/src/app/shared/pipes`
Custom pipes:
- `safe.pipe.ts` - Sanitize URLs for iframes

### `/src/app/pages`
Page components organized by feature:

**Auth Pages** (`/auth`):
- `login/` - User login page
- `register/` - New user registration

**Dashboard** (`/dashboard`):
- Main layout with sidebar and header

**Student Pages** (`/student`):
- `video-replay/` - Watch recorded lessons
- `payment/` - Submit and track payments
- `student-calendar/` - View class schedule
- `student-notifications/` - View notifications

**Teacher Pages** (`/teacher`):
- `teacher-calendar/` - View teaching schedule
- `teacher-courses/` - Manage assigned courses
- `teacher-profile/` - Profile and teaching hours

**Manager/Admin Pages** (`/manager`):
- `manager-calendar/` - Master calendar
- `course-management/` - Create/edit courses
- `revenue/` - Revenue dashboard
- `video-management/` - Upload videos
- `staff-list/` - Manage users

### `/src/environments`
Configuration files:
- `environment.ts` - Development settings
- `environment.prod.ts` - Production settings

### Root Configuration Files
- `package.json` - NPM dependencies and scripts
- `tsconfig.json` - TypeScript compiler settings
- `angular.json` - Angular CLI configuration
- `src/main.ts` - Application bootstrap

## Understanding the Architecture

### Authentication Flow
```
User visits /login
         ↓
Submits credentials (email, password)
         ↓
AuthService.login() sends POST to /api/auth/login
         ↓
Backend returns: { token: "jwt...", user: { id, name, role } }
         ↓
AuthInterceptor stores token in localStorage
         ↓
AuthService.currentUser$ BehaviorSubject updates
         ↓
Router navigates to /dashboard
         ↓
AuthGuard checks token exists before accessing routes
```

### HTTP Request Flow
```
Component calls service.getData()
         ↓
Service creates HttpClient request
         ↓
AuthInterceptor adds Authorization header
         ↓
Request sent to backend
         ↓
Response received
         ↓
ErrorInterceptor checks for errors
         ↓
Service maps response and returns data
         ↓
Component receives Observable with data
```

### Role-Based Access Control
```
User logs in with specific role (student, teacher, manager, admin)
         ↓
AuthService stores current user with role
         ↓
Sidebar component checks role and shows relevant menu items
         ↓
When navigating to protected route:
  - AuthGuard verifies user is logged in
  - RoleGuard verifies user has allowed role
         ↓
If authorized: component loads
If unauthorized: redirect to /dashboard
```

## Styling System

### Global Styles
- Located in `/src/styles.css`
- CSS Variables for theming
- Responsive design with media queries
- Thai font support (Prompt, Sarabun)

### Color Scheme
```css
--primary-color: #1a73e8;      /* Blue */
--secondary-color: #34a853;    /* Green */
--accent-color: #ea4335;       /* Red */
--bg-color: #f8f9fa;           /* Light gray */
--text-primary: #202124;       /* Dark gray */
--text-secondary: #5f6368;     /* Medium gray */
--text-tertiary: #9aa0a6;      /* Light gray */
```

### Responsive Breakpoints
- **768px**: Tablet devices (sidebar becomes hamburger menu)
- **480px**: Mobile phones (reduced padding, stacked layouts)

## Testing the Application

### Test Different Roles

Create test accounts or login with backend-provided credentials:

1. **Student Account**
   - Access student-only pages: Videos, Payments, Calendar
   - Sidebar shows student menu items
   - Cannot access manager pages

2. **Teacher Account**
   - Access teacher pages: Teacher Calendar, Courses, Profile
   - See only assigned courses
   - Cannot access student or manager pages

3. **Manager/Admin Account**
   - Access all manager pages: Calendar, Course Management, Revenue
   - Can manage courses, view revenue, upload videos
   - Can manage all users

### Test Features

1. **Authentication**
   - Try logging in with wrong credentials
   - Verify token persists on page reload
   - Test logout functionality

2. **Navigation**
   - Verify sidebar shows correct items for role
   - Test that unauthorized routes redirect to dashboard

3. **Forms**
   - Submit forms with invalid data (test validation)
   - Submit with valid data (should succeed)

4. **Calendar**
   - Verify events load correctly
   - Switch between month/week/day views

## Troubleshooting

### Port 4200 Already in Use
```bash
# Use different port
ng serve --port 4300

# Or kill process using port 4200
lsof -i :4200        # Find process
kill -9 <PID>        # Kill process
```

### Dependencies Not Installing
```bash
# Clear npm cache
npm cache clean --force

# Remove node_modules
rm -rf node_modules package-lock.json

# Reinstall
npm install
```

### API Connection Errors
1. Verify backend is running
2. Check API URL in environment.ts
3. Check CORS headers on backend
4. Test API endpoint with Postman/curl

### TypeScript Compilation Errors
```bash
# Clear Angular cache
ng cache clean

# Reinstall dependencies
npm install

# Rebuild
ng build
```

### Styling Issues
1. Clear browser cache (Ctrl+Shift+Delete)
2. Hard refresh (Ctrl+F5 or Cmd+Shift+R)
3. Check that styles.css is imported in index.html

## Performance Optimization

### Production Build
```bash
npm run build
```

This creates optimized bundle in `/dist` folder with:
- Tree-shaking (removes unused code)
- Minification (reduces file size)
- Lazy loading (loads routes on demand)
- Source maps (for debugging)

### Bundle Size Analysis
```bash
ng build --stats-json
npm install -g webpack-bundle-analyzer
webpack-bundle-analyzer dist/kms-webapp-frontend/stats.json
```

### Development Performance
- Use OnPush change detection (already configured)
- Lazy load route components
- Unsubscribe from observables in components

## Deployment

### Build for Production
```bash
npm run build
```

### Deploy to Server
```bash
# Copy dist folder to web server
scp -r dist/kms-webapp-frontend/* user@server:/var/www/kms

# Or using AWS S3
aws s3 sync dist/kms-webapp-frontend/ s3://my-bucket/

# Or using Firebase
firebase deploy
```

## Development Best Practices

### Code Style
- Use Angular naming conventions
- Keep components focused (single responsibility)
- Use interfaces for type safety
- Avoid any type, use specific types

### Observable Management
```typescript
// Avoid memory leaks - unsubscribe from observables
subscriptions: Subscription[] = [];

ngOnInit() {
  this.subscriptions.push(
    this.service.getData().subscribe(...)
  );
}

ngOnDestroy() {
  this.subscriptions.forEach(s => s.unsubscribe());
}

// Or use async pipe in template
{{ data$ | async }}
```

### Error Handling
- Always provide error callbacks in subscriptions
- Display user-friendly error messages
- Log errors to console for debugging

### Component Communication
- Use Inputs for parent → child communication
- Use Outputs (EventEmitter) for child → parent
- Use Services with BehaviorSubject for sibling communication

## Common Tasks

### Add a New Component
```bash
# Create component files
mkdir src/app/pages/new-feature
touch src/app/pages/new-feature/new-feature.component.ts
touch src/app/pages/new-feature/new-feature.component.html
touch src/app/pages/new-feature/new-feature.component.css
```

### Add a New Route
Edit `src/app/app.routes.ts`:
```typescript
{
  path: 'new-feature',
  component: NewFeatureComponent,
  canActivate: [authGuard],
  data: { roles: ['student', 'teacher'] }
}
```

### Add a New Service
```bash
touch src/app/services/new-feature.service.ts
```

### Update API Endpoint
Edit service:
```typescript
private apiUrl = `${environment.apiUrl}/new-endpoint`;
```

## Documentation

- **Angular Docs**: https://angular.io/docs
- **TypeScript Docs**: https://www.typescriptlang.org/docs
- **FullCalendar Docs**: https://fullcalendar.io/docs/angular
- **RxJS Docs**: https://rxjs.dev/api

## Support & Contact

For issues, questions, or improvements:
1. Check the README.md file
2. Review component documentation
3. Check browser console for errors
4. Contact development team

## Next Steps

1. **Start Development Server**: `npm start`
2. **Create Test Accounts** with backend team
3. **Test Each Role's Features**
4. **Review Code Structure** and understand architecture
5. **Customize** components as needed
6. **Deploy** to staging environment
7. **Test in Production** before launch

---

Happy coding! 🚀
