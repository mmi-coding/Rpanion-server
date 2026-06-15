# Feature 29 — Live system stats on the dashboard (#31)

Implements upstream feature request [#31](https://github.com/stephendade/Rpanion-server/issues/31):
show live companion-computer health on the web UI. A new **System** card on the
Home dashboard shows CPU load, CPU temperature, RAM and disk usage, and uptime,
refreshed every few seconds.

## What was built

- **`server/aboutInfo.ts` → `getLiveStats(callback)`** — one `si.get()` call
  (`systeminformation`, same pattern as `getHardwareInfo`) returning a compact
  shape: `{ cpuLoad, cpuTempC, memUsedMB, memTotalMB, diskUsedGB, diskTotalGB,
  uptimeSec }`. Root filesystem is the `/` mount (falls back to zeros if absent);
  temperature is `null` when unavailable (VM/WSL); errors return `(null, err)`.
- **`server/routes/system.ts` → `GET /api/systemstatus`** — authenticated; returns
  the stats object, or `{ error: 'Could not read system status' }` on failure.
- **`src/home.jsx`** — polls `/api/systemstatus` every 3 s (interval set in the
  constructor, cleared in `componentWillUnmount`), renders the **System** card
  (temperature shows `N/A` when null; uptime formatted `Hh Mm`).

## Design notes

- **Request-driven, not socket-pushed.** The other dashboard statuses ride the
  1 Hz socket loop, but those getters are synchronous caches; system stats are
  async (`si`). A `GET` route the page polls keeps it deterministic and avoids a
  background sampler/open-handle inside `index.ts`.
- The Home fetch sends the JWT; two `AppRouter` header-capture tests were scoped to
  `/api/auth` so they ignore the new `/api/systemstatus` request.

## Verification — WSL-verified

- `lint` 0 · `typecheck` 0 · `covback` **100/100/100/100** · `covfront` **100/100/100/100**
  (added 3 `getLiveStats` cases, the route's 2 paths, and 3 Home-card cases —
  stats / `N/A` temp / fetch-failure).
- Works the same in WSL as on the Pi (it reads real load/mem/disk); CPU
  temperature is the one value that reads `N/A` off-device.

## Needs on-device

- [ ] Confirm the System card shows a **real CPU temperature** (°C, not N/A) on the Pi, plus live load/RAM/disk/uptime — appended to `docs/ONDEVICE-CHECKLIST.md`.
