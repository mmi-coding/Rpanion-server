/*
 * fakeModemPty.js - spawn pty-backed fake serial devices for tests.
 *
 * startFakeModem() runs python/fake-sim7600.py (a SIM7600 AT emulator on a
 * pty) and resolves with the slave path - a real SerialPort can open it, so
 * the full serial stack (open/parser/write/close) runs against canned AT
 * responses. startSilentPty() gives a pty that never answers, for timeout
 * and probe-failure paths.
 */
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

// repo convention: python always runs from the venv when it exists
const VENV_PYTHON = path.join(__dirname, '..', 'python', '.venv', 'bin', 'python3')
const PYTHON = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python3'

// pty that opens but never responds to anything written to it
const SILENT_SCRIPT = 'import os, pty, time\n' +
  'm, s = pty.openpty()\n' +
  'print(os.ttyname(s), flush=True)\n' +
  'while True:\n' +
  '    time.sleep(1)\n'

// spawn a python helper that prints its pty slave path as the first stdout
// line; resolve with { path, proc, stop() }
function startPty (args, env) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, args, { env: { ...process.env, ...env } })
    proc.stderr.resume() // drain the emulator's CMD log so it never blocks
    let out = ''
    const onData = (d) => {
      out += d.toString()
      const nl = out.indexOf('\n')
      if (nl !== -1) {
        proc.stdout.removeListener('data', onData)
        resolve({ path: out.slice(0, nl).trim(), proc, stop: () => proc.kill() })
      }
    }
    proc.stdout.on('data', onData)
    proc.on('error', reject)
    proc.on('exit', (code) => reject(new Error('pty helper exited early: ' + code)))
  })
}

function startFakeModem (env) {
  return startPty([path.join(__dirname, '..', 'python', 'fake-sim7600.py')], env)
}

function startSilentPty () {
  return startPty(['-c', SILENT_SCRIPT])
}

module.exports = { startFakeModem, startSilentPty }
