# Web UI end-to-end test plan

Test plan for the Rpanion-server (fork) web UI, produced with the official
Playwright planner workflow (`.claude/agents/playwright-test-planner.md`) by
exploring the live dev stack (Vite `:3000` → Express `:3001`, `NODE_ENV=development`).

**Environment assumptions (always a fresh/blank state):**

- Backend runs in development mode, so **auth is disabled** (`/api/auth` →
  `{authEnabled:false}`). The login/logout flow therefore cannot be exercised in
  WSL and is tracked in `docs/ONDEVICE-CHECKLIST.md`.
- No companion hardware is attached (no flight controller, modem, camera, GPS),
  so subsystem-dependent pages render in their **degraded** state. That degraded
  state is itself an assertion target.
- React controlled-input *warnings* logged by upstream pages are expected and are
  **not** treated as failures; only uncaught page exceptions (real crashes) fail a test.

---

## 1. Application shell and navigation

**Seed:** fresh browser at `/`.

### 1.1 Home page loads with the status overview
1. Navigate to `/`.
2. Expect the sidebar (`#sidebar-wrapper`) to be visible.
3. Expect the `System Status Overview` heading (h1) to be visible.

### 1.2 Sidebar lists every navigation link
1. Navigate to `/`.
2. Expect each of the 17 navigation links to be visible (Home … User Management).
3. Expect **no** "Logout" link (auth disabled in dev mode).

### 1.3 Every sidebar link opens its page
For each route, starting from `/`:
1. Click the sidebar link by its exact text.
2. Expect the URL to match the route path.
3. Expect the page's h1 title to be visible.

### 1.4 Unknown route shows the 404 page
1. Navigate to `/does-not-exist`.
2. Expect the `404 - Page Not Found` heading to be visible.
3. Expect the sidebar to still be visible (shell intact).

### 1.5 Logout route is unavailable in dev mode
1. Navigate to `/logoutconfirm`.
2. Expect the `404 - Page Not Found` heading (route not registered when auth is disabled).

---

## 2. Page smoke — every route renders

**Seed:** direct navigation to each route (exercises Vite SPA fallback).

For each of the 16 content routes:
1. Navigate directly to the route path.
2. Expect the sidebar to be visible.
3. Expect the route's h1 title to be visible.
4. Expect no uncaught page exception during load.

---

## 3. Graceful degradation without companion hardware

**Seed:** direct navigation; no hardware attached.

### 3.1 Photo and Video reports OpenCV unavailable
1. Navigate to `/video`.
2. Expect a notice matching `OpenCV is not installed` to be visible.

### 3.2 LTE Modem reports monitoring disabled
1. Navigate to `/ltemodem`.
2. Expect a notice matching `Modem monitoring is disabled` to be visible.

### 3.3 Home shows disconnected / inactive subsystem statuses
1. Navigate to `/`.
2. Expect `Not connected` (MAVLink) to be visible.
3. Expect at least one `Inactive` status to be visible.

---

## 4. Self-documenting UI (fork rule)

**Seed:** direct navigation to each fork-added/-modified page
(`/cameraswitcher`, `/cellulartuning`, `/ltemodem`, `/pipelineeditor`).
See `docs/UI-GUIDELINES.md`.

### 4.1 Fork pages expose HelpTips on controls
1. Navigate to the page.
2. Expect at least one help marker (`[aria-label="help"]`) to be present.

### 4.2 The HelpSection collapses/expands
1. Navigate to the page.
2. Locate the first HelpSection toggle (`a[role="button"][aria-expanded]`).
3. Expect it to start collapsed (`aria-expanded="false"`).
4. Click it; expect `aria-expanded="true"`.
5. Click it again; expect `aria-expanded="false"`.

### 4.3 Hovering a HelpTip reveals its tooltip
1. Navigate to `/cameraswitcher`.
2. Hover the first help marker.
3. Expect a tooltip (`role="tooltip"`) to become visible.
