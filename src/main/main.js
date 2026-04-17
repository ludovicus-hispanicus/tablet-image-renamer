const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { scanFolder, generateThumbnail, renameFiles, getImageInfo } = require('./file-ops');
const {
  loadStitcherConfig,
  saveStitcherConfig,
  verifyStitcherExe,
  autoDetectStitcherExe,
  runStitcherHeadless,
} = require('./stitcher-bridge');
const projectManager = require('./project-manager');
const segBridge = require('./segmentation-bridge');

// Disable Sharp's file cache so that overwritten files are re-read fresh.
// Without this, the segmentation apply/restore can show stale images because
// Sharp serves the old buffer from its in-memory cache.
try {
  require('sharp').cache({ files: 0, items: 0 });
} catch (e) { /* sharp may not be installed in some dev setups */ }

// === Segmentation saved-histories list ===
// When the user clicks "Save" on a segmented image, we add its path here.
// On the NEXT app startup, those histories are deleted and the list cleared.
const os = require('os');
function getSavedHistoriesFile() {
  const userData = process.env.APPDATA
    || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
  const dir = path.join(userData, 'tablet-image-renamer');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'saved-histories.json');
}

function readSavedHistories() {
  const f = getSavedHistoriesFile();
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) || []; } catch (e) { return []; }
}

function writeSavedHistories(list) {
  try { fs.writeFileSync(getSavedHistoriesFile(), JSON.stringify(list, null, 2)); } catch (e) { /* ignore */ }
}

/**
 * Delete all history files for an image: _Original/{name}_step*.ext and
 * {name}.current marker. Removes the _Original/ folder if empty afterwards.
 */
function deleteHistoryFor(imagePath) {
  const dir = path.join(path.dirname(imagePath), '_Original');
  if (!fs.existsSync(dir)) return;
  const base = path.parse(imagePath).name;
  const ext = path.extname(imagePath);
  const escBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escExt = ext.replace(/[.]/g, '\\.');
  const stepPattern = new RegExp(`^${escBase}_step\\d+${escExt}$`, 'i');
  const markerName = `${base}.current`;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f === markerName || stepPattern.test(f)) {
        try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* ignore */ }
      }
    }
    // Remove folder if empty
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch (e) { /* ignore */ }
}

// At startup: clean up all histories marked for deletion in the previous session
(function cleanupSavedHistoriesOnStartup() {
  const list = readSavedHistories();
  if (list.length === 0) return;
  console.log(`[seg] Cleaning ${list.length} saved histories from previous session`);
  for (const imagePath of list) {
    try { deleteHistoryFor(imagePath); } catch (e) { /* ignore */ }
  }
  writeSavedHistories([]);
})();

// Hot reload in dev mode — watches renderer files (HTML, CSS, JS)
try {
  require('electron-reload')(path.join(__dirname, '..', 'renderer'), {
    electron: path.join(__dirname, '..', '..', 'node_modules', '.bin', 'electron'),
  });
} catch (e) { /* ignore in production */ }

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Tablet Image Renamer',
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // F12 to toggle DevTools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// === User Identity ===
// Simple display name for the assignment/collaboration system.
// Stored locally — no accounts, no passwords.
function getUserFile() {
  const userData = process.env.APPDATA
    || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
  const dir = path.join(userData, 'tablet-image-renamer');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'user.json');
}

ipcMain.handle('get-user-name', async () => {
  const f = getUserFile();
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')).name || null; } catch (e) { return null; }
});

ipcMain.handle('set-user-name', async (event, name) => {
  try {
    fs.writeFileSync(getUserFile(), JSON.stringify({ name }, null, 2));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// === IPC Handlers ===

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select folder with tablet subfolders',
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('scan-folder', async (event, folderPath) => {
  return scanFolder(folderPath);
});

ipcMain.handle('get-thumbnail', async (event, imagePath) => {
  return generateThumbnail(imagePath);
});

ipcMain.handle('get-image-info', async (event, imagePath) => {
  return getImageInfo(imagePath);
});

ipcMain.handle('rename-files', async (event, subfolder, assignments, tabletId, allImagePaths) => {
  return renameFiles(subfolder, assignments, tabletId, allImagePaths);
});

// Bake EXIF orientation into pixels, then apply the explicit rotation.
// Sharp's .rotate(angle) with an explicit angle does NOT auto-apply EXIF,
// so without this two-pass the first rotation on an EXIF-tagged image
// combines with the orientation tag and looks off (e.g. 180° looks like 90°).
async function rotateAndSave(imagePath, degrees) {
  const sharp = require('sharp');
  const oriented = await sharp(imagePath).rotate().toBuffer();
  const buffer = await sharp(oriented).rotate(degrees).toBuffer();
  fs.writeFileSync(imagePath, buffer);
}

ipcMain.handle('rotate-image', async (event, imagePath, degrees) => {
  try {
    await rotateAndSave(imagePath, degrees);
    return generateThumbnail(imagePath);
  } catch (err) {
    console.error('Error rotating image:', err.message);
    return null;
  }
});

ipcMain.handle('rotate-images-batch', async (event, imagePaths, degrees) => {
  const results = [];
  for (const imagePath of imagePaths) {
    try {
      await rotateAndSave(imagePath, degrees);
      const thumb = await generateThumbnail(imagePath);
      results.push({ path: imagePath, thumbnail: thumb, status: 'ok' });
    } catch (err) {
      console.error(`Error rotating ${imagePath}: ${err.message}`);
      results.push({ path: imagePath, thumbnail: null, status: 'error' });
    }
  }
  return results;
});

// === Stitcher Bridge ===

ipcMain.handle('get-stitcher-config', async () => {
  return loadStitcherConfig();
});

ipcMain.handle('save-stitcher-config', async (event, config) => {
  return saveStitcherConfig(config);
});

ipcMain.handle('verify-stitcher-exe', async (event, exePath) => {
  return verifyStitcherExe(exePath);
});

ipcMain.handle('auto-detect-stitcher', async () => {
  return autoDetectStitcherExe();
});

ipcMain.handle('select-stitcher-exe', async () => {
  const filters = process.platform === 'win32'
    ? [{ name: 'Executable', extensions: ['exe'] }, { name: 'All Files', extensions: ['*'] }]
    : [{ name: 'All Files', extensions: ['*'] }];
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Select eBL Photo Stitcher',
    filters,
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('process-tablets', async (event, rootFolder, tablets) => {
  const config = loadStitcherConfig();
  return runStitcherHeadless(config.stitcherExe, rootFolder, tablets, (progress) => {
    mainWindow.webContents.send('stitcher-progress', progress);
  });
});

ipcMain.handle('delete-image', async (event, imagePath) => {
  try {
    // Move to OS trash instead of permanent delete
    const { shell } = require('electron');
    await shell.trashItem(imagePath);
    return { success: true };
  } catch (err) {
    console.error('Delete error:', err.message);
    return { success: false, error: err.message };
  }
});

// === Picker Mode ===

const PICKS_FILE = 'picks.json';
const SELECTED_FOLDER = '_Selected';

ipcMain.handle('load-picks', async (event, subfolderPath) => {
  const picksFile = path.join(subfolderPath, PICKS_FILE);
  if (!fs.existsSync(picksFile)) return {};
  try {
    return JSON.parse(fs.readFileSync(picksFile, 'utf8'));
  } catch (e) {
    return {};
  }
});

ipcMain.handle('save-picks', async (event, subfolderPath, picks) => {
  const picksFile = path.join(subfolderPath, PICKS_FILE);
  try {
    fs.writeFileSync(picksFile, JSON.stringify(picks, null, 2));
    return true;
  } catch (e) {
    console.error('Error saving picks:', e.message);
    return false;
  }
});

ipcMain.handle('select-export-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Export Folder',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('export-selected', async (event, rootFolder, subfolderName, picks, customExportFolder) => {
  // picks is { imagePath: viewCode }
  // Copy each picked image to exportFolder/{subfolderName}/{name}_{viewCode}.ext
  const baseDir = customExportFolder || path.join(rootFolder, SELECTED_FOLDER);
  const selectedDir = path.join(baseDir, subfolderName);
  try {
    fs.mkdirSync(selectedDir, { recursive: true });

    // Clear old selected files for this tablet
    if (fs.existsSync(selectedDir)) {
      for (const f of fs.readdirSync(selectedDir)) {
        fs.unlinkSync(path.join(selectedDir, f));
      }
    }

    const results = [];
    for (const [imagePath, viewCode] of Object.entries(picks)) {
      let outName;
      if (viewCode === 'pick') {
        // Unnamed pick — keep original filename
        outName = path.basename(imagePath);
      } else {
        const ext = path.extname(imagePath).toLowerCase();
        outName = `${subfolderName}_${viewCode}${ext}`;
      }
      const outPath = path.join(selectedDir, outName);
      fs.copyFileSync(imagePath, outPath);
      results.push({ source: path.basename(imagePath), dest: outName, status: 'ok' });
    }

    console.log(`Exported ${results.length} picks to ${selectedDir}`);
    return { success: true, count: results.length, outputDir: selectedDir };
  } catch (err) {
    console.error('Export error:', err.message);
    return { success: false, error: err.message };
  }
});

// Clean cached _object.tif and _ruler.tif files from tablet subfolders
// so the stitcher re-extracts from the (possibly edited) source images.
ipcMain.handle('clean-tablet-cache', async (event, rootFolder, tabletNames) => {
  const cleaned = [];
  const folders = tabletNames || fs.readdirSync(rootFolder)
    .filter(f => fs.statSync(path.join(rootFolder, f)).isDirectory() && !f.startsWith('_'));

  for (const name of folders) {
    const subDir = path.join(rootFolder, name);
    if (!fs.existsSync(subDir)) continue;

    const files = fs.readdirSync(subDir);
    for (const file of files) {
      if (file.endsWith('_object.tif') || file.endsWith('_ruler.tif')) {
        try {
          fs.unlinkSync(path.join(subDir, file));
          cleaned.push(file);
        } catch (e) {
          console.warn(`Could not delete ${file}: ${e.message}`);
        }
      }
    }
  }
  console.log(`Cleaned ${cleaned.length} cached files from ${folders.length} folder(s).`);
  return cleaned.length;
});

ipcMain.handle('scan-selected-folder', async (event, folderPath) => {
  // Scan a folder for subfolders containing images (the export/selected folder)
  if (!folderPath || !fs.existsSync(folderPath)) return [];
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const results = [];
  const imageExts = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.cr3', '.nef', '.arw']);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Skip underscore-prefixed folders (_Final_JPG, _Final_TIFF, _Raw, _cleaned, etc.)
    if (entry.name.startsWith('_')) continue;
    const subPath = path.join(folderPath, entry.name);
    const files = fs.readdirSync(subPath);
    const imageFiles = files.filter(f =>
      imageExts.has(path.extname(f).toLowerCase()) &&
      !/_mask\.(png|tif|tiff|jpg|jpeg)$/i.test(f)
    );
    if (imageFiles.length > 0) {
      results.push({ name: entry.name, path: subPath, imageCount: imageFiles.length });
    }
  }
  results.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  );
  return results;
});

// === Project Management ===

ipcMain.handle('list-projects', async () => {
  const config = loadStitcherConfig();
  return projectManager.listProjects(config.stitcherExe);
});

ipcMain.handle('get-project', async (event, name) => {
  const config = loadStitcherConfig();
  return projectManager.getProjectByName(name, config.stitcherExe);
});

ipcMain.handle('save-project', async (event, project) => {
  return projectManager.saveUserProject(project);
});

ipcMain.handle('delete-project', async (event, name) => {
  return projectManager.deleteUserProject(name);
});

ipcMain.handle('new-project', async (event, name) => {
  return projectManager.defaultNewProject(name);
});

ipcMain.handle('select-measurements-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Select Measurements File',
    filters: [{ name: 'Measurements', extensions: ['xlsx', 'xls', 'json'] }],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('scan-results', async (event, rootFolder) => {
  const { scanResults, loadReviewStatus, saveReviewStatus } = require('./results-ops');
  return scanResults(rootFolder);
});

ipcMain.handle('load-review-status', async (event, rootFolder) => {
  const { loadReviewStatus } = require('./results-ops');
  return loadReviewStatus(rootFolder);
});

ipcMain.handle('save-review-status', async (event, rootFolder, status) => {
  const { saveReviewStatus } = require('./results-ops');
  return saveReviewStatus(rootFolder, status);
});

ipcMain.handle('get-result-thumbnail', async (event, imagePath) => {
  const sharp = require('sharp');
  try {
    const buffer = await sharp(imagePath, { limitInputPixels: false })
      .rotate()
      .resize(400, 600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  } catch (err) {
    console.error('Result thumbnail error:', err.message);
    return null;
  }
});

ipcMain.handle('reveal-in-explorer', async (event, filePath) => {
  const { shell } = require('electron');
  shell.showItemInFolder(filePath);
});

ipcMain.handle('get-full-image', async (event, imagePath) => {
  // Return base64 of a screen-sized version, with raw file support
  const sharp = require('sharp');
  const { getSharpInput } = require('./file-ops');
  try {
    const { input } = await getSharpInput(imagePath);
    if (!input) return null;

    const buffer = await sharp(input, { limitInputPixels: false })
      .rotate() // auto-apply EXIF orientation
      .resize(1920, 1440, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  } catch (err) {
    console.error('Error loading full image:', err.message);
    return null;
  }
});

// === Segmentation Bridge ===

ipcMain.handle('seg-start-server', async () => {
  return segBridge.startServer((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('seg-progress', progress);
    }
  });
});

ipcMain.handle('seg-stop-server', async () => {
  segBridge.stopServer();
  return { success: true };
});

ipcMain.handle('seg-encode-image', async (event, imagePath) => {
  return segBridge.encodeImage(imagePath);
});

ipcMain.handle('seg-predict-mask', async (event, box, positivePoints, negativePoints) => {
  return segBridge.predictMask(box, positivePoints, negativePoints);
});

// === Segmentation history helpers ===
// Photoshop-style linear history: each Apply adds a step. Jumping to an older
// step does NOT create a new entry; it just moves the current pointer. If the
// user then applies a new change from an older step, the "future" steps are
// discarded (redo chain broken).

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function historyDir(imagePath) { return path.join(path.dirname(imagePath), '_Original'); }
function stepFilePath(imagePath, step) {
  return path.join(historyDir(imagePath), `${path.parse(imagePath).name}_step${step}${path.extname(imagePath)}`);
}
function currentMarkerPath(imagePath) {
  return path.join(historyDir(imagePath), `${path.parse(imagePath).name}.current`);
}

function listSteps(imagePath) {
  const dir = historyDir(imagePath);
  if (!fs.existsSync(dir)) return [];
  const base = path.parse(imagePath).name;
  const ext = path.extname(imagePath);
  const pattern = new RegExp(`^${escapeRe(base)}_step(\\d+)${escapeRe(ext)}$`, 'i');
  const steps = [];
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(pattern);
    if (!m) continue;
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    steps.push({ step: parseInt(m[1]), path: full, name: f, mtime: stat.mtime.toISOString(), size: stat.size });
  }
  steps.sort((a, b) => a.step - b.step);
  return steps;
}

function getCurrentStep(imagePath) {
  const marker = currentMarkerPath(imagePath);
  if (!fs.existsSync(marker)) return -1;
  const n = parseInt(fs.readFileSync(marker, 'utf8').trim());
  return isNaN(n) ? -1 : n;
}

function setCurrentStep(imagePath, step) {
  fs.mkdirSync(historyDir(imagePath), { recursive: true });
  fs.writeFileSync(currentMarkerPath(imagePath), String(step));
}

/**
 * Prepare history for an upcoming Apply. Returns the new step number that
 * should be written AFTER the apply finishes. Side effects:
 *  - If this is the first apply ever, snapshots the current file as step0.
 *  - If the user has jumped back (current < max), discards all future steps.
 */
function prepareHistoryForApply(imagePath) {
  fs.mkdirSync(historyDir(imagePath), { recursive: true });
  const steps = listSteps(imagePath);
  if (steps.length === 0) {
    // First apply ever → snapshot the original as step0
    fs.copyFileSync(imagePath, stepFilePath(imagePath, 0));
    setCurrentStep(imagePath, 0);
    return 1;
  }
  const current = getCurrentStep(imagePath);
  const maxStep = steps[steps.length - 1].step;
  if (current >= 0 && current < maxStep) {
    // User jumped back — discard steps beyond current
    for (const s of steps) {
      if (s.step > current) { try { fs.unlinkSync(s.path); } catch (e) { /* ignore */ } }
    }
    return current + 1;
  }
  return maxStep + 1;
}

ipcMain.handle('seg-get-history', async (event, imagePath) => {
  const steps = listSteps(imagePath);
  const current = getCurrentStep(imagePath);
  return { steps, current };
});

ipcMain.handle('seg-mark-saved', async (event, imagePath) => {
  // Add this image path to the cleanup list. History will actually be deleted
  // on the NEXT app startup, so the user can still undo within this session.
  try {
    const list = readSavedHistories();
    if (!list.includes(imagePath)) list.push(imagePath);
    writeSavedHistories(list);
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('seg-is-saved', async (event, imagePath) => {
  const list = readSavedHistories();
  return { saved: list.includes(imagePath) };
});

ipcMain.handle('seg-jump-to-step', async (event, imagePath, step) => {
  try {
    const stepPath = stepFilePath(imagePath, step);
    if (!fs.existsSync(stepPath)) return { status: 'error', error: `Step ${step} not found` };
    fs.copyFileSync(stepPath, imagePath);
    setCurrentStep(imagePath, step);
    // Remove stale _mask.png
    const maskPath = path.join(path.dirname(imagePath), path.parse(imagePath).name + '_mask.png');
    if (fs.existsSync(maskPath)) { try { fs.unlinkSync(maskPath); } catch (e) { /* ignore */ } }
    const thumb = await generateThumbnail(imagePath);
    return { status: 'ok', thumbnail: thumb, current: step };
  } catch (err) {
    console.error('seg-jump-to-step error:', err);
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('seg-apply-mask', async (event, imagePath, outputPath, maskBase64, bgColor, rotation) => {
  // Apply SAM mask: cut out the object, fill bg with chosen color, crop tight
  // to the object, then add 100px padding of the bg color on all sides.
  // Before cropping, the mask is EXPANDED (dilated) and FEATHERED (blurred) to
  // match the Photoshop action that the professional uses — so edges aren't
  // cut into the object and the cutout blends smoothly.
  // Result overwrites the original file. A backup is saved to _Original/ first.
  const sharp = require('sharp');
  const PADDING_PX = 100;
  const EXPAND_PX = 1;    // dilate the mask outward by this many pixels
  const FEATHER_PX = 2;   // Gaussian blur sigma for soft edges

  try {
    // Prepare history: snapshot original on first apply, discard future steps
    // if the user jumped back in history, and compute the new step number.
    const newStep = prepareHistoryForApply(imagePath);
    console.log(`[seg-apply] will write step ${newStep}`);

    // Decode the base64 mask PNG
    const maskBuf = Buffer.from(maskBase64, 'base64');

    // Load and auto-rotate the original image; grab its true dimensions
    const rotatedBuf = await sharp(imagePath, { limitInputPixels: false })
      .rotate()
      .removeAlpha()
      .toBuffer();
    const rotatedMeta = await sharp(rotatedBuf).metadata();
    const imgW = rotatedMeta.width;
    const imgH = rotatedMeta.height;

    // Resize mask to image dimensions, then apply Expand + Feather on it.
    // Expand: dilation via a Gaussian-like widening. Sharp doesn't have dilate,
    // so approximate: threshold-blur-threshold expands by the blur radius.
    // Feather: a final Gaussian blur softens the edge.
    const expandKernel = Math.max(1, EXPAND_PX * 2 + 1);
    const maskAtImgSize = await sharp(maskBuf)
      .resize(imgW, imgH, { fit: 'fill', kernel: 'nearest' })
      .blur(EXPAND_PX)
      .threshold(64)     // threshold low → any blurred edge becomes foreground = expansion
      .blur(FEATHER_PX)  // soft feather edge on the expanded mask
      .toBuffer();

    // Get raw grayscale mask pixels (single channel, 0-255)
    const { data: maskRaw, info: maskInfo } = await sharp(maskAtImgSize)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Find tight bbox of the mask (where pixels > 128)
    let minX = imgW, minY = imgH, maxX = -1, maxY = -1;
    for (let y = 0; y < maskInfo.height; y++) {
      for (let x = 0; x < maskInfo.width; x++) {
        if (maskRaw[y * maskInfo.width + x] > 128) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return { status: 'error', error: 'Mask is empty' };

    const bboxW = maxX - minX + 1;
    const bboxH = maxY - minY + 1;

    const bg = bgColor === 'black'
      ? { r: 0, g: 0, b: 0 }
      : { r: 255, g: 255, b: 255 };

    // Get raw RGB pixels from the rotated image
    const { data: rgbRaw, info: rgbInfo } = await sharp(rotatedBuf)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Build RGB buffer with ALPHA-BLENDED edges so the feather is actually
    // visible as a soft fade (rather than a hard threshold cutoff):
    //   out = image * (mask/255) + bg * (1 - mask/255)
    const totalPx = imgW * imgH;
    const rgbaFlat = Buffer.alloc(totalPx * 3);
    for (let i = 0; i < totalPx; i++) {
      const a = maskRaw[i] / 255;
      const inv = 1 - a;
      rgbaFlat[i * 3]     = Math.round(rgbRaw[i * 3]     * a + bg.r * inv);
      rgbaFlat[i * 3 + 1] = Math.round(rgbRaw[i * 3 + 1] * a + bg.g * inv);
      rgbaFlat[i * 3 + 2] = Math.round(rgbRaw[i * 3 + 2] * a + bg.b * inv);
    }

    // Encode the masked image as PNG so downstream pipeline can read it
    const masked = await sharp(rgbaFlat, {
      raw: { width: imgW, height: imgH, channels: 3 },
    }).png().toBuffer();

    // Step 2 + 3: crop tight, then extend canvas by 100px of bg color.
    // Write directly to the target format in one pipeline — avoids intermediate
    // buffers with ambiguous formats.
    const ext = path.extname(imagePath).toLowerCase();

    // Step 2: crop tight to mask bbox.
    let cropped = await sharp(masked)
      .extract({ left: minX, top: minY, width: bboxW, height: bboxH })
      .png()
      .toBuffer();

    // Step 3: fine rotation (if any). Sharp's rotate() with a background
    // expands the canvas automatically to contain the rotated content.
    const rot = Number(rotation) || 0;
    if (Math.abs(rot) > 0.001) {
      cropped = await sharp(cropped)
        .rotate(rot, { background: { ...bg, alpha: 1 } })
        .png()
        .toBuffer();
    }

    // Step 4: add 100px bg-color padding on all sides + encode to target format.
    let pipeline = sharp(cropped)
      .extend({
        top: PADDING_PX,
        bottom: PADDING_PX,
        left: PADDING_PX,
        right: PADDING_PX,
        background: bg,
      });

    if (ext === '.tif' || ext === '.tiff') {
      pipeline = pipeline.tiff({ compression: 'lzw' });
    } else if (ext === '.png') {
      pipeline = pipeline.png();
    } else {
      pipeline = pipeline.jpeg({ quality: 95 });
    }
    const outBuf = await pipeline.toBuffer();
    fs.writeFileSync(imagePath, outBuf);

    // Snapshot the new live file as the new history step and update the pointer
    fs.copyFileSync(imagePath, stepFilePath(imagePath, newStep));
    setCurrentStep(imagePath, newStep);

    // Save the mask alongside the (now-cropped) image for stitcher reference
    const maskPath = path.join(path.dirname(imagePath), path.parse(imagePath).name + '_mask.png');
    fs.writeFileSync(maskPath, maskBuf);

    const thumb = await generateThumbnail(imagePath);

    return {
      status: 'ok',
      output_path: imagePath,
      mask_path: maskPath,
      thumbnail: thumb,
      width: bboxW + 2 * PADDING_PX,
      height: bboxH + 2 * PADDING_PX,
    };
  } catch (err) {
    console.error('seg-apply-mask error:', err);
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('seg-server-status', async () => {
  return { ready: segBridge.isServerReady() };
});

// Clean up Python process on quit
app.on('before-quit', () => {
  segBridge.stopServer();
});

