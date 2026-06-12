#!/usr/bin/env python3
# Validate a user-supplied GStreamer pipeline string for use as a custom
# video pipeline. Prints a single JSON object to stdout:
#   {"valid": true|false|null, "reason": "<message>"}
# valid=null means validation could not be performed (no GStreamer bindings).
#
# A valid custom pipeline must parse with gst_parse_launch() and contain an
# RTP payloader element named "pay0" (the contract used by video-server.py
# for both the RTSP server and the RTP/UDP sink).

import json
import sys


def result(valid, reason):
    print(json.dumps({"valid": valid, "reason": reason}))
    sys.exit(0)


def main():
    if len(sys.argv) != 2 or sys.argv[1].strip() == "":
        result(False, "No pipeline supplied")

    pipeline_str = sys.argv[1]

    try:
        import gi
        gi.require_version("Gst", "1.0")
        from gi.repository import Gst
    except (ImportError, ValueError) as e:
        result(None, "GStreamer python bindings unavailable: {0}".format(e))

    Gst.init(None)

    if "name=pay0" not in pipeline_str.replace(" =", "=").replace("= ", "="):
        result(False, "Pipeline must contain an RTP payloader named pay0 "
                      "(e.g. ... ! rtph264pay config-interval=1 name=pay0 pt=96)")

    try:
        pipeline = Gst.parse_launch(pipeline_str)
    except Exception as e:
        # gst_parse_error covers syntax errors and missing elements
        result(False, str(e).strip())

    # confirm the pay0 element really exists (the string check above can be
    # fooled by e.g. a caps string)
    if pipeline.get_by_name("pay0") is None:
        result(False, "No element named pay0 found in the parsed pipeline")

    pipeline.set_state(Gst.State.NULL)
    result(True, "Pipeline parsed successfully")


if __name__ == "__main__":
    main()
