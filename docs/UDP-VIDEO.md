# UDP (RTP/H.264) video streaming

Rpanion can push video as an RTP/H.264 (or H.265) stream over UDP to a fixed
destination, instead of serving RTSP. This is the preferred mode for
GCS-over-VPN setups (e.g. Mission Planner via WireGuard over LTE): the drone
*pushes* to the GCS address, no inbound connection to the Pi is needed, and
there is no RTSP session setup latency.

## Usage

On the *Photo and Video* page set **Streaming Transport** to `RTP`, then enter
the **destination** IP and port — for a VPN setup, the GCS's VPN address
(e.g. `10.8.0.2:5600`). Multicast destination addresses are supported.

Receive with Mission Planner (right-click HUD → Video → *Set GStreamer
Source*), QGroundControl (Video Source: UDP h.264, matching port), or:

```bash
gst-launch-1.0 udpsrc port=5600 \
  caps='application/x-rtp, media=(string)video, clock-rate=(int)90000, encoding-name=(string)H264' ! \
  rtph264depay ! h264parse ! avdec_h264 ! videoconvert ! autovideosink sync=false
```

The exact receive strings for all three are shown on the page once streaming.

Notes:

- RTP mode composes with the [camera switcher](CAMERA-SWITCHER.md) (dual-source
  pipeline pushes to the same destination) and with
  [custom pipelines](CUSTOM-PIPELINES.md) (the `udpsink` is appended to your
  string automatically).
- A camera-heartbeat `VIDEO_STREAM_INFORMATION` in RTP mode advertises
  `VIDEO_STREAM_TYPE_RTPUDP` with the destination port.

## Fixed in this fork

Upstream, selecting `RTP` in the UI set the destination (`--udp=IP:PORT`) but
never passed `--transport=RTP` to the video server, which defaults to RTSP —
so an RTSP server was silently started and nothing was sent to the UDP
destination. `videostream.js` now passes `--transport` explicitly
(`getTransportArgs()`).
