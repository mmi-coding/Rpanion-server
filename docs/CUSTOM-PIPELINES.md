# Custom Video Pipelines

Replace the auto-generated GStreamer pipeline with your own, per camera
device, from the **Video Pipeline Editor** page. Use this when the built-in
pipeline builder doesn't expose the knob you need — denoise/AWB tuning on
`libcamerasrc`, custom encoder parameters, software cropping, overlays, test
hybrids, etc.

## The contract

- Write a full `gst-launch`-style pipeline string, **without** the final
  network sink.
- The pipeline must end in an RTP payloader **named `pay0`**, e.g.

  ```
  libcamerasrc camera-name=/base/soc/i2c0mux/i2c@1/imx708@1a !
  video/x-raw,width=1920,height=1080,framerate=30/1,format=NV12 !
  v4l2h264enc extra-controls="controls,video_bitrate=2000000,repeat_sequence_header=1" !
  video/x-h264,level=(string)4 ! h264parse !
  rtph264pay config-interval=1 name=pay0 pt=96
  ```

- In **RTSP** mode the RTSP server consumes `pay0` directly.
- In **RTP/UDP** mode a `udpsink` for the configured destination is appended
  automatically — never add your own.
- The pipeline is keyed by **camera device name** and must exactly match the
  device string used on the *Photo and Video* page (e.g. `/dev/video0` or
  `/base/soc/i2c0mux/i2c@1/imx708@1a`).

## Validation and fallback (three layers)

1. **Save-time dry run** — when you enable a pipeline (or press *Validate*),
   it is parsed by GStreamer (`Gst.parse_launch`) and checked for a `pay0`
   element. Invalid pipelines cannot be saved as enabled. If the GStreamer
   python bindings are unavailable, validation is skipped with a warning
   (`valid: null`) and the save is allowed.
2. **Stream-start dry run** — `video-server.py` re-validates before using a
   custom pipeline.
3. **Runtime fallback** — if the custom pipeline fails to parse or lacks
   `pay0` at stream start, the video server falls back to the auto-generated
   pipeline and keeps streaming. The reason is shown as a warning on the
   Pipeline Editor page. A custom pipeline can never brick the video stream.

## Precedence and interactions

- A custom pipeline **overrides the camera switcher's dual-source mode** for
  that device — `--secondary` args are not passed when a custom pipeline is
  active (a notice is logged).
- Multi-RTSP mode ignores custom pipelines.
- Resolution / bitrate / rotation settings from the *Photo and Video* page
  are **not** applied to a custom pipeline — bake them into the string.
- Changes apply on the **next stream start**.

## Editing workflow

1. Start a stream normally from the *Photo and Video* page.
2. Open *Video Pipeline Editor* — the **Last used pipeline** section shows
   the exact string the running stream used (the `PIPELINE:` print from the
   video server). Press *Copy into editor* (a trailing `udpsink` from RTP
   mode is stripped automatically).
3. Edit, *Validate*, set the device name, tick *Enabled*, *Save*.
4. Restart the stream.

## API

- `GET /api/custompipelines` —
  `{pipelines: {device: {enabled, pipeline}}, lastPipeline, customPipelineFallback}`
- `POST /api/custompipelinemodify` — `{device, enabled, pipeline}`;
  enabling triggers validation, errors are returned with the unchanged map.
  Saving an empty, disabled pipeline deletes the entry.
- `POST /api/custompipelinevalidate` — `{pipeline}` →
  `{valid: true|false|null, reason}`

## Implementation notes

- `server/customPipelines.js` — settings store
  (`customPipelines.map`), save-time validation via
  `python/validate-pipeline.py` (execFile, no shell, 20 s timeout)
- `server/videostream.js` — `getCustomPipelineArgs()` passes
  `--custom-pipeline=<str>` to the video server; captures the
  `PIPELINE:`/`CUSTOM-PIPELINE-FALLBACK:` stdout markers into
  `lastPipeline`/`customPipelineFallback`
- `python/video-server.py` — `validateCustomPipeline()` dry-run; custom
  string used by the RTSP factory or the RTP launch path; prints the
  actually-used pipeline as `PIPELINE:<str>`

## Bench test (no cameras needed)

```bash
npm run server &
curl -s -X POST localhost:3001/api/custompipelinevalidate \
  -H 'Content-Type: application/json' \
  -d '{"pipeline":"videotestsrc is-live=true ! video/x-raw,width=640,height=480 ! videoconvert ! x264enc tune=zerolatency bitrate=1000 ! rtph264pay config-interval=1 name=pay0 pt=96"}'
# → {"error":null,"valid":true,"reason":""}
```

Or directly against the video server:

```bash
python3 ./python/video-server.py --videosource=testsrc --width=640 --height=480 \
  --fps=15 --bitrate=1000 --transport=RTSP \
  --custom-pipeline='videotestsrc is-live=true pattern=ball ! video/x-raw,width=640,height=480 ! videoconvert ! x264enc tune=zerolatency bitrate=1000 ! rtph264pay config-interval=1 name=pay0 pt=96'
```

The stream shows the "ball" pattern (custom) instead of the default; with a
broken `--custom-pipeline` it prints `CUSTOM-PIPELINE-FALLBACK:<reason>` and
streams the generated pipeline instead.
