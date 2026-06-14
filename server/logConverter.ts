const spawn = require('child_process').spawn
const path = require('path')
const appRoot = require('app-root-path')
const logpaths = require('./paths')

class logConverter {
  intervalObj: any
  settings: any
  converterPid: any
  pythonScript: any
  pythonFolder: any
  options: any
  constructor (settings: any) {
    this.options = {
      // the interval of sync, every 20 sec
      interval: 20
    }

    this.pythonFolder = path.join(appRoot.toString(), 'python')
    this.pythonScript = path.join(this.pythonFolder, 'tlog2kmz.py')

    this.converterPid = null

    // load settings
    this.settings = settings
    this.options.doLogConversion = this.settings.value('logConverter.doLogConversion', false)

    // interval for conversion checks
    this.intervalObj = setInterval(() => {
      console.log('LogConverter interval')
      if (this.options.doLogConversion) {
        try {
          console.log('Doing log conversion...')
          const pythonPath = logpaths.getPythonPath()
          this.converterPid = spawn(pythonPath, [this.pythonScript, logpaths.flightsLogsDir])
          this.converterPid.stdout.on('data', (data: any) => {
            console.log(`stdout from log converter: ${data}`)
          })
          this.converterPid.stderr.on('data', (data: any) => {
            console.log(`stderr from log converter: ${data}`)
          })
          this.converterPid.on('close', (code: any) => {
            console.log(`Log converter exited with code ${code}`)
          })
        } catch (error) {
          console.log(error)
        }
      }
    }, this.options.interval * 1000)
  }

  quitting () {
    if (this.converterPid) {
      this.converterPid.kill()
    }
    clearInterval(this.intervalObj)
  }

  getSettings (callback: any) {
    // get current settings
    return callback(this.options.doLogConversion)
  }

  setSettingsLog (doLogConversion: any) {
    // save new settings
    this.options.doLogConversion = doLogConversion
    // and save to file
    try {
      this.settings.setValue('logConverter.doLogConversion', this.options.doLogConversion)
      console.log('Saved Log Converter settings')
    } catch (e) {
      console.log(e)
    }
  }

  // Get the rsync status for binlog
  conStatusLogStr () {
    if (!this.options.doLogConversion) {
      return 'Disabled'
    }
    if (this.converterPid) {
      if (this.converterPid.connected) {
        if (this.converterPid.exitCode === null) {
          return 'Running'
        } else if (this.converterPid.exitCode === 0) {
          return 'Success'
        } else {
          return 'Error running kml converter'
        }
      }
    }

    return 'Waiting for run'
  }
}

export = logConverter
