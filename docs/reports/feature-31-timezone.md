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

## Needs on-device

- [ ] `sudo timedatectl set-timezone` must be runnable **non-interactively** by the
  service user — add it to the rpanion sudoers drop-in (alongside the existing
  `shutdown`/networking grants) so the POST doesn't hang on a password prompt.
- [ ] On the Pi: pick a new zone on the About page → **Set Time Zone** → confirm
  `timedatectl` reflects it and log timestamps shift; reboot → zone persists.

## Related: upstream #228 (camera parameter control)

Already covered by this fork. Upstream #228 asks for control over camera
parameters; the fork's **Video Pipeline Editor** (feature reports for the
custom-pipelines work) exposes full per-camera GStreamer pipeline overrides —
a strict superset of fixed parameter knobs — so no separate work is needed.
