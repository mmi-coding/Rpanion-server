const appRoot = require('app-root-path');
const path = require('path');
const fs = require('fs');

// Check if we're in development mode
const isDev = process.env.NODE_ENV === 'development';

// Set base directory depending on dev mode
const baseDir = isDev ? 
    appRoot.toString() : 
    '/etc/rpanion-server';

// Get Python executable path from venv if it exists, otherwise use system python3
function getPythonPath() {
    const venvPython = path.join('/usr/share/rpanion-server/app', 'python', '.venv', 'bin', 'python3');

    // Check if venv Python exists
    if (fs.existsSync(venvPython)) {
        return venvPython;
    }

    // Check for a local venv (development environments)
    const localVenvPython = path.join(appRoot.toString(), 'python', '.venv', 'bin', 'python3');
    if (fs.existsSync(localVenvPython)) {
        return localVenvPython;
    }

    // Fall back to system python3
    return 'python3';
}

// Export the paths
export = {
    usersFile: path.join(baseDir, 'config', 'user.json'),
    // Where ensureInitialAdmin() writes the auto-generated first-boot admin
    // password (mode 0600) so the operator can retrieve it on-device. Deleted
    // once the password is changed.
    initialPasswordFile: path.join(baseDir, 'config', 'initial-password.txt'),
    settingsFile: path.join(baseDir, 'config', 'settings.json'),
    flightsLogsDir: path.join(baseDir, 'flightlogs'),
    kmzDir: path.join(baseDir, 'flightlogs', 'kmzlogs'),
    mediaDir: path.join(baseDir, 'media'),
    // Custom-HUD fonts (#173). fontDataHome is passed to video-server.py as
    // XDG_DATA_HOME so fontconfig/librsvg find hudFontsDir (curated + imported
    // ttf); bundledFontsDir is the read-only assets dir shipped in the .deb.
    fontDataHome: path.join(baseDir, 'fontdata'),
    hudFontsDir: path.join(baseDir, 'fontdata', 'fonts'),
    bundledFontsDir: path.join(__dirname, '..', 'assets', 'hudfonts'),
    getPythonPath: getPythonPath,
};