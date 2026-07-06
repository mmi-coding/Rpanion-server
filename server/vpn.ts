/*
 VPN management. Currently supports Zerotier and Wireguard
*/
const path = require('path')
const fs = require('fs')
const { exec, execFile } = require('child_process')
const logpaths = require('./paths')

interface VPNStatus {
  installed: boolean
  status: boolean
  text: any[]
}

type VPNCallback = (err: string | null, status: VPNStatus) => void

function getVPNStatusZerotier (errpass: string | null, callback: VPNCallback): void {
  execFile('which', ['zerotier-cli'], (errorzt: Error | null, stdoutzt: string, stderrzt: string) => {
    // which returns exit code 1 when binary not found (stderr is empty)
    if (errorzt !== null || stdoutzt.toString().trim() === '') {
      console.log('ZT not installed:', (errorzt as any)?.code || 'binary not found')
      return callback(null, { installed: false, status: false, text: [] })
    }

    exec('sudo zerotier-cli info && sudo zerotier-cli listnetworks -j', (error: Error | null, stdout: string, stderr: string) => {
      if (stderr.toString().trim() !== '') {
        console.log(`exec error3: ${error}`)
        return callback(stderr.toString().trim(), { installed: false, status: false, text: [] })
      } else {
        // zerotier's in JSON format anyway, so just pipe through
        if (stdout.search('connection failed') > -1) {
          return callback(error as any, { installed: true, status: false, text: [] })
        } else {
          const infoout = stdout.slice(0, stdout.indexOf('[\n]'))
          const networkout = stdout.slice(stdout.indexOf('\n') + 1)
          const isOnline = infoout.search('ONLINE') > -1 || infoout.search('TUNNELED') > -1
          let networks: any[]
          try {
            networks = JSON.parse(networkout)
          } catch (e) {
            // malformed/partial zerotier-cli output must not crash the server
            console.error(`Unable to parse zerotier networks: ${e}`)
            return callback('Unable to parse zerotier networks', { installed: true, status: false, text: [] })
          }
          return callback(errpass, { installed: true, status: isOnline, text: networks })
        }
      }
    })
  })
}

function addZerotier (network: string, callback: VPNCallback): void {
  console.log('Adding: ' + network)
  execFile('sudo', ['zerotier-cli', 'join', network], (error: Error | null, stdout: string, stderr: string) => {
    if (stderr.toString().trim() !== '') {
      console.error(`exec error: ${error}`)
    } else {
      // console.log(stdout)
      if (stdout.search('200 join OK') > -1) {
        return getVPNStatusZerotier(null, callback)
      } else {
        return getVPNStatusZerotier(stdout.toString().trim(), callback)
      }
    }
  })
}

function removeZerotier (network: string, callback: VPNCallback): void {
  console.log('Removing: ' + network)
  execFile('sudo', ['zerotier-cli', 'leave', network], (error: Error | null, stdout: string, stderr: string) => {
    if (stderr.toString().trim() !== '') {
      console.error(`exec error: ${error}`)
    } else {
      // console.log(stdout)
      if (stdout.search('200 leave OK') > -1) {
        return getVPNStatusZerotier(null, callback)
      } else {
        return getVPNStatusZerotier(stdout.toString().trim(), callback)
      }
    }
  })
}

function addWireguardProfile (filename: string, tmpfilepath: string, callback: (err: string | null) => void): void {
  // add uploaded profile

  const extensionName = path.extname(filename) // fetch the file extension
  const allowedExtension = ['.conf', '.config']

  if (!allowedExtension.includes(extensionName)) {
    console.log('Bad extension')
    return callback('Bad extension')
  }

  // copy into place with an argv array (no shell) and strip any path
  // components from the uploaded name so it can only land in /etc/wireguard
  const dest = path.join('/etc/wireguard', path.basename(filename))
  execFile('cp', [tmpfilepath, dest], (error: Error | null, stdout: string, stderr: string) => {
    if (stderr.toString().trim() !== '') {
      console.error(`exec error: ${error}`)
      return callback(stderr.toString().trim())
    }
    // best-effort cleanup of the temp upload; a failure here must not crash
    fs.unlink(tmpfilepath, (unlinkErr: Error | null) => {
      if (unlinkErr !== null) {
        console.error(`unlink error: ${unlinkErr}`)
      }
      return callback(null)
    })
  })
}

function activateWireguardProfile (filename: string, callback: VPNCallback): void {
  // activate a wireguard profile
  const profile = path.parse(filename).name
  execFile('sudo', ['wg-quick', 'up', profile], (errorw: Error | null, stdoutw: string) => {
    execFile('sudo', ['systemctl', 'enable', 'wg-quick@' + profile], (error: Error | null, stdout: string) => {
      if (error !== null || errorw !== null) {
        console.error(`exec error: ${error} ${errorw}`)
        const errstr = (error !== null ? error.toString().trim() : '') + (errorw !== null ? errorw.toString().trim() : '')
        getVPNStatusWireguard(errstr, (stderrnot: string | null, statusJSON: VPNStatus) => {
          return callback(stderrnot, statusJSON)
        })
      } else if (stdout.toString().includes('does not exist') === true) {
        console.error(`exec error2: ${stdout} ${stdoutw}`)
        getVPNStatusWireguard(stdout.toString().trim() + stdoutw.toString().trim(), (stderrnot: string | null, statusJSON: VPNStatus) => {
          return callback(stderrnot, statusJSON)
        })
      } else {
        getVPNStatusWireguard(null, (stderrnot: string | null, statusJSON: VPNStatus) => {
          return callback(null, statusJSON)
        })
      }
    })
  })
}

function deactivateWireguardProfile (filename: string, callback: VPNCallback): void {
  // deactivate a wireguard profile

  const profile = path.parse(filename).name
    execFile('sudo', ['systemctl', 'disable', 'wg-quick@' + profile], (error: Error | null, stdout: string) => {
      execFile('sudo', ['wg-quick', 'down', profile], (errorw: Error | null, stdoutw: string) => {
        if (error !== null || errorw !== null) {
        console.error(`exec error: ${error} ${errorw}`)
        const errstr = (error !== null ? error.toString().trim() : '') + (errorw !== null ? errorw.toString().trim() : '')
        getVPNStatusWireguard(errstr, (stderrnot: string | null, statusJSON: VPNStatus) => {
          return callback(stderrnot, statusJSON)
        })
      } else if (stdout.toString().includes('does not exist') === true) {
        console.error(`exec error: ${stdout} ${stdoutw}`)
        getVPNStatusWireguard(stdout.toString().trim() + stdoutw.toString().trim(), (stderrnot: string | null, statusJSON: VPNStatus) => {
          return callback(stderrnot, statusJSON)
        })
      } else {
        getVPNStatusWireguard(null, (stderrnot: string | null, statusJSON: VPNStatus) => {
          return callback(null, statusJSON)
        })
      }
    })
  })
}

function deleteWireguardProfile (filename: string, callback: (err: Error | null, status?: VPNStatus) => void): void {
  // remove a wireguard profile

  // make the filename safe by removing any folder changes
  const wgprofile = path.basename(filename)

  const extensionName = path.extname(wgprofile) // fetch the file extension
  const allowedExtension = ['.conf', '.config']

  if (!allowedExtension.includes(extensionName)) {
    console.log('Bad extension')
    getVPNStatusWireguard(null, (stderrnot: string | null, statusJSON: VPNStatus) => {
      return callback(new Error('Bad extension'), statusJSON)
    })
  }

  execFile('rm', ['/etc/wireguard/' + wgprofile], (error: Error | null, stdout: string, stderr: string) => {
    if (stderr.toString().trim() !== '') {
      console.error(`exec error: ${error}`)
    }
    getVPNStatusWireguard(null, (stderrnot: string | null, statusJSON: VPNStatus) => {
      return callback(null, statusJSON)
    })
  })
}

function getVPNStatusWireguard (errpass: string | null, callback: VPNCallback): void {
  // get status of VPN
  execFile('which', ['wg-quick'], (errorwg: Error | null, stdoutwg: string, stderrwg: string) => {
    // check if installed
    if (errorwg !== null || stdoutwg.toString().trim() === '') {
      console.log('Wireguard not installed:', (errorwg as any)?.code || 'binary not found')
      return callback(null, { installed: false, status: false, text: [] })
    } else {
      const pythonPath = logpaths.getPythonPath()
      execFile(pythonPath, ['./python/wireguardconfig.py'], (error: Error | null, stdout: string, stderr: string) => {
        if (error !== null) {
          console.error(`exec error: ${error}`)
          return callback(stderr as any, { installed: false, status: false, text: [] })
        } else {
          // output in JSON format anyway, so just pipe through
          console.log(stdout)
          let profiles: any[]
          try {
            profiles = JSON.parse(stdout)
          } catch (e) {
            // malformed/partial wireguardconfig.py output must not crash the server
            console.error(`Unable to parse wireguard config: ${e}`)
            return callback('Unable to parse wireguard config', { installed: true, status: false, text: [] })
          }
          return callback(errpass, { installed: true, status: true, text: profiles })
        }
      })
    }
  })
}

function getVPNStatusTailscale (errpass: string | null, callback: VPNCallback): void {
  execFile('which', ['tailscale'], (error: Error | null, stdout: string) => {
    // which returns exit code 1 when binary not found (stdout empty)
    if (error !== null || stdout.toString().trim() === '') {
      console.log('Tailscale not installed')
      return callback(null, { installed: false, status: false, text: [] })
    }

    exec('sudo tailscale status --json', (err: Error | null, sout: string, serr: string) => {
      if (serr.toString().trim() !== '') {
        console.log(`exec error: ${err}`)
        return callback(serr.toString().trim(), { installed: false, status: false, text: [] })
      }
      let parsed: any
      try {
        parsed = JSON.parse(sout)
      } catch (e) {
        return callback('Unable to parse tailscale status', { installed: true, status: false, text: [] })
      }
      const isUp = parsed.BackendState === 'Running'
      const text: any[] = []
      const addNode = (node: any, isSelf: boolean) => {
        const ips = node.TailscaleIPs || []
        text.push({ host: node.HostName, ip: ips[0] || '', online: node.Online, self: isSelf })
      }
      if (parsed.Self) {
        addNode(parsed.Self, true)
      }
      const peers = parsed.Peer || {}
      for (const key in peers) {
        addNode(peers[key], false)
      }
      return callback(errpass, { installed: true, status: isUp, text })
    })
  })
}

function connectTailscale (authkey: string, callback: VPNCallback): void {
  console.log('Tailscale connecting')
  execFile('sudo', ['tailscale', 'up', '--authkey=' + authkey], (error: Error | null, stdout: string, stderr: string) => {
    if (stderr.toString().trim() !== '') {
      return getVPNStatusTailscale(stderr.toString().trim(), callback)
    }
    return getVPNStatusTailscale(null, callback)
  })
}

function disconnectTailscale (callback: VPNCallback): void {
  console.log('Tailscale disconnecting')
  execFile('sudo', ['tailscale', 'down'], (error: Error | null, stdout: string, stderr: string) => {
    if (stderr.toString().trim() !== '') {
      return getVPNStatusTailscale(stderr.toString().trim(), callback)
    }
    return getVPNStatusTailscale(null, callback)
  })
}

export = {
  getVPNStatusZerotier,
  getVPNStatusWireguard,
  getVPNStatusTailscale,
  addZerotier,
  removeZerotier,
  connectTailscale,
  disconnectTailscale,
  addWireguardProfile,
  deleteWireguardProfile,
  activateWireguardProfile,
  deactivateWireguardProfile
}
