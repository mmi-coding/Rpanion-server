# User roles (RBAC)

Rpanion-server supports two access levels, managed on the **User Management**
page (`/users`).

| Role | Can view pages | Can change settings |
|---|---|---|
| **admin** | ✅ | ✅ |
| **readonly** | ✅ | ❌ (server returns HTTP 403) |

## How it is enforced

Roles are enforced on the **backend**, not just hidden in the UI:

- A user's role is stored in `config/user.json` (`"role": "admin" | "readonly"`)
  and embedded in the JWT at login.
- `authenticateToken` (server/index.js) blocks any mutating request from a
  read-only user: a non-allowlisted `POST` returns `403 Read-only user: write
  access denied`. The only `POST`s a read-only user may make are `/api/auth` and
  `/api/logout`.
- `GET` requests (reads) are always allowed for authenticated users.

Because enforcement is server-side, a read-only user cannot bypass it by calling
the API directly.

> Auth (and therefore RBAC) is **disabled** when the server runs with
> `NODE_ENV=development` — see [E2E-TESTING.md](E2E-TESTING.md). Roles only take
> effect in a production deployment.

## Migration / defaults

- Users created before RBAC (no stored role) are treated as **admin**, so
  existing single-admin installs are unaffected.
- New users created from the UI default to **readonly** (least privilege); pick
  *Admin* in the role selector to grant full access.

## Managing roles (UI)

On `/users`:

- The **Role** column shows each user's current role.
- **Make Admin / Make Read-only** toggles a user's role (`POST /api/updateUserRole`).
- The **Add User** dialog has a **Role** selector.
- When you are signed in as a read-only user, a **read-only** badge appears next
  to the sidebar title.

## API

| Endpoint | Method | Notes |
|---|---|---|
| `/api/login` | POST | Returns a JWT whose payload includes `role` |
| `/api/auth` | POST | Response includes `role` (undefined when auth is disabled) |
| `/api/createUser` | POST | Accepts optional `role` (`admin`/`readonly`, default `readonly`) |
| `/api/updateUserRole` | POST | `{ username, role }` — admin only |
