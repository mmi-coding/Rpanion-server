# Feature 15 report: Role-based access control (admin / read-only)

**Branch:** `feature/rbac` (commit `6417611`), merged `--no-ff` into `dev` (`140e60c`)
**Status:** complete, WSL-verified (unit + e2e); live auth flow on-device (auth is off in dev mode)
**Docs:** `docs/USER-ROLES.md` · `docs/ROADMAP.md` (parity tracker) · `docs/ONDEVICE-CHECKLIST.md` (feature 15)

First of the UAVcast-Pro-6 parity features (see `docs/ROADMAP.md §B1`).

## What was built

Two access levels — **admin** (full access) and **readonly** (view-only) —
enforced on the **backend**, not just hidden in the UI.

### Backend (`server/userLogin.js`, `server/index.js`)

- `userLogin`: new `getUserRole()` and `updateRole()`; `addUser(username,
  password, role='readonly')`; `getAllUsers()` normalises pre-RBAC users (no
  `role`) to `admin`.
- Login embeds `role` in the JWT. `authenticateToken` enforces it at a single
  chokepoint: a read-only user's mutating request (`POST`) returns
  `403 Read-only user: write access denied`, except the allowlisted `/api/auth`
  and `/api/logout`. `GET` is always allowed. Because it lives in
  `authenticateToken`, every protected route is covered without touching each
  handler.
- `/api/auth` now returns `role`; `/api/createUser` accepts an optional validated
  `role`; new `/api/updateUserRole` endpoint.
- **Backward compatible:** existing single-admin installs (role-less `user.json`)
  keep working as admin. New users default to least-privilege (`readonly`).

### Frontend (`src/userManagement.jsx`, `src/AppRouter.jsx`)

- User Management: a **Role** column, a per-user **Make Admin / Make Read-only**
  toggle, and a **Role** selector in *Add User*. The page picked up the
  self-documenting treatment (a `HelpSection` explaining roles + `HelpTip`s),
  since modifying it brings it under the fork UI rule.
- AppRouter shows a **read-only** badge beside the sidebar title when the
  signed-in user is read-only.

## Design notes

- **Single chokepoint over per-route guards.** Folding the check into
  `authenticateToken` (gate on `method === 'POST'`, since every mutating route in
  this API is a POST) keeps the diff tiny and makes every branch reachable for
  100% coverage — no untestable `HEAD`/socket branches.
- **Why on-device for the live flow.** `authenticateToken` is a passthrough when
  `NODE_ENV=development` (and the unit suite runs in dev mode), so the role block
  is unit-tested by flipping `NODE_ENV=production` with minted JWTs; the real
  browser flow needs a production install (auth enabled) — tracked on-device.

## How it was tested (WSL)

- Backend `covback`: **100/100/100/100** (3907 stmts / 1992 branches / 595 fns /
  3809 lines). New `userLogin` RBAC unit tests use an isolated temp users file;
  new `index.auth` tests mint distinct-username read-only/admin JWTs (so they
  never collide with the admin/admin tokens blacklisted elsewhere) and assert
  403/200 across the write-block, allowlist, GET and admin paths.
- Frontend `covfront`: **100/100/100/100** (753 tests). New tests cover the role
  column, both toggle directions, `handleChangeRole` success/!ok/catch, the role
  selector flowing into `createUser`, and the AppRouter read-only badge.
- e2e: **52 passed** — User Management added to the self-documenting-UI set.
- `npm run lint` clean.
- Also fixed `.gitignore` so `config/settings.json` is actually ignored (the
  `./config/...` prefix never matched, so the generated file showed as untracked).

## Needs on-device (see `docs/ONDEVICE-CHECKLIST.md` feature 15)

Create a read-only user; confirm the badge, that every page still loads, and that
attempting any change returns 403; verify a direct `POST /api/*` with the
read-only token is 403 while `GET` is 200; toggle the role both ways as admin;
confirm a pre-RBAC `user.json` still logs in as admin.
