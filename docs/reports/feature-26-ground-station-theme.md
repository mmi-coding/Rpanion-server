# Feature 26 — Ground Station theme (webUI design system)

A whole-webUI restyle: the stock Bootstrap look is replaced with **Ground
Station**, a night-cockpit / avionics instrument aesthetic that suits a console
flying a drone over 4G LTE. Delivered as a **theme layer on Bootstrap 5.3's dark
mode**, not a component-library swap — so all 24 react-bootstrap pages re-skin
with zero structural/markup churn, and the 100/100/100/100 coverage ratchet holds.

## Design decisions (confirmed with the user)

- **Bold but shippable, system-wide** — restyle the visual language across the
  app (not one page), pushed hard but kept production-grade and integrable.
- **Stay on Bootstrap** — shadcn/ui was floated, but it's a Tailwind+Radix
  foundation swap = a multi-session rewrite of 24 pages + the test suite, not a
  restyle. The distinctive look is independent of the widget library, so we kept
  react-bootstrap and themed it. (Recorded here in case it's revisited.)
- **Dark** — appropriate for a field/ground-station tool and the domain.

## What was built

- **`index.html`** — `data-bs-theme="dark"` + `class="gs-theme"` on `<html>`.
  The `data-bs-theme` switch alone darkens every react-bootstrap component;
  `gs-theme` scopes the custom overrides.
- **`src/css/styles.css`** (was empty/unimported) — the design system, ~15
  numbered sections. Remaps Bootstrap `--bs-*` vars to the palette, then targets
  the shell, sidebar, cards, buttons, forms, badges, tables, modals, tooltips,
  spinners, scrollbars, the Help affordances, and motion.
- **`src/index.jsx`** — imports self-hosted fonts then `styles.css` **last** so
  overrides win the cascade.
- **`src/AppRouter.jsx`** — sidebar reworked: station-identity header (status
  pip, brand, mono eyebrow) + a **collapse toggle**; nav is now data-driven from
  a `NAV` array and uses **`NavLink`** (active-route highlight). Each item carries
  a `data-code` waypoint tag + `title`.
- **`src/components/Help.jsx`** — `HelpTip`/`HelpSection` recoloured to theme
  tokens (amber `?`, cyan toggle) via classes; hardcoded greys removed.
- **Deps** — `@fontsource/chakra-petch`, `@fontsource/ibm-plex-sans`,
  `@fontsource/ibm-plex-mono` (vendored woff2, bundled by Vite → offline-safe; no
  CDN reaches the Pi).
- **Docs** — `docs/GROUND-STATION-THEME.md`; CHANGELOG entry; this report.

## Palette & type

Surfaces `--gs-bg-0` (#080b11) → `--gs-panel` (#111a26) → inputs/hover. Signal
colours **amber** (primary), **green** (live), **cyan** (info), **red** (fault),
slate (secondary), mapped onto `--bs-*` (+ `-rgb`) so `.bg-*`/`<Badge>` recolour
for free (Home status badges → green/amber/red lamps). Type: Chakra Petch
(display) · IBM Plex Sans (body) · IBM Plex Mono (telemetry readouts: `code`/`pre`,
IP/port/key inputs, badges, collapsed-rail codes).

## Sidebar collapse

A `☰` toggle in the rail header flips `#wrapper.gs-collapsed`. Collapsed → the
rail shrinks to 4.1rem and each item shows its mono `data-code` (HOM/FC/LTE/WG…)
via CSS (label text hidden, full label on hover). No icon library needed. State
lives in `AppRouter` (`navOpen`) — persists across route changes for the session.

## Coverage / verification — WSL-verified

This is pure frontend/CSS; everything below was verified in WSL:

- `npm run lint` — 0 errors
- `npm run build` — clean; the 3 woff2 families bundle as assets
- `covback` — **100/100/100/100** (backend untouched)
- `covfront` — **822 tests, 100/100/100/100** (added a sidebar-toggle test so the
  new `setNavOpen` handler + collapsed branch stay covered)
- **Visual** — rendered the compiled bundle (real theme + bundled fonts) against
  faithful app markup via headless Chromium; confirmed both the expanded
  (unified-dark rail) and collapsed (waypoint-code) states, dashboard status
  lamps, themed form/table/`pre`, and Help affordances.

## Needs on-device

Appended to `docs/ONDEVICE-CHECKLIST.md` (feature 26): confirm the theme + fonts
render on the deployed Pi over the VPN/LAN with no internet (fonts served from the
bundle, not the system fallback), the collapse toggle works, status lamps/mono
render, and a form-heavy page stays legible at the Pi's screen size.
