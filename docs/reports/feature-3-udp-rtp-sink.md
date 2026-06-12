# Feature 3 report: UDP (RTP/H.264) video sink

**Branch:** `feature/udp-rtp-sink` (commit `2417849`), merged `--no-ff` into `dev` (`de405e5`)
**Status:** complete, WSL-verified end-to-end; on-device items at the end
**Docs:** `docs/UDP-VIDEO.md` · checklist: `docs/ONDEVICE-CHECKLIST.md` (Feature 3 section)

## The bug

The Photo and Video page has always offered an RTP/RTSP transport selector,
and `python/video-server.py` has always implemented both transports. But the
wiring between them was broken: selecting RTP set `videoSettings.useUDP` and
Node passed the destination (`--udp=IP:PORT`) to the video server — **without
`--transport=RTP`**. The video server's argparse default is `RTSP`, and the
RTSP code paths ignore `--udp` entirely. Result: the UI claimed RTP streaming,
an RTSP server silently started on :8554 instead, and **nothing was ever sent
to the UDP destination**.

For this project's architecture (Mission Planner behind CGNAT, all traffic
through a VPN) RTP push is the primary video mode, so this fix unblocks the
whole video-over-LTE path.

## The fix

`server/videostream.js`: new `getTransportArgs()` returns
`['--transport=RTP', '--udp=IP:PORT']` when `useUDP` is set, else
`['--transport=RTSP', '--udp=0']` (preserving the previous placeholder).
`startVideoStreaming()` spreads it into the spawn args in place of the old
inline `--udp` construction. One method, one call site — the RTP/RTSP
behaviour in `video-server.py` (including multicast handling, receive-string
hints, and the Feature 1/2 RTP paths) needed no changes; it was correct and
unreachable.

## What changed, by file

| File | Change |
|---|---|
| `server/videostream.js` | `getTransportArgs()`; used in `startVideoStreaming()` |
| `server/videostream.test.js` | `#getTransportArgs()` — default, RTSP, RTP cases |
| `docs/UDP-VIDEO.md` (new) | RTP mode usage (MP/QGC/gst receive), VPN push rationale, fix note |
| `docs/ONDEVICE-CHECKLIST.md` | Feature 3 section (8 items) |
| `CHANGELOG.md` | Fix bullet |

## How it was tested (WSL)

- **CI parity:** `rm -f ./config/settings.json && npm run build && npm run
  testback` → **113/113 passing**; `npm run testfront` → **13/13**; lint 0
  errors (1 pre-existing warning).
- **Python direct:** `video-server.py --transport=RTP --udp=127.0.0.1:5601`
  with `testsrc` → a bound UDP socket received 369 packets in 4 s, RTP
  version bits = 2; `PIPELINE:` marker shows the generated pipeline +
  `udpsink host=127.0.0.1 port=5601`.
- **Node end-to-end (the actual bug path):** scratch script instantiating
  `videoStream` with `useUDP: true` and calling `startVideoStreaming()` →
  spawn args contained `--transport=RTP`; **735 RTP v2 packets** received on
  the destination socket; `lastPipeline` captured with the appended udpsink.
- **RTSP regression:** same script with `useUDP: false` → args
  `--transport=RTSP --udp=0`, RTSP server announced on :8554, **0 UDP
  packets** — behaviour identical to before the fix.
- **Composition with Feature 2:** custom pipeline enabled for the device +
  RTP mode → custom string used (`pattern=smpte` visible in `lastPipeline`),
  udpsink auto-appended, 1186 packets received, no fallback.
- (Composition with Feature 1's dual-source RTP path was verified live in the
  Feature 1 smoke tests; it is gated on the same `--transport=RTP` flag this
  fix now supplies.)

## Needs on-device verification (Pi 4 / Pi Zero 2 W)

See `docs/ONDEVICE-CHECKLIST.md` → Feature 3:

1. RTP from IMX708 with `v4l2h264enc` (hardware encode) to a LAN destination.
2. RTP into Mission Planner over WireGuard/ZeroTier on the LTE link
   (destination = GCS VPN address); latency check.
3. RTP into QGroundControl.
4. RTSP regression on device.
5. RTP + camera switcher runtime A↔B over the VPN.
6. RTP + custom pipeline with hardware elements.
7. Multicast destination (LAN).
8. Camera-heartbeat stream auto-discovery (`VIDEO_STREAM_TYPE_RTPUDP`).
