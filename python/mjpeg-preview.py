#!/usr/bin/env python3
# Live MJPEG preview of a camera, written to stdout as a
# multipart/x-mixed-replace stream. Used by the HUD editor to show the camera
# feed behind the OSD layout (an <img> in the browser renders the stream). The
# Node side (videostream.ts startCameraPreview) spawns this, sets the matching
# Content-Type boundary on the HTTP response, and pipes our stdout to it.
#
# Source selection mirrors video-server.py: libcamera for the Pi CSI camera,
# v4l2 for USB. Pre-compressed H264/H265 sources can't be previewed (they'd need
# a decode), matching the raw-video constraint of the burned-in HUD.
import argparse
import sys
import signal
import gi
gi.require_version("Gst", "1.0")
from gi.repository import Gst, GLib

# the multipart boundary; the Node side sends the same value in the
# Content-Type header so the browser can split frames
BOUNDARY = "rpanionpreviewframe"


def build_source(device, width, height, fmt):
    # returns a GStreamer source sub-pipeline producing raw video (or None if the
    # source can't be previewed without a decode)
    if device == "testsrc":
        return "videotestsrc is-live=true pattern=ball ! video/x-raw,width={0},height={1}".format(width, height)
    if device.startswith("/base/soc/i2c") or device.startswith("/base/axi/pcie"):
        # Pi CSI camera via libcamera (Bullseye+)
        return "libcamerasrc camera-name={0} ! video/x-raw,width={1},height={2}".format(device, width, height)
    if fmt == "image/jpeg":
        # native MJPEG USB camera - decode so we can (re)encode uniformly
        return "v4l2src device={0} io-mode=2 ! image/jpeg,width={1},height={2} ! jpegdec".format(device, width, height)
    if fmt == "video/x-raw":
        return "v4l2src device={0} io-mode=2 ! video/x-raw,width={1},height={2}".format(device, width, height)
    return None


def build_pipeline(device, width, height, fmt, rotation):
    src = build_source(device, width, height, fmt)
    if src is None:
        return None
    parts = [src, "videoconvert"]
    flip = {90: "videoflip video-direction=90r",
            180: "videoflip video-direction=180",
            270: "videoflip video-direction=90l"}.get(rotation)
    if flip:
        parts.append(flip)
    parts.append("jpegenc quality=60")
    parts.append("multipartmux boundary={0}".format(BOUNDARY))
    parts.append("fdsink fd=1 sync=false")
    return " ! ".join(parts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", required=True)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--format", default="video/x-raw")
    ap.add_argument("--rotation", type=int, default=0)
    args = ap.parse_args()

    Gst.init(None)
    pipeline_str = build_pipeline(args.device, args.width, args.height, args.format, args.rotation)
    if pipeline_str is None:
        sys.stderr.write("preview not supported for source format '{0}'\n".format(args.format))
        sys.exit(2)
    sys.stderr.write("PREVIEW PIPELINE: " + pipeline_str + "\n")
    sys.stderr.flush()

    pipeline = Gst.parse_launch(pipeline_str)
    pipeline.set_state(Gst.State.PLAYING)
    loop = GLib.MainLoop()

    def stop(*_a):
        pipeline.set_state(Gst.State.NULL)
        loop.quit()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    bus = pipeline.get_bus()
    bus.add_signal_watch()
    bus.connect("message", lambda _b, m: stop() if m.type in (Gst.MessageType.EOS, Gst.MessageType.ERROR) else None)
    try:
        loop.run()
    except KeyboardInterrupt:
        stop()


if __name__ == "__main__":
    main()
