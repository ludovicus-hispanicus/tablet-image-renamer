const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const readline = require('readline');

let pythonProcess = null;
let serverReady = false;
let startPromise = null;
let responseCallback = null;

/**
 * Directory containing segmentation_server.py and requirements.txt.
 * In dev: <repo>/python/   In production: <resources>/python/
 */
function getPythonDir() {
  const devPath = path.join(__dirname, '..', '..', 'python');
  if (fs.existsSync(path.join(devPath, 'segmentation_server.py'))) return devPath;
  return path.join(process.resourcesPath, 'python');
}

/**
 * Writable directory for model weights.
 * In dev: <repo>/python/weights/   In production: <userData>/seg-weights/
 */
function getWeightsDir() {
  // In dev mode, use the repo's python/weights/ directory
  const devWeights = path.join(__dirname, '..', '..', 'python', 'weights');
  const devMarker = path.join(__dirname, '..', '..', 'python', 'segmentation_server.py');
  if (fs.existsSync(devMarker)) {
    fs.mkdirSync(devWeights, { recursive: true });
    return devWeights;
  }
  // In production, use a writable user-data location
  const userData = process.env.APPDATA
    || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
  const weightsDir = path.join(userData, 'tablet-image-renamer', 'seg-weights');
  fs.mkdirSync(weightsDir, { recursive: true });
  return weightsDir;
}

function findPython() {
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'python.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python310', 'python.exe'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return 'python';
  }
  // macOS / Linux: try common locations
  const unixCandidates = [
    '/usr/local/bin/python3',
    '/opt/homebrew/bin/python3',
    path.join(os.homedir(), '.pyenv', 'shims', 'python3'),
  ];
  for (const p of unixCandidates) {
    if (fs.existsSync(p)) return p;
  }
  return 'python3';
}

/**
 * Send a JSON command to the Python process and wait for a JSON response.
 */
function sendCommand(cmd, params) {
  return new Promise((resolve, reject) => {
    if (!pythonProcess || !serverReady) {
      return reject(new Error('Segmentation server not running'));
    }
    responseCallback = { resolve, reject };
    const msg = JSON.stringify({ cmd, params }) + '\n';
    pythonProcess.stdin.write(msg);
  });
}

/**
 * Start the Python segmentation process.
 */
async function startServer(onProgress) {
  if (serverReady && pythonProcess) return { success: true };
  if (startPromise) return startPromise;

  const pythonDir = getPythonDir();
  const weightsDir = getWeightsDir();
  const python = findPython();
  console.log('[seg-bridge] Python:', python);
  console.log('[seg-bridge] Python dir:', pythonDir);
  console.log('[seg-bridge] Weights dir:', weightsDir);

  // Check / download weights
  const weightsPath = path.join(weightsDir, 'mobile_sam.pt');
  if (!fs.existsSync(weightsPath)) {
    if (onProgress) onProgress({ type: 'status', message: 'Downloading MobileSAM model (~40 MB)...' });
    try {
      await new Promise((resolve, reject) => {
        const dl = spawn(python, ['download_weights.py', '--weights-dir', weightsDir], { cwd: pythonDir });
        dl.stderr.on('data', (d) => {
          if (onProgress) onProgress({ type: 'log', message: d.toString().trim() });
        });
        dl.stdout.on('data', (d) => {
          if (onProgress) onProgress({ type: 'log', message: d.toString().trim() });
        });
        dl.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Download exited with code ${code}`))));
        dl.on('error', reject);
      });
    } catch (err) {
      return { success: false, error: `Weight download failed: ${err.message}` };
    }
  }

  startPromise = new Promise((resolve) => {
    if (onProgress) onProgress({ type: 'status', message: 'Loading MobileSAM model...' });

    pythonProcess = spawn(python, ['segmentation_server.py', '--weights-dir', weightsDir], {
      cwd: pythonDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Read JSON lines from stdout
    const rl = readline.createInterface({ input: pythonProcess.stdout });

    rl.on('line', (line) => {
      let data;
      try {
        data = JSON.parse(line);
      } catch (e) {
        console.log('[seg-bridge] stdout (non-JSON):', line);
        return;
      }

      // First message is the ready signal
      if (!serverReady) {
        if (data.ready) {
          console.log('[seg-bridge] Model loaded, server ready');
          serverReady = true;
          resolve({ success: true });
        } else {
          console.error('[seg-bridge] Model load failed:', data.error);
          resolve({ success: false, error: data.error || 'Model load failed' });
        }
        return;
      }

      // Subsequent messages are command responses
      if (responseCallback) {
        const cb = responseCallback;
        responseCallback = null;
        cb.resolve(data);
      }
    });

    // Log stderr (Python logging goes here)
    pythonProcess.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text) {
        console.log('[seg-bridge]', text);
        if (onProgress) onProgress({ type: 'log', message: text });
      }
    });

    pythonProcess.on('error', (err) => {
      console.error('[seg-bridge] spawn error:', err.message);
      startPromise = null;
      resolve({ success: false, error: `Failed to start Python: ${err.message}` });
    });

    pythonProcess.on('exit', (code) => {
      console.log('[seg-bridge] process exited with code', code);
      serverReady = false;
      pythonProcess = null;
      startPromise = null;
      if (responseCallback) {
        responseCallback.reject(new Error('Python process exited'));
        responseCallback = null;
      }
      if (onProgress) onProgress({ type: 'exit', code });
      resolve({ success: false, error: `Python process exited with code ${code}` });
    });

    // Timeout after 120 seconds (model loading can be slow)
    setTimeout(() => {
      if (!serverReady) {
        startPromise = null;
        resolve({ success: false, error: 'Server startup timed out (120s)' });
      }
    }, 120000);
  });

  return startPromise;
}

function stopServer() {
  if (pythonProcess) {
    try { pythonProcess.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n'); } catch (e) { /* ignore */ }
    setTimeout(() => {
      if (pythonProcess) { pythonProcess.kill(); pythonProcess = null; }
    }, 1000);
    serverReady = false;
  }
}

function isServerReady() {
  return serverReady;
}

async function encodeImage(imagePath) {
  return sendCommand('encode', { image_path: imagePath });
}

async function predictMask(box, positivePoints, negativePoints) {
  return sendCommand('predict', {
    box: box ? [box.x1, box.y1, box.x2, box.y2] : null,
    positive_points: positivePoints.map((p) => [p.x, p.y]),
    negative_points: negativePoints.map((p) => [p.x, p.y]),
  });
}

module.exports = {
  startServer,
  stopServer,
  isServerReady,
  encodeImage,
  predictMask,
};
