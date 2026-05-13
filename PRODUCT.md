# PRODUCT.md

Product context for KMS WebAPP — used by design tools (e.g. Impeccable) to make decisions consistent with brand, users, and strategy.

## What is KMS WebAPP

A full-stack online platform for **Know More Sci**, a Thai-language science tutoring center. Replaces ad-hoc LINE/Google-Sheet workflows with a single dashboard that handles enrollment, scheduling, attendance, payments (PromptPay/KBank QR), and teacher payroll.

## Users

### Admin
The owner/operator. Sees everything: revenue, attendance, teacher payroll, expenses. Needs at-a-glance overview of business health without drilling into spreadsheets. Decisions are financial and strategic.

### Manager
Handles day-to-day operations: books classes, confirms enrollments, monitors who showed up. Lives in the schedule view. Needs fast actions (one-tap confirm, bulk reschedule). Treat as a power user — surface keyboard shortcuts and dense layouts.

### Teacher
Confirms scheduled classes, marks attendance, sees own income. Mobile-first usage during/between classes. Few but high-stakes actions — must be unambiguous. Income views start displaying from 8 May 2026.

### Student (and their parents)
Books courses, pays via QR, watches recorded videos, sees their schedule. Often non-technical, sometimes elderly parents. Trust signals matter (clear pricing, visible receipt, predictable flow). Thai is their first language; technical English is friction.

## Brand voice & tone

- **Warm, competent, calm.** A trusted local tutoring center, not a Silicon Valley app.
- **Thai-first, plain Thai.** Avoid English jargon in user-facing text. When English is needed (technical terms), pair with Thai gloss.
- **Concrete over clever.** "ชำระเงินผ่าน PromptPay" beats "Quick Pay". Names of real things people recognize.
- **Confident, not boastful.** Show outcomes, not adjectives.

## Strategic principles

1. **Payment friction kills enrollment.** The QR-pay → receipt → confirmed-class path must be the smoothest flow in the app. Anything that adds a step here is a regression.
2. **Trust signals throughout money flow.** Show amount, account holder, receipt timestamp, and "what happens next" at every step. Parents pay; they need certainty.
3. **Schedule is the heartbeat.** Most users open the app to answer "what's happening today/this week." Schedule views (FullCalendar) deserve the most polish.
4. **Role-tailored dashboards.** Each role's home page should answer their one most-pressing question without scrolling — admin: revenue today; manager: classes today; teacher: my next class; student: my schedule.
5. **Soft-delete everything.** Records persist (financial/regulatory). UI never shows "permanently delete" — it shows "archive."
6. **Mobile parity on critical paths.** Booking, payment, attendance, and schedule must work flawlessly on a 360px phone. Admin/manager analytics can be desktop-first.

## Anti-references — what KMS is NOT

- ❌ **Not a SaaS / startup-y vibe.** No gradient blobs, no "AI-powered" copy, no growth-hack patterns.
- ❌ **Not crypto / fintech aesthetic.** No neon, no dark-mode-only, no aggressive animations.
- ❌ **Not a generic LMS.** Coursera/Udemy patterns (course browsing, certificates as primary value) don't apply — students enroll in known teachers, not catalogs.
- ❌ **Not English-first.** Don't design layouts that break with Thai's longer word-strings and no-space text flow.
- ❌ **Not flashy.** Tutoring center owners trust calm and predictable. Pyrotechnics suggest amateur hour.

## Reference set (vibe)

- Thai government services that actually work: TaxSSO simplicity, ThaiID clarity.
- Calm productivity tools: Linear's restraint, Things 3's typography.
- Local fintech done right: SCB Easy's payment flows, KBank's receipt screens.

## Locale & i18n

- Primary: **Thai (`th`)**.
- Secondary (future): English (`en`) — design must not assume label widths.
- Currency: **THB (฿)**, displayed with the **฿** symbol prefixed, comma thousands separator (`฿1,500`).
- Dates: Thai Buddhist calendar **optional** (default Gregorian); when shown, "14 พฤษภาคม 2569" format.
- Phone: `0xx-xxx-xxxx`.
