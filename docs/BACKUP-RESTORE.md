# Settings backup & restore

The **About** page (`/about` → *Controls* → *Backup & Restore*) can download and
restore this companion computer's configuration.

- **Backup Settings** — downloads `config/settings.json` (network, video, modem,
  NTRIP, cellular, camera, etc.) as `rpanion-settings.json`.
- **Restore Settings** — pick a previously downloaded file; it overwrites the
  current `config/settings.json`. **Restart the application** afterwards for the
  changes to take effect.

User accounts (`config/user.json`, including password hashes and roles — see
[USER-ROLES.md](USER-ROLES.md)) are **not** included in a settings backup; they
are managed separately on the User Management page.

## API

| Endpoint | Method | Notes |
|---|---|---|
| `/api/settingsbackup` | GET | Streams `config/settings.json` as an attachment (`{}` if none yet) |
| `/api/settingsrestore` | POST | Body must be a JSON **object** (the settings); written verbatim. Returns 400 for a non-object, 500 on write error |

Both require authentication; with RBAC enabled, restore is a mutating POST so
**read-only users cannot restore** (the backend returns 403).

## Use cases

- Re-flashing a device: back up first, restore after.
- Cloning configuration to a second identical device.
- Snapshotting a known-good config before experimenting.
