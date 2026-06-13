# Feature 16 report: Settings backup & restore

**Branch:** `feature/settings-backup`, merged `--no-ff` into `dev` (`9acbc5b`)
**Status:** complete, WSL-verified (unit + e2e); device round-trip on-device
**Docs:** `docs/BACKUP-RESTORE.md` · `docs/ROADMAP.md` · `docs/ONDEVICE-CHECKLIST.md` (feature 16)

Second UAVcast-Pro-6 parity feature (`docs/ROADMAP.md §B1`).

## What was built

Backup and restore of the companion computer's configuration, on the existing
**About** page (next to "Reset All Settings"), mirroring the established
`resetsettings`/`getlogs` patterns rather than introducing a new page.

- **Backend (`server/index.js`)** — two endpoints beside `resetsettings`:
  - `GET /api/settingsbackup` — streams `config/settings.json` as an attachment
    (`rpanion-settings.json`); returns `{}` if the file doesn't exist yet; 500 on
    fs error.
  - `POST /api/settingsrestore` — validates the body is a JSON **object** (rejects
    arrays/null/non-objects with 400), writes it verbatim to `settingsFile`,
    returns a restart-required message; 500 on write error.
- **Frontend (`src/about.jsx`)** — a *Backup & Restore* block in *Controls*:
  `getBackup()` (blob download, mirrors `getlogs`), a hidden file input +
  `handleRestoreFile()` (reads via `file.text()`, `JSON.parse`, POSTs), a status
  alert, and the self-documenting treatment (HelpSection + HelpTips) for the new
  controls.

User accounts (`config/user.json`) are intentionally excluded — managed on the
User Management page (RBAC, feature 15).

## How it was tested (WSL)

- Backend `covback`: **100/100/100/100** (3929 stmts). New route tests
  (`server/index.routes.test.js`) stub `fs` narrowly (the existing `resetsettings`
  approach) to cover backup file-exists / file-missing / fs-error, and restore
  valid-object / non-object-400 / write-error-500.
- Frontend `covfront`: **100/100/100/100** (frontend tests +7). New `about.test.jsx`
  cases cover `getBackup` (blob download, mirroring the Download-Logs test) and
  restore no-file / valid (+5s message clear) / server-failure / fallback-message /
  invalid-JSON-catch. happy-dom supports `File.prototype.text()`, used to drive the
  reader; the file input is exercised via `Object.defineProperty(input,'files')` +
  a dispatched `change` event.
- e2e: **52 passed**. `npm run lint` clean.

## Notes

- `mockFetch` responses don't implement `.blob()`, so the backup download test
  hand-rolls `vi.stubGlobal('fetch', ...)` (same as the Download-Logs test).
- Restore is a mutating POST → with RBAC enabled, read-only users get 403.

## Needs on-device (see `docs/ONDEVICE-CHECKLIST.md` feature 16)

Back up a real configured Pi, restore on a freshly-flashed one and confirm
settings return after a restart; clone A→B; confirm read-only users can't restore.
