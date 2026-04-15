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

ipcMain.handle('rotate-image', async (event, imagePath, degrees) => {
  const sharp = require('sharp');
  try {
    const buffer = await sharp(imagePath)
      .rotate(degrees)
      .toBuffer();
    // Overwrite the original file
    const fs = require('fs');
    fs.writeFileSync(imagePath, buffer);
    // Return new thumbnail
    return generateThumbnail(imagePath);
  } catch (err) {
    console.error('Error rotating image:', err.message);
    return null;
  }
});

ipcMain.handle('rotate-images-batch', async (event, imagePaths, degrees) => {
  const sharp = require('sharp');
  const results = [];
  for (const imagePath of imagePaths) {
    try {
      const buffer = await sharp(imagePath)
        .rotate(degrees)
        .toBuffer();
      const fs = require('fs');
      fs.writeFileSync(imagePath, buffer);
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
    const subPath = path.join(folderPath, entry.name);
    const files = fs.readdirSync(subPath);
    const imageFiles = files.filter(f => imageExts.has(path.extname(f).toLowerCase()));
    if (imageFiles.length > 0) {
      results.push({ name: entry.name, path: subPath, imageCount: imageFiles.length });
    }
  }
  results.sort((a, b) => a.name.localeCompare(b.name));
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

// === Trim to Object (user-drawn rectangle) ===
// The renderer sends normalized coordinates (0..1) of a rectangle drawn on the
// post-EXIF-rotation image. This handler extracts that region, runs sharp.trim
// to find the tight edges of the tablet *within* the rectangle, adds 20px padding
// (clamped to image bounds), flattens against the chosen bg, backs up the original
// to _Raw/, and overwrites the file.
ipcMain.handle('trim-in-rect', async (event, imagePath, normRect, bgColor) => {
  const sharp = require('sharp');
  const PAD = 20;
  const TRIM_THRESHOLD = 10;

  try {
    // Get post-EXIF-rotation dimensions. Sharp's metadata() returns the raw
    // file dimensions; for orientations 5..8 the visual width/height are swapped.
    const meta = await sharp(imagePath, { limitInputPixels: false }).metadata();
    const orient = meta.orientation || 1;
    let origW, origH;
    if (orient >= 5 && orient <= 8) {
      origW = meta.height;
      origH = meta.width;
    } else {
      origW = meta.width;
      origH = meta.height;
    }

    // Convert normalized rect to pixel coordinates
    const urLeft = Math.max(0, Math.round(normRect.left * origW));
    const urTop = Math.max(0, Math.round(normRect.top * origH));
    const urRight = Math.min(origW, Math.round((normRect.left + normRect.width) * origW));
    const urBottom = Math.min(origH, Math.round((normRect.top + normRect.height) * origH));
    const urW = urRight - urLeft;
    const urH = urBottom - urTop;

    if (urW < 10 || urH < 10) {
      return { status: 'error', error: 'Rectangle too small' };
    }

    // Step 1: extract the user region into memory
    const regionBuf = await sharp(imagePath, { limitInputPixels: false })
      .rotate()
      .extract({ left: urLeft, top: urTop, width: urW, height: urH })
      .toBuffer();

    // Step 2: trim the extracted region to find the tablet edges
    let tightLeftInRegion = 0;
    let tightTopInRegion = 0;
    let tightW = urW;
    let tightH = urH;
    try {
      const trimmed = await sharp(regionBuf)
        .trim({ threshold: TRIM_THRESHOLD })
        .toBuffer({ resolveWithObject: true });
      tightLeftInRegion = -(trimmed.info.trimOffsetLeft || 0);
      tightTopInRegion = -(trimmed.info.trimOffsetTop || 0);
      tightW = trimmed.info.width;
      tightH = trimmed.info.height;
    } catch (trimErr) {
      // Uniform region — fall back to using the user rect as-is
      console.warn('Trim fallback (uniform region):', trimErr.message);
    }

    // Step 3: translate back to original-image coordinates and add padding
    const tightLeft = urLeft + tightLeftInRegion;
    const tightTop = urTop + tightTopInRegion;

    const padLeft = Math.max(0, tightLeft - PAD);
    const padTop = Math.max(0, tightTop - PAD);
    const padRight = Math.min(origW, tightLeft + tightW + PAD);
    const padBottom = Math.min(origH, tightTop + tightH + PAD);

    const finalBox = {
      left: padLeft,
      top: padTop,
      width: padRight - padLeft,
      height: padBottom - padTop,
    };

    // Step 4: backup original to _Raw/
    const folder = path.dirname(imagePath);
    const filename = path.basename(imagePath);
    const subfolderName = path.basename(folder);
    const rootFolder = path.dirname(folder);
    const archiveDir = path.join(rootFolder, '_Raw', subfolderName);
    const archivePath = path.join(archiveDir, filename);
    if (!fs.existsSync(archivePath)) {
      fs.mkdirSync(archiveDir, { recursive: true });
      fs.copyFileSync(imagePath, archivePath);
    }

    // Step 5: extract, flatten, overwrite
    const bg = bgColor === 'black'
      ? { r: 0, g: 0, b: 0, alpha: 1 }
      : { r: 255, g: 255, b: 255, alpha: 1 };

    const outBuf = await sharp(imagePath, { limitInputPixels: false })
      .rotate()
      .extract(finalBox)
      .flatten({ background: bg })
      .jpeg({ quality: 95 })
      .toBuffer();

    fs.writeFileSync(imagePath, outBuf);

    const thumb = await generateThumbnail(imagePath);
    return {
      status: 'ok',
      thumbnail: thumb,
      finalBox,
      newWidth: finalBox.width,
      newHeight: finalBox.height,
    };
  } catch (err) {
    console.error('trim-in-rect error:', err.message);
    return { status: 'error', error: err.message };
  }
});

