# Quick Start Guide

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/kms_db
JWT_SECRET=your_secret_key_change_this
JWT_EXPIRE=7d
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
```

### 3. Start MongoDB
If using local MongoDB:
```bash
mongod
```

### 4. Start the Server
Development mode with auto-reload:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

Server will run on http://localhost:5000

## Test the Server

Health check:
```bash
curl http://localhost:5000/health
```

## Example API Calls

### Register a User
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "password": "password123",
    "phone": "1234567890",
    "role": "student"
  }'
```

### Login
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "password123"
  }'
```

Save the returned token and use it for authenticated requests:

### Get Current User
```bash
curl -X GET http://localhost:5000/api/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Get All Users (Admin/Manager only)
```bash
curl -X GET http://localhost:5000/api/users \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Create a Course (Manager only)
```bash
curl -X POST http://localhost:5000/api/courses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "name": "Advanced Math",
    "description": "Learn advanced mathematics concepts",
    "subject": "Mathematics",
    "teacher": "TEACHER_ID",
    "maxStudents": 30,
    "price": 5000,
    "schedule": {
      "dayOfWeek": "Monday",
      "startTime": "14:00",
      "endTime": "15:30"
    }
  }'
```

### Enroll a Student (Manager only)
```bash
curl -X POST http://localhost:5000/api/enrollments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "student": "STUDENT_ID",
    "course": "COURSE_ID"
  }'
```

## Database Seeding (Optional)

You can create sample data by making API requests. Here's a typical workflow:

1. Register multiple users with different roles
2. Create courses as a manager
3. Have teachers accept courses
4. Enroll students in courses
5. Submit payments for courses
6. Create class schedules

## File Structure

- `server.js` - Main application entry point
- `config/db.js` - MongoDB connection
- `middleware/` - Authentication and role checking
- `models/` - Mongoose schemas
- `routes/` - API endpoint handlers
- `utils/` - Helper functions

## Common Issues

### Cannot connect to MongoDB
- Ensure MongoDB is running: `mongod`
- Check MONGODB_URI in .env file
- Verify MongoDB is listening on localhost:27017

### Port already in use
- Change PORT in .env file
- Or kill process: `lsof -i :5000` and `kill -9 <PID>`

### JWT token invalid
- Token may be expired (default: 7 days)
- Use `/api/auth/refresh` to get new token
- Check JWT_SECRET in .env matches production

### File upload fails
- Check `uploads/` directory exists
- Verify file size is under MAX_FILE_SIZE (50MB)
- Check file type is allowed (JPEG, PNG, GIF, PDF)

## Roles and Permissions

### Admin
- Access all endpoints
- Manage all users
- Create and manage courses
- Approve payments
- Create schedules

### Manager
- Manage courses (create, update)
- Manage enrollments
- Confirm/reject payments
- Upload videos
- Create class schedules

### Teacher
- View own courses
- Accept course assignments
- View class schedules
- See student list
- View videos for their courses

### Student
- View active courses
- Submit payments
- View enrollments
- Access assigned videos
- View class schedules
- Manage notifications

## Next Steps

1. Set up MongoDB Atlas for production
2. Configure CORS for your frontend domain
3. Implement webhook for payment gateway integration
4. Add email notifications (optional)
5. Deploy to hosting platform (Heroku, AWS, etc.)

For detailed API documentation, see README.md
