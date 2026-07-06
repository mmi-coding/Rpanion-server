# Security & Resiliency Audit — Rpanion-server fork (airborne companion computer)

**Date:** 2026-07-06 · **Branch:** `dev` · **Scope:** `server/`, `src/`, `python/`, `mavlink/`, `config/`, `debian/`, `deploy/`
**Method:** five parallel read-only audit passes (command-injection/privilege, auth/web-surface, deps/network/secrets, crash-safety, hardware-link/leaks), each grounded in the code with `file:line` evidence.

**Threat model.** A Node/React/Python server on `:3001` on a Raspberry Pi *inside the aircraft*, reachable by anything on the WireGuard VPN (CGNAT tunnel to Mission Planner), and — critically — also listening on every other interface the Pi joins (its own WiFi AP, `eth0`-to-Pixhawk segment, any DHCP LAN). The service user `rpanion` is effectively root via a broad `sudo` NOPASSWD grant. So: **any code-exec as `rpanion` = root on a flying aircraft**, and **any uncaught throw = ~10 s loss of all links** (see the cross-cutting note below).

---

## Remediation status (updated 2026-07-06)

**Fixed + verified this pass** (both suites 100/100/100/100, lint + typecheck clean): R1, R2, R3, R4, R5, R6, R7, R9, R10, R11, R12, R13, R14 (resiliency); S1, S2, S3, S4, S6, S8, S9, S11, S15, S16, and the `ws` dependency (security). S5 (bind) and S1 (provisioning) were implemented with a **never-locked-out** guarantee — configurable bind defaulting to today's behavior with a boot-time fallback to `0.0.0.0`, and a server-side self-heal that always recreates a usable admin. S10 was hardened (argv/metachar defense). Deployment- and interface-level effects are **needs-on-device** (see `docs/ONDEVICE-CHECKLIST.md`).

**Deliberately not auto-changed (documented, needs a policy call):** S7 (the broad `sudo` NOPASSWD wildcards — narrowing them risks breaking the modem/VPN control paths); S14 (defaulting NTRIP to TLS — could break plaintext-only casters, so left opt-in). MAVLink TCP `5760` cannot be address-bound (`mavlink-routerd` has no flag) — mitigate via firewall + MAVLink2 signing.

---

## 0. The two things to internalize first

**(A) One uncaught throw = a guaranteed in-flight blackout.** The global handler at `server/index.ts:227,234` turns *every* `uncaughtException`/`unhandledRejection` — from any timer, child-process callback, or the MAVLink parser — into `process.exit(1)`. systemd (`debian/systemd.service`) restarts with `RestartSec=10`, so each crash = **~10 s with no telemetry, no video, no command link**, then a fresh process with all sessions invalidated. There is no log-and-continue. This multiplies the severity of every resiliency finding below.

**(B) A remote, unauthenticated aircraft-link DoS exists by combining two findings.** MAVLink TCP `5760` binds `0.0.0.0` with **no auth** (`S5`), and the MAVLink RX handler is **unguarded** against malformed frames (`R1`). An attacker on any LAN the Pi joins can open `5760`, send a CRC-valid frame with a bad payload/null STATUSTEXT, and crash the companion — repeatably, into the 10 s restart loop. Fixing either half breaks the chain; fix both.

---

## 1. SECURITY FINDINGS (severity-ranked)

| # | Sev | Issue | Location | Status |
|---|-----|-------|----------|--------|
| S1 | **CRITICAL** | `admin:admin` shipped, committed to git, never forced to change → full admin over the VPN | `config/user.json`, `deploy/build-deb.sh:56` | CONFIRMED |
| S2 | **CRITICAL** | OS command injection → **root**: `POST /api/networkadd` builds a `sudo nmcli` shell string from `conType`/`conAdapter`/`conName`, "guarded" only by `.escape()` (leaves `;` `\|` `$()`) | `server/networkManager.ts:250`, `server/routes/network.ts:229` | CONFIRMED |
| S3 | **HIGH** | Flight telemetry & imagery downloadable with **no auth** — `express.static` mounts outside `authenticateToken` | `server/index.ts:447` (`/logdownload`), `:449` (`/media`) | CONFIRMED |
| S4 | **HIGH** | Unfiltered command-exec-by-design primitive: camera-switcher runs `exec(commandA/B)` verbatim | `server/cameraSwitcher.ts:202`, `server/routes/cameraSwitcher.ts:28` | CONFIRMED |
| S5 | **HIGH** | Cleartext + unauthenticated on `0.0.0.0`: webUI/socket.io `:3001` (no TLS), MAVLink TCP `5760` (no auth/signing), RTSP `8554` (no `GstRTSPAuth`) | `server/index.ts:564`, `server/fcLink.ts:66`, `python/video-server.py:1042` | CONFIRMED |
| S6 | **MED** | RBAC enforced by HTTP verb (`readonly` blocked only on `POST`) → any non-POST mutation bypasses it | `server/auth.ts:72`; live example `server/routes/hud.ts:49` (`DELETE`) | CONFIRMED |
| S7 | **MED** | `sudo` NOPASSWD wildcards `pppd *` / `udhcpc *` / `nmcli *` — the root-amplifier that makes S2/S4 root-level | `debian/postinst` (`/etc/sudoers.d/allow-vpn-control`) | CONFIRMED |
| S8 | **MED** | JWT accepted via `?token=` and logged to the journal by `pino-http` (URL incl. query); `rpanion` ∈ `adm` can read it | `server/auth.ts:50`, `src/hudeditor.jsx:101`, `server/index.ts:383` | CONFIRMED |
| S9 | **MED** | No security headers (`helmet` absent): no CSP, no `X-Frame-Options` → GS UI is clickjackable ("Reboot FC") | `server/index.ts` (absent) | CONFIRMED |
| S10 | **MED** | Latent injections safe *only* by distant middleware — one config change from live root RCE | `server/vpn.ts:87` (upload filename), `server/adhocManager.ts:147` (adhoc settings) | CONFIRMED (currently safe) |
| S11 | **LOW-MED** | Login brute-force: only the shared global 50/min limiter, no per-login throttle/lockout | `server/index.ts:55,67`, `server/auth.ts:82` | CONFIRMED |
| S12 | **LOW-MED** | JWT in `localStorage` + no CSP → any XSS steals the session | `src/AppRouter.jsx:107`, `src/basePage.jsx:25` | CONFIRMED |
| S13 | **LOW** | Auth global kill-switch: `NODE_ENV=development` **or** `DISABLE_AUTH=1` disables all auth (prod unsets both — footgun) | `server/auth.ts:29` | CONFIRMED (safe in prod) |
| S14 | **LOW** | NTRIP defaults to cleartext (`useTls=false`) → caster creds in the clear; docs mention global `NODE_TLS_REJECT_UNAUTHORIZED=0` (never advise) | `server/ntrip.ts:29,56` | CONFIRMED |
| S15 | **LOW** | JWT algorithm not pinned (`jwt.verify` without `algorithms:['HS256']`) — defence-in-depth only | `server/auth.ts:65` | THEORETICAL |
| S16 | **LOW** | Git hygiene: `.env` and `config/user.json` are tracked despite `.gitignore` → a redeploy can **revert an operator's changed password to admin/admin** | `.env`, `config/user.json` | CONFIRMED |

### Dependencies (lane 3)
- **`ws 8.20.1`** (via socket.io) — memory-exhaustion DoS, **reachable** but behind JWT+VPN. Real severity low–moderate. **`npm audit fix` is non-breaking — apply it.**
- **`xml2js` prototype-pollution** via `node-mavlink → mavlink-mappings` — **NOT reachable**: `xml2js` is a dep of the *build-time* codegen (`mavlink-mappings-gen`); the in-flight parse path never calls it. **Do NOT `npm audit fix --force`** — it downgrades `node-mavlink`/`react-router` for zero real gain.
- **`ntrip-client` = a mutable GitHub branch** (`package.json:47`) — pinned by `package-lock.json` today, but any lock regen pulls live HEAD. Vendor/pin to a tag.
- **Python deps unpinned** (`pymavlink`, `piexif` — no `==`) → non-reproducible builds. Pin them.
- **No hardcoded keys/secrets in source** (verified). `RPANION_SECRET_KEY` is random per-process (`server/auth.ts:20`), passwords are bcrypt cost-10. WireGuard key handling is sound (generated on the VPS, `chmod 600`, never baked into emitted JS).

### Security — verified *correctly handled* (don't re-fix)
No `readonly→admin` escalation (user-mgmt endpoints are all POST+auth); socket.io handshake **is** authenticated and emit-only (no inbound mutation, no `cors:*`); upload/media path-traversal defences are layered and solid (`hudFonts` sfnt magic-byte + filename regex + allowlist; camera media `path.relative()` boundary); `timezone` is allowlisted before its shell call; all `execFile`/`spawn` argv sites (qmicli/pppd/udhcpc/gst/wg-quick/tailscale/…) are **not** shell-injectable.

---

## 2. RESILIENCY FINDINGS (severity-ranked)

| # | Sev | Failure mode | Location | Trigger → consequence |
|---|-----|--------------|----------|-----------------------|
| R1 | **CRITICAL** | Unguarded MAVLink RX handler; no parser `.on('error')`. `packet.protocol.data()` throws `RangeError` on truncated frame; `data.text.trim()` throws on null STATUSTEXT | `mavlink/mavManager.ts:103-171` | Routine RF/EMI from motors/ESCs (or a crafted frame via S5) → whole-process crash → 10 s link loss, **recurring** on a noisy airframe. Hottest path in the app. |
| R2 | **HIGH** | `sendData` UDP-error callback is a non-arrow `function` → wrong `this` → `this.udpStream.close()` throws `TypeError` (code's own comment admits it) | `mavlink/mavManager.ts:269-278` | Any send error (`ECONNREFUSED`/`EMSGSIZE`) on the FC send path → crash → 10 s outage. |
| R3 | **HIGH** | `spawn` sites with no `.on('error')` → unhandled child `error` event is thrown by Node | `fcLink.ts:104` (mavlink-routerd) & `:225` (dflogger); `secondaryStreams.ts:103`; `logConverter.ts:35`; `pppConnection.ts:169` | Fork failure under memory pressure (very plausible on a 512 MB Pi Zero 2 W with video+modem), `ENOENT` on stale venv → crash. `fcLink.ts:104` also runs on the **1 Hz reconnect loop** → crash-loop. |
| R4 | **HIGH** | `JSON.parse` in exec callbacks with no try/catch (Tailscale branch *is* guarded — inconsistent) | `server/vpn.ts:36` (zerotier), `:189` (wireguardconfig.py) | Non-JSON/partial helper output → opening the VPN page crashes the whole server. |
| R5 | **HIGH** | `statusText` accumulator grows unbounded, never reset across reconnects, re-broadcast every 1 s | `mavlink/mavManager.ts:165`, emitted `server/index.ts:473` | Long flight → RAM growth **and** an ever-larger blob retransmitted at 1 Hz over the scarce LTE uplink. (Same line as R1's null-throw.) |
| R6 | **HIGH** | DataFlash-logger process accumulation: stale async `close` handler nulls the *new* child ref, defeating kill-before-respawn | `server/fcLink.ts:237-240` | Link flaps / sustained outage (1 Hz retry) → multiple `dflogger.py` writing the same dir → duplicate/corrupt `.bin`, CPU/disk churn. |
| R7 | **MED** | Bare `setInterval` bodies with no try/catch — any one emitter throwing crashes the process every second | `index.ts:472` (`FCStatusLoop`, ~15 subsystems), `fcLink.ts:191`, `fcParams.ts:292`, `droneCan.ts:298/351`, `cellularTuning.ts:129` | Callees are null-safe *today*; one future throw = whole-process crash. Wrapping `FCStatusLoop` is the highest-value single guard. |
| R8 | **MED** | Supervision gaps: `Restart=on-failure` (not `always`), **no `WatchdogSec`/`sd_notify`**, `RestartSec=10` | `debian/systemd.service` | A *wedge* (blocked event loop, not a crash) is never detected — stays "active" forever. A boot-time throw → infinite 10 s crash-loop that never trips the start-limiter. |
| R9 | **MED** | ~25 module constructors + `settings.init` at import with no try/catch | `server/index.ts:74-126` (e.g. `cloudUpload.ts:35` `execSync ssh-keygen`) | Corrupt `settings.json` / empty `~/.ssh` → `require` aborts → boot fails → unrecoverable crash-loop, no companion for the whole flight. |
| R10 | **MED** | Video child not auto-restarted on crash; start-while-running orphans old child + leaks a 1 s heartbeat timer | `server/videostream.ts:944-957`, `routes/camera.ts:224` | gstreamer crash → video dead until manual restart; orphan holds the camera device. |
| R11 | **MED** | NTRIP client / log-converter leaks: new `NtripClient` without closing old; 20 s converter interval with no "still running" guard | `server/ntrip.ts:78`, `server/logConverter.ts:29-49` | Duplicate RTCM to FC + leaked socket/timer; piled-up python conversions. |
| R12 | **MED** | No log/tlog/bin size cap or rotation (clearing is manual) | `server/flightLogger.ts`, `python/dflogger.py` | Long/many flights → disk fills → box down. |
| R13 | **MED** | PPP data-path has no auto-reconnect if `pppd` dies; `pkill pppd` is system-wide | `server/pppConnection.ts:186-197` | pppd crash → link stays down; stop can kill the LTE modem's *own* pppd. |
| R14 | **LOW** | Serial reconnect has no backoff (1 Hz) and pushes `null:baud` when the device path is gone | `server/fcLink.ts:79-80,191-208` | Sustained serial outage → 1 Hz respawn of router (+dflogger) → log-spam/CPU; compounds R6. |

### Resiliency — verified *handled well* (credit; don't touch)
FC serial link **auto-reconnects** at 1 Hz (`fcLink.ts:189`, `mavManager.restart` closes the old socket first — no fd/listener leak); **LTE modem reconnect is backoff-safe** (30 s window, timestamp-before-attempt, children reaped — no zombies, no tight loop); **socket.io has no per-connection leak** (single global timer, no per-socket listeners); bounded accumulators for `mavTelemetry`/`droneCan`/`fcParams`; **Express 5 catches route-handler throws** (ordinary routes are off the crash surface — risk is concentrated in non-Express callbacks); global crash handlers **exist** (the problem is they exit, not that they're missing); `cloudUpload` kills prior `rsync` before respawn.

---

## 3. Recommended remediation order (flight-safety weighted)

**Tier 0 — do before the next flight on any shared network**
1. **R1** — wrap the `mav.on('data')` body in try/catch + add `mav.on('error')`. Single most important change; kills the recurring in-flight crash and half the remote-DoS chain.
2. **S1 + S16** — stop shipping `admin:admin`: `git rm --cached config/user.json`, generate a random per-device password (or force first-login change) in `postinst`, add a "default password in use" banner.
3. **S2** — convert `networkManager.ts:250` to `execFile('sudo',['nmcli',…argv])` (the wifi branch already does) + allowlist `conType`/`conAdapter`/`conName`.
4. **S3** — put `/logdownload` and `/media` behind `authenticateToken` (accept `?token=` like the camera preview, since `<a download>`/`<img>` can't set headers).
5. **S5** — bind webUI `:3001`, MAVLink `5760`, RTSP `8554` to the `wg0`/loopback address, not `0.0.0.0`.

**Tier 1 — soon**
6. **R2 + R3** — arrow-fn the `sendData` error callback; add `.on('error')` to all five `spawn` sites (mechanical, closes the whole missing-child-error-handler class).
7. **R4** — wrap the two `vpn.ts` `JSON.parse` calls like the Tailscale branch already is.
8. **R5 + R6** — bound `statusText` to a ring buffer + reset on reconnect; identity-check the dflogger `close` handler (`if (this.dflogger === proc) this.dflogger = null`).
9. **S4 + S6 + S7** — admin-only-gate the camera command mode; enforce RBAC on action/role not verb (block all of `POST|PUT|PATCH|DELETE` for `readonly`); narrow the sudoers wildcards.
10. **Deps** — `npm audit fix` (non-breaking, fixes `ws`); pin the Python deps and the `ntrip-client` ref. **Not** `--force`.

**Tier 2 — hardening**
11. **R7** — wrap `FCStatusLoop` and the other bare intervals in try/catch.
12. **R8 + R9** — `Restart=always` + `WatchdogSec`/`sd_notify` heartbeat (catches wedges); wrap `index.ts` construction so one bad subsystem can't abort boot.
13. **S8/S9/S10/S11/S12/S14** — redact `token` from pino; add `helmet`+CSP; convert `vpn.ts:87`/`adhocManager.ts:147` to argv; add a per-login limiter+lockout; default NTRIP to TLS.
14. **R10–R14** — video auto-restart; NTRIP/converter leak fixes; log rotation; PPP reconnect + scope the `pkill`; serial reconnect backoff.

---

*Generated from a 5-lane parallel audit. Every finding cites the line it was read from; "CONFIRMED" = traced end-to-end, "THEORETICAL" = plausible but not proven reachable.*
