#!/usr/bin/env python3
# -*- coding:utf-8 vi:ts=4:noexpandtab
# Simple RTSP server. Run as-is or with a command-line to replace the default pipeline
# Taken from https://github.com/tamaggo/gstreamer-examples/blob/master/test_gst_rtsp_server.py
# gst-launch-1.0 rtspsrc location=rtsp://127.0.0.1:8554/video latency=0 ! decodebin ! autovideosink

import argparse
import json
import os
from datetime import datetime
import platform
import ipaddress
import sys
from typing import List
import subprocess
import gi

gi.require_version("Gst", "1.0")
gi.require_version("GstRtsp", "1.0")
gi.require_version("GstRtspServer", "1.0")
from gi.repository import Gst, GstRtspServer, GLib


# Returns true if this is a Raspi5 or later
# https://www.raspberrypi.com/documentation/computers/raspberry-pi.html#raspberry-pi-revision-codes
def is_pi_5_or_later() -> bool:
    cmd = "cat /proc/cpuinfo | awk '/Revision/ {print $3}'"
    revcode = subprocess.check_output(cmd, shell=True)

    if revcode == "":
        return False

    try:
        code = int(revcode, 16)
        new = (code >> 23) & 0x1
        model = (code >> 4) & 0xff
        # mem = (code >> 20) & 0x7

        if new and model >= 0x17:
            return True
        else:
            return False
    except:
        return False


def is_multicast(ip: str) -> bool:
    try:
        ip_obj = ipaddress.ip_address(ip)
        # Multicast addresses are in the range 224.0.0.0 to 239.255.255.255
        return ip_obj.is_multicast
    except ValueError:
        # If the IP address is not valid, return False
        return False


# ---- Cellular low-latency tuning ----
# --lowlatency trades a little quality for a stream that degrades gracefully
# on constrained cellular links: ~1 second GOP, constrained rate control,
# single-buffer leaky queues and a non-blocking udpsink. All generated
# encoders are named enc0 so their bitrate can be retuned at runtime via the
# stdin control channel (see doBitrate)
LOW_LATENCY = False

# Telemetry HUD style (#173 follow-up): 'text' (textoverlay readout) or 'graphic'
# (an SVG artificial-horizon via rsvgoverlay — no extra dependency, the element
# renders the SVG data we feed it over the control channel).
HUD_STYLE = "text"


def hudOverlayElement():
    # the overlay element inserted as name=hud0 (its text/data is set at runtime)
    if HUD_STYLE == "graphic":
        return "rsvgoverlay name=hud0 fit-to-frame=true"
    return "textoverlay name=hud0 text=\"\" valignment=top halignment=left font-desc=\"Monospace, 12\" shaded-background=true ypad=4 xpad=8"


def _hud_num(v, suffix, digits=0):
    if v is None:
        return "--"
    return ("{0:.%df}" % digits).format(v) + suffix


def _hud_int(v, prefix="", suffix=""):
    if v is None:
        return prefix + "--"
    return prefix + str(int(round(v))) + suffix


def _hud_mmss(v):
    if v is None:
        return "--:--"
    v = int(v)
    return "{0}:{1:02d}".format(v // 60, v % 60)


_GPS_FIX = {0: "NO", 1: "NO", 2: "2D", 3: "3D", 4: "DGPS", 5: "RTKf", 6: "RTKx", 7: "STAT", 8: "PPP"}


def _hud_escape(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def hudElementText(t, f):
    # the value string for one OSD element type. Mirrors the labels in
    # server/hudOverlay.ts. f is the telemetry field dict.
    if t == "alt":
        return "ALT " + _hud_num(f.get("alt"), "m")
    if t == "altRel":
        return "AGL " + _hud_num(f.get("altRel"), "m")
    if t == "spd":
        return "SPD " + _hud_num(f.get("spd"), "", 1)
    if t == "airspeed":
        return "AIR " + _hud_num(f.get("airspeed"), "", 1)
    if t == "hdg":
        return "HDG " + ("--" if f.get("hdg") is None else str(int(round(f.get("hdg")))))
    if t == "climb":
        return "VS " + _hud_num(f.get("climb"), "", 1)
    if t == "throttle":
        return "THR " + ("--" if f.get("throttle") is None else str(int(round(f.get("throttle")))) + "%")
    if t == "batV":
        return "BAT " + _hud_num(f.get("batV"), "V", 1)
    if t == "batPct":
        return ("--" if f.get("batPct") is None else str(f.get("batPct"))) + "%"
    if t == "current":
        return _hud_num(f.get("current"), "A", 1)
    if t == "mode":
        return f.get("mode") or "MODE --"
    if t == "armed":
        return "ARMED" if f.get("armed") else "DISARM"
    if t == "gps":
        fix = f.get("gpsFix")
        sats = f.get("gpsSats")
        return "GPS " + ("--" if fix is None else _GPS_FIX.get(fix, "?")) + "/" + ("--" if sats is None else str(sats))
    # ── attitude ──
    if t == "turnRate":
        return "TRN " + _hud_int(f.get("turnRate"), suffix="°/s")
    if t == "gload":
        return _hud_num(f.get("gload"), "G", 1)
    # ── altitude & speed ──
    if t == "rangefinder":
        return "RNG " + _hud_num(f.get("rangefinder"), "m", 1)
    # ── position & gps ──
    if t == "lat":
        return "LAT " + _hud_num(f.get("lat"), "", 5)
    if t == "lon":
        return "LON " + _hud_num(f.get("lon"), "", 5)
    if t == "hdop":
        return "HDOP " + _hud_num(f.get("hdop"), "", 1)
    if t == "gpsCourse":
        return "CRS " + _hud_int(f.get("gpsCourse"), suffix="°")
    # ── navigation ──
    if t == "homeDist":
        return "HOME " + _hud_int(f.get("homeDist"), suffix="m")
    if t == "wpDist":
        return "WP " + _hud_int(f.get("wpDist"), suffix="m")
    if t == "wpNum":
        return _hud_int(f.get("wpNum"), prefix="WP#")
    if t == "xtrack":
        return "XTK " + _hud_num(f.get("xtrack"), "m", 1)
    if t == "altError":
        return "AERR " + _hud_num(f.get("altError"), "m", 1)
    # ── battery & power ──
    if t == "mah":
        return _hud_int(f.get("mah"), suffix="mAh")
    if t == "battTemp":
        return "BT " + _hud_int(f.get("battTemp"), suffix="°C")
    if t == "battTimeRemaining":
        return "BTL " + _hud_mmss(f.get("battTimeRemaining"))
    if t == "cpuLoad":
        return "CPU " + _hud_int(f.get("cpuLoad"), suffix="%")
    # ── link ──
    if t == "rcRssi":
        return "RC " + _hud_int(f.get("rcRssi"), suffix="%")
    if t == "radioRssi":
        return "RSSI " + _hud_int(f.get("radioRssi"))
    if t == "radioRemRssi":
        return "RRSSI " + _hud_int(f.get("radioRemRssi"))
    if t == "radioNoise":
        return "NOISE " + _hud_int(f.get("radioNoise"))
    if t == "dropRate":
        return "DROP " + _hud_num(f.get("dropRate"), "%", 0)
    # ── environment ──
    if t == "windSpeed":
        return "WND " + _hud_num(f.get("windSpeed"), "m/s", 1)
    if t == "windDir":
        return "WDIR " + _hud_int(f.get("windDir"), suffix="°")
    if t == "baroTemp":
        return "TMP " + _hud_int(f.get("baroTemp"), suffix="°C")
    if t == "pressure":
        return "PRS " + _hud_int(f.get("pressure"), suffix="hPa")
    # ── status ──
    if t == "timer":
        return _hud_mmss(f.get("timer"))
    if t == "clock":
        return datetime.now().strftime("%H:%M:%S")
    # ── health ──
    if t == "vibe":
        return "VIB " + _hud_int(f.get("vibe"))
    if t == "vibeClip":
        return "CLIP " + _hud_int(f.get("vibeClip"))
    # ── modem GPS (SIM7600) ──
    if t == "modemFix":
        v = f.get("modemFix")
        return "mGPS " + ("--" if v is None else str(v))
    if t == "modemLat":
        return "mLAT " + _hud_num(f.get("modemLat"), "", 5)
    if t == "modemLon":
        return "mLON " + _hud_num(f.get("modemLon"), "", 5)
    if t == "modemAlt":
        return "mALT " + _hud_int(f.get("modemAlt"), suffix="m")
    return ""


def _hud_icon(t, x, y, col="#7fe9c8", scale=1):
    # a small (~30px) glyph for an OSD element, drawn just left of its value.
    # Several element types share a concept (battery, gauge), so map to a glyph.
    # `col`/`scale` are the element's per-icon colour + size (defaults match the
    # original fixed cyan, 1x look); the glyph is scaled about its (x, y) anchor.
    if t in ("batV", "batPct", "current", "mah", "battTemp", "battTimeRemaining"):
        g = ('<g stroke="{0}" stroke-width="3" fill="none">'
             '<rect x="{1}" y="{2}" width="26" height="16" rx="2"/>'
             '<rect x="{3}" y="{4}" width="3" height="8" fill="{0}"/></g>').format(col, x, y - 8, x + 26, y - 4)
    elif t in ("alt", "altRel", "rangefinder"):
        g = '<path d="M {1} {2} l 12 -22 l 12 22 Z" fill="{0}"/>'.format(col, x, y + 2)
    elif t in ("climb", "gload", "turnRate"):
        g = '<path d="M {1} {2} l 12 -20 l 12 20" stroke="{0}" stroke-width="3" fill="none"/>'.format(col, x, y)
    elif t in ("spd", "airspeed", "throttle", "cpuLoad", "dropRate"):
        g = '<path d="M {1} {2} a 14 14 0 0 1 28 0" stroke="{0}" stroke-width="3" fill="none"/>'.format(col, x, y)
    elif t in ("rcRssi", "radioRssi", "radioRemRssi", "radioNoise"):
        g = ('<g stroke="{0}" stroke-width="2" fill="none"><line x1="{1}" y1="{2}" x2="{1}" y2="{3}"/>'
             '<path d="M {4} {3} a 10 10 0 0 1 14 0"/></g>').format(col, x + 9, y - 16, y, x + 2)
    elif t in ("windSpeed", "windDir", "baroTemp", "pressure", "vibe", "vibeClip"):
        g = '<path d="M {1} {2} q 8 -10 16 0 t 16 0" stroke="{0}" stroke-width="2" fill="none"/>'.format(col, x, y - 4)
    elif t in ("homeDist", "wpDist", "xtrack", "altError"):
        g = '<path d="M {1} {2} l 9 -12 l 9 12 v 10 h -18 Z" stroke="{0}" stroke-width="2" fill="none"/>'.format(col, x, y - 2)
    elif t in ("hdg", "gpsCourse"):
        g = ('<g stroke="{0}" stroke-width="2" fill="none"><circle cx="{1}" cy="{2}" r="13"/>'
             '<path d="M {1} {3} l 4 8 l -8 0 Z" fill="{0}" stroke="none"/></g>').format(col, x + 13, y - 4, y - 14)
    elif t in ("mode", "timer", "clock", "wpNum"):
        g = '<circle cx="{1}" cy="{2}" r="12" stroke="{0}" stroke-width="3" fill="none"/>'.format(col, x + 13, y - 4)
    elif t in ("gps", "hdop", "lat", "lon", "modemFix", "modemLat", "modemLon", "modemAlt"):
        g = ('<g stroke="{0}" stroke-width="2" fill="none"><circle cx="{1}" cy="{2}" r="4" fill="{0}"/>'
             '<path d="M {3} {4} a 10 10 0 0 1 16 0"/></g>').format(col, x + 13, y - 4, x + 5, y - 4)
    elif t == "armed":
        g = '<path d="M {1} {2} l 13 -6 l 13 6 v 10 l -13 8 l -13 -8 Z" stroke="{0}" stroke-width="2" fill="none"/>'.format(col, x, y - 14)
    else:
        g = '<circle cx="{1}" cy="{2}" r="3" fill="{0}"/>'.format(col, x + 10, y - 4)
    return _scaled(g, x, y, scale)


def _scaled(content, cx, cy, scale):
    # uniformly scale a graphic about its centre (cx, cy) so the same drawing code
    # can be made bigger/smaller from the editor's per-element scale
    if not scale or abs(scale - 1.0) < 1e-3:
        return content
    return '<g transform="translate({0} {1}) scale({2}) translate({3} {4})">{5}</g>'.format(
        cx, cy, scale, -cx, -cy, content)


# centre "aircraft" markers for the artificial horizon (INAV crosshair-style choices)
def _marker_svg(cx, cy, marker, color):
    if marker == "crosshair":
        return ('<g stroke="{c}" stroke-width="4" fill="none">'
                '<line x1="{0}" y1="{cy}" x2="{1}" y2="{cy}"/><line x1="{2}" y1="{cy}" x2="{3}" y2="{cy}"/>'
                '<line x1="{cx}" y1="{4}" x2="{cx}" y2="{5}"/><line x1="{cx}" y1="{6}" x2="{cx}" y2="{7}"/></g>').format(
            cx - 46, cx - 16, cx + 16, cx + 46, cy - 46, cy - 16, cy + 16, cy + 46, c=color, cx=cx, cy=cy)
    if marker == "dot":
        return ('<circle cx="{cx}" cy="{cy}" r="7" fill="{c}"/>'
                '<circle cx="{cx}" cy="{cy}" r="16" stroke="{c}" stroke-width="3" fill="none"/>').format(cx=cx, cy=cy, c=color)
    if marker == "caret":
        return '<path d="M {0} {1} L {2} {3} L {4} {1}" fill="none" stroke="{5}" stroke-width="5"/>'.format(
            cx - 30, cy - 16, cx, cy + 10, cx + 30, color)
    if marker == "drone":
        rings = "".join('<circle cx="{0}" cy="{1}" r="9"/>'.format(px, py)
                        for px, py in [(cx - 34, cy - 34), (cx + 34, cy - 34), (cx - 34, cy + 34), (cx + 34, cy + 34)])
        return ('<g stroke="{c}" stroke-width="4" fill="none">'
                '<line x1="{0}" y1="{1}" x2="{2}" y2="{3}"/><line x1="{0}" y1="{3}" x2="{2}" y2="{1}"/>{r}</g>').format(
            cx - 34, cy - 34, cx + 34, cy + 34, c=color, r=rings)
    # wings (classic, default)
    return ('<path d="M {0} {1} l -70 0 l 20 22 M {0} {1} l 70 0 l -20 22" '
            'stroke="{2}" stroke-width="5" fill="none"/>').format(cx, cy, color)


def _horizon_svg(cx, cy, f, scale=1, style="ladder", color="#00e0a0", marker="wings", marker_color="#ffcf40"):
    roll = f.get("roll") or 0
    pitch = f.get("pitch") or 0
    ppd = 8
    extras = []
    if style == "ladder":
        for d in (-20, -10, 10, 20):
            ry = cy + d * ppd
            extras.append('<line x1="{0}" y1="{1}" x2="{2}" y2="{1}" stroke="{3}" stroke-width="3"/>'.format(cx - 90, ry, cx + 90, color))
            extras.append('<text x="{0}" y="{1}" fill="{3}" font-size="26" font-family="monospace">{2}</text>'.format(cx + 100, ry + 8, abs(d), color))
    elif style == "ticks":
        for d in (-10, 10):
            ry = cy + d * ppd
            for tx in (cx - 30, cx + 30):
                extras.append('<line x1="{0}" y1="{1}" x2="{0}" y2="{2}" stroke="{3}" stroke-width="3"/>'.format(tx, ry - 8, ry + 8, color))
    # style == "line" → just the horizon line
    horizon = ('<g transform="rotate({0} {1} {2}) translate(0 {3})">'
               '<line x1="{5}" y1="{2}" x2="{6}" y2="{2}" stroke="{7}" stroke-width="4"/>'
               '{4}</g>').format(-roll, cx, cy, pitch * ppd, "".join(extras), cx - 1000, cx + 1000, color)
    return _scaled(horizon + _marker_svg(cx, cy, marker, marker_color), cx, cy, scale)


def _compass_svg(cx, cy, f, scale=1, color="#00e0a0"):
    # a horizontal heading tape centred at cx,cy with a fixed pointer
    hdg = f.get("hdg")
    if hdg is None:
        hdg = 0
    ppd = 6  # px per degree
    base = int(round(hdg / 10.0)) * 10
    ticks = []
    for d in range(base - 60, base + 70, 10):
        hx = cx + (d - hdg) * ppd
        deg = d % 360
        ticks.append('<line x1="{0}" y1="{1}" x2="{0}" y2="{2}" stroke="{3}" stroke-width="2"/>'.format(hx, cy - 10, cy, color))
        lbl = {0: "N", 90: "E", 180: "S", 270: "W"}.get(deg, str(deg))
        ticks.append('<text x="{0}" y="{1}" fill="{3}" font-size="22" font-family="monospace" text-anchor="middle">{2}</text>'.format(hx, cy - 16, lbl, color))
    pointer = '<path d="M {0} {1} l -8 -12 l 16 0 Z" fill="#ffcf40"/>'.format(cx, cy + 12)
    return _scaled('<g>' + "".join(ticks) + pointer + '</g>', cx, cy, scale)


def _homedir_svg(cx, cy, f, scale=1, color="#ffcf40"):
    # an arrow pointing toward home, relative to the current heading
    homeDir = f.get("homeDir")
    hdg = f.get("hdg") or 0
    rel = 0 if homeDir is None else (homeDir - hdg)
    arrow = ('<g transform="rotate({0} {1} {2})">'
             '<path d="M {1} {3} L {4} {5} L {6} {5} Z" fill="{7}"/></g>').format(
        rel, cx, cy, cy - 22, cx - 14, cy + 14, cx + 14, color)
    return _scaled(arrow, cx, cy, scale)


# fallback layout if none has been pushed yet (mirrors hudOverlay.defaultHudLayout)
_DEFAULT_HUD_ELEMENTS = [
    {"type": "horizon", "enabled": True, "x": 0.5, "y": 0.5, "icon": False, "scale": 1.8},
    {"type": "alt", "enabled": True, "x": 0.86, "y": 0.06, "icon": True},
    {"type": "spd", "enabled": True, "x": 0.04, "y": 0.06, "icon": True},
    {"type": "hdg", "enabled": True, "x": 0.46, "y": 0.06, "icon": False},
    {"type": "batV", "enabled": True, "x": 0.78, "y": 0.92, "icon": True},
    {"type": "mode", "enabled": True, "x": 0.04, "y": 0.92, "icon": False},
    {"type": "gps", "enabled": True, "x": 0.46, "y": 0.92, "icon": True},
]


def buildHudSvg(layout, fields):
    # a customizable OSD as an SVG string (16:9 viewBox; rsvgoverlay fit-to-frame
    # scales it onto the video). layout = {global:{font,size,color},
    # elements:[{type,enabled,x,y,icon, font?,size?,color?}]}. A per-element
    # font/size/color overrides the global text style.
    fields = fields or {}
    layout = layout or {}
    g = layout.get("global") or {}
    g_font = g.get("font") or "monospace"
    g_size = g.get("size") or 34
    g_color = g.get("color") or "#ffffff"
    elements = layout.get("elements")
    if not elements:
        elements = _DEFAULT_HUD_ELEMENTS
    parts = []
    for el in elements:
        if not el.get("enabled"):
            continue
        t = el.get("type")
        x = (el.get("x") or 0) * 1600
        y = (el.get("y") or 0) * 900
        scale = el.get("scale") or 1
        if t == "horizon":
            parts.append(_horizon_svg(x, y, fields, scale, el.get("style") or "ladder",
                                      el.get("color") or "#00e0a0", el.get("marker") or "wings",
                                      el.get("markerColor") or "#ffcf40"))
            continue
        if t == "compass":
            parts.append(_compass_svg(x, y, fields, scale, el.get("color") or "#00e0a0"))
            continue
        if t == "homeDir":
            parts.append(_homedir_svg(x, y, fields, scale, el.get("color") or "#ffcf40"))
            continue
        font = el.get("font") or g_font
        size = int(el.get("size") or g_size)
        color = el.get("color") or g_color
        tx = x
        if el.get("icon"):
            icon_scale = el.get("iconScale") or 1
            parts.append(_hud_icon(t, x, y, el.get("iconColor") or "#7fe9c8", icon_scale))
            tx = x + 30 * icon_scale + 12  # clear the (scaled ~30-wide) glyph + a gap
        parts.append('<text x="{0}" y="{1:.0f}" fill="{2}" font-size="{3}" font-family="{4}">{5}</text>'.format(
            tx, y + size * 0.3, color, size, _hud_escape(font), _hud_escape(hudElementText(t, fields))))
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">' + "".join(parts) + '</svg>'


def gopFrames(framerate) -> int:
    # one keyframe per second; assume 30 fps if the rate is unspecified
    return framerate if framerate is not None and framerate > 0 else 30


def nvEncStr(codec, bitrate, framerate) -> str:
    # Jetson hardware encoder. codec is "h264" or "h265", bitrate in kbps
    gop = gopFrames(framerate) if LOW_LATENCY else 5
    return "nvv4l2{0}enc name=enc0 bitrate={1} iframeinterval={2} preset-level=1 insert-sps-pps=true".format(
        codec, bitrate*1000, gop)


def v4l2EncStr(bitrate, framerate) -> str:
    # Pi (4 and earlier) hardware H264 encoder, bitrate in kbps
    gop = gopFrames(framerate) if LOW_LATENCY else 5
    controls = "controls,repeat_sequence_header=1,h264_profile=4,video_bitrate={0},h264_i_frame_period={1}".format(
        bitrate*1000, gop)
    if LOW_LATENCY:
        # CBR - don't let the rate spike above target on scene changes
        controls += ",video_bitrate_mode=1"
    return "v4l2h264enc name=enc0 extra-controls=\"{0}\"".format(controls)


def swEncStr(compression, bitrate, framerate) -> str:
    # software encoder (x264/x265), bitrate in kbps
    if LOW_LATENCY:
        keyint = gopFrames(framerate)
        # constrain the VBV buffer to ~0.5s of video so the encoder
        # can't burst far above the target bitrate
        extra = " vbv-buf-capacity=500" if compression == "H264" else ""
    else:
        keyint = 25
        extra = ""
    threads = " threads=0" if compression == "H264" else ""
    return "{0}enc name=enc0 tune=zerolatency bitrate={1} speed-preset=superfast key-int-max={2}{3}{4}".format(
        "x264" if compression == "H264" else "x265", bitrate, keyint, threads, extra)


def payQueueStr() -> str:
    # the queue feeding the RTP payloader. In low-latency mode never let
    # encoded frames pile up - drop instead (recovery is at most one GOP)
    if LOW_LATENCY:
        return "queue max-size-buffers=1 leaky=downstream"
    return "queue"


def udpSinkStr(udp) -> str:
    host = udp.split(':')[0]
    port = udp.split(':')[1]
    sink = "udpsink host={0} port={1}".format(host, port)
    if is_multicast(host):
        sink += " auto-multicast=true"
    if LOW_LATENCY:
        # don't clock-wait on buffers - send as soon as they arrive
        sink += " sync=false"
    return sink


def getPipeline(device, height, width, bitrate, format, rotation, framerate, timestamp, compression, hud=False) -> str:
    pipeline: List[str] = []

    # -1 is no framerate specified
    if framerate == -1:
        framestr = ""
    else:
        framestr = ",framerate={0}/1".format(framerate)

    # start with device
    if device == "testsrc":
        pipeline.append("videotestsrc pattern=ball")
        pipeline.append("video/x-raw,width={0},height={1}{2}".format(width, height, framestr))
    elif device.startswith("rtsp://"):
        # rtsp streaming source
        pipeline.append("rtspsrc location=\"{0}\" is-live=true latency=0 udp-buffer-size=212992".format(device))
        if format == "video/x-h264":
            pipeline.append("rtph264depay")
        elif format == "video/x-h265":
            pipeline.append("rtph265depay")
        else:
            print("Error: Need to specify video/x-h264 or video/x-h265 for rtsp source in --format")
            return ""
    elif device in ["argus0", "argus1"]:
        pipeline.append("nvarguscamerasrc sensor-id={0}".format(device[-1]))
        pipeline.append("video/x-raw(memory:NVMM),width={0},height={1},format=NV12{2}".format(width, height, framestr))
    elif device in ["0rpicam", "1rpicam"]:
        # Old (Buster and earlier) can use the rpicamsrc interface
        ts = ""
        if timestamp:
            ts = "annotation-mode=12 annotation-text-colour=0"
        pipeline.append("rpicamsrc {2} bitrate={0} rotation={1} camera-number={3} preview=false".format(
            bitrate*1000, rotation, ts, device[0]))
        pipeline.append("video/x-h264,width={0},height={1}{2}".format(
            width, height, framestr))
    elif device.startswith("/base/soc/i2c") or device.startswith("/base/axi/pcie"):
        # Bullseye uses the new libcamera interface ... so need a different pipeline
        # Note that the Pi5 uses a different format
        if is_pi_5_or_later():
            format = "RGBx"
        else:
            format = "I420"  # https://forums.raspberrypi.com/viewtopic.php?t=93560
        pipeline.append("libcamerasrc camera-name={0}".format(device))
        pipeline.append("capsfilter caps=video/x-raw,width={0},height={1},format={3}{2}".format(width, height, framestr, format))
        pipeline.append("queue max-size-buffers=3 leaky=downstream")
    elif format == "video/x-raw":
        # Use io-mode=2 (mmap) for better performance
        pipeline.append("v4l2src device={0} io-mode=2".format(device))
        pipeline.append("videorate drop-only=true")
        pipeline.append("{2},width={0},height={1}{3}".format(width, height, format, framestr))
        pipeline.append("queue max-size-buffers=2 leaky=downstream")
    elif format == "video/x-h264":
        pipeline.append("v4l2src device={0}".format(device))
        pipeline.append("{2},width={0},height={1}{3}".format(width, height, format, framestr))
    elif format == "image/jpeg":
        # Use io-mode=2 (mmap) for better performance with JPEG sources
        pipeline.append("v4l2src device={0} io-mode=2".format(device))
        # Drop frames immediately if processing can't keep up
        pipeline.append("videorate drop-only=true max-rate={0}".format(
            framerate if framerate != -1 else 30))
        pipeline.append("{2},width={0},height={1}{3}".format(
            width, height, format, framestr))
        # Reduce buffer to 2 and make it leaky to drop old frames faster
        pipeline.append("queue max-size-buffers=2 leaky=downstream")
        # Use hardware JPEG decoder if available, otherwise software
        if Gst.ElementFactory.find("v4l2jpegdec"):
            # Hardware decoder with output buffer optimization
            pipeline.append("v4l2jpegdec capture-io-mode=4")
        else:
            # Software decoder - allow error recovery
            pipeline.append("jpegdec max-errors=-1")
        # Output format from decoder - use I420 for better encoder compatibility
        pipeline.append("videoconvert n-threads=4")
        pipeline.append("video/x-raw,format=I420")
        # Add another small queue after decode to prevent blocking
        pipeline.append("queue max-size-buffers=2 leaky=downstream")
    else:
        print("Bad camera")
        return ""

    # now for rotations, overlays and compression, if required. Note we can't modify an x264 source stream
    if format not in ["video/x-h264", "video/x-h265"] and not device.startswith("rtsp://"):
        # now add rotations for not-jetson and not-legacy-pi-camera
        if device not in ["0rpicam", "1rpicam"] and 'tegra' not in platform.uname().release:
            if rotation == 90:
                pipeline.append("videoflip video-direction=90r")
            elif rotation == 180:
                pipeline.append("videoflip video-direction=180")
            elif rotation == 270:
                pipeline.append("videoflip video-direction=90l")

        # and then timestamps
        if timestamp and device not in ["0rpicam", "1rpicam"] and 'tegra' not in platform.uname().release:
            pipeline.append("videoconvert")
            pipeline.append("clockoverlay time-format=\"%d-%b-%Y %H:%M:%S\"")

        # telemetry HUD overlay (#173): a text readout updated live over the
        # stdin control channel. Raw-video only - a pre-compressed source can't
        # be overlaid without a decode/re-encode - and not on the Jetson NVMM path
        if hud and device not in ["0rpicam", "1rpicam"] and 'tegra' not in platform.uname().release:
            pipeline.append("videoconvert")
            pipeline.append(hudOverlayElement())

        # 3 options for H264: Rpi hardware compression (v4l2h264enc), Jetson hardware compression (nvv4l2h264enc)
        # or software compression (x264enc)
        # 2 options for H265: Jetson hardware compression (nvv4l2h265enc) or software compression (x265enc)
        # Use v4l2-ctl -d 11 --list-ctrls-menu to get v4l2h264enc options
        if (Gst.ElementFactory.find("nvv4l2h264enc") and compression == "H264") or (Gst.ElementFactory.find("nvv4l2h265enc") and compression == "H265"):
            # Jetson, with h/w rotation
            if rotation == 90:
                devrotation = "flip-method=3"
            elif rotation == 180:
                devrotation = "flip-method=2"
            elif rotation == 270:
                devrotation = "flip-method=1"
            else:
                devrotation = ""
            pipeline.append("nvvidconv {0}".format(devrotation))
            if timestamp:
                pipeline.append("clockoverlay time-format=\"%d-%b-%Y %H:%M:%S\"")
                pipeline.append("nvvidconv")
            if compression == "H265":
                pipeline.append(nvEncStr("h265", bitrate, framerate))
                pipeline.append("h265parse")
            elif compression == "H264":
                pipeline.append(nvEncStr("h264", bitrate, framerate))
                pipeline.append("h264parse")
        elif Gst.ElementFactory.find("v4l2h264enc") and compression == "H264" and not (device == "testsrc" or device.startswith("/dev/video")):
            # Pi or similar arm platforms running on RasPiOS. Note that Pi5 onwards don't support hardware encoding
            # Only use a higher h264 level if the bitrate requires it. I find that level 4.1 can be a little
            # crashy sometimes.
            # The hardware encoder doesn't support USB or testvideo sources realiably, so use software x264 instead
            if bitrate > 20000:
                level = "4.1"
            else:
                level = "4"
            pipeline.append("videoconvert")
            pipeline.append(v4l2EncStr(bitrate, framerate))
            pipeline.append("video/x-h264,profile=high,level=(string){0}".format(level))
            pipeline.append("h264parse")
        else:
            # s/w encoder - x86, Pi5, etc
            pipeline.append("videoconvert")
            if is_pi_5_or_later() and compression == "H264":
                pipeline.append("video/x-raw,format=NV12")
            else:
                pipeline.append("video/x-raw,format=I420")
            # testcamerasrc doesn't like leaky queues
            if device != "testsrc":
                pipeline.append("queue max-size-buffers=2 leaky=downstream")
            else:
                pipeline.append("queue max-size-buffers=2")
            if compression == "H264":
                # Use multiple threads for software encoding
                pipeline.append(swEncStr("H264", bitrate, framerate))
            elif compression == "H265":
                pipeline.append(swEncStr("H265", bitrate, framerate))

        # final rtp formatting
        pipeline.append(payQueueStr())
        if compression == "H264":
            pipeline.append("rtph264pay config-interval=1 name=pay0 pt=96")
        elif compression == "H265":
            pipeline.append("rtph265pay config-interval=1 name=pay0 pt=96")
    else:
        # just need to do rtp payloader for pre-compressed streams
        pipeline.append("queue")
        if format == "video/x-h264":
            pipeline.append("rtph264pay config-interval=1 name=pay0 pt=96")
        elif format == "video/x-h265":
            pipeline.append("rtph265pay config-interval=1 name=pay0 pt=96")

    # return as full string
    print(" ! ".join(pipeline))
    return " ! ".join(pipeline)


# ---- Custom (user-editable) pipelines ----
def validateCustomPipeline(pipeline_str):
    """Dry-run validation of a user-supplied pipeline string. Returns
    (ok, reason). The pipeline must parse and contain an RTP payloader
    named pay0 - the same contract as the generated pipelines."""
    if pipeline_str is None or pipeline_str.strip() == "":
        return False, "Empty pipeline"
    try:
        pipeline = Gst.parse_launch(pipeline_str)
    except Exception as e:
        return False, str(e).strip()
    if pipeline.get_by_name("pay0") is None:
        return False, "No element named pay0 in pipeline"
    pipeline.set_state(Gst.State.NULL)
    return True, "OK"


# ---- Runtime source switching (camera switcher) ----
# Shared state between the stdin control channel and the pipelines.
# switch_state holds the desired source; live_selectors holds the
# input-selector elements of all currently-running pipelines.
# live_pipelines holds every currently-running pipeline, for runtime
# encoder retuning (doBitrate)
switch_state = {"source": "A"}
live_selectors = []
live_pipelines = []
# latest HUD overlay text (#173), so a client connecting after the last update
# still shows the current readout
hud_state = {"text": "", "layout": None, "fields": {}}


def applySwitchToSelector(sel):
    # point one input-selector at the currently desired source
    padname = "sink_0" if switch_state["source"] == "A" else "sink_1"
    pad = sel.get_static_pad(padname)
    if pad is not None:
        sel.set_property("active-pad", pad)


def doSwitch(source):
    # change the desired source and apply to all running pipelines
    switch_state["source"] = source
    for sel in list(live_selectors):
        try:
            applySwitchToSelector(sel)
        except Exception as e:
            print("Switch error: {0}".format(e))
    print("SWITCHED:{0}".format(source), flush=True)


def doBitrate(kbps):
    # retune the bitrate of every encoder named enc0 in every running
    # pipeline. x264enc/x265enc take kbps; the nv/v4l2 hardware encoders
    # take bps (v4l2h264enc via an extra-controls restructure)
    applied = False
    for pipe in list(live_pipelines):
        enc = pipe.get_by_name("enc0")
        if enc is None:
            continue
        try:
            factory = enc.get_factory().get_name()
            if factory in ("x264enc", "x265enc"):
                enc.set_property("bitrate", kbps)
            elif factory in ("nvv4l2h264enc", "nvv4l2h265enc"):
                enc.set_property("bitrate", kbps * 1000)
            elif factory == "v4l2h264enc":
                controls = Gst.Structure.from_string(
                    "controls,video_bitrate={0}".format(kbps * 1000))[0]
                enc.set_property("extra-controls", controls)
            else:
                continue
            applied = True
        except Exception as e:
            print("Bitrate error: {0}".format(e))
    if applied:
        print("BITRATE:{0}".format(kbps), flush=True)
    else:
        # no running pipeline has a retunable encoder (e.g. passthrough
        # H264 source, custom pipeline without an enc0, no clients yet)
        print("BITRATE-NOENCODER:{0}".format(kbps), flush=True)


def setHudElement(el):
    # push the current text / SVG onto one hud0 overlay, whichever kind it is
    try:
        kind = el.get_factory().get_name()
        if kind == "rsvgoverlay":
            # re-render the OSD from the current layout + latest telemetry
            el.set_property("data", buildHudSvg(hud_state["layout"], hud_state["fields"]))
        else:
            el.set_property("text", hud_state["text"])
    except Exception as e:
        print("HUD error: {0}".format(e))


def _refreshHud():
    for pipe in list(live_pipelines):
        el = pipe.get_by_name("hud0")
        if el is not None:
            setHudElement(el)


def doHudText(text):
    # text-mode HUD: update the textoverlay readout on every running pipeline
    hud_state["text"] = text
    _refreshHud()


def doHudGraphic(fields):
    # graphic-mode HUD: store the latest telemetry and re-render
    hud_state["fields"] = fields
    _refreshHud()


def doHudLayout(layout):
    # graphic-mode HUD: store the OSD layout (from the editor) and re-render
    hud_state["layout"] = layout
    _refreshHud()


def applyHudToPipeline(element):
    # seed a freshly-prepared pipeline's HUD overlay so a late-joining client
    # doesn't show a blank readout until the next update
    el = element.get_by_name("hud0")
    if el is not None:
        setHudElement(el)


def handleControlLine(line):
    try:
        cmd = json.loads(line)
        if cmd.get("cmd") == "switch" and cmd.get("source") in ("A", "B"):
            doSwitch(cmd.get("source"))
        elif cmd.get("cmd") == "bitrate" and isinstance(cmd.get("kbps"), int) and 50 <= cmd.get("kbps") <= 100000:
            doBitrate(cmd.get("kbps"))
        elif cmd.get("cmd") == "hud" and isinstance(cmd.get("text"), str) and len(cmd.get("text")) <= 500:
            doHudText(cmd.get("text"))
        elif cmd.get("cmd") == "hud" and isinstance(cmd.get("hud"), dict):
            doHudGraphic(cmd.get("hud"))
        elif cmd.get("cmd") == "hudlayout" and isinstance(cmd.get("layout"), dict):
            doHudLayout(cmd.get("layout"))
        else:
            print("Unknown control command: {0}".format(line.strip()))
    except ValueError:
        print("Bad control command: {0}".format(line.strip()))


# partial line carried between stdinWatch invocations
stdin_buffer = {"data": ""}


def stdinWatch(fd, condition):
    # control channel from the Node server. One JSON object per line:
    # {"cmd": "switch", "source": "A"|"B"} - dual-source switching
    # {"cmd": "bitrate", "kbps": N} - runtime encoder bitrate change
    # Read the fd directly (not sys.stdin.readline) and drain every
    # complete line: multiple commands can arrive in a single pipe chunk,
    # and lines left in a buffered reader would never re-trigger the watch
    try:
        chunk = os.read(fd, 4096)
    except OSError:
        return False
    if chunk == b"":
        # EOF - parent has gone away. Stop watching
        return False
    stdin_buffer["data"] += chunk.decode("utf-8", errors="replace")
    while "\n" in stdin_buffer["data"]:
        line, stdin_buffer["data"] = stdin_buffer["data"].split("\n", 1)
        if line.strip() != "":
            handleControlLine(line)
    return True


def getNormalizedSourceBin(device, height, width, format, framerate, out_width, out_height, out_framerate) -> List[str]:
    """Build a source branch that always outputs fixed-caps raw video
    (I420, out_width x out_height), suitable for one input of an
    input-selector. Both branches having identical caps means the
    selector can switch without the encoder renegotiating."""
    bin: List[str] = []

    if framerate == -1:
        framestr = ""
    else:
        framestr = ",framerate={0}/1".format(framerate)

    if device == "testsrc":
        bin.append("videotestsrc is-live=true pattern=ball")
        bin.append("video/x-raw,width={0},height={1}{2}".format(width, height, framestr))
    elif device == "testsrc2":
        # a visually distinct second test pattern, for bench testing the switcher
        bin.append("videotestsrc is-live=true pattern=smpte")
        bin.append("video/x-raw,width={0},height={1}{2}".format(width, height, framestr))
    elif device.startswith("/base/soc/i2c") or device.startswith("/base/axi/pcie"):
        # libcamera (CSI) source
        if is_pi_5_or_later():
            srcformat = "RGBx"
        else:
            srcformat = "I420"
        bin.append("libcamerasrc camera-name={0}".format(device))
        bin.append("capsfilter caps=video/x-raw,width={0},height={1},format={3}{2}".format(width, height, framestr, srcformat))
        bin.append("queue max-size-buffers=3 leaky=downstream")
    elif format == "image/jpeg":
        # USB camera, MJPEG
        bin.append("v4l2src device={0} io-mode=2".format(device))
        bin.append("videorate drop-only=true max-rate={0}".format(framerate if framerate != -1 else 30))
        bin.append("image/jpeg,width={0},height={1}{2}".format(width, height, framestr))
        bin.append("queue max-size-buffers=2 leaky=downstream")
        if Gst.ElementFactory.find("v4l2jpegdec"):
            bin.append("v4l2jpegdec capture-io-mode=4")
        else:
            bin.append("jpegdec max-errors=-1")
    elif format == "video/x-raw":
        # USB camera, raw
        bin.append("v4l2src device={0} io-mode=2".format(device))
        bin.append("videorate drop-only=true")
        bin.append("video/x-raw,width={0},height={1}{2}".format(width, height, framestr))
        bin.append("queue max-size-buffers=2 leaky=downstream")
    else:
        print("Bad switcher source: {0} ({1})".format(device, format))
        return []

    # normalize both branches to identical caps
    bin.append("videoconvert")
    bin.append("videoscale")
    if out_framerate != -1:
        bin.append("videorate")
        bin.append("video/x-raw,format=I420,width={0},height={1},framerate={2}/1".format(out_width, out_height, out_framerate))
    else:
        bin.append("video/x-raw,format=I420,width={0},height={1}".format(out_width, out_height))
    return bin


def getEncodeTail(primary_device, bitrate, compression, framerate=-1) -> List[str]:
    """Encoder + RTP payloader for the switched (raw I420) stream. Mirrors the
    encoder selection logic of getPipeline()."""
    tail: List[str] = []

    if (Gst.ElementFactory.find("nvv4l2h264enc") and compression == "H264") or (Gst.ElementFactory.find("nvv4l2h265enc") and compression == "H265"):
        # Jetson hardware encoder
        tail.append("nvvidconv")
        if compression == "H265":
            tail.append(nvEncStr("h265", bitrate, framerate))
            tail.append("h265parse")
        else:
            tail.append(nvEncStr("h264", bitrate, framerate))
            tail.append("h264parse")
    elif Gst.ElementFactory.find("v4l2h264enc") and compression == "H264" and not is_pi_5_or_later() and \
            (primary_device.startswith("/base/soc/i2c") or primary_device.startswith("/base/axi/pcie")):
        # Pi hardware encoder (Pi4/Zero 2 W and earlier). Same usage restrictions
        # as getPipeline(): only used when the primary source is a CSI camera
        if bitrate > 20000:
            level = "4.1"
        else:
            level = "4"
        tail.append("videoconvert")
        tail.append(v4l2EncStr(bitrate, framerate))
        tail.append("video/x-h264,profile=high,level=(string){0}".format(level))
        tail.append("h264parse")
    else:
        # software encoder - x86, Pi5, etc
        tail.append("videoconvert")
        if is_pi_5_or_later() and compression == "H264":
            tail.append("video/x-raw,format=NV12")
        else:
            tail.append("video/x-raw,format=I420")
        tail.append("queue max-size-buffers=2 leaky=downstream")
        if compression == "H264":
            tail.append(swEncStr("H264", bitrate, framerate))
        elif compression == "H265":
            tail.append(swEncStr("H265", bitrate, framerate))

    tail.append(payQueueStr())
    if compression == "H264":
        tail.append("rtph264pay config-interval=1 name=pay0 pt=96")
    elif compression == "H265":
        tail.append("rtph265pay config-interval=1 name=pay0 pt=96")
    return tail


def getDualPipeline(primary_device, primary_format, height, width, framerate,
                    secondary_device, secondary_format, sec_height, sec_width, sec_framerate,
                    bitrate, rotation, timestamp, compression, hud=False, udp_sink="") -> str:
    """Build a dual-source pipeline with an input-selector, allowing runtime
    switching between the two sources without restarting the stream. The
    output caps follow the primary source's resolution/framerate."""
    # secondary capture size defaults to the primary's
    if sec_width == 0:
        sec_width = width
    if sec_height == 0:
        sec_height = height

    binA = getNormalizedSourceBin(primary_device, height, width, primary_format,
                                  framerate, width, height, framerate)
    binB = getNormalizedSourceBin(secondary_device, sec_height, sec_width, secondary_format,
                                  sec_framerate, width, height, framerate)
    if not binA or not binB:
        return ""

    # selected stream -> rotation -> timestamp -> encoder -> RTP
    tail: List[str] = ["input-selector name=sel sync-streams=false"]
    if rotation == 90:
        tail.append("videoflip video-direction=90r")
    elif rotation == 180:
        tail.append("videoflip video-direction=180")
    elif rotation == 270:
        tail.append("videoflip video-direction=90l")
    if timestamp:
        tail.append("videoconvert")
        tail.append("clockoverlay time-format=\"%d-%b-%Y %H:%M:%S\"")
    if hud:
        tail.append("videoconvert")
        tail.append(hudOverlayElement())
    tail.extend(getEncodeTail(primary_device, bitrate, compression, framerate))
    if udp_sink != "":
        tail.append(udp_sink)

    pipeline = " ! ".join(tail)
    pipeline += "  " + " ! ".join(binA + ["sel.sink_0"])
    pipeline += "  " + " ! ".join(binB + ["sel.sink_1"])

    print(pipeline)
    return pipeline


class SwitcherFactory(GstRtspServer.RTSPMediaFactory):
    """RTSP factory for the dual-source (switchable) pipeline. The pipeline is
    shared between clients (one set of cameras), and every prepared media
    registers its input-selector for runtime switching."""

    def __init__(self, pipeline_str):
        GstRtspServer.RTSPMediaFactory.__init__(self)
        self.pipeline_str = pipeline_str

        self.set_latency(0)
        self.set_buffer_size(0)
        self.set_transport_mode(GstRtspServer.RTSPTransportMode.PLAY)
        # share one pipeline between all clients - the cameras can only be opened once
        self.set_shared(True)

    def do_create_element(self, url):
        print("PIPELINE:{0}".format(self.pipeline_str), flush=True)
        return Gst.parse_launch(self.pipeline_str)

    def do_configure(self, media):
        self.set_eos_shutdown(True)
        element = media.get_element()
        # track the pipeline so runtime bitrate changes can reach it
        live_pipelines.append(element)
        applyHudToPipeline(element)
        sel = element.get_by_name("sel")
        if sel is not None:
            live_selectors.append(sel)
            # apply the current switch state to the new pipeline
            applySwitchToSelector(sel)
        media.connect("unprepared", self.onMediaUnprepared, sel, element)

    def onMediaUnprepared(self, media, sel, element):
        if sel in live_selectors:
            live_selectors.remove(sel)
        if element in live_pipelines:
            live_pipelines.remove(element)


class MyFactory(GstRtspServer.RTSPMediaFactory):
    def __init__(self, device, h, w, bitrate, format, rotation, framerate, timestamp, compression, custom_pipeline="", hud=False):
        GstRtspServer.RTSPMediaFactory.__init__(self)
        self.device = device
        self.height = h
        self.width = w
        self.bitrate = bitrate
        self.format = format
        self.rotation = rotation
        self.framerate = framerate
        self.timestamp = timestamp
        self.compression = compression
        self.custom_pipeline = custom_pipeline
        self.hud = hud

        # Configure for low latency streaming
        self.set_latency(0)  # Minimize latency
        self.set_buffer_size(0)  # Use default but don't accumulate
        self.set_transport_mode(GstRtspServer.RTSPTransportMode.PLAY)

    def do_create_element(self, url):
        if self.custom_pipeline != "":
            pipeline_str = self.custom_pipeline
        else:
            pipeline_str = getPipeline(self.device, self.height, self.width, self.bitrate, self.format, self.rotation,
                                       self.framerate, self.timestamp, self.compression, self.hud)
        print("PIPELINE:{0}".format(pipeline_str), flush=True)
        return Gst.parse_launch(pipeline_str)

    def do_configure(self, media):
        # Configure the media for each client connection
        # This is called when a client connects
        self.set_eos_shutdown(True)  # Clean shutdown on EOS
        # track the pipeline so runtime bitrate changes can reach it
        element = media.get_element()
        live_pipelines.append(element)
        applyHudToPipeline(element)
        media.connect("unprepared", self.onMediaUnprepared, element)

    def onMediaUnprepared(self, media, element):
        if element in live_pipelines:
            live_pipelines.remove(element)


class GstServer():
    def __init__(self, port=8554):
        self.server = GstRtspServer.RTSPServer()
        # the RTSP listen port. Defaults to 8554 (the primary stream); secondary
        # streams (#398) run their own server on a distinct port to avoid a clash
        self.port = port
        self.server.set_service(str(port))
        # S5: which interface the RTSP server listens on. Defaults to 0.0.0.0 (all
        # interfaces) so the field WiFi-AP path keeps working; harden by setting
        # RPANION_BIND_ADDRESS (e.g. the wg0 VPN address). Mirrors the web UI bind.
        self.server.set_address(os.environ.get('RPANION_BIND_ADDRESS', '0.0.0.0'))

        # Configure server for low-latency streaming
        self.server.set_backlog(5)  # Limit queued connections

        self.sourceID = self.server.attach(None)
        print("Server available on rtsp://<IP>:{0}".format(port))

    def addStream(self, device, h, w, bitrate, format, rotation, framerate, timestamp, compression, custom_pipeline="", hud=False):
        f = MyFactory(device, h, w, bitrate, format,
                      rotation, framerate, timestamp,
                      compression, custom_pipeline, hud)

        # Don't share the media pipeline - each client gets their own
        # This prevents one slow client from affecting others
        f.set_shared(False)

        # Enable clock synchronization for smoother playback
        f.set_clock(None)  # Use default system clock

        m = self.server.get_mount_points()
        if not device.startswith("rtsp://"):
            name = ''.join(filter(str.isalnum, device))
        else:
            # remove any rtsp username or passwords, format rtsp://admin:admin@192.168.1.217:554/11
            if "@" in device:
                name = device.split('@')[1]
            else:
                name = device.replace("rtsp://", "")
            name = ''.join(filter(str.isalnum, name))
        m.add_factory("/" + name, f)

        print("Added " + "rtsp://<IP>:{0}/".format(self.port) + name)
        print("Use: gst-launch-1.0 rtspsrc location=rtsp://<IP>:{0}/".format(self.port) +
              name + " latency=0 ! queue ! decodebin ! autovideosink sync=false")

    def addSwitcherStream(self, device, pipeline_str):
        # Dual-source (switchable) stream. Mounted under the primary device's
        # name, so client URLs are identical to single-source mode
        f = SwitcherFactory(pipeline_str)

        m = self.server.get_mount_points()
        name = ''.join(filter(str.isalnum, device))
        m.add_factory("/" + name, f)

        print("Added switchable " + "rtsp://<IP>:8554/" + name)
        print("Use: gst-launch-1.0 rtspsrc location=rtsp://<IP>:8554/" +
              name + " latency=0 ! queue ! decodebin ! autovideosink sync=false")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="RTSP Server using Gstreamer")
    parser.add_argument("--videosource", help="Video Device. Can be device (/dev/video0) or rtsp source (rtsp://192.168.1.100:8554/stream)",
                        default="/dev/video0", type=str)
    parser.add_argument("--height", help="Height", default=480, type=int)
    parser.add_argument("--width", help="Width", default=640, type=int)
    parser.add_argument("--fps", help="Framerate", default=10, type=int)
    parser.add_argument(
        "--bitrate", help="Max bitrate (kbps)", default=2000, type=int)
    parser.add_argument("--format", help="Video format",
                        default="video/x-raw", type=str)
    parser.add_argument("--compression", help="encoder choice",
                        default='H264', type=str, choices=['H264', 'H265'])
    parser.add_argument("--rotation", help="rotation angle",
                        default=0, type=int, choices=[0, 90, 180, 270])
    parser.add_argument("--transport", help="Transport protocol selection",
                        default="RTSP", type=str, choices=['RTSP', 'RTP'])
    parser.add_argument(
        "--udp", help="If using RTP, the destinatinon IP:port", default="127.0.0.1:5600", type=str)
    parser.add_argument(
        "--multirtsp", help="CSV of multi-camera RTSP setup. Format is videosource,height,width,bitrate,formatstr,rotation, fps;source2,etc", default="", type=str)
    parser.add_argument("--timestamp", help="add timestamp",
                        default=False, action='store_true')
    parser.add_argument("--hud", help="burn a live telemetry HUD readout onto the stream (fed over the stdin control channel)",
                        default=False, action='store_true')
    parser.add_argument("--rtsp-port", help="RTSP server listen port (default 8554; secondary streams use a distinct port)",
                        default=8554, type=int)
    parser.add_argument("--hud-style", help="HUD style when --hud is set: text readout or graphic artificial horizon",
                        default="text", type=str, choices=["text", "graphic"])
    parser.add_argument(
        "--secondary", help="Secondary video device for runtime source switching", default="", type=str)
    parser.add_argument("--secondary-format", help="Secondary video format",
                        default="video/x-raw", type=str)
    parser.add_argument(
        "--secondary-width", help="Secondary capture width", default=0, type=int)
    parser.add_argument(
        "--secondary-height", help="Secondary capture height", default=0, type=int)
    parser.add_argument(
        "--secondary-fps", help="Secondary capture framerate", default=-1, type=int)
    parser.add_argument(
        "--custom-pipeline", help="User-defined pipeline string, replacing the generated one. Must end in an RTP payloader named pay0", default="", type=str)
    parser.add_argument("--lowlatency", help="Tune the generated pipeline for low-latency cellular links",
                        default=False, action='store_true')
    args = parser.parse_args()

    LOW_LATENCY = args.lowlatency
    HUD_STYLE = args.hud_style

    loop = GLib.MainLoop()
    Gst.init(None)

    Gst.debug_set_active(True)
    Gst.debug_set_default_threshold(3)

    # Custom pipeline: validate up-front and fall back to the generated
    # pipeline if it's bad. Never let a stale custom pipeline kill the stream
    custom_pipeline = args.custom_pipeline
    if custom_pipeline != "" and args.multirtsp == "":
        ok, reason = validateCustomPipeline(custom_pipeline)
        if not ok:
            print("CUSTOM-PIPELINE-FALLBACK:{0}".format(reason), flush=True)
            custom_pipeline = ""
        elif args.secondary != "":
            # custom pipelines and the dual-source switcher are mutually
            # exclusive - the custom pipeline wins
            print("Custom pipeline set - ignoring --secondary (camera switcher dual-source mode)")

    secondary_active = args.secondary != "" and args.multirtsp == "" and custom_pipeline == ""
    if args.multirtsp == "":
        # control channel from the Node server: runtime source switching
        # (dual-source mode) and runtime bitrate changes
        GLib.io_add_watch(sys.stdin.fileno(), GLib.IO_IN |
                          GLib.IO_HUP, stdinWatch)

    if args.multirtsp != "":
        # Multi-camera streaming, delimited via ';'
        # Example commandline is:
        # ./video-server.py --multirtsp="/dev/video0,480,640,2000,video/x-raw,0,10;/dev/video2,480,640,2000,video/x-raw,0,10"

        cams = args.multirtsp.split(';')
        s = GstServer(args.rtsp_port)

        # Add each camera
        for cam in cams:
            try:
                (videosource, height, width, bitrate, formatstr,
                 rotation, fps, timestamp) = cam.split(',')
            except:
                print("Bad format: " + cam)
                break
            if not (height.isdigit() and width.isdigit() and bitrate.isdigit() and rotation.isdigit() and fps.isdigit()):
                print("Bad format: " + cam)
                break
            s.addStream(videosource, height, width, bitrate,
                        formatstr, rotation, fps, timestamp, args.compression, hud=args.hud)

        try:
            loop.run()
        except:
            print("Exiting RTSP Server")
            loop.quit()
    elif secondary_active and args.transport == "RTSP":
        # Dual-source RTSP with runtime switching
        pipeline_str = getDualPipeline(args.videosource, args.format, args.height, args.width, args.fps,
                                       args.secondary, args.secondary_format, args.secondary_height,
                                       args.secondary_width, args.secondary_fps,
                                       args.bitrate, args.rotation, args.timestamp, args.compression, hud=args.hud)
        if pipeline_str == "":
            print("Unable to build dual-source pipeline")
            sys.exit(1)
        s = GstServer(args.rtsp_port)
        s.addSwitcherStream(args.videosource, pipeline_str)

        try:
            loop.run()
        except:
            print("Exiting RTSP Server")
            loop.quit()
    elif secondary_active and args.transport == "RTP":
        # Dual-source RTP with runtime switching
        udp_sink = udpSinkStr(args.udp)
        pipeline_str = getDualPipeline(args.videosource, args.format, args.height, args.width, args.fps,
                                       args.secondary, args.secondary_format, args.secondary_height,
                                       args.secondary_width, args.secondary_fps,
                                       args.bitrate, args.rotation, args.timestamp, args.compression,
                                       hud=args.hud, udp_sink=udp_sink)
        if pipeline_str == "":
            print("Unable to build dual-source pipeline")
            sys.exit(1)
        print("PIPELINE:{0}".format(pipeline_str), flush=True)
        pipeline = Gst.parse_launch(pipeline_str)
        live_pipelines.append(pipeline)
        sel = pipeline.get_by_name("sel")
        if sel is not None:
            live_selectors.append(sel)
            applySwitchToSelector(sel)
        pipeline.set_state(Gst.State.PLAYING)

        print("Server sending UDP stream to " + args.udp)

        try:
            loop.run()
        except:
            print("Exiting UDP Server")
            pipeline.set_state(Gst.State.NULL)
            loop.quit()
    elif args.transport == "RTSP":
        # RTSP
        s = GstServer(args.rtsp_port)
        s.addStream(args.videosource, args.height, args.width, args.bitrate,
                    args.format, args.rotation, args.fps, args.timestamp, args.compression,
                    custom_pipeline, args.hud)

        try:
            loop.run()
        except:
            print("Exiting RTSP Server")
            loop.quit()
    elif args.transport == "RTP":
        # RTP
        if custom_pipeline != "":
            pipeline_str = custom_pipeline
        else:
            pipeline_str = getPipeline(args.videosource, args.height, args.width,
                                       args.bitrate, args.format, args.rotation, args.fps, args.timestamp,
                                       args.compression, args.hud)
        pipeline_str += " ! " + udpSinkStr(args.udp)
        print("PIPELINE:{0}".format(pipeline_str), flush=True)
        pipeline = Gst.parse_launch(pipeline_str)
        live_pipelines.append(pipeline)
        pipeline.set_state(Gst.State.PLAYING)

        print("Server sending UDP stream to " + args.udp)
        if args.compression == "H264" or (args.videosource.startswith("rtsp://") and args.format == "video/x-h264"):
            print(
                "Use: gst-launch-1.0 udpsrc port={0} caps='application/x-rtp, media=(string)video, clock-rate=(int)90000, encoding-name=(string)H264' ! rtph264depay ! h264parse ! avdec_h264 ! videoconvert ! autovideosink sync=false".format(args.udp.split(':')[1]))
        elif args.compression == "H265" or (args.videosource.startswith("rtsp://") and args.format == "video/x-h265"):
            print(
                "Use: gst-launch-1.0 udpsrc port={0} caps='application/x-rtp, media=(string)video, clock-rate=(int)90000, encoding-name=(string)H265' ! rtpjitterbuffer ! rtph265depay ! h265parse ! avdec_h265 ! videoconvert ! autovideosink sync=false".format(args.udp.split(':')[1]))

        try:
            loop.run()
        except:
            print("Exiting UDP Server")
            pipeline.set_state(Gst.State.NULL)
            loop.quit()
