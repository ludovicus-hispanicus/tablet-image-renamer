const fs = require('fs');
const path = require('path');

const FINAL_JPG_FOLDER = '_Final_JPG';
const FINAL_TIFF_FOLDER = '_Final_TIFF';
const REVIEW_STATUS_FILE = 'review_status.json';

/**
 * Scan for stitched results in _Final_JPG.
 * Returns { hasResults, results: [{ name, jpgPath, tiffPath }] }
 */
function scanResults(rootFolder) {
  const jpgFolder = path.join(rootFolder, FINAL_JPG_FOLDER);
  const tiffFolder = path.join(rootFolder, FINAL_TIFF_FOLDER);

  const result = { hasResults: false, results: [], jpgFolder, tiffFolder };

  if (!fs.existsSync(jpgFolder)) return result;

  const files = fs.readdirSync(jpgFolder);
  const jpgFiles = files.filter(f => /\.(jpg|jpeg)$/i.test(f));

  if (jpgFiles.length === 0) return result;

  result.hasResults = true;

  // Sort naturally
  jpgFiles.sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  );

  for (const file of jpgFiles) {
    const baseName = path.parse(file).name;
    const jpgPath = path.join(jpgFolder, file);

    // Check for matching TIFF
    let tiffPath = null;
    if (fs.existsSync(tiffFolder)) {
      const tiffFile = fs.readdirSync(tiffFolder).find(f =>
        path.parse(f).name === baseName && /\.(tif|tiff)$/i.test(f)
      );
      if (tiffFile) tiffPath = path.join(tiffFolder, tiffFile);
    }

    result.results.push({
      name: baseName,
      jpgPath,
      tiffPath,
    });
  }

  return result;
}

/**
 * Load review status. Checks root folder first, then legacy _Final_JPG/ location.
 * Returns { tabletName: { status, notes, reviewedBy, reviewedAt } }
 */
function loadReviewStatus(rootFolder) {
  // Primary: root-level file
  const rootFile = path.join(rootFolder, REVIEW_STATUS_FILE);
  if (fs.existsSync(rootFile)) {
    try {
      return JSON.parse(fs.readFileSync(rootFile, 'utf8'));
    } catch (err) {
      console.error('Error loading review status:', err.message);
    }
  }

  // Legacy: _Final_JPG/review_status.json
  const legacyFile = path.join(rootFolder, FINAL_JPG_FOLDER, REVIEW_STATUS_FILE);
  if (fs.existsSync(legacyFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
      // Migrate: save to root level
      saveReviewStatus(rootFolder, data);
      return data;
    } catch (err) {
      console.error('Error loading legacy review status:', err.message);
    }
  }

  return {};
}

/**
 * Save review status to root folder (review_status.json).
 */
function saveReviewStatus(rootFolder, status) {
  const statusFile = path.join(rootFolder, REVIEW_STATUS_FILE);

  try {
    fs.writeFileSync(statusFile, JSON.stringify(status, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving review status:', err.message);
    return false;
  }
}

module.exports = { scanResults, loadReviewStatus, saveReviewStatus };
