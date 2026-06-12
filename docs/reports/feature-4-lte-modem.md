# Feature 4 report: LTE modem management page (SIM7600G)

**Branch:** `feature/lte-modem` (commit `148fd25`), merged `--no-ff` into `dev` (`9ab0fc1`)
**Status:** complete, WSL-verified against a pty modem emulator; on-device items at the end
**Docs:** `docs/LTE-MODEM.md` · checklist: `docs/ONDEVICE-CHECKLIST.md` (Feature 4 section)

## What was built

A new **LTE Modem** web page for the SimCom SIM7600G, driven entirely by AT
commands on the modem's command port (`/dev/ttyUSB2` typical). The
architecture respects the project's hard constraints: the **data path is USB
RNDIS** (`usb0`, a plain network interface), and **ModemManager is never
used** — the module owns the AT port directly via the `serialport` package
already in the dependency tree.

Capabilities (matching/exceeding the UAVcast-Pro modem page):

- **Connection state** — modem responding, registration (home / roaming /
  searching / denied), operator name, RAT + band (`AT+CPSI?`), WAN IP
  (`AT+CGPADDR`).
- **Signal quality** — RSSI in dBm with a quality label, plus RSRP and SINR
  on LTE. Live at 1 Hz over the existing socket.io status channel (modem
  polled at a configurable interval, default 5 s).
- **Data usage** — session and persistent byte counters read from
  `/sys/class/net/<iface>/statistics`, safe across interface counter resets
  and reboots; reset button.
- **Auto-reconnect** — if registered on the network but no IP is assigned,
  the data call is restarted (`AT+CGDCONT=1,"IP","<apn>"` when an APN is
  configured, then `AT$QCRMCALL=1,1`) with a 30 s backoff; manual
  "Reconnect data call" button as well.
- **AT console** — raw command round-trip from the page (AT-prefixed,
  ≤ 128 chars, auth-protected like everything else).

## What changed, by file

| File | Change |
|---|---|
| `server/ltemodem.js` (new) | The manager: queued AT session (echo off via `ATE0`, responses collected to `OK`/`ERROR`/`+CME ERROR`, per-command timeout, one command in flight); lazy port open with reopen-after-error (modem replug recovers); pure static parsers `parseCSQ/parseCREG/parseCOPS/parseCPSI/parseCGPADDR`; poll loop; usage accounting; reconnect; settings validation |
| `server/ltemodem.test.js` (new) | 15 tests (see below) |
| `server/index.js` | Instantiation, 5 REST endpoints (`/api/ltemodem`, `ltemodemmodify`, `ltemodemreconnect`, `ltemodemresetusage`, `ltemodemcommand`), `LTEStatus` socket emit, shutdown hook |
| `src/ltemodem.jsx` (new) | Page: status table (badges for modem/signal quality), settings form (AT port with detected-ports datalist, baud, APN, interface, auto-reconnect, poll interval), usage + reset, AT console with scrollback |
| `src/AppRouter.jsx` | Route `/ltemodem` + sidebar link |
| `python/fake-sim7600.py` (new) | pty-based SIM7600 AT emulator for bench testing without hardware |
| `docs/LTE-MODEM.md`, `docs/ONDEVICE-CHECKLIST.md`, `CHANGELOG.md` | Docs |

## Design decisions

- **AT port only, RNDIS for data.** No `pppd`, no ModemManager, no dialer
  process to babysit. `AT$QCRMCALL=1,1` (the SIM7600 RNDIS dial) is the only
  state-changing command, and it's idempotent.
- **Serialized AT queue.** The modem handles one command at a time; status
  polls and user console commands share one promise-chained queue, so they
  can't interleave or steal each other's responses. URC lines outside a
  pending command are ignored.
- **Failure containment.** A missing/unplugged modem sets
  `status.available=false` with the error string; the poll loop retries the
  port open each cycle. An AT timeout force-closes the port so a half-dead
  fd doesn't wedge the session. Nothing here can take the telemetry or video
  path down.
- **Usage from the kernel, not the modem.** Interface byte counters are
  exact for the RNDIS path, free, and work even when the AT port is busy or
  absent. Counter-reset detection handles replug/reboot.
- **Parsers are pure static methods** — fully unit-testable with no serial
  port, which is what makes the suite meaningful on WSL/CI.

## How it was tested (WSL)

- **CI parity:** `rm -f ./config/settings.json && npm run build && npm run
  testback` → **128/128 passing** (15 new); `npm run testfront` → **14/14**
  (1 new); lint 0 errors (1 pre-existing warning).
- **Unit tests:** parser fixtures for CSQ (incl. 99-unknown), CREG
  (home/roaming/denied/CEREG), COPS (named + no-network), CPSI (LTE full
  field set incl. RSRP/SINR, NO SERVICE), CGPADDR (quoted/unquoted/0.0.0.0);
  AT queue ordering, OK/CME-ERROR termination, timeout rejection; usage
  accumulation + counter-reset + persistence across reload + reset; settings
  validation (baud/interval/interface/APN); console guards; enable with a
  missing port (error surfaces, no crash, clean disable).
- **Integration against `python/fake-sim7600.py`** (pty emulating the AT
  port, full dev server): enabling the monitor populated the entire status
  block — `available: true`, signal `-71 dBm (68%) RSRP -85 SINR 15`,
  `Registered (home)`, operator `TestTel`, `LTE EUTRAN-BAND3`, IP
  `10.64.12.34`; the emulator log shows the expected command sequence
  (`ATE0`, `+CSQ`, `+CREG?`, `+COPS?`, `+CPSI?`, `+CGPADDR=1`). AT console
  round-tripped `AT+CPSI?`; manual reconnect returned `$QCRMCALL: 1,V4`.
- **Auto-reconnect scenario:** emulator variant reporting `0.0.0.0` →
  exactly one reconnect within the backoff window, with
  `AT+CGDCONT=1,"IP","testapn"` sent before the dial; reconnect count and
  timestamp surfaced in status.
- **REST smoke:** defaults, invalid-baud 422, valid save + persistence,
  console rejections (non-AT command; port closed), usage reset,
  enable-with-missing-port error path, disable.

## Needs on-device verification (Pi 4 / Pi Zero 2 W + SIM7600G)

See `docs/ONDEVICE-CHECKLIST.md` → Feature 4:

1. RNDIS mode enumeration (`usb0` + 4 ttyUSB ports), ModemManager absent.
2. Real-SIM status population (operator, band, RSSI/RSRP/SINR, WAN IP).
3. Usage counters vs carrier-reported usage; persistence across reboot.
4. Auto-reconnect after a forced drop (`AT+CFUN=4`/`1` or antenna pull).
5. APN applied on reconnect (`AT+CGDCONT?`).
6. AT console on real hardware.
7. Port contention with mavlink-router/PPP; telemetry running concurrently.
8. Boot auto-start; USB replug recovery.
9. Zero 2 W CPU headroom with polling active during a video stream.
