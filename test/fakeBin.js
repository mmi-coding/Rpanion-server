const fs = require('fs')
const os = require('os')
const path = require('path')

/*
 * Fake-binaries-on-PATH harness — see docs/TESTING.md.
 *
 * Many server modules shell out to system tools (nmcli, iw, wg, zerotier-cli,
 * sudo ...) via child_process.exec/execSync, which resolve the binary through
 * PATH at call time. Prepending a directory of fake shell scripts to PATH lets
 * tests drive every branch of those modules without modifying upstream source
 * and without the real tools installed.
 *
 * Usage:
 *   const { FakeBin } = require('../test/fakeBin')
 *   const fake = new FakeBin()
 *   fake.install('nmcli', 'echo "wifi:uuid1:802-11-wireless:wlan0"')
 *   fake.activate()            // prepends to process.env.PATH
 *   ...exercise the module...
 *   assert(fake.calls('nmcli').length === 1)
 *   fake.cleanup()             // restores PATH, removes the temp dir
 *
 * Script bodies are POSIX sh; "$*" holds the arguments. Every invocation is
 * recorded to <name>.calls before the body runs. Use environment variables
 * (e.g. process.env.FAKE_SCENARIO) to vary behaviour between tests — exec'd
 * children inherit the test process environment.
 */
class FakeBin {
  constructor () {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpanion-fakebin-'))
    this.savedPath = null
  }

  // Install (or replace) a fake binary named `name` whose body is `body`
  install (name, body = '') {
    const file = path.join(this.dir, name)
    const script = '#!/bin/sh\n' +
      `printf '%s\\n' "$*" >> "${this.dir}/${name}.calls"\n` +
      body + '\n'
    fs.writeFileSync(file, script, { mode: 0o755 })
    return this
  }

  activate () {
    if (this.savedPath === null) {
      this.savedPath = process.env.PATH
      process.env.PATH = `${this.dir}:${process.env.PATH}`
    }
    return this
  }

  deactivate () {
    if (this.savedPath !== null) {
      process.env.PATH = this.savedPath
      this.savedPath = null
    }
  }

  // All recorded invocations of `name`, one argument-string per call
  calls (name) {
    const file = path.join(this.dir, `${name}.calls`)
    if (!fs.existsSync(file)) {
      return []
    }
    return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l !== '')
  }

  // Forget recorded calls (keeps the installed binaries)
  reset () {
    for (const f of fs.readdirSync(this.dir)) {
      if (f.endsWith('.calls')) {
        fs.unlinkSync(path.join(this.dir, f))
      }
    }
  }

  cleanup () {
    this.deactivate()
    fs.rmSync(this.dir, { recursive: true, force: true })
  }
}

module.exports = { FakeBin }
