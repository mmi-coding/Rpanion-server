# Feature 19 report: Network priority/failover + bandwidth monitoring

**Branch:** `feature/network-priority`, merged `--no-ff` into `dev` (`24d74bc`)
**Status:** complete, WSL-verified (sampler/parsing/rate maths + nmcli wrappers + UI); real failover on-device
**Docs:** `docs/NETWORK-PRIORITY.md` · `docs/ROADMAP.md` · `docs/ONDEVICE-CHECKLIST.md` (feature 19)

Fifth and final selected UAVcast-Pro-6 parity feature (`docs/ROADMAP.md §B1`).

## What was built

A `/networkpriority` page combining live bandwidth monitoring with WiFi↔cellular
priority/failover.

- **Backend (`server/networkPriority.js`)** — self-contained:
  - **Bandwidth:** `readNetStats()` reads `/sys/class/net/<iface>/statistics/{rx,tx}_bytes`
    (injectable `netStatsBase`); `sample(now)` returns per-interface totals and the
    rate vs the previous sample, handling counter resets, loopback, and
    garbage/missing counters.
  - **Priority:** `listConnections()` and `setPriority(conName, priority, metric)`
    via `nmcli` (`connection.autoconnect-priority` + `ipv4.route-metric`).
  - Endpoints `/api/networkpriority` (GET list), `/api/networkbandwidth` (GET),
    `/api/networksetpriority` (POST, UUID + int validation).
- **Frontend (`src/networkpriority.jsx`)** — basePage page: a bandwidth table that
  auto-refreshes (interval cleared on unmount) and a per-connection priority/metric
  editor. Self-documenting (HelpSection + HelpTips). Wired into `AppRouter` + e2e
  routes.

## Design decision

Per the scout brief, the nmcli calls live in a **new** `networkPriority.js` module
(with its own FakeBin test) rather than in `networkManager.js`, to avoid editing
the 1523-line `networkManager.test.js` and re-covering its branches. The bandwidth
sampler reuses the proven `/sys/class/net` + injectable-base pattern from
`ltemodem.js`, which is far more deterministic for 100% coverage than
`systeminformation.networkStats()` (hidden internal state).

## How it was tested (WSL)

- Backend `covback`: **100/100/100/100** (4138 stmts). `networkPriority.test.js`
  drives bandwidth against temp `/sys`-style fixtures (baseline, rate, counter
  reset, zero-elapsed, new-interface, missing base, garbage/missing counters, lo
  skip, `Date.now()` default) and nmcli via FakeBin (list / empty / list-error /
  set / set-error). `index.routes.test.js` covers the three endpoints (list,
  bandwidth, set 422 + 200) by stubbing the prototype.
- Frontend `covfront`: **100/100/100/100**. `networkpriority.test.jsx` covers the
  formatted bandwidth table (all `formatBytes` branches), the connection editor +
  Set (asserts POST body), backend-error and fetch-catch paths for set, the
  empty-connections/empty-interfaces fallbacks, and the connection/bandwidth catch
  paths.
- e2e: **64 passed** — `/networkpriority` added to smoke, navigation and
  self-documenting sets. `npm run lint` clean.

## Needs on-device (see `docs/ONDEVICE-CHECKLIST.md` feature 19)

Live counters under real traffic; setting WiFi above the SIM7600 `usb0`
connection and observing actual failover when WiFi drops; `sudo nmcli` polkit
rights; read-only users blocked from setting priority (403).
