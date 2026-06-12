#!/usr/bin/env python3
# Emulates a SIM7600 AT port on a pty. Prints the slave path on stdout.
import os, pty, sys

RESPONSES = {
    "ATE0": [],
    "AT+CGMM": ["SIMCOM_SIM7600G-H"],
    "AT+CGMI": ["SIMCOM INCORPORATED"],
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
        out = ""
        for l in lines:
            out += l + "\r\n"
        out += "OK\r\n"
        os.write(master, out.encode())
