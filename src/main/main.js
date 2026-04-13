const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { scanFolder, generateThumbnail, renameFiles, getImageInfo } = require('./file-ops');
const {
  loadStitcherConfig,
  saveStitcherConfig,
  verifyStitcherPath,
  loadStitcherProjects,
  processStitcherTablets,
} = require('./stitcher-bridge');

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

ipcMain.handle('verify-stitcher-path', async (event, stitcherPath) => {
  return verifyStitcherPath(stitcherPath);
});

ipcMain.handle('get-stitcher-projects', async (event, stitcherPath) => {
  return loadStitcherProjects(stitcherPath);
});

ipcMain.handle('select-stitcher-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select ebl-photo-stitcher folder (must contain process_tablets.py)',
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});


ipcMain.handle('process-tablets', async (event, rootFolder, tablets) => {
  const config = loadStitcherConfig();
  return processStitcherTablets(config, rootFolder, tablets, (progress) => {
    mainWindow.webContents.send('stitcher-progress', progress);
  });
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
