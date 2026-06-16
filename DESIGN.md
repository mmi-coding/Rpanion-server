# Design

> The visual system for the Rpanion LTE companion console ("Ground Station"). Source of
> truth is `src/css/styles.css` (a token-driven theme layer over Bootstrap 5.3); this file
> documents it so design variants stay on-brand. Identity-preserving — do not restyle the
> brand, refine within it.

## Theme

A **night-cockpit / avionics instrument** aesthetic on Bootstrap 5.3. Light ("day cockpit")
and dark ("night cockpit") are **both first-class**: tokens split into a shared block plus
per-theme blocks keyed off `[data-bs-theme]`. The sidebar-footer toggle flips
`data-bs-theme` on `<html>` and persists to `localStorage`. Strategy: **Restrained** —
neutral surfaces carry the UI, a single amber accent carries primary actions, current
selection, and state.

## Color

Signal hues (identical in both themes, used as solid fills / markers):

| Role | Token | Value |
| --- | --- | --- |
| Primary / runway lighting | `--gs-amber` | `#ffb224` |
| Live / connected | `--gs-green` | `#2fe0a0` |
| Info / links | `--gs-cyan` | `#4fd1ff` |
| Fault / danger | `--gs-red` | `#ff5d61` |
| Neutral signal | `--gs-slate` | `#56708a` |

Surfaces & text are per-theme tokens: backgrounds `--gs-bg-0/-1`, panels
`--gs-panel/-2/-3`; text ramp `--gs-text` → `--gs-text-dim` → `--gs-text-faint`; hairlines
`--gs-line/-soft/-strong`. **Contrast rule: all three text steps must clear WCAG AA (≥4.5:1)
on every surface they appear on, in both themes** (`--gs-text-faint` is the one to watch —
it backs placeholders, the footer, and disabled inputs).

## Typography

Three self-hosted families (via `@fontsource`, imported in `index.jsx`):

- **Chakra Petch** (`--gs-font-display`) — squared, mechanical → headings, nav, labels, badges-of-structure.
- **IBM Plex Sans** (`--gs-font-body`) — engineering body face → prose, controls.
- **IBM Plex Mono** (`--gs-font-mono`) — telemetry readout → data, code, badges, inputs.

Headings, buttons, table headers, and the page title are **uppercase with positive
letter-spacing** (the instrument-label look). Fixed rem scale (product UI, not fluid).
Section headings (`h2`/`h3`) inside page content have their own vertical rhythm so sections
breathe — see Spacing.

## Spacing

A token scale drives rhythm — `--gs-space-1: 0.25rem` … `--gs-space-7: 3rem`. Page content
padding `1.9rem 2.1rem 2.6rem`, max-width `1280px`. In-page section headings, form rows, and
cards use the scale (no ad-hoc `5px`/`8px`/`20px` one-offs). Density is allowed; cramped is not.

## Components

- **Cards = instrument panels.** `--gs-panel` surface, hairline border, an amber stripe on
  the header (`.card-header::before`), faint top sheen. Never nested.
- **Buttons = cockpit switches.** Uppercase, `--gs-font-body`, amber primary on dark ink;
  secondary is a ghost/outline; amber focus glow.
- **Badges = status lamps.** Mono, uppercase, tinted by semantic colour (success/danger/warning).
- **Tables = data grids.** Mono-ish density, uppercase display-font headers, amber hover wash.
- **Forms = labelled instruments.** Display-font labels, mono inputs, amber focus ring.
- **Help affordances.** `.gs-helptip` (the `?` chip) + `.gs-helpsection` (collapsible) —
  every fork page uses these (see `src/components/Help.jsx`).

## Layout

Sticky left **console rail** sidebar (`15.5rem`), collapsible on desktop to a `4.1rem`
waypoint-code rail, and an off-canvas drawer under `md`. Content is a single `container-fluid`
column. Responsive behaviour is structural (collapse / drawer / reflow), not fluid type.

## Motion

150–250 ms, ease-out; motion conveys state only (page-details `gs-rise` entrance, the live
`gs-pip` pulse, hover/focus feedback). No bounce/elastic, no page-load choreography.
`@media (prefers-reduced-motion: reduce)` neutralises all animation and transition.

## Known detector notes

- The amber **side-tab** accent (card-header stripe, `pre`, help-section, nav-active) is a
  deliberate brand signature, not AI-slop — ignored for `src/css/styles.css` in
  `.impeccable/config.json`.
- Sidebar-collapse / nav / help **layout-transition**s are intentional and reduced-motion-safe
  — likewise ignored for the theme file.
- Home dashboard cards may report `low-contrast` "via analytic-gradient+alpha": a false
  positive — the card surface is opaque (`--gs-panel`, real contrast ~16:1); the detector
  composites over the decorative near-zero-alpha sheen. Not a real defect.
