const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Stitcher bridge
  getStitcherConfig: () => ipcRenderer.invoke('get-stitcher-config'),
  saveStitcherConfig: (config) => ipcRenderer.invoke('save-stitcher-config', config),
  verifyStitcherExe: (path) => ipcRenderer.invoke('verify-stitcher-exe', path),
  autoDetectStitcher: () => ipcRenderer.invoke('auto-detect-stitcher'),
  selectStitcherExe: () => ipcRenderer.invoke('select-stitcher-exe'),
  loadPicks: (subfolderPath) => ipcRenderer.invoke('load-picks', subfolderPath),
  savePicks: (subfolderPath, picks) => ipcRenderer.invoke('save-picks', subfolderPath, picks),
  exportSelected: (rootFolder, subfolderName, picks) => ipcRenderer.invoke('export-selected', rootFolder, subfolderName, picks),
  cleanTabletCache: (rootFolder, tablets) => ipcRenderer.invoke('clean-tablet-cache', rootFolder, tablets),
  processTablets: (rootFolder, tablets) => ipcRenderer.invoke('process-tablets', rootFolder, tablets),
  onStitcherProgress: (callback) => ipcRenderer.on('stitcher-progress', (event, data) => callback(data)),
  offStitcherProgress: () => ipcRenderer.removeAllListeners('stitcher-progress'),


  selectFolder: () => ipcRenderer.invoke('select-folder'),
  scanFolder: (path) => ipcRenderer.invoke('scan-folder', path),
  getThumbnail: (path) => ipcRenderer.invoke('get-thumbnail', path),
  getFullImage: (path) => ipcRenderer.invoke('get-full-image', path),
  getImageInfo: (path) => ipcRenderer.invoke('get-image-info', path),
  renameFiles: (subfolder, assignments, tabletId, allImagePaths) =>
    ipcRenderer.invoke('rename-files', subfolder, assignments, tabletId, allImagePaths),
  scanResults: (rootFolder) => ipcRenderer.invoke('scan-results', rootFolder),
  loadReviewStatus: (rootFolder) => ipcRenderer.invoke('load-review-status', rootFolder),
  saveReviewStatus: (rootFolder, status) => ipcRenderer.invoke('save-review-status', rootFolder, status),
  getResultThumbnail: (path) => ipcRenderer.invoke('get-result-thumbnail', path),
  revealInExplorer: (path) => ipcRenderer.invoke('reveal-in-explorer', path),
  rotateImage: (path, degrees) => ipcRenderer.invoke('rotate-image', path, degrees),
  rotateImagesBatch: (paths, degrees) => ipcRenderer.invoke('rotate-images-batch', paths, degrees),
  trimInRect: (path, rect, bgColor) => ipcRenderer.invoke('trim-in-rect', path, rect, bgColor),
});
