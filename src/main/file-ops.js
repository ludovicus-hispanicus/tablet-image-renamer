const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const exifr = require('exifr');

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp', '.heic', '.heif', '.cr3',
]);

const RAW_ARCHIVE_FOLDER = '_Raw';
const RAW_EXTENSIONS = new Set(['.cr3', '.heic', '.heif']);

/**
 * Detect true format of a file by reading its header.
 * Returns 'jpeg', 'cr3', 'heic', or 'unknown'.
 */
function detectTrueFormat(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);

    if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
    if (buf.slice(4, 8).toString() === 'ftyp') {
      const brand = buf.slice(8, 12).toString();
      if (brand === 'crx ') return 'cr3';
      return 'heic';
    }
    return 'unknown';
  } catch (e) {
    return 'unknown';
  }
}

/**
 * Preserve a raw file in the _Raw/ archive folder before conversion.
 */
function preserveRaw(filePath) {
  const folder = path.dirname(filePath);
  const filename = path.basename(filePath);
  const subfolderName = path.basename(folder);
  const rootFolder = path.dirname(folder);

  const archiveDir = path.join(rootFolder, RAW_ARCHIVE_FOLDER, subfolderName);
  const archivePath = path.join(archiveDir, filename);

  if (fs.existsSync(archivePath)) return true;

  try {
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.copyFileSync(filePath, archivePath);
    return true;
  } catch (err) {
    console.error(`  Could not archive raw ${filename}: ${err.message}`);
    return false;
  }
}

/**
 * Scan a root folder for subfolders containing images.
 * Returns { subfolders: [{ path, name, imageCount }], totalImages }
 */
function scanFolder(folderPath) {
  const result = { subfolders: [], totalImages: 0 };

  if (!fs.existsSync(folderPath)) return result;

  const entries = fs.readdirSync(folderPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;

    const subPath = path.join(folderPath, entry.name);
    const images = getImagesInFolder(subPath);

    if (images.length > 0) {
      result.subfolders.push({
        path: subPath,
        name: entry.name,
        imageCount: images.length,
        images: images,
      });
      result.totalImages += images.length;
    }
  }

  // Sort naturally (Si 1, Si 2, ... Si 10, Si 11)
  result.subfolders.sort((a, b) => {
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });

  return result;
}

/**
 * Get all image files in a folder.
 */
function getImagesInFolder(folderPath) {
  const files = fs.readdirSync(folderPath);
  const images = [];

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) {
      const fullPath = path.join(folderPath, file);
      if (fs.statSync(fullPath).isFile()) {
        images.push({
          path: fullPath,
          name: file,
          ext: ext,
          detectedView: detectViewCode(file),
        });
      }
    }
  }

  return images.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Detect if a filename already has a view code suffix.
 * Returns the view code or null.
 */
function detectViewCode(filename) {
  const nameNoExt = path.parse(filename).name;
  const match = nameNoExt.match(/_(0[1-6]|[o][tblr]|[r][tblr])$/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Extract the embedded JPEG preview from a raw file (CR3, HEIC, etc.).
 * Canon CR3 files always contain a JPEG thumbnail/preview.
 * Returns a Buffer of the JPEG, or null if extraction fails.
 */
async function extractRawPreview(imagePath) {
  try {
    // exifr.thumbnail() returns a Buffer of the embedded JPEG thumbnail
    const thumbBuf = await exifr.thumbnail(imagePath);
    if (thumbBuf && thumbBuf.length > 100) return thumbBuf;
    return null;
  } catch (err) {
    console.error(`Raw preview extraction error for ${path.basename(imagePath)}: ${err.message}`);
    return null;
  }
}

/**
 * Get a Sharp-readable input for a given image path.
 * For raw files (CR3, HEIC that Sharp can't read), extracts the embedded
 * JPEG preview first. Returns { input, isPreview } where input is either
 * the file path (for supported formats) or a Buffer (for raw previews).
 */
async function getSharpInput(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  const isRaw = RAW_EXTENSIONS.has(ext);

  if (!isRaw) {
    return { input: imagePath, isPreview: false };
  }

  // Try Sharp first — it handles HEIC on some builds
  try {
    await sharp(imagePath, { limitInputPixels: false }).metadata();
    return { input: imagePath, isPreview: false };
  } catch (_) {
    // Sharp can't handle this format — extract embedded preview
  }

  const preview = await extractRawPreview(imagePath);
  if (preview) {
    return { input: preview, isPreview: true };
  }

  return { input: null, isPreview: false };
}

/**
 * Generate a thumbnail as base64 data URL.
 */
async function generateThumbnail(imagePath) {
  try {
    const { input } = await getSharpInput(imagePath);
    if (!input) {
      console.error(`Cannot read ${path.basename(imagePath)}: unsupported raw format`);
      return null;
    }

    const buffer = await sharp(input, { limitInputPixels: false })
      .rotate() // auto-apply EXIF orientation
      .resize(250, 250, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  } catch (err) {
    console.error(`Thumbnail error for ${path.basename(imagePath)}: ${err.message}`);
    return null;
  }
}

/**
 * Get basic image info.
 */
async function getImageInfo(imagePath) {
  try {
    const { input } = await getSharpInput(imagePath);
    if (!input) {
      const stats = fs.statSync(imagePath);
      return { width: 0, height: 0, format: path.extname(imagePath).slice(1), size: stats.size };
    }
    const metadata = await sharp(input).metadata();
    const stats = fs.statSync(imagePath);
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      size: stats.size,
    };
  } catch (err) {
    return { width: 0, height: 0, format: 'unknown', size: 0 };
  }
}

/**
 * Rename files based on assignments.
 * assignments: { imagePath: viewCode }
 * Uses two-pass rename (via temp names) to avoid collisions.
 * Only assigned files are renamed — unassigned files are left untouched.
 */
async function renameFiles(subfolderPath, assignments, tabletId, allImagePaths) {
  const results = [];

  console.log(`\n=== RENAME START: ${tabletId} ===`);
  console.log(`  Folder: ${subfolderPath}`);
  console.log(`  Assignments: ${Object.keys(assignments).length}`);

  // Normalize tablet ID: replace spaces with dots (e.g., "Si 10" -> "Si.10")
  const normalizedId = tabletId.replace(/(\w+)\s+(\d+)/g, '$1.$2');

  // Normalize folder name if needed
  if (normalizedId !== tabletId) {
    const parentDir = path.dirname(subfolderPath);
    const newSubfolderPath = path.join(parentDir, normalizedId);
    if (!fs.existsSync(newSubfolderPath)) {
      try {
        fs.renameSync(subfolderPath, newSubfolderPath);
        subfolderPath = newSubfolderPath;
        console.log(`  Normalized folder: "${tabletId}" -> "${normalizedId}"`);
      } catch (err) {
        console.error(`  ERROR normalizing folder: ${err.message}`);
      }
    }
  }

  // Update image paths if folder was renamed
  const updatedAssignments = {};
  for (const [imagePath, viewCode] of Object.entries(assignments)) {
    const fileName = path.basename(imagePath);
    const updatedPath = path.join(subfolderPath, fileName);
    updatedAssignments[updatedPath] = viewCode;
    console.log(`  Assignment: ${fileName} -> _${viewCode}`);
  }

  // Build the rename plan: check what exists, what will collide
  const renamePlan = [];

  for (const [imagePath, viewCode] of Object.entries(updatedAssignments)) {
    if (!fs.existsSync(imagePath)) {
      console.error(`  SKIP: file not found: ${path.basename(imagePath)}`);
      results.push({ oldName: path.basename(imagePath), newName: '?', status: 'error', error: 'File not found' });
      continue;
    }

    const ext = path.extname(imagePath).toLowerCase();
    const trueFormat = detectTrueFormat(imagePath);
    const isRawContent = (trueFormat === 'cr3' || trueFormat === 'heic');
    const isRawExt = RAW_EXTENSIONS.has(ext);
    const needsConversion = isRawExt || isRawContent;
    const outExt = needsConversion ? '.jpg' : ext;
    const finalName = `${normalizedId}_${viewCode}${outExt}`;
    const finalPath = path.join(subfolderPath, finalName);

    // Skip if already has the correct name
    if (path.normalize(imagePath) === path.normalize(finalPath)) {
      console.log(`  SKIP (already correct): ${finalName}`);
      results.push({ oldName: path.basename(imagePath), newName: finalName, status: 'skipped' });
      continue;
    }

    renamePlan.push({
      originalPath: imagePath,
      oldName: path.basename(imagePath),
      finalPath,
      finalName,
      tempPath: path.join(subfolderPath, `_tmp_rename_${viewCode}${ext}`),
      needsConversion,
      trueFormat,
    });
  }

  // Add unassigned files to the plan with "unassigned" suffix
  if (allImagePaths && allImagePaths.length > 0) {
    const assignedPaths = new Set(Object.keys(updatedAssignments));
    let unassignedCount = 0;

    for (const imgPath of allImagePaths) {
      const updatedPath = path.join(subfolderPath, path.basename(imgPath));
      if (assignedPaths.has(updatedPath)) continue;
      if (!fs.existsSync(updatedPath)) continue;

      unassignedCount++;
      const ext = path.extname(updatedPath).toLowerCase();
      const suffix = unassignedCount === 1 ? 'unassigned' : `unassigned_${String(unassignedCount).padStart(2, '0')}`;
      const finalName = `${normalizedId}_${suffix}${ext}`;
      const finalPath = path.join(subfolderPath, finalName);

      if (path.normalize(updatedPath) === path.normalize(finalPath)) {
        results.push({ oldName: path.basename(updatedPath), newName: finalName, status: 'skipped' });
        continue;
      }

      renamePlan.push({
        originalPath: updatedPath,
        oldName: path.basename(updatedPath),
        finalPath,
        finalName,
        tempPath: path.join(subfolderPath, `_tmp_rename_${suffix}${ext}`),
        needsConversion: false,
        trueFormat: 'jpeg',
      });

      console.log(`  Unassigned: ${path.basename(updatedPath)} -> ${finalName}`);
    }
  }

  if (renamePlan.length === 0) {
    console.log('  Nothing to rename.');
    return results;
  }

  // Pass 1: move all assigned files to temp names
  const movedToTemp = [];
  for (const item of renamePlan) {
    try {
      // Preserve raw before moving
      if (item.needsConversion) {
        preserveRaw(item.originalPath);
      }
      fs.renameSync(item.originalPath, item.tempPath);
      movedToTemp.push(item);
      console.log(`  TEMP: ${item.oldName} -> ${path.basename(item.tempPath)}`);
    } catch (err) {
      console.error(`  ERROR moving to temp: ${item.oldName}: ${err.message}`);
      results.push({ oldName: item.oldName, newName: item.finalName, status: 'error', error: err.message });
    }
  }

  // Pass 2: move temp files to final names (with conversion if needed)
  for (const item of movedToTemp) {
    try {
      if (item.needsConversion && item.trueFormat === 'heic') {
        // Convert HEIC to JPEG via sharp (async)
        const buffer = await sharp(item.tempPath).jpeg({ quality: 95 }).toBuffer();
        fs.writeFileSync(item.finalPath, buffer);
        fs.unlinkSync(item.tempPath);
      } else {
        fs.renameSync(item.tempPath, item.finalPath);
      }
      console.log(`  OK: ${item.oldName} -> ${item.finalName}`);
      results.push({ oldName: item.oldName, newName: item.finalName, status: 'ok' });
    } catch (err) {
      console.error(`  ERROR finalizing: ${item.oldName} -> ${item.finalName}: ${err.message}`);
      results.push({ oldName: item.oldName, newName: item.finalName, status: 'error', error: err.message });
      // Restore original name
      try {
        fs.renameSync(item.tempPath, item.originalPath);
        console.log(`  RESTORED: ${item.oldName}`);
      } catch (restoreErr) {
        console.error(`  CRITICAL: Could not restore ${item.oldName}: ${restoreErr.message}`);
      }
    }
  }

  console.log(`=== RENAME DONE: ${results.filter(r => r.status === 'ok').length} ok, ${results.filter(r => r.status === 'error').length} errors ===\n`);
  return results;
}

module.exports = { scanFolder, generateThumbnail, renameFiles, getImageInfo, getSharpInput };
