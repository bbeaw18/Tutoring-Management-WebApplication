# Tutoring Management WebApplication (KMS)

A production-style full-stack web application that runs the day-to-day
operations of an online tutoring business — class scheduling, attendance,
tuition payments, teacher payroll, and monthly revenue analytics —
across four user roles: **admin, manager, teacher, student**.

> This document is written as a **project review** for reviewers and
> recruiters. It walks through what the application does, who uses it,
> and the engineering decisions behind it.

---

## 1. What the product does

The platform replaces spreadsheets and chat-based coordination with a
single system that owns the entire teaching lifecycle:

1. A **manager** books a class (one-off, or a weekly series until end of
   month). The system stamps a `seriesId` so the whole batch is
   addressable as a unit.
2. The assigned **teacher** receives an in-app notification + email and
   confirms the class. Each session is confirmed individually so a
   series can be partially accepted.
3. **Students** confirm attendance; once both sides agree the class
   becomes "confirmed" on every calendar.
4. On class day the teacher opens a **QR-code screen**; students scan
   to check in. A **TOTP 2FA** path is available for secure logins.
5. After the class, the teacher reports it done; the **manager confirms
   completion**, which locks the hours into the teacher's running
   `teachingHours` totals and the student's `learningHours`.
6. Payments are collected per attendance (PromptPay QR or K-Bank
   integration). The **revenue dashboard** rolls everything up monthly
   with KPIs, charts, and drill-down to per-teacher classes.
7. The manager triggers **teacher payouts** from the same dashboard —
   one click reveals the teacher's bank details and records the payout.

All UI labels and validation messages are in **Thai**.

---

## 2. Who uses it — role walkthrough

| Role     | Primary jobs                                                                    |
|----------|---------------------------------------------------------------------------------|
| Admin    | Full access; manages users, oversees every other role, configures the system.   |
| Manager  | Books classes, edits schedules, confirms completion, runs the revenue dashboard, pays teachers, manages students. |
| Teacher  | Sees their calendar, confirms classes, runs QR check-in, drags-to-reschedule, reads earnings + payout notifications. |
| Student  | Sees upcoming classes, confirms invitations, pays tuition, views history.       |

### Manager experience

- **Course Management** — calendar-aware booking form with a
  *"repeat weekly until end of month"* option that previews the exact
  dates it will create. Series cards expose a stack-style badge with a
  live `paid / total` progress chip (e.g. `2/4 ครั้งที่เสร็จสิ้นคลาส`).
- **Series Modal** — opens any series to see all sessions, with
  per-session actions: edit, cancel, or **confirm completion**
  (the manager-only button appears once the teacher has checked off
  the class). Bulk cancel / delete-all are also available.
- **Master Calendar** — week + month views; manager can drag classes
  to reschedule. Drag is gated by a **1.3 s click-and-hold** to prevent
  misclicks; a progress bar fills inside the event while holding.
- **Revenue Dashboard** — month-filtered KPIs:
  - Institute-wide: total / paid / unpaid
  - Personnel: teacher expense (with paid vs unpaid split), manager
    income, **net profit** = `total − (teacher expense + manager income)`
  - Three analytics cards: pie of per-teacher share, income vs expense
    pie, and a manual income/expense ledger
- **Teacher payouts** — clicking a teacher's nickname inside the
  *"รายจ่ายครู"* KPI drills into that month's classes, then a
  **"ชำระค่าจ้างครู"** button opens a premium modal showing the
  teacher's bank channel, account number (one-click copy), and name.
  Confirming records a `TeacherPayout` row and notifies the teacher;
  the KPI re-splits between *paid* and *unpaid* live, and the
  teacher's name card now shows a green *"ชำระแล้ว"* badge.

### Teacher experience

- **Personal calendar** — Google-Calendar-style week grid with an
  earnings dashboard, daily-income bar chart, and *"pending confirmation"*
  card.
- **Drag-to-reschedule (own classes only)** — hold 1.3 s, then drag the
  event vertically (changes time, snap 30 min) or across columns
  (changes day). Backend enforces ownership and blocks classes that are
  already completed / cancelled / awaiting manager confirmation. The
  manager and impacted students are notified by app + email; the
  teacher is not (they performed the action themselves).
- **QR check-in screen** for class attendance.
- **History page** with all past classes, hours, and earnings.

### Student experience

- Calendar of confirmed classes, invitations to accept or decline,
  tuition payment via PromptPay / K-Bank, payment status, and a
  history view.

---

## 3. Tech stack

| Layer    | Technology                                                            |
|----------|-----------------------------------------------------------------------|
| Frontend | Angular 17 (standalone components), TypeScript 5.2 strict, RxJS, GSAP, FullCalendar |
| Backend  | Node.js, Express 4, MongoDB 7 + Mongoose 7                            |
| Auth     | JWT + bcrypt, optional TOTP 2FA (`speakeasy`)                         |
| Payments | PromptPay QR (`promptpay-qr` + `qrcode`), Kasikorn Bank OpenAPI       |
| Email    | Nodemailer with HTML templates                                        |
| Realtime | In-app notifications (poll-on-visibility) + email                     |

No CSS framework is used; the design system is hand-rolled.

---

## 4. Architecture

```
backend/
  models/        Mongoose schemas (User, Course, Schedule, Payment,
                 Attendance, Expense, TeacherPayout, Notification, ...)
  routes/        One file per feature; { success, data, message, pagination } responses
  middleware/    authenticateToken -> roleCheck([roles]) RBAC chain
  services/      Email, QR, hours service, schedule aggregation
  utils/         Helpers (price/income compute, pagination)

frontend/src/app/
  pages/         Route-level components, grouped by role
                 (auth/, dashboard/student/, .../teacher/, .../manager/)
  services/      One per domain (AuthService, CourseService, ...)
  guards/        authGuard, guestGuard, roleGuard
  interceptors/  AuthInterceptor (Bearer), ErrorInterceptor (401 → logout)
  interfaces/    TS interfaces mirroring backend schemas
  shared/        Reusable components + design tokens
```

### Request lifecycle

1. User logs in → JWT in `localStorage`.
2. `AuthInterceptor` attaches the bearer token to every HTTP call.
3. Backend `authenticateToken` validates, then `roleCheck` gates the
   route by role.
4. Frontend `roleGuard` mirrors that check using
   `AuthService.currentUser$` (a `BehaviorSubject`).
5. `ErrorInterceptor` catches any 401 and forces a logout.

### Display-status pipeline

A schedule's UI status is one of: `pending_teacher`, `pending_students`,
`confirmed`, `awaiting_manager`, `completed`, `cancelled`. The backend
computes this via `scheduleAggregation.deriveDisplayStatus()` and
**attaches it to every schedule / course response** so the calendar,
history, course management, and revenue pages all show the same label
without re-deriving it.

---

## 5. Engineering review

Notable design decisions and the problems they solve.

### Defense-in-depth RBAC
Every protected route chains `authenticateToken → roleCheck([...])`.
The frontend mirrors it with `roleGuard`, so access is enforced on both
sides rather than trusted from the client. Ownership-sensitive
operations (e.g. teacher-rescheduling) double-check
`schedule.teacher === req.user.id` inside the handler.

### Consistent API contract
All endpoints return `{ success, data, message, pagination }`. This
keeps client-side handling uniform and gives a single place to attach
optional metadata (`displayStatus`, `scheduleId` for cross-collection
links, `paymentSummary`).

### Soft deletes
Records carry an `isActive` flag (or status) instead of being
hard-deleted, preserving financial and attendance history for auditing.
The only "permanent delete" path lives behind an extra confirmation
step in the UI.

### Overnight-aware scheduling
Classes that cross midnight (e.g. 22:00–01:00) are handled by one
shared rule reused by the Mongoose model, the email service, the
revenue calculation, and the teacher calendar's "tail segment" render.
Duration always wraps modulo 24 h so a single midnight class is billed,
displayed, and totaled correctly.

### Date-gated pricing rollout
The move from flat per-class fees to per-hour billing for both tuition
(`PRICE_HOURLY_FROM`) and teacher wage (`TEACHER_HOURLY_FROM`) uses
**effective-date cutoffs**. Historical classes keep their original
flat amounts — no data migration, no retroactive recompute, no broken
revenue history.

### Payroll integrity
Accumulated teaching/learning hours are **reversed** when a completed
class is later cancelled or deleted. A standalone idempotent recompute
script (`scripts/recompute-hours.js`) can rebuild the totals from the
source of truth (completed schedules + attendance) whenever drift is
suspected.

### Drag-to-reschedule with a hold gate
Both the manager master calendar and the teacher calendar support
drag-to-reschedule. The interaction begins only after a **1.3 s
click-and-hold** with a visible progress bar; a 6 px movement tolerance
aborts the hold so brief clicks still open the detail modal. After the
hold arms, dragging snaps to 30-minute steps and hit-tests across day
columns so a class can be moved to a different day in one gesture.
Teachers can only move their own classes, and only while the class is
still pending / confirmed. The backend dispatches notification + email
to the manager and impacted students.

### Teacher payouts as a first-class concept
`TeacherPayout` is its own collection (one row per teacher × month)
with a unique compound index that prevents double payouts. The KPI
splits into *paid* and *unpaid* derived from this table, so the
"institute net profit" can be reasoned about without scanning expense
ledgers.

### Series-aware course management
Recurring class batches share a `seriesId`. The UI builds anchor cards
that expose series-level actions (open all, bulk cancel, bulk delete,
per-session manager confirm). The completion progress chip on the
subject title (`2/4 ครั้งที่เสร็จสิ้นคลาส`) is computed live from
each child's `displayStatus`, so a manager scanning the list sees how
many sessions in a batch are done at a glance.

### Transactional email
Booking / edit / reschedule / reminder emails render the full
`rate per hour × hours = total` breakdown instead of an ambiguous
per-hour figure. The same helper is used by manager-created bookings,
teacher-rescheduled classes, and the schedule-edited flow, so wording
stays consistent across paths.

### Frontend discipline
- Standalone Angular components throughout — no NgModules.
- Strict TypeScript, every domain has a typed interface.
- RxJS subscriptions cleaned up via the `takeUntil(destroy$)` pattern.
- Path aliases (`@app/*`, `@environments/*`) for readable imports.
- Form handling is fully reactive (`FormBuilder`, `Validators`).
- A hand-rolled CSS design system — design tokens, no Bootstrap /
  Tailwind / Material.

### Auth hardening
JWT + bcrypt; optional TOTP 2FA for accounts that opt in. The
attendance flow uses a **separate** short-lived QR token (not the JWT)
so the check-in screen never exposes a long-lived credential.

### Areas marked for future work
- Automated test coverage (unit + e2e) and a configured linter for both
  sub-projects.
- Additional MongoDB indexes for the heavier reporting aggregations.
- Extracting more route-handler logic into the `services/` layer to
  shrink the route files.
- Replacing visibility-based polling with WebSockets / SSE for
  real-time status updates.

---

## 6. Local setup

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

No linter is configured for either project.

### Environment requirements
- Node 18+
- MongoDB 7 (Atlas or local)
- SMTP credentials for email
- (Optional) PromptPay ID + K-Bank partner credentials for live payment

---

## 7. Repository layout note

This repo is published in two places that point at the same code:

- `kms-webapp` — primary working repo
- `Tutoring-Management-WebApplication` — portfolio mirror

Environment files and seed/bootstrap scripts are intentionally excluded
from the published trees; configure your own via `backend/.env.example`.
