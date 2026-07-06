/*
Manage adhoc Wifi connections
Note we are using iwconfig here, rather than nmcli,
as nmcli does not support ad-hoc networks
*/

const { exec, execSync } = require('child_process')

// S10 defense-in-depth. setAdapter() interpolates device/channel/ssid/
// password/ipaddress/gateway into ONE chained shell string
// (`nmcli ... managed no && sleep 1 && ip link ... && iwconfig ... && ...`).
// That `&&`/`sleep` short-circuit sequence can't be expressed faithfully as a
// single execFile argv array, so instead we refuse to hand /bin/sh any value
// carrying a shell metacharacter, quote, backslash, whitespace or glob char.
// routes/adhoc.ts already constrains these fields (isAlphanumeric / isIP /
// isInt / isIn) so no valid activation is affected — this only bites a caller
// that bypasses that middleware, e.g. an out-of-band-edited settings.json that
// the constructor re-activates on boot.
const SHELL_META = /[;&|$`<>()'"\\ \t\n\r*?{}[\]!#~]/

function hasShellMeta (value: any): boolean {
  return SHELL_META.test(String(value))
}

class adhocManager {
  device: any
  devicesettings: any
  settings: any
  constructor (settings: any) {
    this.settings = settings

    this.devicesettings = this.settings.value('adhoc.devicesettings', null)
    this.device = this.settings.value('adhoc.device', null)

    // if Ahoc mode is supposed to be active, then activate it. As OS won't save settings between reboots
    if (this.device !== null) {
      // this.setAdapter(true, this.device, this.devicesettings, null)
      this.setAdapter(true, this.device, this.devicesettings, (err: any) => {
        if (!err) {
          console.log('Adhoc Init ' + this.device.toString())
        } else {
          console.log('Error in adhoc init ', { message: err })
        }
      })
    }
  }

  getAdapters (callback: (...args: any[]) => void) {
    // Get all wifi adapters available to system
    exec('nmcli -t -f device,type,state dev', (error: Error | null, stdout: string, stderr: string) => {
      const netStatusList: any[] = []
      let netDeviceSelected: any = {}
      const curSettings = {
        ipaddress: '',
        wpaType: 'none',
        password: '',
        ssid: '',
        band: 'bg',
        channel: 0,
        isActive: false,
        gateway: ''
      }
      let activeDevice: string | false = false

      if (stderr) {
        console.error(`exec error: ${error}`)
        return callback(stderr)
      } else {
        stdout.split('\n').forEach(function (item: string) {
          const device = item.split(':')
          if (device.length === 3 && device[1] === 'wifi' && device[2] !== 'unavailable') {
            console.log('Adding Network device ' + device[0])
            // if wifi, check for avail channels
            const freqList: any[] = []
            try {
              const output = execSync('iwlist ' + device[0] + ' channel')
              const allFreqs = output.toString().split('\n')
              for (let i = 0, len = allFreqs.length; i < len; i++) {
                if (allFreqs[i].includes('Channel ') && !allFreqs[i].includes('Current')) {
                  const ln = allFreqs[i].split(' ').filter((i: string) => i)
                  // can only do 2.4GHz channels in adhoc mode
                  if (ln.length > 4 && parseFloat(ln[3]) < 3) {
                    // istanbul ignore next - the 'a' branch is unreachable: the enclosing if already requires < 3 GHz
                    freqList.push({ value: parseInt(ln[1]), freq: ln[3], label: '' + ln[1] + ' (' + ln[3] + ' GHz)', band: ((parseFloat(ln[3]) < 3) ? 'bg' : 'a') })
                  }
                }
              }
              // get adapter status
              const outputcfg = execSync('iwconfig ' + device[0])
              const ipcfg = execSync('ip -4 -j addr show ' + device[0])
              const gateway = execSync('ip route show | grep ' + device[0] + ' | grep default | awk \'{ print $3 }\'')
              const pwdLine = execSync('iwlist ' + device[0] + ' key')
              if (outputcfg.toString().includes('Mode:Ad-Hoc')) {
                // adapter is acive in adhoc mopde, grab settings
                activeDevice = device[0]
                const outputlines = outputcfg.toString().split(/[ :\n]+/)
                // console.log(outputlines)
                for (let j = 0, lenn = outputlines.length; j < lenn; j++) {
                  if (outputlines[j] === 'ESSID') {
                    curSettings.ssid = outputlines[j + 1].replace(/"/g, '')
                  }
                  if (outputlines[j] === 'Frequency' && parseFloat(outputlines[j + 1]) > 3) {
                    curSettings.band = 'a'
                    curSettings.channel = freqList.find(x => x.freq === outputlines[j + 1]).value
                  }
                  if (outputlines[j] === 'Frequency' && parseFloat(outputlines[j + 1]) < 3) {
                    curSettings.band = 'bg'
                    curSettings.channel = freqList.find(x => x.freq === outputlines[j + 1]).value
                  }
                }
                // get ip address
                const ipjsonformat = JSON.parse(ipcfg)
                for (let k = 0, lennn = ipjsonformat.length; k < lennn; k++) {
                  if ('ifname' in ipjsonformat[k] && ipjsonformat[k].ifname === device[0]) {
                    curSettings.ipaddress = ipjsonformat[k].addr_info[0].local
                  }
                }
                // get password
                const password = pwdLine.toString().split('\n')[2]
                const allpw = password.split(' ')
                if (allpw[1] === 'off') {
                  curSettings.wpaType = 'none'
                  curSettings.password = ''
                } else {
                  curSettings.wpaType = 'wep'
                  // nee to convert from hex
                  curSettings.password = Buffer.from(allpw[1].replace(/-/gi, ''), 'hex').toString()
                }
                curSettings.gateway = gateway.toString()
              }
            } catch (e) {
              console.error('exec error: ' + e)
              return callback(e)
            }

            netStatusList.push({ value: device[0], label: device[0] + ' (' + device[1] + ')', type: device[1], state: device[2], channels: freqList })
          }
        })
      }
      // console.log(netStatusList)
      if (netStatusList.length === 0) {
        netDeviceSelected = null
        curSettings.isActive = false
      } else if (activeDevice) {
        netDeviceSelected = netStatusList[0]
        curSettings.isActive = true
      } else {
        netDeviceSelected = netStatusList[0]
        curSettings.isActive = false
      }

      return callback(null, netStatusList, netDeviceSelected, curSettings)
    })
  }

  setAdapter (toState: boolean, device: string, settings: any, callback: (...args: any[]) => void) {
    // active or deactivate an ad-hoc connection

    // S10: reject shell metacharacters on any value that gets interpolated into
    // the chained exec/execSync command below, before it can reach /bin/sh.
    // Only the fields that are actually interpolated for this call are checked,
    // mirroring the command string (settings fields only matter when activating;
    // password/gateway only when their optional clause is emitted).
    const suspects: any[] = [device]
    if (toState) {
      suspects.push(settings.channel, settings.ssid, settings.ipaddress)
      if (settings.wpaType !== 'none') {
        suspects.push(settings.password)
      }
      if (settings.gateway !== '') {
        suspects.push(settings.gateway)
      }
    }
    if (suspects.some(hasShellMeta)) {
      return callback(new Error('Refusing adhoc command: a value contains shell metacharacters'))
    }

    this.settings.setValue('adhoc.devicesettings', settings)
    this.settings.setValue('adhoc.device', toState ? device : null)
    if (toState) {
      // activate
      console.log('Activate Adhoc')
      exec('nmcli dev set ' + device + ' managed no && sleep 1 && ip link set ' +
      device + ' down && iwconfig ' +
      device + ' mode ad-hoc ' + ' && iwconfig ' +
      device + ' channel ' + settings.channel + ' && iwconfig ' +
      device + ' essid \'' + settings.ssid + '\'  ' +
      (settings.wpaType === 'none' ? '' : '&& iwconfig ' + device + ' key s:' + settings.password) +
      ' && ip addr flush ' + device +
      ' && ip addr add ' + settings.ipaddress + '/16 dev ' + device +
      ' && ip link set ' + device + ' up' +
      (settings.gateway === '' ? '' : '&& route add default gw ' + settings.gateway + ' ' + device), (error: Error | null, stdout: string, stderr: string) => {
        if (stderr) {
          console.log(`exec error: ${error}`)
          return callback(stderr)
        }
        // refresh
        console.log('Activate Adhoc Success')
        this.getAdapters((err: any, netStatusList: any, netDeviceSelected: any, settings: any) => {
          if (!err) {
            callback(null, netStatusList, netDeviceSelected, settings)
          } else {
            // reset back to managed
            execSync('ip link set ' + device + ' down && sleep 1 && nmcli dev set ' + device + ' managed yes')
            callback(err, netStatusList, netDeviceSelected, settings)
          }
        })
      })
    } else {
      // deactivate
      console.log('Deactivate Adhoc')
      exec('ip link set ' + device + ' down && sleep 1 && nmcli dev set ' + device + ' managed yes', (error: Error | null, stdout: string, stderr: string) => {
        if (stderr) {
          console.error(`exec error: ${error}`)
          return callback(stderr)
        }
        // refresh
        this.getAdapters((err: any, netStatusList: any, netDeviceSelected: any, settings: any) => {
          if (!err) {
            callback(null, netStatusList, netDeviceSelected, settings)
          } else {
            callback(err, netStatusList, netDeviceSelected, settings)
          }
        })
      })
    }
  }
}

export = adhocManager
