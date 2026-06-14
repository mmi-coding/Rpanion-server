# Ground Station theme — webUI design system

The fork's webUI uses a single cohesive visual language called **Ground Station**:
a night-cockpit / avionics instrument aesthetic, fitting for a console that flies
a drone over 4G LTE. It is a **theme layer on top of Bootstrap 5.3's dark mode** —
not a component-library swap — so every existing react-bootstrap page is re-skinned
with no structural changes.

## How it's wired

- `index.html` sets `data-bs-theme="dark"` + `class="gs-theme"` on `<html>`. The
  `data-bs-theme` switch puts every react-bootstrap component (forms, tables,
  modals, tooltips, dropdowns, badges) into dark mode automatically.
- `src/index.jsx` imports the self-hosted fonts (`@fontsource/*`) then
  `src/css/styles.css` **last**, so the theme's variable overrides win the cascade
  over `bootstrap.css` and `startbootstrap-simple-sidebar`.
- `src/css/styles.css` is the whole design system: it remaps Bootstrap's `--bs-*`
  variables to the palette below, then adds targeted styling for the shell,
  sidebar, cards, buttons, forms, badges, tables, modals and motion. Sections are
  numbered (1 Tokens … 15 a11y).

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

The nav is data-driven from the `NAV` array in `src/AppRouter.jsx`; add a route by
adding `{ to, code, label }` there (set `end: true` only for an exact-match route).

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
