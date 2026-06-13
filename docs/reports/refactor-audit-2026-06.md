# Refactor & optimization audit (2026-06)

Whole-codebase refactor/optimization pass, driven by a multi-agent audit
(parallel readers over the whole tree → each finding adversarially verified for
*behaviour-preservation* and *test coverage*). 159 candidate findings → 46
verified-keep (113 rejected by the skeptics). Applied in 8 batches, each on its
own `feature/refactor-b*` branch, **gated by the full CI parity run**
(`lint` + `build` + `covback` + `covfront`) and merged `--no-ff` into `dev` only
when green. Both suites stayed at **100/100/100/100** throughout; e2e 68 passed.

Scope: entire codebase (fork + upstream). Of 46 applied findings, 45 were
fork-added/-modified files and 1 touched upstream (`adhocwifi.jsx`). All changes
are behaviour-preserving except the explicitly-noted bug fixes.

## Batches

| Branch | Theme | Highlights |
|---|---|---|
| b1 | backend dead-code | delete unreachable `getPPPdatarate()`; drop unused imports/fields; simplify `scanInterfaces`/recording-detect; hoist `flightLogger` tree-walk helpers; `JSON.parse('[]')`→`[]` |
| b2 | backend DRY + correctness | `userLogin` `_loadUsers`/`_saveUsers`; `ltemodem` `_markReconnect`/`VALID_BAUDS`; `pppConnection` `_stateSnapshot` + **empty-device-list guard**; `videostream` `_sendStdinCommand`/`_ensureAndPushDest` + single settings write; **cloudUpload rsync `.bin`-only filter** |
| b3 | index.js | fix two **mis-logged route names**; `toBool()` helper for 13 coercions; `tokenBlacklist` Array→**Set** (O(1)); hoist in-handler `require('fs')` |
| b4 | flightController | **fix armed/disarmed listener leak** on auto-reconnect (+ regression test) |
| b5 | frontend correctness | **ddns JWT-shadowing fix** (+ regression test); userManagement ok-check before setState; about.jsx drops unused socket |
| b6 | frontend DRY | shared `handleConfigChange` in basePage (−4 copies); video.jsx `isH264Stream` + dead-code; ltemodem `handleModemAction`/`MODEM_BAUDS`; misc |
| b7 | build/config | **sudoers tailscale entries**; **postrm cleans QMI udev/NM drop-ins**; eslint lints `src/components`; dedup `python3-dev` |
| b8 | python | `wireguardconfig.py` → pathlib (drop `os`); `tlog2kmz.py` drop dead `run_cmd` branch |

## Bugs fixed (surfaced by the audit)

- **flightController**: `armed`/`disarmed` listeners registered outside the
  `this.m === null` guard accumulated on every 1 s auto-reconnect (MaxListeners
  warning, then duplicate events). Now bound once per mavManager.
- **ddns.jsx**: the DuckDNS API token was stored in `state.token`, shadowing the
  basePage JWT — so Save/Update-now sent the DuckDNS token as the `Authorization`
  bearer, silently breaking auth when enabled. State key renamed to `ddnsToken`.
- **userManagement.jsx**: `setState(data)` ran before the `response.ok` check, so
  an error body transiently corrupted component state. Reordered.
- **cloudUpload.js**: `rsync --include='*.bin'` with no trailing `--exclude='*'`
  uploaded *every* file (tlogs/media) over the metered link. Now
  `--include='*/' --include='*.bin' --exclude='*'`.
- **pppConnection.getPPPSettings**: indexed `serialDevices[0]` with a stale
  device and no ports detected → TypeError. Guarded.
- **index.js**: two handlers logged `/api/logout` instead of their own route;
  `tokenBlacklist` did an O(n) scan per authenticated request (→ Set).
- **debian**: sudoers had no `tailscale` entries (Tailscale VPN silently failed
  under the service user); postrm left the QMI udev rule + NM drop-in on disk
  after uninstall.
- **eslint**: `src/*.jsx` glob never linted `src/components/*.jsx`.

## Verification

Every batch: `npm run lint` clean, `npm run build` OK, `covback` 947 passing
100/100/100/100, `covfront` 814 passing 100/100/100/100. Final combined `dev`:
all of the above + `npm run e2e` 68 passed. New regression tests added for the FC
listener leak, the ddns JWT header, the ppp empty-device guard, and the
cloudUpload rsync filter. One self-inflicted regression (an infinite-recursion
from a `replace_all` that matched the helper it created) was caught by the B2 CI
gate before merge — the gate working as intended.

## Needs on-device

The deployment-only fixes (B7 sudoers tailscale, postrm cleanup) and the
operational ones (cloudUpload `.bin`-only upload, FC reconnect listener count
under sustained link loss) are verified by unit tests / inspection in WSL but
exercise real services only on the Pi.
