const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

const CONFIG_FILE = 'stitcher-config.json';

function getConfigPath() {
  const userData = process.env.APPDATA || path.join(os.homedir(), '.config');
  const dir = path.join(userData, 'tablet-image-renamer');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, CONFIG_FILE);
}

function loadStitcherConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return { stitcherExe: '' };
  }
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    // Migrate from old formats
    if (!config.stitcherExe) {
      config.stitcherExe = config.scriptPath || '';
    }
    return config;
  } catch (err) {
    console.error('Error loading stitcher config:', err.message);
    return { stitcherExe: '' };
  }
}

function saveStitcherConfig(config) {
  const configPath = getConfigPath();
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return true;
  } catch (err) {
    console.error('Error saving stitcher config:', err.message);
    return false;
  }
}

/**
 * Verify the stitcher exe exists.
 */
function verifyStitcherExe(exePath) {
  if (!exePath) return { valid: false, reason: 'Stitcher path not set' };
  if (!fs.existsSync(exePath)) return { valid: false, reason: 'File not found' };
  return { valid: true };
}

/**
 * Try to auto-detect the stitcher exe in common locations.
 * Returns the path if found, null otherwise.
 */
function autoDetectStitcherExe() {
  const candidates = [];

  // Same folder as the renamer app
  const appDir = path.dirname(process.execPath);
  candidates.push(path.join(appDir, 'eBL Photo Stitcher.exe'));
  candidates.push(path.join(appDir, 'eBL Photo Stitcher'));

  // Common install locations (Windows)
  if (process.platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    candidates.push(path.join(programFiles, 'eBL Photo Stitcher', 'eBL Photo Stitcher.exe'));
    // Desktop
    const desktop = path.join(os.homedir(), 'Desktop');
    candidates.push(path.join(desktop, 'eBL Photo Stitcher.exe'));
  }

  // macOS
  if (process.platform === 'darwin') {
    candidates.push('/Applications/eBL Photo Stitcher.app/Contents/MacOS/eBL Photo Stitcher');
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Run the stitcher exe in headless mode.
 * The exe is called with: --headless --root <folder> --json-progress [--tablets <name1> <name2> ...]
 * onProgress receives log events: { type, message }
 * Returns a promise: { success, exitCode, error? }
 */
function runStitcherHeadless(exePath, rootFolder, tablets, onProgress) {
  return new Promise((resolve) => {
    const verification = verifyStitcherExe(exePath);
    if (!verification.valid) {
      resolve({ success: false, error: verification.reason });
      return;
    }

    const args = ['--headless', '--root', rootFolder, '--json-progress'];

    if (tablets && tablets.length > 0) {
      args.push('--tablets', ...tablets);
    }

    console.log(`Running stitcher: "${exePath}" ${args.join(' ')}`);

    const proc = spawn(exePath, args, {
      cwd: path.dirname(exePath),
      env: { ...process.env },
    });

    let stdoutBuffer = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdoutBuffer += text;

      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('{')) {
          try {
            const event = JSON.parse(trimmed);
            if (onProgress) onProgress(event);
            continue;
          } catch (e) { /* not JSON */ }
        }

        if (onProgress) onProgress({ type: 'log', message: trimmed });
      }
    });

    proc.stderr.on('data', (data) => {
      if (onProgress) onProgress({ type: 'stderr', message: data.toString() });
    });

    proc.on('error', (err) => {
      console.error('Stitcher process error:', err.message);
      resolve({ success: false, error: err.message });
    });

    proc.on('exit', (code) => {
      console.log(`Stitcher exited with code ${code}`);
      if (onProgress) onProgress({ type: 'exit', code });
      resolve({ success: code === 0, exitCode: code });
    });
  });
}

module.exports = {
  loadStitcherConfig,
  saveStitcherConfig,
  verifyStitcherExe,
  autoDetectStitcherExe,
  runStitcherHeadless,
};
