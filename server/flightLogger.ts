/*
 * Logs flight data (tlogs) to file
 */

const path = require('path')
const fs = require('fs')
const logpaths = require('./paths')

// R12: retention caps for the flight-logs directory (tlogs + binlogs). Without a
// cap, a long or repeated flight fills the disk and downs the companion computer.
// pruneLogs() deletes oldest-first until BOTH caps are satisfied, and never
// touches the actively-written binlog. Tune these to the target's storage.
const MAX_LOG_BYTES = 2 * 1024 * 1024 * 1024 // 2 GiB total across all flight logs
const MAX_LOG_FILES = 500                    // hard cap on flight-log file count

// Recursively delete a file or directory tree.
function deleteRecursively (targetPath: string) {
  const targetStat = fs.lstatSync(targetPath)
  if (targetStat.isDirectory()) {
    const entries = fs.readdirSync(targetPath)
    entries.forEach((entry: string) => {
      deleteRecursively(path.join(targetPath, entry))
    })
    fs.rmdirSync(targetPath)
  } else {
    fs.unlinkSync(targetPath)
  }
}

// Recursively delete files matching a predicate.
function deleteMatchingFiles (dir: string, matcher: (p: string) => boolean) {
  const entries = fs.readdirSync(dir)
  entries.forEach((entry: string) => {
    const entryPath = path.join(dir, entry)
    const entryStat = fs.lstatSync(entryPath)
    if (entryStat.isDirectory()) {
      deleteMatchingFiles(entryPath, matcher)
    } else if (matcher(entryPath)) {
      fs.unlinkSync(entryPath)
    }
  })
}

// Recursively remove now-empty subdirectories.
function removeEmptySubDirs (dir: string) {
  const entries = fs.readdirSync(dir)
  entries.forEach((entry: string) => {
    const entryPath = path.join(dir, entry)
    const stat = fs.lstatSync(entryPath)
    if (stat.isDirectory()) {
      removeEmptySubDirs(entryPath)
      try {
        fs.rmdirSync(entryPath)
      } catch (e) {
        // Directory not empty, skip
      }
    }
  })
}

class flightLogger {
  mediafolder: any
  kmzlogfolder: any
  topfolder: any
  constructor () {
    this.topfolder = logpaths.flightsLogsDir
    // this.tlogfolder = path.join(this.topfolder, 'tlogs')
    // this.binlogfolder = path.join(this.topfolder, 'binlogs')
    this.kmzlogfolder = logpaths.kmzDir
    this.mediafolder = logpaths.mediaDir
    // this.activeLogging = true
    // this.settings = settings

    // get settings
    // this.activeLogging = this.settings.value('flightLogger.activeLogging', true)

    // mkdir the log and media folders
    fs.mkdirSync(this.topfolder, { recursive: true })
    // fs.mkdirSync(this.binlogfolder, { recursive: true })
    fs.mkdirSync(this.kmzlogfolder, { recursive: true })
    // and the media folder
    fs.mkdirSync(this.mediafolder, { recursive: true })

    // R12: reclaim disk from previous flights before we start logging again.
    // There is no active binlog yet at construction, so nothing is skipped.
    this.pruneLogs()
  }

  // R12: enforce the retention caps on the flight-logs directory, deleting the
  // oldest logs first (by mtime) until the total size AND file count are both
  // within maxBytes / maxFiles. The actively-written binlog (curBinLog) is always
  // skipped so a live log is never truncated. Safe to call on start and from a
  // periodic tick. Returns the paths actually deleted. Callers may pass smaller
  // caps (used by the tests); production uses the module constants.
  pruneLogs (curBinLog?: string, maxBytes: number = MAX_LOG_BYTES, maxFiles: number = MAX_LOG_FILES): string[] {
    const logFiles: { path: string; size: number; mtime: number }[] = []

    function scanDirectory (currentDir: string) {
      fs.readdirSync(currentDir).forEach((entry: string) => {
        const entryPath = path.join(currentDir, entry)
        const entryStat = fs.lstatSync(entryPath)
        if (entryStat.isDirectory()) {
          scanDirectory(entryPath)
        } else if (entryPath.endsWith('.tlog') || entryPath.endsWith('.bin')) {
          logFiles.push({ path: entryPath, size: entryStat.size, mtime: entryStat.mtimeMs })
        }
      })
    }
    scanDirectory(this.topfolder)

    // Oldest first, so we shed the least-recent logs to get back under the cap.
    logFiles.sort((a, b) => a.mtime - b.mtime)

    let totalBytes = logFiles.reduce((sum, f) => sum + f.size, 0)
    let fileCount = logFiles.length
    const deleted: string[] = []

    for (const f of logFiles) {
      if (totalBytes <= maxBytes && fileCount <= maxFiles) {
        break
      }
      if (f.path === curBinLog) {
        // Never delete the log currently being written.
        continue
      }
      try {
        fs.unlinkSync(f.path)
        deleted.push(f.path)
        totalBytes -= f.size
        fileCount -= 1
      } catch (e) {
        // File already removed (e.g. concurrent clearlogs) or not writable; skip.
      }
    }

    if (deleted.length > 0) {
      console.log('Pruned ' + deleted.length + ' old flight log(s) to stay within retention cap')
    }
    return deleted
  }

  // Delete all logs - tlog or binlog or kmz files
  clearlogs (logtype: string, curBinLog: string) {
    if (logtype === 'tlog') {
      deleteMatchingFiles(this.topfolder, (filePath: string) => filePath.endsWith('.tlog'))
      removeEmptySubDirs(this.topfolder)
      console.log('Deleted tlogs')
    } else if (logtype === 'binlog') {
      // Don't delete the actively logging file
      deleteMatchingFiles(this.topfolder, (filePath: string) => filePath.endsWith('.bin') && filePath !== curBinLog)
      removeEmptySubDirs(this.topfolder)
      console.log('Deleted binlogs')
    } else if (logtype === 'kmzlog') {
      fs.readdirSync(this.kmzlogfolder).forEach((entry: string) => {
        deleteRecursively(path.join(this.kmzlogfolder, entry))
      })
      console.log('Deleted kmzlogs')
    } else if (logtype === 'media') {
      fs.readdirSync(this.mediafolder).forEach((entry: string) => {
        deleteRecursively(path.join(this.mediafolder, entry))
      })
      console.log('Deleted all media files and subfolders')
    }
  }

  // find all files in dir (recursively)
  findInDir (dir: string, extfilter: string | string[]) {
    const fileList: any[] = []
    const extensions = Array.isArray(extfilter) ? extfilter : [extfilter]
    const topFolder = this.topfolder

    function scanDirectory(currentDir: string) {
      const files = fs.readdirSync(currentDir)

      files.forEach((file: string) => {
        const filePath = path.join(currentDir, file)
        const fileStat = fs.lstatSync(filePath)
        const filemTime = new Date(fileStat.mtimeMs)

        if (fileStat.isDirectory()) {
          // Recursively scan subdirectories
          scanDirectory(filePath)
        } else if (extensions.some(ext => filePath.toLowerCase().endsWith(ext.toLowerCase()))) {
          const relpath = path.relative(topFolder, filePath)
          const mTime = filemTime.toLocaleString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          fileList.push({ key: relpath, name: path.basename(filePath), modified: mTime, size: Math.round(fileStat.size / 1024) })
        }
      })
    }

    scanDirectory(dir)
    return fileList
  }

  // get list of logfiles for website
  // return format is (err, tlogs)
  getLogs (callback: (...args: any[]) => void) {
    const newfilestlog = this.findInDir(this.topfolder, '.tlog')
    const newfilesbinlog = this.findInDir(this.topfolder, '.bin')
    const newfileskmzlog = this.findInDir(this.kmzlogfolder, '.kmz')
    const newfilesmedia = this.findInDir(this.mediafolder, ['.jpg', '.png', '.gif', '.avi', '.mp4', '.h264', '.h265'])

    return callback(false, newfilestlog, newfilesbinlog, newfileskmzlog, newfilesmedia)
  };
}

export = flightLogger
