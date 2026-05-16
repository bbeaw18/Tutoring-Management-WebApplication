# Tutoring Management WebApplication

Full-stack tutoring management platform with role-based dashboards for
**admin, manager, teacher, and student** — covering scheduling,
attendance, payments, payroll, and revenue analytics for an online
tutoring business.

> Portfolio snapshot. Environment files and seed/bootstrap scripts are
> intentionally excluded; configure your own via `backend/.env.example`.

## Features

- **Role-based access** — admin / manager / teacher / student dashboards, JWT auth + RBAC
- **Scheduling** — class booking with weekly recurrence and overnight (cross-midnight) classes, FullCalendar views
- **Attendance** — QR-code check-in and TOTP two-factor (2FA)
- **Payments & payroll** — per-hour tuition and teacher wage, monthly revenue/expense reporting with drill-downs
- **Notifications & email** — in-app notifications plus HTML email for bookings, edits, and reminders
- **Thai-language UI** throughout

## Tech Stack

| Layer    | Technology                                                         |
|----------|--------------------------------------------------------------------|
| Frontend | Angular 17 (standalone components), TypeScript (strict), RxJS, GSAP |
| Backend  | Node.js, Express 4, MongoDB 7 + Mongoose 7                          |
| Auth     | JWT, bcrypt, speakeasy (TOTP 2FA)                                   |

## Architecture

```
backend/
  models/       Mongoose schemas (User, Course, Schedule, Payment, ...)
  routes/       One file per feature; { success, data, message } responses
  middleware/   authenticateToken -> roleCheck(roles[]) RBAC chain
  services/     Business logic (email, QR, payroll hours)
frontend/src/app/
  pages/        Route-level components grouped by role
  services/     One service per domain
  guards/       authGuard, guestGuard, roleGuard
  interceptors/ Bearer-token + 401 handling
```

## Engineering Review

Notable design decisions and the problems they solve:

- **Defense-in-depth RBAC** — every protected route chains
  `authenticateToken -> roleCheck([...])`; the frontend mirrors it with
  `roleGuard`, so access is enforced on both sides rather than trusted
  from the client.
- **Soft deletes everywhere** — records carry an `isActive` flag instead
  of being hard-deleted, preserving financial and attendance history for
  auditing.
- **Consistent API contract** — all endpoints return
  `{ success, data, message, pagination }`, keeping client handling
  uniform.
- **Overnight-aware scheduling** — class duration that crosses midnight
  is computed with one shared rule reused by the Mongoose model, the
  email service, and the calendar UI, so a 22:00-01:00 class is billed
  and displayed correctly.
- **Date-gated pricing rollout** — the move from flat to per-hour
  tuition/wage uses effective-date cutoffs
  (`PRICE_HOURLY_FROM`, `TEACHER_HOURLY_FROM`) so historical classes keep
  their original amounts without a data migration.
- **Payroll integrity** — accumulated teaching/learning hours are
  reversed when a completed class is cancelled or deleted, backed by an
  idempotent recompute script that rebuilds totals from the source of
  truth (completed schedules + attendance).
- **Transactional email** — booking / edit / reminder emails render the
  full `rate/hr x hours = total` breakdown instead of an ambiguous
  per-hour figure.
- **Auth hardening** — JWT + bcrypt with optional TOTP 2FA and a
  separate QR-code check-in flow for attendance.
- **Frontend discipline** — Angular standalone components, strict
  TypeScript, RxJS subscriptions cleaned up via `takeUntil(destroy$)`,
  and a hand-rolled CSS design system (no UI framework).

### Areas for future work

- Automated test coverage and a configured linter for both sub-projects
- Additional MongoDB indexes for the heavier reporting aggregations
- Extracting more route-handler logic into the `services/` layer

## Local Setup

```bash
# Backend
cd backend
cp .env.example .env        # then fill MONGODB_URI, JWT_SECRET, ...
npm install
npm run dev                 # http://localhost:5000

# Frontend
cd frontend
npm install
npm start                   # http://localhost:4200
```
