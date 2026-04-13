// === State ===
const state = {
  rootFolder: null,
  subfolders: [],
  currentIndex: -1,
  images: [],
  selectedImage: null,       // primary selection (for assignment)
  selectedImages: new Set(),  // multi-selection (for rotation, etc.)
  lastClickedIndex: -1,       // for shift-click range selection
  assignments: {},            // imagePath -> viewCode
  reverseAssignments: {},     // viewCode -> imagePath
  comboPending: null,
  comboTimer: null,
};

const VIEW_CODES = {
  '01': 'obverse', '02': 'reverse', '03': 'top',
  '04': 'bottom', '05': 'left', '06': 'right',
  'ot': 'obverse top', 'ob': 'obverse bottom',
  'ol': 'obverse left', 'or': 'obverse right',
  'rt': 'reverse top', 'rb': 'reverse bottom',
  'rl': 'reverse left', 'rr': 'reverse right',
};

const SHORTCUT_MAP = {
  '1': '01', '2': '02', '3': '03',
  '4': '04', '5': '05', '6': '06',
};

const COMBO_FIRST = new Set(['o', 'r']);
const COMBO_SECOND = new Set(['t', 'b', 'l', 'r']);

// === DOM References ===
const dom = {
  btnBrowse: document.getElementById('btn-browse'),
  folderPath: document.getElementById('folder-path'),
  btnPrev: document.getElementById('btn-prev'),
  btnNext: document.getElementById('btn-next'),
  btnSkip: document.getElementById('btn-skip'),
  subfolderInfo: document.getElementById('subfolder-info'),
  thumbGrid: document.getElementById('thumb-grid'),
  btnConfirm: document.getElementById('btn-confirm'),
  btnReset: document.getElementById('btn-reset'),
  statusText: document.getElementById('status-text'),
  statusCount: document.getElementById('status-count'),
  comboIndicator: document.getElementById('combo-indicator'),
  // Thumbnails panel modes
  thumbGridMode: document.getElementById('thumb-grid-mode'),
  viewerMode: document.getElementById('viewer-mode'),
  viewerStage: document.getElementById('viewer-stage'),
  viewerImage: document.getElementById('viewer-image'),
  viewerInfo: document.getElementById('viewer-info'),
};

// === Initialization ===
dom.btnBrowse.addEventListener('click', onBrowse);
dom.btnPrev.addEventListener('click', () => navigateSubfolder(-1));
dom.btnNext.addEventListener('click', () => navigateSubfolder(1));
dom.btnSkip.addEventListener('click', () => navigateSubfolder(1));
dom.btnConfirm.addEventListener('click', onConfirm);
dom.btnReset.addEventListener('click', onReset);

// Viewer mode controls
document.getElementById('viewer-back').addEventListener('click', exitViewerMode);
document.getElementById('viewer-prev').addEventListener('click', () => viewerNavigate(-1));
document.getElementById('viewer-next').addEventListener('click', () => viewerNavigate(1));
document.getElementById('viewer-reveal').addEventListener('click', () => {
  if (viewerCurrentPath) window.api.revealInExplorer(viewerCurrentPath);
});
document.getElementById('viewer-rot-ccw').addEventListener('click', () => viewerRotate(-90));
document.getElementById('viewer-rot-180').addEventListener('click', () => viewerRotate(180));
document.getElementById('viewer-rot-cw').addEventListener('click', () => viewerRotate(90));

// Sidebar rotation controls (still work, use selection)
document.getElementById('btn-rot-ccw').addEventListener('click', () => rotateSelected(-90));
document.getElementById('btn-rot-180').addEventListener('click', () => rotateSelected(180));
document.getElementById('btn-rot-cw').addEventListener('click', () => rotateSelected(90));

document.addEventListener('keydown', onKeyDown);

// Slot clicks
document.querySelectorAll('.slot[data-code]').forEach(slot => {
  slot.addEventListener('click', () => {
    assignCurrentImage(slot.dataset.code);
  });

  // Drop target
  slot.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    slot.classList.add('drag-over');
  });
  slot.addEventListener('dragleave', () => {
    slot.classList.remove('drag-over');
  });
  slot.addEventListener('drop', (e) => {
    e.preventDefault();
    slot.classList.remove('drag-over');
    const imagePath = e.dataTransfer.getData('text/plain');
    if (imagePath) {
      // Select the dropped image, then assign
      selectImage(imagePath);
      assignCurrentImage(slot.dataset.code);
    }
  });
});

// Help overlay
document.getElementById('btn-help').addEventListener('click', toggleHelp);
document.getElementById('help-close').addEventListener('click', toggleHelp);
document.getElementById('help-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'help-overlay') toggleHelp();
});

function toggleHelp() {
  document.getElementById('help-overlay').classList.toggle('hidden');
}

// === Resizable divider ===
const divider = document.getElementById('panel-divider');
const panelRight = document.getElementById('panel-right');
let isResizing = false;

divider.addEventListener('mousedown', (e) => {
  isResizing = true;
  divider.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const newWidth = document.body.clientWidth - e.clientX;
  const clamped = Math.max(380, Math.min(newWidth, window.innerWidth * 0.7));
  panelRight.style.width = clamped + 'px';
});

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    divider.classList.remove('dragging');
    document.body.style.cursor = '';
  }
});

// === Right Panel Tabs ===
document.querySelectorAll('.right-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.right-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');

    activeTab = tab.dataset.tab;
    if (activeTab === 'results') {
      showResultThumbnails();
    } else if (activeTab === 'tools') {
      loadCurrentSubfolder();
      updateToolInfo();
    } else {
      // Restore source image thumbnails
      loadCurrentSubfolder();
    }
  });
});

// Results tab controls
document.getElementById('result-save-notes').addEventListener('click', saveCurrentNotes);
document.getElementById('btn-reprocess-updated').addEventListener('click', reprocessUpdated);
document.getElementById('btn-reprocess-all').addEventListener('click', reprocessAll);

// Settings dialog
document.getElementById('btn-settings').addEventListener('click', openSettings);
document.getElementById('settings-close').addEventListener('click', closeSettings);
document.getElementById('settings-save').addEventListener('click', saveSettings);
document.getElementById('setting-browse-stitcher').addEventListener('click', browseStitcherExe);
document.getElementById('settings-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'settings-overlay') closeSettings();
});

// Stitcher progress
window.api.onStitcherProgress((event) => {
  handleStitcherProgress(event);
});
document.getElementById('result-preview-close').addEventListener('click', closeResultPreview);
document.getElementById('result-preview-prev').addEventListener('click', () => navigateResultPreview(-1));
document.getElementById('result-preview-next').addEventListener('click', () => navigateResultPreview(1));
document.getElementById('result-toggle-revision').addEventListener('click', () => setResultStatus('revision'));
document.getElementById('result-toggle-updated').addEventListener('click', () => setResultStatus('updated'));
document.getElementById('result-preview-reveal').addEventListener('click', () => {
  if (resultsState.results[resultsState.currentIndex]) {
    window.api.revealInExplorer(resultsState.results[resultsState.currentIndex].jpgPath);
  }
});
document.getElementById('result-preview-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'result-preview-overlay') closeResultPreview();
});

// Ctrl+A to select all
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'a') {
    e.preventDefault();
    selectAll();
  }
});

// === Browse ===
async function onBrowse() {
  const folder = await window.api.selectFolder();
  if (!folder) return;
  await openFolder(folder);
}

async function openFolder(folder) {
  state.rootFolder = folder;
  dom.folderPath.textContent = folder;
  localStorage.setItem('lastFolder', folder);
  setStatus('Scanning folder...');

  const result = await window.api.scanFolder(folder);
  state.subfolders = result.subfolders;

  if (state.subfolders.length === 0) {
    setStatus('No subfolders with images found.');
    return;
  }

  setStatus(`Found ${state.subfolders.length} subfolder(s) with ${result.totalImages} images.`);
  state.currentIndex = 0;
  buildTreeView();
  loadResults();
  loadCurrentSubfolder();
}

// Restore last folder on startup
(async () => {
  const lastFolder = localStorage.getItem('lastFolder');
  if (lastFolder) {
    openFolder(lastFolder);
  }
})();

// === Tree View ===
function buildTreeView() {
  const treeList = document.getElementById('tree-list');
  treeList.innerHTML = '';

  state.subfolders.forEach((sub, idx) => {
    const item = document.createElement('div');
    item.className = 'tree-item';
    item.dataset.index = idx;
    item.innerHTML = `${sub.name}<span class="tree-count">(${sub.imageCount})</span>`;
    item.addEventListener('click', () => {
      state.currentIndex = idx;
      loadCurrentSubfolder();
    });
    treeList.appendChild(item);
  });
}

function updateTreeActive() {
  document.querySelectorAll('.tree-item').forEach(item => {
    item.classList.toggle('active', parseInt(item.dataset.index) === state.currentIndex);
  });
  // Scroll active into view
  const active = document.querySelector('.tree-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

// === Subfolder Navigation ===
function navigateSubfolder(direction) {
  const newIndex = state.currentIndex + direction;
  if (newIndex < 0 || newIndex >= state.subfolders.length) return;
  state.currentIndex = newIndex;
  loadCurrentSubfolder();
}

async function loadCurrentSubfolder() {
  const sub = state.subfolders[state.currentIndex];
  const total = state.subfolders.length;

  dom.subfolderInfo.textContent = `${sub.name}  (${state.currentIndex + 1} / ${total})`;
  dom.btnPrev.disabled = state.currentIndex === 0;
  dom.btnNext.disabled = state.currentIndex >= total - 1;
  dom.btnSkip.disabled = state.currentIndex >= total - 1;
  updateTreeActive();

  // Reset state
  state.images = sub.images;
  state.selectedImage = null;
  state.selectedImages.clear();
  state.lastClickedIndex = -1;
  state.assignments = {};
  state.reverseAssignments = {};

  // Auto-detect existing assignments
  for (const img of state.images) {
    if (img.detectedView && !state.reverseAssignments[img.detectedView]) {
      state.assignments[img.path] = img.detectedView;
      state.reverseAssignments[img.detectedView] = img.path;
    }
  }

  // Render thumbnails
  dom.thumbGrid.innerHTML = '';
  setStatus(`Loading ${state.images.length} thumbnails...`);

  for (const img of state.images) {
    const card = createThumbCard(img);
    dom.thumbGrid.appendChild(card);
    loadThumbnail(img.path, card);
  }

  // Select first image
  if (state.images.length > 0) {
    selectImage(state.images[0].path);
  }

  updateStructureDiagram();
  updateButtons();
  updateStatusCount();
  updateResultsTab();
}

function createThumbCard(img) {
  const card = document.createElement('div');
  card.className = 'thumb-card';
  card.dataset.path = img.path;

  if (state.assignments[img.path]) {
    card.classList.add('assigned');
  }

  // Assignment badge (top-right)
  const badge = document.createElement('div');
  badge.className = 'thumb-badge';
  const code = state.assignments[img.path];
  badge.textContent = code ? `_${code}` : '';
  card.appendChild(badge);

  // Image
  const imgEl = document.createElement('img');
  imgEl.alt = img.name;
  imgEl.src = '';
  card.appendChild(imgEl);

  // Floating rotation buttons (appear on hover/selection)
  const rotBar = document.createElement('div');
  rotBar.className = 'thumb-rotate-bar';
  rotBar.innerHTML = `
    <button class="rot-btn" data-deg="-90" title="Rotate 90° CCW">&#x21B6;</button>
    <button class="rot-btn" data-deg="180" title="Rotate 180°">&#x21BB;</button>
    <button class="rot-btn" data-deg="90" title="Rotate 90° CW">&#x21B7;</button>
  `;
  card.appendChild(rotBar);

  // Rotation button clicks — rotate THIS card's image, not the global selection
  rotBar.querySelectorAll('.rot-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const degrees = parseInt(btn.dataset.deg);
      rotateSingleImage(img.path, degrees, card);
    });
  });

  // Filename
  const name = document.createElement('div');
  name.className = 'thumb-name';
  name.textContent = img.name;
  card.appendChild(name);

  // Drag support
  card.setAttribute('draggable', 'true');
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', img.path);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
  });

  // Right-click: reveal in explorer
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.api.revealInExplorer(img.path);
  });

  // Click handlers with modifier support
  card.addEventListener('click', (e) => {
    if (e.target.closest('.rot-btn')) return;
    handleThumbClick(img.path, e);
  });
  card.addEventListener('dblclick', (e) => {
    if (e.target.closest('.rot-btn')) return;
    enterViewerMode(img.path);
  });

  return card;
}

async function loadThumbnail(imagePath, card) {
  const dataUrl = await window.api.getThumbnail(imagePath);
  if (dataUrl) {
    const imgEl = card.querySelector('img');
    imgEl.src = dataUrl;
  }
}

// === Selection ===

function handleThumbClick(imagePath, event) {
  const clickedIndex = state.images.findIndex(i => i.path === imagePath);

  if (event.shiftKey && state.lastClickedIndex >= 0) {
    // Shift+click: range selection
    const start = Math.min(state.lastClickedIndex, clickedIndex);
    const end = Math.max(state.lastClickedIndex, clickedIndex);
    state.selectedImages.clear();
    for (let i = start; i <= end; i++) {
      state.selectedImages.add(state.images[i].path);
    }
    state.selectedImage = imagePath;
  } else if (event.ctrlKey || event.metaKey) {
    // Ctrl+click: toggle individual
    if (state.selectedImages.has(imagePath)) {
      state.selectedImages.delete(imagePath);
      // If we deselected the primary, pick another
      if (state.selectedImage === imagePath) {
        state.selectedImage = state.selectedImages.size > 0
          ? state.selectedImages.values().next().value
          : null;
      }
    } else {
      state.selectedImages.add(imagePath);
      state.selectedImage = imagePath;
    }
    state.lastClickedIndex = clickedIndex;
  } else {
    // Normal click: single selection
    state.selectedImages.clear();
    state.selectedImages.add(imagePath);
    state.selectedImage = imagePath;
    state.lastClickedIndex = clickedIndex;
  }

  updateSelectionUI();
  updateStatusCount();
}

function selectImage(imagePath) {
  // Single selection (used by keyboard nav, auto-advance)
  state.selectedImages.clear();
  state.selectedImages.add(imagePath);
  state.selectedImage = imagePath;
  state.lastClickedIndex = state.images.findIndex(i => i.path === imagePath);

  updateSelectionUI();
  updateStatusCount();
}

function selectAll() {
  state.selectedImages.clear();
  for (const img of state.images) {
    state.selectedImages.add(img.path);
  }
  if (state.images.length > 0 && !state.selectedImage) {
    state.selectedImage = state.images[0].path;
  }
  updateSelectionUI();
  updateStatusCount();
}

function selectAdjacent(direction) {
  if (!state.images.length) return;

  let idx = state.images.findIndex(img => img.path === state.selectedImage);
  if (idx === -1) idx = 0;

  const newIdx = idx + direction;
  if (newIdx >= 0 && newIdx < state.images.length) {
    selectImage(state.images[newIdx].path);
  }
}

function updateSelectionUI() {
  // Update all cards
  document.querySelectorAll('.thumb-card').forEach(card => {
    const path = card.dataset.path;
    const isSelected = state.selectedImages.has(path);
    const isPrimary = path === state.selectedImage;

    card.classList.toggle('selected', isSelected);
    card.classList.toggle('primary', isPrimary);
  });

  // Scroll primary into view
  if (state.selectedImage) {
    const card = getCardForImage(state.selectedImage);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // If the viewer is open, swap its image to match the newly selected one
  if (isViewerOpen() && state.selectedImage && state.selectedImage !== viewerCurrentPath) {
    loadViewerImage(state.selectedImage);
  }

  // Keep the Tools tab Info section fresh
  if (activeTab === 'tools') updateToolInfo();
}

// === Assignment ===
function assignCurrentImage(viewCode) {
  if (!state.selectedImage || !VIEW_CODES[viewCode]) return;

  const oldCode = state.assignments[state.selectedImage];
  if (oldCode) {
    delete state.reverseAssignments[oldCode];
  }

  const oldImage = state.reverseAssignments[viewCode];
  if (oldImage) {
    delete state.assignments[oldImage];
    updateCardBadge(oldImage);
  }

  state.assignments[state.selectedImage] = viewCode;
  state.reverseAssignments[viewCode] = state.selectedImage;

  updateCardBadge(state.selectedImage);
  updateStructureDiagram();
  updateButtons();
  updateStatusCount();

  autoAdvanceSelection();
}

function unassignCurrentImage() {
  if (!state.selectedImage) return;

  const code = state.assignments[state.selectedImage];
  if (!code) return;

  delete state.reverseAssignments[code];
  delete state.assignments[state.selectedImage];

  updateCardBadge(state.selectedImage);
  updateStructureDiagram();
  updateButtons();
  updateStatusCount();
}

function autoAdvanceSelection() {
  const currentIdx = state.images.findIndex(img => img.path === state.selectedImage);

  for (let i = currentIdx + 1; i < state.images.length; i++) {
    if (!state.assignments[state.images[i].path]) {
      selectImage(state.images[i].path);
      return;
    }
  }
  for (let i = 0; i < currentIdx; i++) {
    if (!state.assignments[state.images[i].path]) {
      selectImage(state.images[i].path);
      return;
    }
  }
}

// === Keyboard ===
function onKeyDown(e) {
  // Close overlays on Escape
  if (e.key === 'Escape') {
    if (!document.getElementById('result-preview-overlay').classList.contains('hidden')) { closeResultPreview(); return; }
    if (isViewerOpen()) {
      // Esc priority: cancel rect → deactivate tool → exit viewer
      if (previewTool.rectDisplay) { clearViewerRect(); e.preventDefault(); return; }
      if (previewTool.active) { setActiveTool(previewTool.active); e.preventDefault(); return; }
      exitViewerMode(); return;
    }
    if (!document.getElementById('help-overlay').classList.contains('hidden')) { toggleHelp(); return; }
  }

  // Result preview mode
  if (!document.getElementById('result-preview-overlay').classList.contains('hidden')) {
    if (e.key === 'ArrowLeft') { navigateResultPreview(-1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { navigateResultPreview(1); e.preventDefault(); }
    else if (e.key.toLowerCase() === 'r') { setResultStatus('revision'); e.preventDefault(); }
    else if (e.key.toLowerCase() === 'u') { setResultStatus('updated'); e.preventDefault(); }
    return;
  }

  // Viewer mode: arrow navigation, rotation, tool shortcuts
  if (isViewerOpen()) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft' && e.shiftKey) {
      viewerRotate(-90); e.preventDefault();
    } else if (e.key === 'ArrowRight' && e.shiftKey) {
      viewerRotate(90); e.preventDefault();
    } else if (e.key === 'ArrowDown' && e.shiftKey) {
      viewerRotate(180); e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      viewerNavigate(-1); e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      viewerNavigate(1); e.preventDefault();
    } else if (e.key === 't' || e.key === 'T') {
      setActiveTool('trim'); e.preventDefault();
    } else if (e.key === 'Enter' && previewTool.rectDisplay && !previewTool.drawing) {
      applyViewerRect(); e.preventDefault();
    }
    return;
  }

  if (!document.getElementById('help-overlay').classList.contains('hidden')) return;

  const key = e.key.toLowerCase();

  // Handle pending combo
  if (state.comboPending) {
    if (COMBO_SECOND.has(key)) {
      const combo = state.comboPending + key;
      clearCombo();
      if (VIEW_CODES[combo]) {
        assignCurrentImage(combo);
      }
      e.preventDefault();
      return;
    } else {
      clearCombo();
    }
  }

  // Start combo
  if (COMBO_FIRST.has(key) && !e.ctrlKey && !e.altKey) {
    state.comboPending = key;
    dom.comboIndicator.textContent = `${key.toUpperCase()} + ?`;
    dom.comboIndicator.classList.remove('hidden');
    state.comboTimer = setTimeout(clearCombo, 800);
    e.preventDefault();
    return;
  }

  // Single key shortcuts
  if (SHORTCUT_MAP[key] && !e.ctrlKey && !e.altKey) {
    assignCurrentImage(SHORTCUT_MAP[key]);
    e.preventDefault();
    return;
  }

  if (key === 'u') {
    unassignCurrentImage();
    e.preventDefault();
  } else if (e.key === 'ArrowLeft' && e.shiftKey) {
    rotateSelected(-90);
    e.preventDefault();
  } else if (e.key === 'ArrowRight' && e.shiftKey) {
    rotateSelected(90);
    e.preventDefault();
  } else if (e.key === 'ArrowDown' && e.shiftKey) {
    rotateSelected(180);
    e.preventDefault();
  } else if (e.key === 'ArrowLeft') {
    selectAdjacent(-1);
    e.preventDefault();
  } else if (e.key === 'ArrowRight') {
    selectAdjacent(1);
    e.preventDefault();
  } else if (e.key === 'Enter') {
    onConfirm();
    e.preventDefault();
  } else if (e.key === ' ') {
    if (state.selectedImage) enterViewerMode(state.selectedImage);
    e.preventDefault();
  }
}

function clearCombo() {
  state.comboPending = null;
  if (state.comboTimer) {
    clearTimeout(state.comboTimer);
    state.comboTimer = null;
  }
  dom.comboIndicator.classList.add('hidden');
}

// === Preview ===
// === Viewer Mode (replaces modal preview overlay) ===
let viewerCurrentPath = null;

function isViewerOpen() {
  return !dom.viewerMode.classList.contains('hidden');
}

async function enterViewerMode(imagePath) {
  if (!imagePath) return;
  viewerCurrentPath = imagePath;
  dom.thumbGridMode.classList.add('hidden');
  dom.viewerMode.classList.remove('hidden');
  await loadViewerImage(imagePath);
  updateToolInfo();
}

function exitViewerMode() {
  dom.viewerMode.classList.add('hidden');
  dom.thumbGridMode.classList.remove('hidden');
  dom.viewerImage.src = '';
  viewerCurrentPath = null;
  clearViewerRect();
}

async function loadViewerImage(imagePath) {
  viewerCurrentPath = imagePath;
  dom.viewerImage.src = '';
  clearViewerRect();

  const idx = state.images.findIndex(i => i.path === imagePath);
  const total = state.images.length;
  const name = state.images[idx]?.name || '';
  const code = state.assignments[imagePath];
  const viewName = code ? `${VIEW_CODES[code]} (_${code})` : 'unassigned';
  dom.viewerInfo.textContent = `${name}  |  ${viewName}  |  ${idx + 1}/${total}`;

  const dataUrl = await window.api.getFullImage(imagePath);
  if (dataUrl && viewerCurrentPath === imagePath) {
    dom.viewerImage.src = dataUrl;
  }
  updateToolInfo();
}

function viewerNavigate(direction) {
  if (!viewerCurrentPath) return;
  const idx = state.images.findIndex(i => i.path === viewerCurrentPath);
  const newIdx = idx + direction;
  if (newIdx >= 0 && newIdx < state.images.length) {
    const newPath = state.images[newIdx].path;
    selectImage(newPath);
    loadViewerImage(newPath);
  }
}

async function viewerRotate(degrees) {
  if (!viewerCurrentPath) return;
  dom.viewerInfo.textContent = `Rotating ${degrees}\u00B0...`;
  const newThumb = await window.api.rotateImage(viewerCurrentPath, degrees);
  if (newThumb) {
    const card = getCardForImage(viewerCurrentPath);
    if (card) card.querySelector('img').src = newThumb;
  }
  await loadViewerImage(viewerCurrentPath);
}

// === Rotation ===
async function rotateSingleImage(imagePath, degrees, card) {
  setStatus(`Rotating by ${degrees}\u00B0...`);
  const newThumb = await window.api.rotateImage(imagePath, degrees);
  if (newThumb && card) {
    card.querySelector('img').src = newThumb;
  }
  setStatus(`Rotated by ${degrees}\u00B0.`);
}

async function rotateSelected(degrees) {
  // Determine which images to rotate
  const paths = state.selectedImages.size > 1
    ? [...state.selectedImages]
    : (state.selectedImage ? [state.selectedImage] : []);

  if (paths.length === 0) return;

  if (paths.length === 1) {
    setStatus(`Rotating by ${degrees}\u00B0...`);
    const newThumb = await window.api.rotateImage(paths[0], degrees);
    if (newThumb) {
      const card = getCardForImage(paths[0]);
      if (card) card.querySelector('img').src = newThumb;
      setStatus(`Rotated by ${degrees}\u00B0.`);
    } else {
      setStatus('Rotation failed.');
    }
  } else {
    setStatus(`Rotating ${paths.length} images by ${degrees}\u00B0...`);
    const results = await window.api.rotateImagesBatch(paths, degrees);
    for (const result of results) {
      if (result.thumbnail) {
        const card = getCardForImage(result.path);
        if (card) card.querySelector('img').src = result.thumbnail;
      }
    }
    const okCount = results.filter(r => r.status === 'ok').length;
    setStatus(`Rotated ${okCount} image(s) by ${degrees}\u00B0.`);
  }
}

// === Confirm / Reset ===
async function onConfirm() {
  const count = Object.keys(state.assignments).length;
  if (count === 0) {
    alert('No images have been assigned.');
    return;
  }

  const sub = state.subfolders[state.currentIndex];
  const tabletId = sub.name;
  const normalizedId = tabletId.replace(/(\w+)\s+(\d+)/g, '$1.$2');

  // Build summary: assigned files
  const assignedLines = Object.entries(state.assignments)
    .sort(([, a], [, b]) => a.localeCompare(b))
    .map(([imgPath, code]) => {
      const oldName = state.images.find(i => i.path === imgPath)?.name || '';
      const ext = oldName.substring(oldName.lastIndexOf('.')).toLowerCase();
      const newName = `${normalizedId}_${code}${ext}`;
      if (oldName.toLowerCase() === newName.toLowerCase()) return null; // skip same name
      return `  ${oldName}  \u2192  ${newName}`;
    })
    .filter(Boolean);

  // Build summary: unassigned files
  const assignedPaths = new Set(Object.keys(state.assignments));
  const unassignedImages = state.images.filter(i => !assignedPaths.has(i.path));
  const unassignedLines = unassignedImages.map((img, idx) => {
    const suffix = unassignedImages.length === 1 ? 'unassigned' : `unassigned_${String(idx + 1).padStart(2, '0')}`;
    const ext = img.name.substring(img.name.lastIndexOf('.')).toLowerCase();
    return `  ${img.name}  \u2192  ${normalizedId}_${suffix}${ext}`;
  });

  // Nothing to change?
  if (assignedLines.length === 0 && unassignedLines.length === 0) {
    alert('All files already have the correct names. Nothing to change.');
    return;
  }

  let msg = `Save ${count} assigned file(s) in "${tabletId}"?\n`;
  if (assignedLines.length > 0) {
    msg += `\nAssigned:\n${assignedLines.join('\n')}`;
  }
  if (unassignedLines.length > 0) {
    msg += `\n\nUnassigned (${unassignedLines.length}):\n${unassignedLines.join('\n')}`;
  }

  const ok = confirm(msg);
  if (!ok) return;

  setStatus('Renaming...');

  // Send assignments + all image paths (so unassigned get renamed too)
  const allPaths = state.images.map(i => i.path);
  const results = await window.api.renameFiles(sub.path, state.assignments, tabletId, allPaths);

  const okCount = results.filter(r => r.status === 'ok' || r.status === 'skipped').length;
  const errCount = results.filter(r => r.status === 'error').length;

  if (errCount > 0) {
    const errorDetails = results
      .filter(r => r.status === 'error')
      .map(r => `${r.oldName}: ${r.error}`)
      .join('\n');
    alert(`Renamed ${okCount} file(s), ${errCount} error(s):\n\n${errorDetails}`);
  } else {
    setStatus(`Renamed ${okCount} file(s) successfully.`);
  }

  // Re-scan and reload the current folder (stay here, don't auto-advance)
  const scanResult = await window.api.scanFolder(state.rootFolder);
  state.subfolders = scanResult.subfolders;
  buildTreeView();
  loadResults();
  loadCurrentSubfolder();
}

function onReset() {
  if (Object.keys(state.assignments).length === 0) return;
  if (!confirm('Clear all assignments for this folder?')) return;

  for (const imgPath of Object.keys(state.assignments)) {
    updateCardBadge(imgPath, true);
  }
  state.assignments = {};
  state.reverseAssignments = {};
  updateStructureDiagram();
  updateButtons();
  updateStatusCount();
}

// === UI Updates ===
function getCardForImage(imagePath) {
  return dom.thumbGrid.querySelector(`.thumb-card[data-path="${CSS.escape(imagePath)}"]`);
}

function updateCardBadge(imagePath, forceRemove = false) {
  const card = getCardForImage(imagePath);
  if (!card) return;

  const code = forceRemove ? null : state.assignments[imagePath];
  const badge = card.querySelector('.thumb-badge');

  if (code) {
    badge.textContent = `_${code}`;
    card.classList.add('assigned');
  } else {
    badge.textContent = '';
    card.classList.remove('assigned');
  }
}

function updateStructureDiagram() {
  document.querySelectorAll('.slot[data-code]').forEach(slot => {
    const code = slot.dataset.code;
    const imgPath = state.reverseAssignments[code];

    // Remove old filename badge
    const oldBadge = slot.querySelector('.slot-filename');
    if (oldBadge) oldBadge.remove();

    if (imgPath) {
      slot.classList.add('assigned');

      // Show filename between label and shortcut
      const fname = state.images.find(i => i.path === imgPath)?.name || '';
      const badge = document.createElement('span');
      badge.className = 'slot-filename';
      badge.textContent = fname;
      // Insert before shortcut
      const shortcut = slot.querySelector('.slot-shortcut');
      slot.insertBefore(badge, shortcut);
    } else {
      slot.classList.remove('assigned');
    }

    if (slot.classList.contains('mirror-slot') && imgPath) {
      slot.style.opacity = '0.7';
    } else if (slot.classList.contains('mirror-slot')) {
      slot.style.opacity = '0.5';
    }
  });
}

function updateButtons() {
  const hasAssignments = Object.keys(state.assignments).length > 0;
  dom.btnConfirm.disabled = !hasAssignments;
  dom.btnReset.disabled = !hasAssignments;
}

function setStatus(text) {
  dom.statusText.textContent = text;
}

function updateStatusCount() {
  const total = state.images.length;
  const assigned = Object.keys(state.assignments).length;
  const selCount = state.selectedImages.size;

  let selText;
  if (selCount > 1) {
    selText = `${selCount} images selected`;
  } else if (state.selectedImage) {
    const name = state.images.find(i => i.path === state.selectedImage)?.name || 'none';
    const code = state.assignments[state.selectedImage];
    const codePart = code ? ` \u2192 _${code} (${VIEW_CODES[code]})` : '';
    selText = `Selected: ${name}${codePart}`;
  } else {
    selText = 'No selection';
  }

  dom.statusText.textContent = selText;
  dom.statusCount.textContent = `${assigned} / ${total} assigned`;
}

// === Results System ===
const resultsState = {
  results: [],
  currentIndex: 0,
  selectedResult: null,
  reviewStatus: {},
  hasResults: false,
};

let activeTab = 'structure';

async function loadResults() {
  if (!state.rootFolder) return;

  const data = await window.api.scanResults(state.rootFolder);
  resultsState.results = data.results;
  resultsState.hasResults = data.hasResults;

  if (data.hasResults) {
    resultsState.reviewStatus = await window.api.loadReviewStatus(state.rootFolder);
  }

  updateResultsTab();
  updateTreeStatusIcons();
}

function updateResultsTab() {
  const emptyEl = document.getElementById('results-empty');
  const infoEl = document.getElementById('results-info');

  if (!resultsState.hasResults || resultsState.results.length === 0) {
    emptyEl.classList.remove('hidden');
    infoEl.classList.add('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  infoEl.classList.remove('hidden');

  updateResultSummary();

  // If results tab is active, show result thumbnails in left panel
  if (activeTab === 'results') {
    showResultThumbnails();
  }
}

function showResultThumbnails() {
  dom.thumbGrid.innerHTML = '';

  // Sync with current subfolder if possible
  if (state.subfolders.length > 0 && state.currentIndex >= 0) {
    const currentName = state.subfolders[state.currentIndex]?.name;
    const matchIdx = resultsState.results.findIndex(r => r.name === currentName);
    if (matchIdx >= 0) resultsState.currentIndex = matchIdx;
  }

  for (let i = 0; i < resultsState.results.length; i++) {
    const result = resultsState.results[i];
    const review = resultsState.reviewStatus[result.name];
    const statusClass = review?.status === 'revision' ? ' revision' : review?.status === 'updated' ? ' updated' : '';

    const card = document.createElement('div');
    card.className = `result-card${statusClass}`;
    card.dataset.index = i;

    const badge = document.createElement('div');
    badge.className = 'result-badge';
    badge.textContent = review?.status === 'updated' ? '\uD83D\uDFE2' : '\uD83D\uDD34';
    card.appendChild(badge);

    const imgEl = document.createElement('img');
    imgEl.alt = result.name;
    card.appendChild(imgEl);

    const name = document.createElement('div');
    name.className = 'result-name';
    name.textContent = result.name;
    card.appendChild(name);

    card.addEventListener('click', () => {
      resultsState.currentIndex = i;
      resultsState.selectedResult = result;
      updateResultSelection();
      showResultNotes(result);
    });

    card.addEventListener('dblclick', () => {
      resultsState.currentIndex = i;
      openResultPreview(i);
    });

    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.api.revealInExplorer(result.jpgPath);
    });

    dom.thumbGrid.appendChild(card);

    // Load thumbnail async
    (async () => {
      const thumb = await window.api.getResultThumbnail(result.jpgPath);
      if (thumb) imgEl.src = thumb;
    })();
  }

  // Select current
  updateResultSelection();
  if (resultsState.results[resultsState.currentIndex]) {
    showResultNotes(resultsState.results[resultsState.currentIndex]);
  }
}

function updateResultSelection() {
  document.querySelectorAll('.result-card').forEach(card => {
    card.classList.toggle('selected', parseInt(card.dataset.index) === resultsState.currentIndex);
  });
  const active = document.querySelector('.result-card.selected');
  if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function showResultNotes(result) {
  const review = resultsState.reviewStatus[result.name] || {};
  document.getElementById('result-notes').value = review.notes || '';
}

// Result preview overlay
async function openResultPreview(index) {
  resultsState.currentIndex = index;
  const overlay = document.getElementById('result-preview-overlay');
  overlay.classList.remove('hidden');
  await loadResultPreviewImage(index);
}

async function loadResultPreviewImage(index) {
  const result = resultsState.results[index];
  if (!result) return;
  resultsState.currentIndex = index;

  const review = resultsState.reviewStatus[result.name];
  updateResultPreviewUI(review);

  const imgEl = document.getElementById('result-preview-image');
  imgEl.src = '';
  const dataUrl = await window.api.getFullImage(result.jpgPath);
  if (dataUrl) imgEl.src = dataUrl;
}

function navigateResultPreview(direction) {
  const newIdx = resultsState.currentIndex + direction;
  if (newIdx >= 0 && newIdx < resultsState.results.length) {
    loadResultPreviewImage(newIdx);
    updateResultSelection();
  }
}

function closeResultPreview() {
  document.getElementById('result-preview-overlay').classList.add('hidden');
  document.getElementById('result-preview-image').src = '';
}

// Set or toggle a result's review status. Clicking the same status clears it.
async function setResultStatus(newStatus) {
  const result = resultsState.results[resultsState.currentIndex];
  if (!result) return;

  const existing = resultsState.reviewStatus[result.name] || {};

  if (existing.status === newStatus) {
    // Toggle off — clear status but keep notes
    delete existing.status;
    delete existing.reviewedAt;
    if (!existing.notes) {
      delete resultsState.reviewStatus[result.name];
    }
  } else {
    resultsState.reviewStatus[result.name] = {
      ...existing,
      status: newStatus,
      reviewedAt: new Date().toISOString(),
    };
  }

  await window.api.saveReviewStatus(state.rootFolder, resultsState.reviewStatus);

  const review = resultsState.reviewStatus[result.name];
  updateResultPreviewUI(review);

  // Update thumbnail card classes and badge
  const card = document.querySelector(`.result-card[data-index="${resultsState.currentIndex}"]`);
  if (card) {
    card.classList.remove('revision', 'updated');
    if (review?.status) card.classList.add(review.status);
    const badge = card.querySelector('.result-badge');
    if (badge) badge.textContent = review?.status === 'updated' ? '\uD83D\uDFE2' : '\uD83D\uDD34';
  }

  updateTreeStatusIcons();
  updateResultSummary();
}

function updateResultPreviewUI(review) {
  const result = resultsState.results[resultsState.currentIndex];
  if (!result) return;

  // Update buttons
  document.getElementById('result-toggle-revision').classList.toggle('active', review?.status === 'revision');
  document.getElementById('result-toggle-updated').classList.toggle('active', review?.status === 'updated');

  // Update info text
  const statusLabel = review?.status === 'revision' ? '  [REVISION]'
    : review?.status === 'updated' ? '  [UPDATED]' : '';
  const total = resultsState.results.length;
  document.getElementById('result-preview-info').textContent =
    `${result.name}${statusLabel}  |  ${resultsState.currentIndex + 1}/${total}  |  \u2190\u2192 navigate  |  R revision  |  U updated  |  Esc close`;
}

function updateResultSummary() {
  const statuses = Object.values(resultsState.reviewStatus);
  const revCount = statuses.filter(r => r.status === 'revision').length;
  const updCount = statuses.filter(r => r.status === 'updated').length;
  const parts = [`${resultsState.results.length} results`];
  if (revCount) parts.push(`${revCount} revision`);
  if (updCount) parts.push(`${updCount} updated`);
  document.getElementById('result-summary').textContent = parts.join('  |  ');
}

async function saveCurrentNotes() {
  const result = resultsState.results[resultsState.currentIndex];
  if (!result) return;

  const notes = document.getElementById('result-notes').value.trim();
  const existing = resultsState.reviewStatus[result.name] || {};

  if (notes) {
    resultsState.reviewStatus[result.name] = {
      ...existing,
      notes,
      reviewedAt: new Date().toISOString(),
    };
  } else if (existing.notes) {
    delete existing.notes;
    if (!existing.status) {
      delete resultsState.reviewStatus[result.name];
    }
  }

  await window.api.saveReviewStatus(state.rootFolder, resultsState.reviewStatus);
  setStatus(`Notes saved for ${result.name}.`);
}

function updateTreeStatusIcons() {
  document.querySelectorAll('.tree-item').forEach(item => {
    const idx = parseInt(item.dataset.index);
    const sub = state.subfolders[idx];
    if (!sub) return;

    const oldIcon = item.querySelector('.tree-status');
    if (oldIcon) oldIcon.remove();

    const review = resultsState.reviewStatus[sub.name];
    if (review?.status === 'revision' || review?.status === 'updated') {
      const icon = document.createElement('span');
      icon.className = 'tree-status';
      icon.textContent = review.status === 'updated' ? '\uD83D\uDFE2' : '\uD83D\uDD34';
      icon.title = review.status === 'revision'
        ? 'Needs revision — click to mark as updated'
        : 'Updated — click to clear';
      icon.addEventListener('click', (e) => {
        e.stopPropagation(); // don't navigate to the subfolder
        toggleTreeStatus(sub.name);
      });
      item.appendChild(icon);
    }
  });
}

async function toggleTreeStatus(tabletName) {
  const existing = resultsState.reviewStatus[tabletName] || {};

  if (existing.status === 'revision') {
    // revision → updated
    resultsState.reviewStatus[tabletName] = {
      ...existing,
      status: 'updated',
      reviewedAt: new Date().toISOString(),
    };
  } else if (existing.status === 'updated') {
    // updated → clear
    delete existing.status;
    delete existing.reviewedAt;
    if (!existing.notes) {
      delete resultsState.reviewStatus[tabletName];
    }
  }

  await window.api.saveReviewStatus(state.rootFolder, resultsState.reviewStatus);
  updateTreeStatusIcons();
  updateResultSummary();

  // Update the result card if visible
  const resultIdx = resultsState.results.findIndex(r => r.name === tabletName);
  if (resultIdx >= 0) {
    const card = document.querySelector(`.result-card[data-index="${resultIdx}"]`);
    if (card) {
      const review = resultsState.reviewStatus[tabletName];
      card.classList.remove('revision', 'updated');
      if (review?.status) card.classList.add(review.status);
      const badge = card.querySelector('.result-badge');
      if (badge) badge.textContent = review?.status === 'updated' ? '\uD83D\uDFE2' : '\uD83D\uDD34';
    }
  }
}

// === Settings ===
async function openSettings() {
  const config = await window.api.getStitcherConfig();
  let exePath = config.stitcherExe || '';

  // Auto-detect if not configured
  if (!exePath) {
    const detected = await window.api.autoDetectStitcher();
    if (detected) {
      exePath = detected;
      setStatus('Auto-detected stitcher: ' + detected);
    }
  }

  document.getElementById('setting-stitcher-exe').value = exePath;
  if (exePath) {
    await verifyStitcherUI(exePath);
  } else {
    document.getElementById('setting-stitcher-status').textContent = 'Not configured — click Browse to locate eBL Photo Stitcher';
    document.getElementById('setting-stitcher-status').className = 'settings-hint';
  }
  document.getElementById('settings-overlay').classList.remove('hidden');
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.add('hidden');
}

async function browseStitcherExe() {
  const exePath = await window.api.selectStitcherExe();
  if (exePath) {
    document.getElementById('setting-stitcher-exe').value = exePath;
    await verifyStitcherUI(exePath);
  }
}

async function verifyStitcherUI(exePath) {
  const statusEl = document.getElementById('setting-stitcher-status');
  const result = await window.api.verifyStitcherExe(exePath);
  if (result.valid) {
    statusEl.textContent = '\u2713 eBL Photo Stitcher found';
    statusEl.className = 'settings-hint valid';
  } else {
    statusEl.textContent = '\u2717 ' + result.reason;
    statusEl.className = 'settings-hint invalid';
  }
}

async function saveSettings() {
  const config = {
    stitcherExe: document.getElementById('setting-stitcher-exe').value.trim(),
  };
  await window.api.saveStitcherConfig(config);
  setStatus('Settings saved.');
  closeSettings();
}

// === Stitcher Reprocessing ===
let isStitcherRunning = false;

async function reprocessUpdated() {
  if (isStitcherRunning) {
    alert('Stitcher is already running.');
    return;
  }

  const updated = Object.entries(resultsState.reviewStatus)
    .filter(([, v]) => v.status === 'updated')
    .map(([name]) => name);

  if (updated.length === 0) {
    alert('No tablets are marked as updated (green).');
    return;
  }

  const ok = confirm(`Reprocess ${updated.length} updated tablet(s)?\n\n${updated.join('\n')}`);
  if (!ok) return;

  await runStitcher(updated);
}

async function reprocessAll() {
  if (isStitcherRunning) {
    alert('Stitcher is already running.');
    return;
  }

  if (state.subfolders.length === 0) {
    alert('No subfolders loaded.');
    return;
  }

  const ok = confirm(`Reprocess ALL ${state.subfolders.length} tablet(s)?\nThis may take a long time.`);
  if (!ok) return;

  await runStitcher(null);
}

async function runStitcher(tablets) {
  const config = await window.api.getStitcherConfig();
  if (!config.stitcherExe) {
    alert('eBL Photo Stitcher not configured. Open Settings (gear icon) to set it up.');
    openSettings();
    return;
  }

  const verification = await window.api.verifyStitcherExe(config.stitcherExe);
  if (!verification.valid) {
    alert(`Stitcher not found: ${verification.reason}\n\nOpen Settings to fix.`);
    openSettings();
    return;
  }

  isStitcherRunning = true;
  document.getElementById('btn-reprocess-updated').disabled = true;
  document.getElementById('btn-reprocess-all').disabled = true;

  const statusEl = document.getElementById('stitcher-status');
  statusEl.classList.remove('hidden');
  statusEl.textContent = 'Starting stitcher...\n';

  setStatus('Stitcher running...');

  const result = await window.api.processTablets(state.rootFolder, tablets);

  isStitcherRunning = false;
  document.getElementById('btn-reprocess-updated').disabled = false;
  document.getElementById('btn-reprocess-all').disabled = false;

  if (result.success) {
    setStatus('Stitcher finished successfully.');
    statusEl.textContent += '\n=== DONE ===\n';
    await loadResults();
  } else {
    setStatus(`Stitcher failed: ${result.error || 'exit code ' + result.exitCode}`);
    statusEl.textContent += `\n=== ERROR: ${result.error || 'exit code ' + result.exitCode} ===\n`;
  }
}

function handleStitcherProgress(event) {
  const statusEl = document.getElementById('stitcher-status');
  if (!statusEl) return;

  if (event.type === 'progress') {
    setStatus(`Stitcher: ${event.value}%`);
  } else if (event.type === 'log' || event.type === 'stderr') {
    statusEl.textContent += event.message + '\n';
    statusEl.scrollTop = statusEl.scrollHeight;
  } else if (event.type === 'error') {
    statusEl.textContent += `ERROR: ${event.message}\n`;
    statusEl.scrollTop = statusEl.scrollHeight;
  }
}

// =====================================================================
// Tools tab + Viewer rectangle drawing
// =====================================================================
// Tool: 'trim' (draw rectangle → trim) or null (no active tool, just viewing).
// Click the tool button to activate; click again (or Esc) to deactivate.

const previewTool = {
  active: null,
  bgColor: 'white',
  busy: false,

  // Rectangle drawing state (coords are relative to #viewer-stage)
  drawing: false,
  startX: 0,
  startY: 0,
  rectDisplay: null,    // {x, y, w, h} in #viewer-stage CSS pixels
};

function setActiveTool(toolName) {
  // Toggle: clicking the already-active tool deactivates it
  const newTool = (previewTool.active === toolName) ? null : toolName;
  previewTool.active = newTool;
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === newTool);
  });
  document.getElementById('tool-options-trim').classList.toggle('visible', newTool === 'trim');
  dom.viewerStage.classList.toggle('tool-trim', newTool === 'trim');
  clearViewerRect();

  // Auto-switch to viewer mode if an image is selected
  if (newTool === 'trim' && !isViewerOpen() && state.selectedImage) {
    enterViewerMode(state.selectedImage);
  } else if (newTool === 'trim' && !state.selectedImage) {
    setStatus('Select an image first, then pick a tool.');
  }
}

function setTrimBg(color) {
  previewTool.bgColor = color;
  document.getElementById('bg-white').classList.toggle('active', color === 'white');
  document.getElementById('bg-black').classList.toggle('active', color === 'black');
}

function clearViewerRect() {
  previewTool.drawing = false;
  previewTool.rectDisplay = null;
  const overlay = document.getElementById('viewer-rect-overlay');
  const actions = document.getElementById('viewer-rect-actions');
  if (overlay) overlay.classList.add('hidden');
  if (actions) actions.classList.add('hidden');
}

// Returns the displayed image's bounding rect relative to #viewer-stage.
// The <img> uses object-fit: contain, so we have to compute the visible area.
function getDisplayedImageRect() {
  const img = dom.viewerImage;
  const stage = dom.viewerStage;
  if (!img || !stage) return null;

  const natW = img.naturalWidth;
  const natH = img.naturalHeight;
  if (!natW || !natH) return null;

  const stageRect = stage.getBoundingClientRect();
  const imgRect = img.getBoundingClientRect();

  const scale = Math.min(imgRect.width / natW, imgRect.height / natH);
  const drawW = natW * scale;
  const drawH = natH * scale;
  const offsetX = (imgRect.width - drawW) / 2 + (imgRect.left - stageRect.left);
  const offsetY = (imgRect.height - drawH) / 2 + (imgRect.top - stageRect.top);

  return { left: offsetX, top: offsetY, width: drawW, height: drawH, natW, natH };
}

function onViewerMouseDown(e) {
  if (previewTool.active !== 'trim' || previewTool.busy) return;
  if (e.button !== 0) return;
  if (!isViewerOpen()) return;

  const disp = getDisplayedImageRect();
  if (!disp) return;

  const stageRect = dom.viewerStage.getBoundingClientRect();
  const x = e.clientX - stageRect.left;
  const y = e.clientY - stageRect.top;

  // Only start drawing if the mousedown happened on the image itself
  if (x < disp.left || x > disp.left + disp.width ||
      y < disp.top || y > disp.top + disp.height) return;

  e.preventDefault();
  previewTool.drawing = true;
  previewTool.startX = x;
  previewTool.startY = y;
  previewTool.rectDisplay = { x, y, w: 0, h: 0 };

  const overlay = document.getElementById('viewer-rect-overlay');
  const box = document.getElementById('viewer-rect-box');
  overlay.classList.remove('hidden');
  document.getElementById('viewer-rect-actions').classList.add('hidden');
  updateRectBox(box, previewTool.rectDisplay);
}

function onViewerMouseMove(e) {
  if (!previewTool.drawing) return;
  const stageRect = dom.viewerStage.getBoundingClientRect();
  const disp = getDisplayedImageRect();
  if (!disp) return;

  const x = Math.max(disp.left, Math.min(disp.left + disp.width, e.clientX - stageRect.left));
  const y = Math.max(disp.top, Math.min(disp.top + disp.height, e.clientY - stageRect.top));

  const rx = Math.min(previewTool.startX, x);
  const ry = Math.min(previewTool.startY, y);
  const rw = Math.abs(x - previewTool.startX);
  const rh = Math.abs(y - previewTool.startY);
  previewTool.rectDisplay = { x: rx, y: ry, w: rw, h: rh };

  updateRectBox(document.getElementById('viewer-rect-box'), previewTool.rectDisplay);
}

function onViewerMouseUp() {
  if (!previewTool.drawing) return;
  previewTool.drawing = false;

  const r = previewTool.rectDisplay;
  if (!r || r.w < 6 || r.h < 6) {
    clearViewerRect();
    return;
  }
  const actions = document.getElementById('viewer-rect-actions');
  actions.classList.remove('hidden');
  positionRectActions(actions, r);
}

function updateRectBox(box, r) {
  box.style.left = `${r.x}px`;
  box.style.top = `${r.y}px`;
  box.style.width = `${r.w}px`;
  box.style.height = `${r.h}px`;
}

function positionRectActions(actions, r) {
  actions.style.left = `${r.x}px`;
  actions.style.top = `${r.y + r.h + 6}px`;
}

// Convert displayed (CSS) pixels to normalized (0..1) image coordinates and apply.
async function applyViewerRect() {
  if (previewTool.busy || !viewerCurrentPath || !previewTool.rectDisplay) return;

  const disp = getDisplayedImageRect();
  if (!disp) return;

  const r = previewTool.rectDisplay;
  const normRect = {
    left: (r.x - disp.left) / disp.width,
    top: (r.y - disp.top) / disp.height,
    width: r.w / disp.width,
    height: r.h / disp.height,
  };

  previewTool.busy = true;
  dom.viewerInfo.textContent = 'Trimming...';

  const result = await window.api.trimInRect(viewerCurrentPath, normRect, previewTool.bgColor);
  previewTool.busy = false;

  if (!result || result.status !== 'ok') {
    dom.viewerInfo.textContent = `Error: ${result?.error || 'trim failed'}`;
    return;
  }

  if (result.thumbnail) {
    const card = getCardForImage(viewerCurrentPath);
    if (card) {
      const imgEl = card.querySelector('img');
      if (imgEl) imgEl.src = result.thumbnail;
    }
  }

  setStatus(`Trimmed to ${result.newWidth}\u00D7${result.newHeight}. Original backed up to _Raw/.`);

  clearViewerRect();
  await loadViewerImage(viewerCurrentPath);
}

// Update the Image Info section in the Tools tab
function updateToolInfo() {
  const filenameEl = document.getElementById('info-filename');
  const viewEl = document.getElementById('info-view');
  const dimsEl = document.getElementById('info-dims');
  if (!filenameEl) return;

  const path = viewerCurrentPath || state.selectedImage;
  if (!path) {
    filenameEl.textContent = '—';
    viewEl.textContent = '—';
    dimsEl.textContent = '—';
    return;
  }

  const img = state.images.find(i => i.path === path);
  filenameEl.textContent = img ? img.name : '—';
  const code = state.assignments[path];
  viewEl.textContent = code ? `${VIEW_CODES[code]} (_${code})` : 'unassigned';

  window.api.getImageInfo(path).then(info => {
    if (info && (viewerCurrentPath === path || state.selectedImage === path)) {
      dimsEl.textContent = `${info.width}\u00D7${info.height}`;
    }
  });
}

// --- Wire up tool panel ---
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => setActiveTool(btn.dataset.tool));
});
document.getElementById('bg-white').addEventListener('click', () => setTrimBg('white'));
document.getElementById('bg-black').addEventListener('click', () => setTrimBg('black'));
document.getElementById('viewer-rect-apply').addEventListener('click', applyViewerRect);
document.getElementById('viewer-rect-cancel').addEventListener('click', clearViewerRect);

dom.viewerStage.addEventListener('mousedown', onViewerMouseDown);
window.addEventListener('mousemove', onViewerMouseMove);
window.addEventListener('mouseup', onViewerMouseUp);

// Drop any drawn rectangle on window resize (display coords become stale)
window.addEventListener('resize', clearViewerRect);
