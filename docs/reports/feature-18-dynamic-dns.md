# Feature 18 report: Dynamic DNS (DuckDNS / No-IP)

**Branch:** `feature/dynamic-dns`, merged `--no-ff` into `dev` (`bc1efd1`)
**Status:** complete, WSL-verified (updater logic fully unit-tested with a stubbed HTTP client); real provider round-trips on-device
**Docs:** `docs/DYNAMIC-DNS.md` · `docs/ROADMAP.md` · `docs/ONDEVICE-CHECKLIST.md` (feature 18)

Fourth UAVcast-Pro-6 parity feature (`docs/ROADMAP.md §B1`).

## What was built

A Dynamic DNS updater that keeps a hostname pointed at the device's public IP, so
it can be reached by name as the IP changes.

- **Backend (`server/dynamicDns.js`)** — a settings-injected class:
  - `detectPublicIp()` via `api.ipify.org`; `buildRequest(ip)` returns the
    per-provider URL/init plus a success predicate (DuckDNS: body `OK`; No-IP:
    body `good`/`nochg` with HTTP basic auth).
  - `performUpdate()` (detect → push → record status), `updateNow()`,
    `startLoop`/`stopLoop`/`quitting` (interval timer).
  - The HTTP client (`fetchFn`) is **injectable**, so every path is unit-tested
    without the network; the default falls back to global `fetch`.
  - `getSettings()` reports `hasPassword` and **never returns the stored password**.
  - Endpoints `/api/ddns` (GET), `/api/ddnsmodify` (POST, validated), `/api/ddnsupdate`
    (POST); instance constructed alongside the other managers and stopped in
    `gracefulShutdown`.
- **Frontend (`src/ddns.jsx`)** — basePage page: enable toggle, provider select
  with conditional fields (DuckDNS token vs No-IP username/password), interval,
  Save + Update now, live status. Self-documenting (HelpSection + HelpTips). Wired
  into `AppRouter` and the e2e route tables.

## How it was tested (WSL)

- Backend `covback`: **100/100/100/100** (4069 stmts). `server/dynamicDns.test.js`
  uses an in-memory settings stub and an injected `fetchFn` to cover: disabled/
  enabled construction, the interval (sinon fake timers), both provider request
  builders, success per provider, provider-rejected, fetch failure, IP-detection
  failure, disabled no-op, settings persist/enable/disable, password-keep,
  persistence-error catch, and the global-`fetch` fallback. Route tests in
  `index.routes.test.js` cover GET / modify (422 + 200) / update (200), stubbing
  the prototype so the real instance never hits the network.
- Frontend `covfront`: **100/100/100/100**. `src/ddns.test.jsx` covers both
  provider field sets, status rendering, the enable-checkbox + provider-switch
  branches of `handleChange`, Save (asserts POST body), Update now (status
  refresh), and the mount/save/update catch paths.
- e2e: **60 passed** — `/ddns` added to smoke, navigation and self-documenting sets.
  `npm run lint` clean.

## Scope note

Ships DuckDNS + No-IP — the two simplest token/credential providers — which keeps
the form, validation and tests clean at 100%. Cloudflare (zone/record IDs, a PUT)
is a straightforward future addition in `buildRequest()`; noted in the roadmap.

## Needs on-device (see `docs/ONDEVICE-CHECKLIST.md` feature 18)

Real DuckDNS/No-IP updates with live credentials, public-IP detection reachable
over the modem link (CGNAT caveat), the periodic timer pushing on schedule, and
read-only users blocked from Save/Update (403).
