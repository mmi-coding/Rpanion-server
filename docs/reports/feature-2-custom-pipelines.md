# Feature 2 report: Custom/editable video pipelines

**Branch:** `feature/custom-pipelines` (commit `6f5564e`), merged `--no-ff` into `dev` (`1c6c436`)
**Status:** complete, WSL-verified; on-device items listed at the end
**Docs:** `docs/CUSTOM-PIPELINES.md` · checklist: `docs/ONDEVICE-CHECKLIST.md` (Feature 2 section)

## What was built

Per-camera-device custom GStreamer pipeline overrides, edited from a new
**Video Pipeline Editor** page, with a strict safety model: a bad pipeline can
be rejected at save time, rejected at stream start, and even if it slips
through, the video server falls back to the auto-generated pipeline at runtime
— the stream never bricks.

Contract: the user writes a full `gst-launch`-style string ending in an RTP
payloader named `pay0`. RTSP mode consumes `pay0` directly; RTP/UDP mode
appends the `udpsink` automatically. Pipelines are keyed by the exact device
string from the Photo and Video page and stored in settings under
`customPipelines.map` as `{device: {enabled, pipeline}}`.

To make authoring easy, the actually-used pipeline of the last stream is
reported back to the UI ("Last used pipeline" + *Copy into editor*, which
strips a trailing `udpsink`), so users start from a known-good string.

## What changed, by file

| File | Change |
|---|---|
| `python/video-server.py` | `--custom-pipeline` arg; `validateCustomPipeline()` dry-run (parse + `pay0` check); on failure prints `CUSTOM-PIPELINE-FALLBACK:<reason>` and reverts to the generated pipeline; custom string used by the RTSP factory (`MyFactory`) and the single-RTP launch path; actually-used pipeline printed as `PIPELINE:<str>`; custom pipeline suppresses `--secondary` dual-source mode |
| `python/validate-pipeline.py` (new) | Standalone validator: prints one JSON `{"valid": true\|false\|null, "reason"}`; `null` when gi/GStreamer bindings are missing (env-tolerant) |
| `server/customPipelines.js` (new) | Settings-backed store: `getAllPipelines/getPipeline/getActivePipeline/setPipeline/validatePipeline`; enabling validates first via `execFile` (no shell, 20 s timeout); empty disabled entry = delete |
| `server/videostream.js` | `getCustomPipelineArgs()` builds `--custom-pipeline=` for the active device; suppresses secondary-source args when custom is active (logged); stdout markers captured into `lastPipeline` / `customPipelineFallback` |
| `server/index.js` | `GET /api/custompipelines`, `POST /api/custompipelinemodify`, `POST /api/custompipelinevalidate` — all behind `authenticateToken`, express-validator shape checks (device 1–256, pipeline ≤ 8192) |
| `server/paths.js` | `getPythonPath()` now resolves a local `python/.venv` (after the deployment venv, before bare `python3`) — fixes dev boxes where the default `python3` is a pyenv shim without gi |
| `src/pipelineeditor.jsx` (new) | Editor page: device/pipeline/enabled form, Validate (success/danger/warning for true/false/null), saved-pipelines table with Edit/Delete, last-used pipeline + copy, fallback warning |
| `src/AppRouter.jsx` | Route + sidebar link "Video Pipeline Editor" |
| `server/customPipelines.test.js` (new) | 8 backend tests |
| `server/videostream.test.js` | `#getCustomPipelineArgs()` test (4 scenarios) |
| `src/App.test.jsx` | Render test for the editor page |
| `CHANGELOG.md`, `docs/CUSTOM-PIPELINES.md`, `docs/ONDEVICE-CHECKLIST.md` | Docs |

## Design decisions

- **Three validation layers, env-tolerant.** The save-time validator returns
  `valid: null` (not an error) when gi is unavailable, so the feature works on
  dev boxes without GStreamer python bindings — the runtime fallback in
  `video-server.py` is the real safety net and always runs where it matters.
- **Precedence: custom pipeline > camera switcher.** Both features can be
  configured for the same device; the custom pipeline wins and the conflict is
  logged. This keeps Feature 1 and Feature 2 composable without surprising
  pipeline mutations.
- **`pay0` contract instead of free-form sinks.** Reusing GStreamer's RTSP
  factory convention means one string works for both RTSP and RTP transports;
  the transport-specific sink stays Rpanion's responsibility.
- **No shell anywhere.** Validation uses `execFile` with an argv array; the
  pipeline string is never interpolated into a shell command.

## How it was tested (WSL)

- **CI parity:** `rm -f ./config/settings.json && npm run build && npm run
  testback` → **112/112 passing**; `npm run testfront` → **13/13 passing**;
  `npm run lint` → 0 errors (1 pre-existing warning).
- **Python smoke (live GStreamer):**
  - RTP mode with a valid `--custom-pipeline` → `PIPELINE:` marker shows the
    custom string, stream runs.
  - Broken custom pipeline → `CUSTOM-PIPELINE-FALLBACK:<reason>` printed,
    generated pipeline streams.
  - Custom + `--secondary` together → secondary ignored with notice.
  - Custom RTSP with a live `rtspsrc` client → client received the stream
    (rc=124 timeout-bounded run, no errors).
- **REST smoke (dev server, NODE_ENV=development):** all six scenarios —
  GET empty map; validate-good → `{"valid":true}`; validate-bad →
  `{"valid":false}` with the pay0 reason; save-enabled-good persisted;
  save-enabled-bad rejected with `gst_parse_error` and map unchanged;
  delete emptied the map.
- **Unit tests:** disabled-store, delete-by-empty, bad-args rejection,
  validator bad-element/missing-pay0, enable-good persists across reload,
  enable-invalid rejected (assertion skipped when validator returns `null`).

## Needs on-device verification (Pi 4 / Pi Zero 2 W)

See `docs/ONDEVICE-CHECKLIST.md` → Feature 2:

1. Custom pipeline with real hardware elements (`libcamerasrc` IMX708 →
   `v4l2h264enc` → `rtph264pay name=pay0`) in RTSP and RTP modes; confirm
   hardware encode (CPU, pipeline print).
2. Pi Zero 2 W CPU headroom at 1080p30 with a custom string.
3. Save-time validator runs with gi available in the deployed venv
   (`/usr/share/rpanion-server/app/python/.venv`) — should return
   `true`/`false`, not `null`.
4. Runtime fallback behaviour on device with a deliberately broken pipeline.
5. Last-used-pipeline → copy → edit → restart loop with a real camera.
6. Custom-over-switcher precedence with both features configured.
