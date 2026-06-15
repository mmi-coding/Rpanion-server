# Feature 31 — Set the system time zone from the web UI (#224)

Implements upstream feature request [#224](https://github.com/stephendade/Rpanion-server/issues/224):
let the operator change the companion computer's time zone from the web UI instead
of SSH-ing in to run `timedatectl`. A new **Time Zone** section on the About page
lists every IANA zone, shows the current one, and applies a new selection.

## What was built

- **`server/aboutInfo.ts`**
  - `getTimezone(callback)` — returns `{ current, zones }` straight from Node's
    `Intl` (`Intl.DateTimeFormat().resolvedOptions().timeZone` +
    `Intl.supportedValuesOf('timeZone')`), no shell-out.
  - `setTimezone(timezone, callback)` — **validates** the requested zone against
    `Intl.supportedValuesOf('timeZone')` first (the value is interpolated into a
    shell command, so only exact known zones are allowed → `'Invalid timezone'`
    otherwise), then runs `sudo timedatectl set-timezone <zone>`. `error || stderr`
    is surfaced to the caller.
- **`server/routes/system.ts`**
  - `GET /api/timezone` (authenticated) → `getTimezone`.
  - `POST /api/timezone` (authenticated, `check('timezone').isString()`) →
    `setTimezone`, responding `{ error: <msg|null> }`.
- **`src/about.jsx`** — a self-documenting **Time Zone** section: a `<Form.Select>`
  of the IANA list (defaulting to the current zone), a **Set Time Zone** button
  (disabled until a *different* zone is chosen), a `HelpTip` on each control and a
  `HelpSection` explaining that the change runs `timedatectl` and persists across
  reboots. Success shows a confirmation that auto-clears after 5 s; backend or
  network errors are surfaced inline.

## Design notes

- **Zone list from `Intl`, not the shell.** Node ships the full IANA database, so
  the list and the "current" value need no `timedatectl`/`ls /usr/share/zoneinfo`
  shell-out and read identically in WSL and on the Pi.
- **Allow-list before exec.** `setTimezone` rejects anything not in
  `supportedValuesOf('timeZone')` before building the command — the one untrusted
  value never reaches the shell unless it exactly matches a known zone.
- The `Set Time Zone` button is gated on `selectedTimezone !== timezone` so a
  redundant apply can't fire; the success handler updates the displayed current
  zone to the applied one.

## Verification — WSL-verified

- `lint` 0 · `typecheck` 0 · `covback` **100/100/100/100** · `covfront`
  **100/100/100/100**. Added backend cases (getTimezone shape; setTimezone
  invalid-zone / success / non-zero exit / stderr) and frontend cases (load into
  the select; apply success with auto-clear; backend-error surfaced; fetch-failure
  caught).
- `getTimezone` reads real values in WSL; `setTimezone`'s `timedatectl` path is the
  only part that needs the Pi (and a sudoers grant).

## Sudoers (shipped)

`sudo timedatectl set-timezone` must run **non-interactively** for the service
user. `debian/postinst` now grants `/usr/bin/timedatectl set-timezone *` in the
rpanion sudoers drop-in (alongside the existing `shutdown`/networking grants), so
a fresh install / redeploy has it automatically — no manual step. (The original
deploy lacked this, so an on-device redeploy is required to pick it up.)

## Verified on-device (Pi 4, 2026-06-15)

- [x] Redeployed; the `/etc/sudoers.d/allow-vpn-control` drop-in now contains the
  `/usr/bin/timedatectl set-timezone *` grant.
- [x] Exercised the **exact feature path** as the service user:
  `sudo -u rpanion sudo -n timedatectl set-timezone Europe/London` ran
  password-less, `timedatectl` reflected `Europe/London`, then restored to
  `Europe/Paris` (the box's zone). So `setTimezone()`'s `sudo timedatectl …`
  succeeds non-interactively on-device.
- [x] `GET/POST /api/timezone` are served (401 unauthenticated — route present).

Remaining (manual, needs an app login + a browser): click **Set Time Zone** on
the About page and confirm the UI round-trip; reboot to confirm persistence
(inherent to `timedatectl`).

## Related: upstream #228 (camera parameter control)

Already covered by this fork. Upstream #228 asks for control over camera
parameters; the fork's **Video Pipeline Editor** (feature reports for the
custom-pipelines work) exposes full per-camera GStreamer pipeline overrides —
a strict superset of fixed parameter knobs — so no separate work is needed.
