# Split index.js + videostream.js (2026-06)

Follow-up to the refactor-audit campaign: reduce the size of the two largest
backend files by **modularization** (an architectural change, distinct from the
audit's in-place cleanups). Behaviour-preserving, applied incrementally, every
step gated by the full CI parity run. Branch `feature/split-index-videostream`,
merged `--no-ff` into `dev`.

## server/index.js — 2196 → 538 lines (−75%)

> **Update (phase 2):** after the user confirmed this fork will never merge
> upstream (so merge friction is a non-issue — see the
> `fork-no-upstream-merge` memory), the remaining groups were extracted too.
> index.js is now **538 lines** — app/middleware setup, the socket.io status
> loop, graceful shutdown, the production SPA catch-all, and `testHooks`. Every
> route lives in a module. Phase-1 stopped at 1215 (−45%); phase-2 finished at
> 538 (−75%).

The Express monolith's route handlers were extracted into **router-factory
modules** under `server/routes/`. Each module exports
`({deps}) => express.Router()` and is mounted from index.js with an explicit
dependency-injection context, e.g.:

```js
app.use(require('./routes/ltemodem.js')({ authenticateToken, toBool, lteModem }))
```

**Auth keystone** (`server/auth.js`): `authenticateToken` is the middleware every
other route depends on. It moved into `auth.js` together with the auth/user
routes and the JWT secret / logout blacklist / RBAC write-allowlist;
index.js obtains it once (`const { authenticateToken, router } =
require('./auth.js')({ userMgmt })`) and injects it into every route module.

18 route modules + auth.js extracted:

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
| flightController | 6 | fcManager |
| system | 12 | aboutPage, networkClients, logManager, fcManager |
| camera | 6 | vManager, fcManager, camSwitcher, MEDIA_ROOT |
| auth.js | 8 | userMgmt (+ owns secret/blacklist/allowlist) |

`authenticateToken`/`toBool` are passed in; `check`/`validationResult` are
required per-module. Route order is preserved relative to the
connection-tracking middleware and the production SPA catch-all (both still
registered last). Express matches by path, so groups split across the file (e.g.
`network` was interrupted by the `camera/*` routes) are safely consolidated.

**Gotcha caught by the gate:** the `camera` router was first mounted at the old
capturestillphoto position — *before* the `express.json()`/`urlencoded` body
parser — so `camera/start` saw an empty `req.body` and every test 422'd. Moving
the mount below the body parser fixed it. The `covback` gate caught this before
merge.

**What remains in index.js (~538 lines):** require/instantiate the managers,
middleware setup (rate limit, file upload, body parsers, static), the
`vManager`/`fcManager` event-emitter wiring, the socket.io status-emit loop +
`FCStatusLoop`, `gracefulShutdown`, the production SPA catch-all, and the
`testHooks` export. No route handlers.

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

## No upstream-merge constraint

These extractions heavily restructure upstream-derived files (`index.js`,
`videostream.js`). That is intentional and unconstrained: the user confirmed
this fork is maintained independently and **will never merge upstream**
(recorded in the `fork-no-upstream-merge` memory). Merge friction is therefore
not a consideration — the whole tree is treated as fork-owned. The only standing
guardrail is the 100% coverage ratchet, which every step passed.
