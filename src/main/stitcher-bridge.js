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
    return {
      stitcherPath: '',
      pythonPath: '',
      project: 'Non-eBL Ruler (VAM)',
    };
  }
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    // Migrate legacy "museum" key to "project"
    if (config.museum && !config.project) {
      config.project = config.museum;
      delete config.museum;
    }
    return config;
  } catch (err) {
    console.error('Error loading stitcher config:', err.message);
    return {};
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
 * Read all project definitions from the stitcher's assets/projects/ and the
 * user's AppData projects folder.  Returns an array of { name, builtin, ... }.
 */
function loadStitcherProjects(stitcherPath) {
  const projects = [];
  const seen = new Set();

  const dirs = [];
  // Built-in projects ship with the stitcher
  if (stitcherPath) {
    dirs.push({ dir: path.join(stitcherPath, 'assets', 'projects'), builtin: true });
  }
  // User projects in AppData (same folder the Python stitcher uses)
  const userAppData = process.env.APPDATA || path.join(os.homedir(), '.config');
  dirs.push({ dir: path.join(userAppData, 'eBLImageProcessor', 'projects'), builtin: false });

  for (const { dir, builtin } of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).sort()) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        if (data.name && !seen.has(data.name)) {
          seen.add(data.name);
          data.builtin = builtin;
          projects.push(data);
        }
      } catch (e) {
        console.warn(`Could not read project ${file}:`, e.message);
      }
    }
  }
  return projects;
}

/**
 * Check if a stitcher path is valid (contains process_tablets.py).
 */
function verifyStitcherPath(stitcherPath) {
  if (!stitcherPath) return { valid: false, reason: 'Path not set' };
  if (!fs.existsSync(stitcherPath)) return { valid: false, reason: 'Path does not exist' };

  const scriptPath = path.join(stitcherPath, 'process_tablets.py');
  if (!fs.existsSync(scriptPath)) {
    return { valid: false, reason: 'process_tablets.py not found in path' };
  }

  return { valid: true, scriptPath };
}

/**
 * Spawn the stitcher to process tablets.
 * onProgress is called with progress events: { type, value, message }
 * Returns a promise that resolves to { success, exitCode }
 */
function processStitcherTablets(config, rootFolder, tablets, onProgress) {
  return new Promise((resolve) => {
    const verification = verifyStitcherPath(config.stitcherPath);
    if (!verification.valid) {
      resolve({ success: false, error: verification.reason });
      return;
    }

    const pythonPath = config.pythonPath || 'python';
    const args = [
      verification.scriptPath,
      '--root', rootFolder,
      '--museum', config.project || config.museum || 'Non-eBL Ruler (VAM)',
      '--json-progress',
    ];

    if (tablets && tablets.length > 0) {
      args.push('--tablets', ...tablets);
    }

    console.log(`Spawning stitcher: ${pythonPath} ${args.join(' ')}`);

    const proc = spawn(pythonPath, args, {
      cwd: config.stitcherPath,
      env: { ...process.env },
    });

    let stdoutBuffer = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdoutBuffer += text;

      // Parse line by line
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Try to parse as JSON progress event
        if (trimmed.startsWith('{')) {
          try {
            const event = JSON.parse(trimmed);
            if (onProgress) onProgress(event);
            continue;
          } catch (e) {
            // Not JSON, treat as log
          }
        }

        // Regular log line
        if (onProgress) onProgress({ type: 'log', message: trimmed });
      }
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      if (onProgress) onProgress({ type: 'stderr', message: text });
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
  verifyStitcherPath,
  loadStitcherProjects,
  processStitcherTablets,
};
