# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KMS WebAPP is a full-stack Thai-language online tutoring platform with role-based dashboards for Admin, Manager, Teacher, and Student roles. The backend and frontend are separate sub-projects each with their own `package.json`.

## Working Style (Behavioral Guidelines)

These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## Commands

### Backend (`/backend`)

```bash
npm run dev      # Development server with nodemon (port 5000)
npm start        # Production server
npm run seed     # Seed the database
```

### Frontend (`/frontend`)

```bash
npm start        # Angular dev server (port 4200)
npm run build    # Production build
npm test         # Angular unit tests (ng test)
npm run watch    # Watch mode build
```

No linter is configured for either project.

## Architecture

### Stack
- **Frontend:** Angular 17+ standalone components, TypeScript 5.2 strict, RxJS, custom CSS (no Bootstrap/Tailwind)
- **Backend:** Node.js + Express 4.18, MongoDB 7.1 + Mongoose 7.0, JWT authentication

### Backend structure (`/backend`)
- `server.js` — Express app entry point; registers all route files, applies middleware (helmet, CORS, rate limiting)
- `models/` — Mongoose schemas: User, Course, Enrollment, Payment, Video, Schedule, Notification, Attendance, Expense
- `routes/` — One file per feature; all responses follow `{ success, data, message, pagination }`
- `middleware/` — `authenticateToken` (JWT validation), `roleCheck(roles[])` (RBAC)
- `services/` — Business logic extracted from route handlers
- `config/` — Database connection, environment validation
- `utils/` — Shared helpers (file upload via multer, email via nodemailer)

User roles are enforced at the route level by chaining `authenticateToken` then `roleCheck(['admin', 'manager'])`. Soft-deletes use an `isActive` flag; no hard deletes.

### Frontend structure (`/frontend/src/app`)
- `services/` — One service per domain (AuthService, CourseService, PaymentService, etc.)
- `pages/` — Route-level components organized by role: `auth/`, `dashboard/student/`, `dashboard/teacher/`, `dashboard/manager/`
- `guards/` — `authGuard` (protected routes), `guestGuard` (login/register), `roleGuard` (role-based access)
- `interceptors/` — `AuthInterceptor` attaches Bearer token; `ErrorInterceptor` redirects on 401
- `interfaces/` — TypeScript interfaces for every domain model matching backend schemas
- `shared/` — Reusable components (header, sidebar, loading spinner, confirm dialog) and pipes

### Data flow
1. User authenticates → JWT stored in `localStorage`
2. `AuthInterceptor` attaches token to every HTTP request
3. Backend validates with `authenticateToken`, then checks role with `roleCheck`
4. Frontend `roleGuard` uses `AuthService.currentUser$` (BehaviorSubject) to gate routes
5. `ErrorInterceptor` catches 401s and calls `AuthService.logout()` automatically

### Key configuration
- Frontend API base URL: `src/environments/environment.ts` → `http://localhost:5000/api`
- Backend env: copy `backend/.env.example` to `backend/.env` (PORT, MONGODB_URI, JWT_SECRET, CORS_ORIGIN)
- CORS allows `localhost:4200` and configurable production origins
- File uploads via multer: max 50 MB, JPEG/PNG/GIF/PDF only
- Rate limiting: auth routes 20 req/15 min; general 1000 req/15 min (disabled in dev)

### Notable patterns
- All Angular components use the **standalone** component API (no NgModules)
- Path alias `@app/*` maps to `src/app/`; `@environments/*` maps to `src/environments/`
- Forms use Reactive Forms (`FormBuilder`, `Validators`)
- Subscriptions are cleaned up with `takeUntil(destroy$)` pattern
- UI labels and validation messages are in **Thai**
- FullCalendar 6.1 is used for class scheduling views
- TOTP 2FA is supported via `speakeasy`; QR code check-in is a separate attendance flow

## Verification Checklist

Before completing a task, confirm:
- [ ] Every changed line traces to the user's request
- [ ] Response format follows `{ success, data, message, pagination }` (backend changes)
- [ ] Role enforcement chain is intact (`authenticateToken` → `roleCheck`)
- [ ] Subscriptions clean up via `takeUntil(destroy$)` (frontend changes)
- [ ] Thai labels/messages remain consistent (UI changes)
- [ ] No hard deletes — use `isActive` soft-delete flag

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
