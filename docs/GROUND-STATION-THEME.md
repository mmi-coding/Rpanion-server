# Ground Station theme — webUI design system

The fork's webUI uses a single cohesive visual language called **Ground Station**:
a night-cockpit / avionics instrument aesthetic, fitting for a console that flies
a drone over 4G LTE. It is a **theme layer on top of Bootstrap 5.3** — not a
component-library swap — so every existing react-bootstrap page is re-skinned with
no structural changes. **Light and dark are both first-class** (user-toggleable),
and the shell is **responsive** down to phones.

## How it's wired

- `index.html` sets `class="gs-theme"` on `<html>` plus a tiny inline script that
  applies the saved (or OS-preferred) `data-bs-theme` **before first paint** to
  avoid a flash; `data-bs-theme="dark"` stays on the tag as the no-JS fallback.
  The `data-bs-theme` switch puts every react-bootstrap component (forms, tables,
  modals, tooltips, dropdowns, badges) into the matching mode automatically.
- `src/index.jsx` imports the self-hosted fonts (`@fontsource/*`) then
  `src/css/styles.css` **last**, so the theme's variable overrides win the cascade
  over `bootstrap.css` and `startbootstrap-simple-sidebar`.
- `src/css/styles.css` is the whole design system. Tokens are split into a
  **shared** block (`html.gs-theme` — fonts, signal hues, Bootstrap mappings) and
  two **per-theme** blocks (`html.gs-theme[data-bs-theme="dark"|"light"]` — surfaces,
  lines, ink, foreground/contrast tones, shadows, glows). Every component rule is
  token-driven, so it adapts to whichever theme is active. Sections are numbered
  (1 Tokens … 16 Responsive).

> **Don't add Bootstrap `.bg-*` utility classes to themed shell elements.** Those
> ship with `!important` and will override the theme's surfaces. The sidebar is
> styled entirely by `#id`/class selectors in `styles.css` (the upstream
> `bg-light`/`border-right` classes were removed from the markup).

## Light / dark toggle

The toggle lives in the **sidebar footer** (`#gs-themetoggle`, a sun/moon button).
`AppRouter` holds the `theme` state, applies it to `document.documentElement`'s
`data-bs-theme`, and persists it to `localStorage('gs-theme')`. The light palette
darkens the "foreground" tones (`--gs-*-fg`, links, code) for contrast on light
surfaces while keeping the amber/green/cyan/red **solid** hues identical, so the
brand reads the same in both modes.

## Responsive (mobile)

Above `768px` the sidebar is the sticky rail (with the desktop collapse-to-
waypoint-codes mode). Below `768px` (`§16`) it becomes an **off-canvas drawer**:
hidden by default, opened by a hamburger in a sticky **mobile top bar**
(`#gs-topbar` / `#gs-menubtn`), dimmed by a tap-to-close **backdrop**
(`#gs-backdrop`), and auto-closed when a nav link is tapped. `AppRouter` seeds the
open/closed default from `window.matchMedia('(min-width: 768px)')`. Page content
uses Bootstrap's responsive grid; a CSS safety net neutralises fixed pixel widths
on `.pagedetails` wrappers at phone widths.

## Type system (self-hosted, offline-safe)

Fonts are vendored via `@fontsource/*` and bundled by Vite, so there is **no CDN
dependency at runtime** — they work on a Pi with no internet.

| Role | Family | Used for |
|------|--------|----------|
| Display | **Chakra Petch** | headings, nav, form labels, table headers |
| Body | **IBM Plex Sans** | prose, controls |
| Mono | **IBM Plex Mono** | telemetry readouts — `code`/`pre`, badges, IP/port/key inputs, the collapsed-rail waypoint codes |

## Palette (CSS custom properties under `html.gs-theme`)

- Surfaces step from `--gs-bg-0` (#080b11, the rail + page void) → `--gs-panel`
  (#111a26, cards) → `--gs-panel-2/3` (inputs / hover).
- **Signal colours:** `--gs-amber` (#ffb224, primary / "runway lighting"),
  `--gs-green` (#2fe0a0, live / connected), `--gs-cyan` (#4fd1ff, info / links),
  `--gs-red` (#ff5d61, fault), `--gs-slate` (neutral / secondary).
- These map onto `--bs-primary/success/danger/info/secondary` (+ their `-rgb`
  triplets), so Bootstrap `.bg-*` utilities and `<Badge bg="…">` recolour for free
  — e.g. the Home dashboard's status badges become green/amber/red "status lamps".

## Sidebar

The rail is a flat `--gs-bg-0` surface (one continuous dark plane with the page,
separated only by a hairline) with a station-identity header: a pulsing green
status pip, the brand name in Chakra Petch, a mono eyebrow, and a **collapse
toggle (☰)**. Collapsing sets `#wrapper.gs-collapsed`, shrinking the rail to a
4.1rem **waypoint-code strip** — each nav item shows its short `data-code` (HOM,
FC, LTE, WG…) in mono via CSS, with the full label on hover (`title`). Nav uses
`NavLink`, so the active route gets an amber left-marker + chevron.

The nav is **grouped into collapsible categories** (Flight · Logs & Media · Camera
& Video · Network · VPN & DDNS · System), with Home as a standalone top item and
Logout at the bottom. Each category has a header (uppercase label + chevron) that
toggles its items (CSS `max-height` transition; groups are expanded by default,
state in `AppRouter`'s `openGroups`). In the collapsed waypoint-code rail the
category headers are hidden and every code is shown as a flat list.

The nav is data-driven in `src/AppRouter.jsx`: `NAV_HOME` (standalone) + `NAV_GROUPS`
(`{ id, label, items: [{ to, code, label }] }`). Add a page by dropping a
`{ to, code, label }` into the right group (set `end: true` only for exact-match).

## Working within the theme

- **Don't hardcode colours** in new pages — use Bootstrap variants
  (`variant="primary"`, `bg="success"`, `.text-muted`) and they inherit the theme.
  For bespoke styling, reference the `--gs-*` tokens.
- Render technical values (IPs, ports, keys, signal, AT output) in `code`/`pre` so
  they pick up the mono "instrument readout" treatment.
- The self-documenting UI rule still applies (`HelpTip`/`HelpSection`, see
  [UI-GUIDELINES.md](UI-GUIDELINES.md)); those affordances are themed too
  (amber `?` tip, cyan section toggle).
- Motion respects `prefers-reduced-motion`.
