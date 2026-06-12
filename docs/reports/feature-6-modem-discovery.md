# Feature 6 report: Modem discovery + connection test (USB/UART)

**Branch:** `feature/modem-discovery` (commit `5f222f5`), merged `--no-ff` into `dev` (`855156a`)
**Status:** complete, WSL-verified against the pty modem emulator and the real network stack; on-device items at the end
**Docs:** `docs/LTE-MODEM.md` (Discovery / Connection test / USB-or-UART sections) · checklist: `docs/ONDEVICE-CHECKLIST.md` (Feature 6 section)

## What was built

Two additions to the LTE Modem page so the user can go from "modem plugged
in somewhere" to "verified working link" without touching a terminal:

1. **Modem discovery** — a *Scan for modem* button that:
   - probes every candidate serial port with an AT handshake: detected USB
     serial devices, the board UARTs (`/dev/serial0`, `/dev/ttyAMA*` —
     GPIO-header-wired HATs), and the currently configured port
   - identifies responders via `AT+CGMM`/`AT+CGMI` and **recommends** the
     SIMCOM-identified, lowest-numbered port (a SIM7600 answers AT on two
     of its USB ports)
   - tries one baud on USB CDC ports (baud is ignored there) and
     115200/921600/460800/9600 on real UARTs
   - **never probes the flight controller's serial link** (shown as
     *Skipped*) — AT chatter must not land in the MAVLink stream
   - lists candidate **data network interfaces** with their kernel driver,
     flagging and recommending RNDIS/CDC ones (`rndis_host`, `cdc_ether`,
     `cdc_ncm`, `cdc_mbim`, `qmi_wwan`)
   - *Use* buttons fill the settings form (port + baud, interface); Save
     applies
2. **Connection test** — a staged end-to-end check with per-step pass /
   fail / skipped and a one-line diagnosis:
   AT port → modem model → SIM (`AT+CPIN?`) → signal (`AT+CSQ`) →
   registration + operator → PDP address (`AT+CGPADDR`) → network
   interface present with IPv4 → **ping routed through the modem's
   interface** (`ping -I`, target configurable, default 8.8.8.8 — proves
   the modem path, not whatever the default route is).
   Failure details carry actionable hints: the RNDIS mode-switch command
   (`AT+CUSBPIDSWITCH=9011,1,1`) when no modem interface exists, the
   UART-carries-AT-only note, APN/reconnect pointers.

**USB or UART:** both are supported for the AT control link. The data path
remains **USB RNDIS** per the project's hard constraint — no PPP-over-UART
(far too slow for video), no ModemManager. The test and the docs state
this explicitly when a UART-only setup is detected.

## What changed, by file

| File | Change |
|---|---|
| `server/ltemodem.js` | `probeAttempt` (self-contained per-port AT session: open → `ATE0` → `AT`→OK → identify; NMEA/diag ports time out cleanly), `probePort` (multi-baud), `buildProbeCandidates` (static: dedup, USB-vs-UART baud lists, FC-link exclusion, configured-port inclusion), `detectModem` (orchestration: releases the monitor's port, probes sequentially, recommends, lists interfaces; `scanning` guard keeps `doPoll` out), `listNetInterfaces` (driver via `/sys/class/net/*/device/driver`, operstate, IPv4), `testConnection` (8 staged steps, skip-on-prerequisite-failure, opens/closes the port itself when monitoring is off), `parsePIN`/`parseIdentLine`/`isModemNetDriver` statics, `_netIfaces`/`_ping` seams for tests |
| `server/ltemodem.test.js` | 7 new tests (see below) |
| `server/index.js` | `POST /api/ltemodemdetect`, `POST /api/ltemodemtest` (`pingHost` validated against `[a-zA-Z0-9.:-]{1,253}`) |
| `src/ltemodem.jsx` | *Modem discovery* section (scan button with progress label, port results table with model/baud/recommended badges + Use, interface table with driver/Modem/recommended badges + Use, no-modem-found alert, RNDIS/UART hint footer); *Connection test* section (run button, ping target field, step table with Pass/Fail/Skipped badges and details) |
| `python/fake-sim7600.py` | Answers `AT+CGMM`/`AT+CGMI`/`AT+CPIN?` so discovery and the test bench without hardware |
| `docs/LTE-MODEM.md`, `docs/ONDEVICE-CHECKLIST.md`, `CHANGELOG.md` | Docs |

## Design decisions

- **The FC link is excluded, not just deprioritized.** Probing writes
  `ATE0\r AT\r` into the port — harmless to a modem, garbage into a
  Pixhawk's MAVLink stream. The scan resolves `flightcontroller.activeDevice`
  to both its value and path and skips it visibly.
- **Sequential probing.** A handful of ports at ~2–4 s worst case each is
  well inside an acceptable scan time, and it avoids opening many serial
  devices at once on a Pi Zero.
- **The monitor releases its port for the scan.** The configured port is
  itself a candidate; the existing lazy-reopen design (built for modem
  replug) restores monitoring on the next poll with no special-case code.
- **`ping -I <iface>`** instead of plain ping: with a VPN up (the normal
  deployment), the default route goes through the tunnel — a plain ping
  would test the wrong path.
- **Skipped ≠ failed.** Steps whose prerequisites failed report `pass:
  null`; the UI shows a neutral badge. A missing SIM doesn't paint the
  interface check red.
- **Hints in the failure details.** The two most common bring-up problems
  (modem not in RNDIS mode; UART-only wiring with no USB data cable) are
  diagnosed in the step text rather than left for the user to deduce.

## How it was tested (WSL)

CI parity green: `npm run lint` (0 errors), `rm -f ./config/settings.json &&
npm run build && npm run testback` → **145/145** (7 new), `rm -f
./config/settings.json && npm run testfront` → **15/15**.

Unit tests (`ltemodem.test.js`):

- `parsePIN` (READY / SIM PIN / +CME ERROR / absent), `parseIdentLine`
  (model line, echo/URC skipping, null), `isModemNetDriver` fixtures
- `buildProbeCandidates`: dedup, USB single-baud vs UART multi-baud, FC
  port listed-but-skipped, configured port appended when detection misses
  it (the pty case)
- `testConnection` all-pass / failure-modes / port-unavailable via the
  injected seams (`sendAT` fixtures, `listNetInterfaces`, `_ping`):
  asserts SIM-not-inserted text, both RNDIS and UART hints present,
  ping skipped (not failed) without an interface, AT-dependent steps
  skipped when the port can't open, port not left half-open

Live smoke (`python/fake-sim7600.py` pty + real WSL network):

- `probeAttempt` on the pty: AT OK, identified `SIMCOM_SIM7600G-H` /
  `SIMCOM INCORPORATED`
- `detectModem`: pty found via configured-port inclusion, recommended at
  115200; real interfaces classified by driver (eth0 `hv_netvsc` not
  modem-like, docker/tailscale virtuals driverless)
- `testConnection('8.8.8.8')`: **8/8 pass** — AT legs against the
  emulator, interface leg against real eth0, real ICMP through
  `ping -I eth0` (rtt reported)
- Negative path: interface set to missing `usb0` → interface step fails
  with both hints, ping skipped
- REST: `POST /api/ltemodemdetect` and `POST /api/ltemodemtest` on the dev
  server return the full structures; `pingHost: "8.8.8.8; rm -rf /"` → 422
- Monitor lifecycle: with monitoring enabled and polling the pty
  (available, operator TestTel), a scan runs, finds the modem, and the
  monitor is back to available on the next poll — no restart needed

## Needs on-device verification (Pi 4 / Pi Zero 2 W + SIM7600G)

Tracked in `docs/ONDEVICE-CHECKLIST.md` (Feature 6 section):

- Real USB enumeration: scan across all four `/dev/ttyUSB*` — the NMEA
  port streams sentences and the diag port stays silent; both must time
  out without wedging the scan (WSL had no real NMEA stream to test)
- UART scan on the GPIO header with the serial console disabled; scan
  duration with silent multi-baud UARTs
- FC exclusion live: MAVLink stream stays clean during a scan with the
  Pixhawk connected
- `usb0`/`rndis_host` discovery and recommendation on real hardware; the
  wrong-USB-mode path (PID 9001) shows the RNDIS hint
- Connection test failure modes with real hardware (SIM removed, antenna
  off, wrong APN, USB data cable pulled in a UART-control setup)
- `ping -I usb0` egress verified with `tcpdump` while the VPN is up
- Pi Zero 2 W scan/test timing
