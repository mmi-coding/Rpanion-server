# Feature 28 — Collapsible sidebar nav categories

The 22-page sidebar was a flat list; this groups it into **six collapsible
categories** so the menu is easier to scan. A small follow-on to the Ground
Station theme ([feature-26](feature-26-ground-station-theme.md) /
[feature-27](feature-27-theme-toggle-responsive.md)); frontend-only, ratchet holds.

## What changed

- **`src/AppRouter.jsx`** — the flat `NAV` array became `NAV_HOME` (standalone top
  item) + `NAV_GROUPS` (`{ id, label, items: [{ to, code, label }] }`). Groups:
  **Flight** (Flight Controller, NTRIP, Telemetry Injector) · **Logs & Media**
  (Flight Logs, Cloud Upload) · **Camera & Video** (Photo/Video, Camera Switcher,
  Pipeline Editor, Cellular Tuning) · **Network** (Network Config, Network Priority,
  Adhoc, AP Clients, LTE Modem, PPP) · **VPN & DDNS** (VPN, WireGuard Hub, Tailscale,
  Dynamic DNS) · **System** (About, User Management). Logout stays a conditional
  standalone item. All 22 pages preserved one-for-one.
- Each category renders a header `<button>` (uppercase label + chevron,
  `aria-expanded`) that toggles its items. State is `openGroups` (a `Set` of open
  ids, all open by default); `toggleGroup` flips membership.
- **`styles.css`** — `.gs-navgroup-header` / `.gs-navgroup-chevron` styling;
  `.gs-navgroup-items` collapses via a `max-height` transition
  (`.gs-navgroup--closed` → `max-height: 0`). In the collapsed desktop
  waypoint-code rail (`≥ 768px`) the headers are hidden and `max-height` is
  released, so the rail stays a flat list of all codes (quick-access unchanged).

## Verification — WSL-verified

- `lint` 0 errors · `covback` **100/100/100/100** · `covfront` **826 tests,
  100/100/100/100** (added a category collapse/expand test covering `toggleGroup`
  + the open/closed render branches).
- Visual: headless-Chromium screenshot of the grouped rail (one group collapsed)
  against the compiled bundle.

## Needs on-device

Covered by the feature-27 checklist item set (real-browser confirmation of the
sidebar on the Pi). No new hardware paths.
