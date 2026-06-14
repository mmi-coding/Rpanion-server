# Feature 27 — Light/dark toggle + mobile-responsive shell

Two enhancements to the Ground Station theme ([feature-26](feature-26-ground-station-theme.md)):
a user-facing **light/dark toggle** (light is now a first-class theme), and a
**responsive shell** so the app is usable on phones. Both are CSS-/frontend-only,
no react-bootstrap markup churn, and the 100/100/100/100 coverage ratchet holds.

## Light / dark toggle

- **`styles.css` token split** — tokens moved from one block into a **shared**
  block (`html.gs-theme`: fonts, signal hues + rgb, Bootstrap mappings) plus two
  **per-theme** blocks (`[data-bs-theme="dark"]` / `[data-bs-theme="light"]`:
  surfaces, hairlines, ink, depth/shadows/glows, and **foreground tones**
  `--gs-link` / `--gs-code-fg` / `--gs-*-fg` darkened for contrast on light
  surfaces). Every component rule is token-driven, so it adapts automatically.
- **Toggle** — a sun/moon button in the new sidebar **footer** (`#gs-themetoggle`).
  `AppRouter` holds `theme`, writes `data-bs-theme` on `<html>`, and persists to
  `localStorage('gs-theme')`.
- **No flash** — an inline script in `index.html` applies the saved (or
  `prefers-color-scheme`) theme before first paint; `data-bs-theme="dark"` remains
  the static no-JS fallback.

## Mobile responsive

- **Off-canvas drawer < 768px** (`styles.css` §16) — the sidebar becomes
  `position: fixed`, slid out by default, slid in when open. A sticky **top bar**
  (`#gs-topbar`) with a hamburger (`#gs-menubtn`) opens it; a tap **backdrop**
  (`#gs-backdrop`) or tapping any nav link closes it.
- **State** — `AppRouter` unifies the toggle into `toggleNav`, seeds the
  open/closed default from `window.matchMedia('(min-width: 768px)')`, and closes
  the drawer on nav-tap only when mobile (`closeNavOnMobile`).
- **Desktop collapse rail** (waypoint codes) is now gated to `≥ 768px`; on phones
  the drawer always shows full labels.
- **Content** — Bootstrap's responsive grid already stacks columns; `home.jsx`'s
  fixed `width: 650` became `maxWidth`, plus a §16 safety net neutralising fixed
  pixel widths on `.pagedetails` wrappers.

## Bug fixed along the way

The sidebar markup carried upstream `bg-light`/`border-right` utility classes.
Bootstrap's `.bg-*` utilities ship with `!important`, so `.bg-light` (#f8f9fa) was
**overriding the themed rail surface** regardless of selector specificity — the
rail was rendering light even in dark mode. Removing those vestigial classes from
the markup lets the theme's `#sidebar-wrapper { background: var(--gs-bg-0) }` win
(verified by computed-style: rail `background-color` → `rgb(8, 11, 17)`).
Documented as a guardrail in `docs/GROUND-STATION-THEME.md`.

## Coverage / verification — WSL-verified

- `npm run lint` — 0 errors
- `covback` — **100/100/100/100** (backend untouched)
- `covfront` — **825 tests, 100/100/100/100**. New tests: theme toggle
  (flips `data-bs-theme` + persists, both ternary branches), mobile drawer
  (menu-button open / backdrop close), nav-tap close (mobile vs desktop branch).
  `window.matchMedia` is stubbed per-test (`stubViewport`) for determinism.
- **Visual** — headless Chromium against the compiled bundle: desktop dark,
  desktop light, mobile drawer closed (top bar), mobile drawer open (backdrop).

## Needs on-device

Appended to `docs/ONDEVICE-CHECKLIST.md` (feature 27): confirm the toggle persists
+ no first-paint flash on the Pi, light mode is legible, and the mobile drawer /
content reflow behave in a real phone browser.
