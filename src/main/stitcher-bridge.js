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
    return { scriptPath: '' };
  }
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    // Migrate from old format: if scriptPath is missing, try to build one
    if (!config.scriptPath && config.stitcherPath) {
      config.scriptPath = '';
    }
    return config;
  } catch (err) {
    console.error('Error loading stitcher config:', err.message);
    return { scriptPath: '' };
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
 * Verify a processing script exists and is executable.
 */
function verifyScript(scriptPath) {
  if (!scriptPath) return { valid: false, reason: 'Script path not set' };
  if (!fs.existsSync(scriptPath)) return { valid: false, reason: 'Script file not found' };

  const ext = path.extname(scriptPath).toLowerCase();
  const validExts = ['.bat', '.cmd', '.sh', '.py', '.exe'];
  if (!validExts.includes(ext)) {
    return { valid: false, reason: `Unsupported file type: ${ext}. Use .bat, .sh, .py, or .exe` };
  }

  return { valid: true };
}

/**
 * Generate a template processing script for the user.
 * Returns the path to the generated file.
 */
function generateTemplateScript(targetDir) {
  const isWin = process.platform === 'win32';
  const ext = isWin ? '.bat' : '.sh';
  const filename = `process_tablets${ext}`;
  const filePath = path.join(targetDir, filename);

  let content;
  if (isWin) {
    content = `@echo off
REM === Tablet Image Renamer — Processing Script ===
REM This script is called by the Tablet Image Renamer app.
REM
REM Arguments:
REM   %1        = root folder path (e.g., C:\\photos\\session1)
REM   %2 %3 ... = tablet names to process (e.g., Si.10 Si.11)
REM              If no tablet names are given, process all.
REM
REM Edit the paths below to match your setup:

set STITCHER_DIR=C:\\path\\to\\ebl-photo-stitcher
set PYTHON=python

cd /d "%STITCHER_DIR%"
%PYTHON% process_tablets.py --root "%~1" --json-progress %2 %3 %4 %5 %6 %7 %8 %9
`;
  } else {
    content = `#!/bin/bash
# === Tablet Image Renamer — Processing Script ===
# This script is called by the Tablet Image Renamer app.
#
# Arguments:
#   $1        = root folder path (e.g., /Users/me/photos/session1)
#   $2 $3 ... = tablet names to process (e.g., Si.10 Si.11)
#              If no tablet names are given, process all.
#
# Edit the paths below to match your setup:

STITCHER_DIR="/path/to/ebl-photo-stitcher"
PYTHON="python"

cd "$STITCHER_DIR"
$PYTHON process_tablets.py --root "$1" --json-progress "\${@:2}"
`;
  }

  fs.writeFileSync(filePath, content, { mode: 0o755 });
  return filePath;
}

/**
 * Run the processing script with the given arguments.
 * onProgress is called with log events: { type, message }
 * Returns a promise that resolves to { success, exitCode, error? }
 */
function runProcessingScript(scriptPath, rootFolder, tablets, onProgress) {
  return new Promise((resolve) => {
    const verification = verifyScript(scriptPath);
    if (!verification.valid) {
      resolve({ success: false, error: verification.reason });
      return;
    }

    const ext = path.extname(scriptPath).toLowerCase();
    let cmd, args;

    if (ext === '.bat' || ext === '.cmd') {
      cmd = 'cmd.exe';
      args = ['/c', scriptPath, rootFolder];
    } else if (ext === '.sh') {
      cmd = 'bash';
      args = [scriptPath, rootFolder];
    } else if (ext === '.py') {
      cmd = 'python';
      args = [scriptPath, rootFolder];
    } else if (ext === '.exe') {
      cmd = scriptPath;
      args = [rootFolder];
    } else {
      resolve({ success: false, error: `Unsupported script type: ${ext}` });
      return;
    }

    // Append tablet names as additional arguments
    if (tablets && tablets.length > 0) {
      args.push(...tablets);
    }

    console.log(`Running: ${cmd} ${args.join(' ')}`);

    const proc = spawn(cmd, args, {
      cwd: path.dirname(scriptPath),
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

        // Try to parse as JSON progress event
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
      console.error('Script process error:', err.message);
      resolve({ success: false, error: err.message });
    });

    proc.on('exit', (code) => {
      console.log(`Script exited with code ${code}`);
      if (onProgress) onProgress({ type: 'exit', code });
      resolve({ success: code === 0, exitCode: code });
    });
  });
}

module.exports = {
  loadStitcherConfig,
  saveStitcherConfig,
  verifyScript,
  generateTemplateScript,
  runProcessingScript,
};
