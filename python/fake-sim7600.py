#!/usr/bin/env python3
# Emulates a SIM7600 AT port on a pty. Prints the slave path on stdout.
# Set FAKE_SIM7600_ERROR=1 to answer every command with ERROR instead of OK.
import os, pty, sys

RESPONSES = {
    "ATE0": [],
    "AT+CGMM": ["SIMCOM_SIM7600G-H"],
    # the stray whitespace-only line exercises the parsers' blank-line guards
    "AT+CGMI": [" ", "SIMCOM INCORPORATED"],
    "AT+CPIN?": ["+CPIN: READY"],
    "AT+CSQ": ["+CSQ: 21,99"],
    "AT+CREG?": ["+CREG: 0,1"],
    "AT+COPS?": ['+COPS: 0,0,"TestTel",7'],
    "AT+CPSI?": ["+CPSI: LTE,Online,505-01,0x5A1E,187214780,257,EUTRAN-BAND3,1850,5,5,-94,-850,-545,15"],
    "AT+CGPADDR=1": ["+CGPADDR: 1,10.64.12.34"],
    "AT$QCRMCALL=1,1": ["$QCRMCALL: 1,V4"],
}

master, slave = pty.openpty()
print(os.ttyname(slave), flush=True)

buf = b""
while True:
    try:
        data = os.read(master, 256)
    except OSError:
        break
    if not data:
        break
    buf += data
    while b"\r" in buf:
        line, _, buf = buf.partition(b"\r")
        cmd = line.decode(errors="replace").strip()
        if cmd == "":
            continue
        sys.stderr.write("CMD: " + cmd + "\n"); sys.stderr.flush()
        lines = RESPONSES.get(cmd, [])
        out = "\r\n"  # real SIM7600s prefix responses with a blank line
        for l in lines:
            out += l + "\r\n"
        out += "ERROR\r\n" if os.environ.get("FAKE_SIM7600_ERROR") == "1" else "OK\r\n"
        if cmd == "ATE0":
            # a real SIM7600 emits unsolicited result codes after boot -
            # clients must ignore lines that arrive with no command pending
            out += "SMS DONE\r\n"
        os.write(master, out.encode())
