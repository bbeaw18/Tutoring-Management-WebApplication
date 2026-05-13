# DESIGN.md

Visual system for KMS WebAPP — "Luminous Intelligence." Used by design tools (e.g. Impeccable) to keep new work aligned with existing tokens and patterns.

Authoritative source for CSS variables: [`frontend/src/styles.css`](frontend/src/styles.css). This file is a human-readable summary — if it disagrees with `styles.css`, `styles.css` wins.

## Design system: Luminous Intelligence

A calm, confident, slightly futuristic look built on **glassmorphism** layered over a navy-to-pink gradient base. Reads as trustworthy (navy) with a spark of warmth (pink). Suited to a serious learning brand that still feels current.

## Color

### Brand palette

| Token | Hex | Use |
|---|---|---|
| `--brand-navy` | `#1e3f80` | Primary actions, headers, body links, focused states |
| `--brand-pink` | `#ec4899` | Accent, highlights, key CTAs, "current" indicators |
| `--brand-navy-dark` | `#15305f` | Hover/pressed states for navy |
| `--brand-pink-dark` | `#be3878` | Hover/pressed states for pink |

Navy carries weight; pink is rationed. A surface should never be majority-pink — pink is a spice, not a substrate.

### Semantic palette

| Token | Hex | Use |
|---|---|---|
| `--success-*` | green family | Confirmations, paid receipts, attendance present |
| `--warning-*` | amber family | Pending payment, upcoming deadlines |
| `--error-*` | red family | Failed payment, validation errors |
| `--info-*` | blue family | Tips, neutral notifications |

### Surfaces

| Token | Use |
|---|---|
| `--glass-white` | Card backgrounds (semi-transparent white over the gradient base) |
| `--glass-border` | 1px borders on glass cards |
| `--surface-page` | Body background (the navy-pink gradient or a derived soft tint) |
| `--surface-elevated` | Modals, popovers — slightly more opaque than glass |

### Contrast rules

- Body text on glass: navy-900 or near-black, never pink.
- Pink text only on white/very-light backgrounds and only for emphasis (badges, highlights, "current class" pills).
- Minimum AA contrast (4.5:1) on all interactive elements. Thai script reads thinner than Latin — bias to higher contrast.

## Typography

### Font stacks

```css
--font-thai: 'Prompt', 'Sarabun', sans-serif;
--font-latin: 'Inter', system-ui, sans-serif;
```

The browser falls back gracefully; mixed-language strings (e.g. "ห้อง Lab A") render Thai in Prompt and Latin glyphs in Inter without manual switching.

### Type scale

Defined in CSS variables (`--text-xs` through `--text-3xl`). Use the scale — don't inline `font-size` values. Common usage:

| Token | Use |
|---|---|
| `--text-xs` | Helper text, timestamps, meta |
| `--text-sm` | Form labels, secondary UI |
| `--text-base` | Body, table cells |
| `--text-lg` | Card titles, section headers |
| `--text-xl` | Page titles |
| `--text-2xl`+ | Dashboard hero metrics (revenue, attendance %) |

### Weight

- **400** body, paragraphs
- **500** UI labels, table headers
- **600** card titles, page titles
- **700** dashboard hero metrics, brand wordmarks

Thai (Prompt) reads heavier than Latin at the same numeric weight — when mixing in headings, you may need to step Thai down one weight.

## Spacing & layout

CSS spacing scale `--space-1` (4px) through `--space-12` (96px). Stick to the scale.

- **Card padding:** `--space-5` to `--space-6` (20–24px) for content, `--space-4` (16px) for compact tables.
- **Page gutter (desktop):** `--space-8` (32px) min.
- **Page gutter (mobile, <768px):** `--space-4` (16px).
- **Stack rhythm:** vertical sections separated by `--space-6` to `--space-8`.

Grid: 12-col on desktop, single column under 768px. Dashboard hero cards span 4-6 cols; data tables span full width.

## Elevation & glass

Glassmorphism pattern:
```css
background: var(--glass-white);
backdrop-filter: blur(12px);
border: 1px solid var(--glass-border);
border-radius: var(--radius-lg);
box-shadow: var(--shadow-md);
```

Three shadow levels:

| Token | Use |
|---|---|
| `--shadow-sm` | Inputs at rest, table rows on hover |
| `--shadow-md` | Cards, popovers |
| `--shadow-lg` | Modals, floating action buttons |

Avoid hard drop shadows on the pink-navy gradient — they look muddy. Prefer subtle, large-radius, low-opacity shadows.

## Border radius

| Token | Use |
|---|---|
| `--radius-sm` | Inputs, buttons-small, badges |
| `--radius-md` | Buttons, chips |
| `--radius-lg` | Cards, modals, drawers |
| `--radius-full` | Avatars, status dots, pill buttons |

## Motion

- **Duration:** 150ms (instant feedback), 250ms (default UI), 400ms (entrance of modals/drawers). Avoid >500ms.
- **Easing:** `cubic-bezier(0.4, 0, 0.2, 1)` for most. Use spring-ish curves sparingly for celebratory moments (successful payment, attendance marked).
- **Reduce motion:** honor `prefers-reduced-motion`. Replace transitions with instant state changes.

## Components

Reusable components live in `frontend/src/app/shared/`:

- **Header** — logo + role-aware nav
- **Sidebar** — collapsible, role-tailored
- **Loading spinner** — pink, centered
- **Confirm dialog** — destructive vs neutral variants

Forms use **Reactive Forms** (`FormBuilder`, `Validators`). Validation messages are in Thai; keep them concrete ("กรุณาระบุเบอร์โทร 10 หลัก" not "Invalid input").

## Tables

- Row height: 48–56px (comfortable for touch).
- Zebra striping: off by default; show only when rows exceed ~8.
- Sticky header on scroll past 4 rows.
- Empty state: never just "No data." — show what action restores it ("ยังไม่มีนักเรียนลงทะเบียน — เพิ่มนักเรียนคนแรก →").

## States to design for every flow

Don't ship a feature without these:

1. **Empty** (no data yet, with a clear next action)
2. **Loading** (skeleton preferred over spinners for content areas)
3. **Error** (specific message, recovery path)
4. **Success** (confirmation that the user can actually see)
5. **Partial** (some data, more loading) — important for paginated tables
6. **Offline / API down** — show last-cached values where possible

## Accessibility floor

- All interactive elements reachable by keyboard, with visible focus.
- Form errors announced (`aria-live="polite"`).
- Touch targets ≥ 44×44px.
- No color-only signals (status uses icon + color + text).

## Patterns to avoid

- ❌ Pink backgrounds covering >20% of a screen.
- ❌ Dark mode (not designed/supported yet — don't half-implement).
- ❌ Decorative gradients on text (illegible at small sizes).
- ❌ Skeleton screens that morph wildly (jarring on slow connections).
- ❌ Modals stacked >1 deep.
- ❌ Tooltips on mobile (use inline help instead).
