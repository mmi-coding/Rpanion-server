# Split index.js + videostream.js (2026-06)

Follow-up to the refactor-audit campaign: reduce the size of the two largest
backend files by **modularization** (an architectural change, distinct from the
audit's in-place cleanups). Behaviour-preserving, applied incrementally, every
step gated by the full CI parity run. Branch `feature/split-index-videostream`,
merged `--no-ff` into `dev`.

## server/index.js — 2196 → 1215 lines (−45%)

The Express monolith's route handlers were extracted into **router-factory
modules** under `server/routes/`. Each module exports
`({deps}) => express.Router()` and is mounted from index.js with an explicit
dependency-injection context, e.g.:

```js
app.use(require('./routes/ltemodem.js')({ authenticateToken, toBool, lteModem }))
```

14 route groups extracted (one module each):

| Module | Routes | Injected deps |
|---|---|---|
| ltemodem | 12 | lteModem |
| network | 11 | networkManager |
| vpn | 11 | VPNManager |
| cameraSwitcher | 3 | camSwitcher |
| customPipelines | 3 | customPipelines, vManager |
| telemetryInjector | 3 | telemetryInjector |
| networkPriority | 3 | networkPriority |
| dynamicDns | 3 | ddns |
| ppp | 2 | pppConnectionManager |
| ntrip | 2 | ntripClient |
| cloud | 2 | cloud |
| cellularTuning | 2 | cellularTuning |
| logConversion | 2 | logConversion |
| adhoc | 2 | adhocManager |

`authenticateToken`/`toBool` are passed in; `check`/`validationResult` are
required per-module. Route order is preserved relative to the
connection-tracking middleware and the production SPA catch-all (both still
registered last). Express matches by path, so groups split across the file (e.g.
`network` was interrupted by the `camera/*` routes) are safely consolidated.

**Left in index.js by design** (tightly coupled to app core / module state, not
worth the merge-friction): camera routes (vManager + `io` emits + MEDIA_ROOT +
the video lifecycle), the auth/users routes (tokenBlacklist/JWT), the FC routes
(interleaved with the settings/system routes), and the misc system endpoints —
plus the socket.io section, `gracefulShutdown`, `FCStatusLoop`, and `testHooks`.

## server/videostream.js — 1099 → 1031 lines

`videostream.js` is a cohesive **stateful** class, so it doesn't decompose as
dramatically as the route monolith. The genuinely-pure (no-`this`) helpers were
moved to `server/videostreamHelpers.js` — `toRelativePath`,
`getCompressionSelect`, `getTransportSelect`, `getTransportOptions`,
`scanInterfaces`, `toMavChars` — and the class delegates to them. The public
method API is unchanged (tests calling `vManager.getCompressionSelect()` etc.
still pass), so this is a transparent move; the now-unused `os` import was
dropped.

## Verification

- `nyc all:true include server/**/*.js` auto-instruments the new modules, so they
  are subject to the 100% ratchet. Every new module is covered transitively by
  the existing route/class tests (no test rewrites required) and reports 100%.
- Each extraction batch was committed only after `covback` returned
  100/100/100/100. One batch was caught and would have failed the gate had the
  pattern been wrong (it wasn't) — the gate ran after every group.
- Final combined `dev`: `npm run lint` clean, `npm run build` OK, `covback` 947
  passing 100/100/100/100, `covfront` 814 passing 100/100/100/100, `npm run e2e`
  68 passed.

## Trade-off (recorded)

These extractions touch upstream-derived code (`index.js`, `videostream.js`),
so they add merge friction against `stephendade/Rpanion-server`. The user opted
into whole-codebase changes; the router-factory layout keeps each group small
and self-contained, which limits per-merge conflict surface to the touched
group rather than the whole monolith.
