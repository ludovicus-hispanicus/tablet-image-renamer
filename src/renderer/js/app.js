// === State ===
let appMode = 'picker'; // 'picker' or 'renamer'
let customExportFolder = null; // null = use _Selected in root
let currentUserName = null; // collaboration: display name for assignments

const state = {
  rootFolder: null,
  subfolders: [],
  currentIndex: -1,
  images: [],
  selectedImage: null,       // primary selection (for assignment)
  selectedImages: new Set(),  // multi-selection (for rotation, etc.)
  lastClickedIndex: -1,       // for shift-click range selection
  assignments: {},            // imagePath -> viewCode (used by both modes)
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

// Mode toggle
document.getElementById('btn-mode-renamer').addEventListener('click', () => switchMode('renamer'));
document.getElementById('btn-mode-picker').addEventListener('click', () => switchMode('picker'));
document.getElementById('btn-export-selected').addEventListener('click', onExportSelected);
document.getElementById('btn-browse-export').addEventListener('click', async () => {
  const folder = await window.api.selectExportFolder();
  if (folder) {
    customExportFolder = folder;
    updateExportFolderDisplay();
  }
});
document.getElementById('btn-process').addEventListener('click', onProcessReady);

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
document.getElementById('viewer-pick').addEventListener('click', () => {
  togglePick();
  updateViewerPickButton();
});
document.getElementById('viewer-delete').addEventListener('click', deleteCurrentImage);

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

// Tree search: hide tree items whose name doesn't match the query (case-insensitive)
document.getElementById('tree-search').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('#tree-list .tree-item').forEach(item => {
    const name = item.textContent.toLowerCase();
    item.classList.toggle('hidden-by-search', q && !name.includes(q));
  });
});
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
// Tabs only change the right-panel content. The only tab that swaps the thumbnail
// grid is Results (to show stitched results). Leaving Results restores the
// image thumbnails for the currently selected tablet.
document.querySelectorAll('.right-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const newTab = tab.dataset.tab;
    const leavingResults = activeTab === 'results' && newTab !== 'results';

    document.querySelectorAll('.right-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${newTab}`).classList.add('active');

    activeTab = newTab;

    if (activeTab === 'results') {
      showResultThumbnails();
    } else {
      if (leavingResults) restoreThumbnailsForSelection();
      if (activeTab === 'tools') updateToolInfo();
    }
  });
});

// Re-render the thumbnail grid from the current state.images (the last-clicked
// tablet in the tree). Called when leaving the Results tab.
function restoreThumbnailsForSelection() {
  dom.thumbGrid.innerHTML = '';
  if (!state.images || state.images.length === 0) return;

  for (const img of state.images) {
    const card = createThumbCard(img);
    dom.thumbGrid.appendChild(card);
    loadThumbnail(img.path, card);
  }

  // Restore visual selection state
  if (state.selectedImage) {
    const card = getCardForImage(state.selectedImage);
    if (card) card.classList.add('primary');
  }
}

// Results tab controls
document.getElementById('result-save-notes').addEventListener('click', saveCurrentNotes);
document.getElementById('btn-reprocess-updated').addEventListener('click', reprocessUpdated);
document.getElementById('btn-reprocess-all').addEventListener('click', reprocessAll);

// Settings dialog
document.getElementById('btn-settings').addEventListener('click', openSettings);
document.getElementById('settings-close').addEventListener('click', closeSettings);
document.getElementById('settings-save').addEventListener('click', saveSettings);
document.getElementById('setting-browse-stitcher').addEventListener('click', browseStitcherExe);
document.getElementById('setting-browse-measurements').addEventListener('click', async () => {
  const path = await window.api.selectMeasurementsFile();
  if (path) document.getElementById('setting-measurements').value = path;
});
document.getElementById('setting-clear-measurements').addEventListener('click', () => {
  document.getElementById('setting-measurements').value = '';
});
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
document.getElementById('result-toggle-sent').addEventListener('click', () => setResultStatus('sent'));
document.getElementById('result-preview-reveal').addEventListener('click', () => {
  if (resultsState.results[resultsState.currentIndex]) {
    window.api.revealInExplorer(resultsState.results[resultsState.currentIndex].jpgPath);
  }
});
document.getElementById('result-preview-edit').addEventListener('click', editSelectedForCurrentResult);
document.getElementById('result-preview-overlay').addEventListener('click', (e) => {
  // Don't close if the "click" was actually the end of a pan drag
  if (resultZoom.moved) { resultZoom.moved = false; return; }
  if (e.target.id === 'result-preview-overlay') closeResultPreview();
});

// Zoom + pan on the result preview overlay
document.getElementById('result-preview-overlay').addEventListener('wheel', onResultWheel, { passive: false });
document.getElementById('result-preview-overlay').addEventListener('mousedown', onResultPanStart);
window.addEventListener('mousemove', onResultPanMove);
window.addEventListener('mouseup', onResultPanEnd);

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

  setStatus(`Found ${state.subfolders.length} subfolder(s) with ${result.totalImages} images. Click a folder to start.`);
  state.currentIndex = -1;  // no folder auto-opened; user picks one from the tree

  // Load statuses early so tree icons show immediately
  resultsState.reviewStatus = await window.api.loadReviewStatus(getResultsRoot());

  buildTreeView();
  loadResults();
  // Thumbnail grid stays empty until the user clicks a folder in the tree.
  dom.thumbGrid.innerHTML = '';
  dom.subfolderInfo.textContent = '';
  updateTreeStatusIcons();
  // Start live collaboration refresh if in renamer mode
  if (appMode === 'renamer') startStatusRefresh();
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
  if (appMode === 'renamer') {
    buildSelectedTree();
    return;
  }
  buildSourceTree();
}

function buildSourceTree() {
  const treeList = document.getElementById('tree-list');
  treeList.innerHTML = '';
  document.getElementById('tree-header').textContent = 'Folders';

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
  if (appMode === 'renamer') return; // don't highlight in selected tree
  document.querySelectorAll('.tree-item').forEach(item => {
    item.classList.toggle('active', parseInt(item.dataset.index) === state.currentIndex);
  });
  // Scroll active into view
  const active = document.querySelector('.tree-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

// === Subfolder Navigation ===
function navigateSubfolder(direction) {
  if (appMode === 'renamer' && selectedTreeFolders.length > 0) {
    const newIndex = selectedTreeIndex + direction;
    if (newIndex < 0 || newIndex >= selectedTreeFolders.length) return;
    loadSelectedFolder(newIndex);
    return;
  }
  const newIndex = state.currentIndex + direction;
  if (newIndex < 0 || newIndex >= state.subfolders.length) return;
  state.currentIndex = newIndex;
  loadCurrentSubfolder();
}

async function loadCurrentSubfolder() {
  const sub = state.subfolders[state.currentIndex];
  if (!sub) return;
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

  // In picker mode, load saved picks from picks.json
  if (appMode === 'picker') {
    const savedPicks = await window.api.loadPicks(sub.path);
    // savedPicks maps filename -> viewCode. Translate to full paths.
    if (savedPicks && Object.keys(savedPicks).length > 0) {
      for (const [filename, viewCode] of Object.entries(savedPicks)) {
        const img = state.images.find(i => i.name === filename);
        if (img && (viewCode === 'pick' || !state.reverseAssignments[viewCode])) {
          state.assignments[img.path] = viewCode;
          if (viewCode !== 'pick') state.reverseAssignments[viewCode] = img.path;
        }
      }
      // Update card badges for all loaded picks
      for (const imgPath of Object.keys(state.assignments)) {
        updateCardBadge(imgPath);
      }
    }
  }

  updateStructureDiagram();
  updatePickerList();
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
  updatePickerList();
  updateButtons();
  updateStatusCount();
  if (appMode === 'picker') savePicksDebounced();

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
  updatePickerList();
  updateButtons();
  updateStatusCount();
  if (appMode === 'picker') savePicksDebounced();
}

function togglePick() {
  if (!state.selectedImage || appMode !== 'picker') return;

  const existing = state.assignments[state.selectedImage];
  if (existing) {
    // Already picked (named or unnamed) — unpick it
    delete state.reverseAssignments[existing];
    delete state.assignments[state.selectedImage];
  } else {
    // Pick without a view code
    state.assignments[state.selectedImage] = 'pick';
  }

  updateCardBadge(state.selectedImage);
  updatePickerList();
  updateButtons();
  updateStatusCount();
  savePicksDebounced();
  updateViewerPickButton();
  if (isViewerOpen()) {
    viewerNavigate(1);
  } else {
    autoAdvanceSelection();
  }
}

function updateViewerPickButton() {
  const btn = document.getElementById('viewer-pick');
  if (!btn) return;
  const isPicked = !!state.assignments[viewerCurrentPath || state.selectedImage];
  btn.textContent = isPicked ? '\u2715' : '\u2713';
  btn.classList.toggle('viewer-pick-active', isPicked);
  btn.style.display = appMode === 'picker' ? '' : 'none';

  // Show/hide delete button based on mode
  const delBtn = document.getElementById('viewer-delete');
  if (delBtn) delBtn.style.display = appMode === 'renamer' ? '' : 'none';
}

async function deleteCurrentImage() {
  if (appMode !== 'renamer') return;
  const target = viewerCurrentPath || state.selectedImage;
  if (!target) return;

  const name = state.images.find(i => i.path === target)?.name || target;
  if (!confirm(`Remove "${name}" from this tablet?\n\nThe file will be moved to the Recycle Bin.`)) return;

  const result = await window.api.deleteImage(target);
  if (!result.success) {
    alert(`Failed to remove: ${result.error}`);
    return;
  }

  // Remove from state
  delete state.assignments[target];
  const revKey = Object.entries(state.reverseAssignments).find(([, v]) => v === target)?.[0];
  if (revKey) delete state.reverseAssignments[revKey];

  const idx = state.images.findIndex(i => i.path === target);
  state.images.splice(idx, 1);

  // Remove thumbnail card
  const card = dom.thumbGrid.querySelector(`.thumb-card[data-path="${CSS.escape(target)}"]`);
  if (card) card.remove();

  // Navigate to next image in viewer or exit
  if (isViewerOpen()) {
    if (state.images.length === 0) {
      exitViewerMode();
    } else {
      const newIdx = Math.min(idx, state.images.length - 1);
      const newPath = state.images[newIdx].path;
      selectImage(newPath);
      loadViewerImage(newPath);
    }
  } else if (state.images.length > 0) {
    selectImage(state.images[Math.min(idx, state.images.length - 1)].path);
  }

  updateStructureDiagram();
  updateButtons();
  updateStatusCount();
  setStatus(`Removed ${name}`);
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
  // Ctrl shortcuts — always available
  if (e.ctrlKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    onConfirm();
    return;
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'e') {
    e.preventDefault();
    onExportSelected();
    return;
  }

  // If focus is in an input/textarea, don't intercept single-key shortcuts
  // (except Escape, handled below, which should still close overlays).
  const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
  if (inInput && e.key !== 'Escape') return;

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
    else if (e.key === '0') { resetResultZoom(); e.preventDefault(); }
    return;
  }

  // Viewer mode: arrow navigation, rotation, tool shortcuts, assignments
  if (isViewerOpen()) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const vKey = e.key.toLowerCase();

    // Handle pending combo in viewer
    if (state.comboPending) {
      if (COMBO_SECOND.has(vKey)) {
        const combo = state.comboPending + vKey;
        clearCombo();
        if (VIEW_CODES[combo]) {
          assignCurrentImage(combo);
          viewerNavigate(1);
        }
        e.preventDefault();
      } else {
        clearCombo();
      }
      return;
    }

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
    } else if (vKey === 's' && !e.ctrlKey) {
      setActiveTool('segment'); e.preventDefault();
    } else if (e.key === '0' && !e.ctrlKey) {
      resetViewerZoom(); e.preventDefault();
    } else if (e.key === 'Enter' && previewTool.active === 'segment' && segTool.currentMaskBase64) {
      applySegMask(); e.preventDefault();
    } else if (vKey === 'p' && appMode === 'picker') {
      togglePick(); e.preventDefault();
    } else if (vKey === 'u') {
      unassignCurrentImage(); e.preventDefault();
    } else if (SHORTCUT_MAP[vKey] && !e.ctrlKey && !e.altKey) {
      assignCurrentImage(SHORTCUT_MAP[vKey]);
      viewerNavigate(1);
      e.preventDefault();
    } else if (COMBO_FIRST.has(vKey) && !e.ctrlKey && !e.altKey) {
      state.comboPending = vKey;
      dom.comboIndicator.textContent = `${vKey.toUpperCase()} + ?`;
      dom.comboIndicator.classList.remove('hidden');
      state.comboTimer = setTimeout(clearCombo, 800);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      exitViewerMode(); e.preventDefault();
    } else if (e.key === 'Delete' && appMode === 'renamer') {
      deleteCurrentImage(); e.preventDefault();
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

  if (key === 'p' && appMode === 'picker') {
    togglePick();
    e.preventDefault();
  } else if (key === 'u') {
    unassignCurrentImage();
    e.preventDefault();
  } else if (e.key === 'Delete' && appMode === 'renamer') {
    deleteCurrentImage();
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
  // Opening an image is a fresh start — drop any leftover mask/box state
  clearSegState();
  viewerCurrentPath = imagePath;
  dom.thumbGridMode.classList.add('hidden');
  dom.viewerMode.classList.remove('hidden');
  await loadViewerImage(imagePath);
  updateToolInfo();
  updateViewerPickButton();
}

function exitViewerMode() {
  dom.viewerMode.classList.add('hidden');
  dom.thumbGridMode.classList.remove('hidden');
  dom.viewerImage.src = '';
  viewerCurrentPath = null;
  clearViewerRect();
  // Always deactivate the segment tool when leaving the viewer — next image
  // should start fresh without inherited mask state.
  if (previewTool.active === 'segment') setActiveTool('segment');
  // Clear the history panel — no image is viewed
  refreshSegHistory();
}

async function loadViewerImage(imagePath) {
  viewerCurrentPath = imagePath;
  dom.viewerImage.src = '';
  clearViewerRect();
  resetViewerZoom();
  if (previewTool.active === 'segment') {
    clearSegState();
  }
  // Refresh the segment history panel for whichever image is now open,
  // even if the tool isn't currently active.
  refreshSegHistory();

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
  updateViewerPickButton();
}

// === Viewer zoom + pan ===
// CSS-transform zoom on the image + overlay canvases (they move as one unit).
// Mouse wheel zooms centered on cursor. Middle-mouse drag pans. Double-click
// on the image (outside any active tool) or pressing "0" resets to fit.

const viewerZoom = {
  scale: 1,
  panX: 0,
  panY: 0,
  panning: false,
  panStartX: 0,
  panStartY: 0,
  panStartPanX: 0,
  panStartPanY: 0,
};

function applyViewerTransform() {
  const t = `translate(${viewerZoom.panX}px, ${viewerZoom.panY}px) scale(${viewerZoom.scale})`;
  // Anchor at top-left so the cursor-centered zoom math works correctly
  const origin = '0 0';
  if (dom.viewerImage) {
    dom.viewerImage.style.transformOrigin = origin;
    dom.viewerImage.style.transform = t;
  }
  const segC = document.getElementById('seg-canvas-container');
  if (segC) {
    segC.style.transformOrigin = origin;
    segC.style.transform = t;
  }
  const rectO = document.getElementById('viewer-rect-overlay');
  if (rectO) {
    rectO.style.transformOrigin = origin;
    rectO.style.transform = t;
  }
}

function resetViewerZoom() {
  viewerZoom.scale = 1;
  viewerZoom.panX = 0;
  viewerZoom.panY = 0;
  applyViewerTransform();
}

function onViewerWheel(e) {
  if (!isViewerOpen()) return;
  // Only zoom when cursor is over the stage (already true via event target)
  e.preventDefault();

  const stageRect = dom.viewerStage.getBoundingClientRect();
  const cx = e.clientX - stageRect.left;
  const cy = e.clientY - stageRect.top;

  const oldScale = viewerZoom.scale;
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const newScale = Math.max(0.1, Math.min(10, oldScale * factor));
  if (newScale === oldScale) return;

  // Keep the point under the cursor stable as we zoom:
  // pan' = cursor - (cursor - pan) * (newScale / oldScale)
  viewerZoom.panX = cx - (cx - viewerZoom.panX) * (newScale / oldScale);
  viewerZoom.panY = cy - (cy - viewerZoom.panY) * (newScale / oldScale);
  viewerZoom.scale = newScale;
  applyViewerTransform();
}

function onViewerPanStart(e) {
  if (!isViewerOpen()) return;
  // Middle mouse always pans. Left mouse pans too, but only when no tool is
  // active (left-click with an active tool belongs to that tool, e.g. drawing
  // a bounding box for the segment tool).
  const isMiddle = e.button === 1;
  const isLeftNoTool = e.button === 0 && !previewTool.active;
  if (!isMiddle && !isLeftNoTool) return;

  e.preventDefault();
  viewerZoom.panning = true;
  viewerZoom.panStartX = e.clientX;
  viewerZoom.panStartY = e.clientY;
  viewerZoom.panStartPanX = viewerZoom.panX;
  viewerZoom.panStartPanY = viewerZoom.panY;
  document.body.style.cursor = 'grabbing';
}

function onViewerPanMove(e) {
  if (!viewerZoom.panning) return;
  viewerZoom.panX = viewerZoom.panStartPanX + (e.clientX - viewerZoom.panStartX);
  viewerZoom.panY = viewerZoom.panStartPanY + (e.clientY - viewerZoom.panStartY);
  applyViewerTransform();
}

function onViewerPanEnd() {
  if (!viewerZoom.panning) return;
  viewerZoom.panning = false;
  document.body.style.cursor = '';
}

// === Result preview zoom + pan (mirrors the viewer zoom/pan) ===
const resultZoom = {
  scale: 1,
  panX: 0,
  panY: 0,
  panning: false,
  panStartX: 0,
  panStartY: 0,
  panStartPanX: 0,
  panStartPanY: 0,
};

function applyResultTransform() {
  const img = document.getElementById('result-preview-image');
  if (!img) return;
  img.style.transformOrigin = '0 0';
  img.style.transform = `translate(${resultZoom.panX}px, ${resultZoom.panY}px) scale(${resultZoom.scale})`;
}

function resetResultZoom() {
  resultZoom.scale = 1;
  resultZoom.panX = 0;
  resultZoom.panY = 0;
  applyResultTransform();
}

function isResultPreviewOpen() {
  return !document.getElementById('result-preview-overlay').classList.contains('hidden');
}

function onResultWheel(e) {
  if (!isResultPreviewOpen()) return;
  e.preventDefault();

  const overlay = document.getElementById('result-preview-overlay');
  const rect = overlay.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;

  const oldScale = resultZoom.scale;
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const newScale = Math.max(0.1, Math.min(10, oldScale * factor));
  if (newScale === oldScale) return;

  resultZoom.panX = cx - (cx - resultZoom.panX) * (newScale / oldScale);
  resultZoom.panY = cy - (cy - resultZoom.panY) * (newScale / oldScale);
  resultZoom.scale = newScale;
  applyResultTransform();
}

function onResultPanStart(e) {
  if (!isResultPreviewOpen()) return;
  // Ignore clicks on buttons / controls
  if (e.target.closest('button')) return;
  // Left or middle mouse pans
  if (e.button !== 0 && e.button !== 1) return;
  e.preventDefault();
  resultZoom.panning = true;
  resultZoom.moved = false;  // becomes true if mouse actually moves during the drag
  resultZoom.panStartX = e.clientX;
  resultZoom.panStartY = e.clientY;
  resultZoom.panStartPanX = resultZoom.panX;
  resultZoom.panStartPanY = resultZoom.panY;
  document.body.style.cursor = 'grabbing';
}

function onResultPanMove(e) {
  if (!resultZoom.panning) return;
  const dx = e.clientX - resultZoom.panStartX;
  const dy = e.clientY - resultZoom.panStartY;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) resultZoom.moved = true;
  resultZoom.panX = resultZoom.panStartPanX + dx;
  resultZoom.panY = resultZoom.panStartPanY + dy;
  applyResultTransform();
}

function onResultPanEnd() {
  if (!resultZoom.panning) return;
  resultZoom.panning = false;
  document.body.style.cursor = '';
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
  if (appMode === 'picker') {
    await onExportSelected();
    return;
  }

  const count = Object.keys(state.assignments).length;
  if (count === 0) {
    alert('No images have been assigned.');
    return;
  }

  let sub;
  if (appMode === 'renamer' && selectedTreeIndex >= 0) {
    sub = selectedTreeFolders[selectedTreeIndex];
  } else {
    sub = state.subfolders[state.currentIndex];
  }
  if (!sub) return;
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
  if (appMode !== 'renamer' && unassignedLines.length > 0) {
    msg += `\n\nUnassigned (${unassignedLines.length}):\n${unassignedLines.join('\n')}`;
  }

  const ok = confirm(msg);
  if (!ok) return;

  setStatus('Renaming...');

  // In renamer mode, only rename assigned files (leave others untouched)
  // In picker mode, rename all (unassigned get _unassigned suffix)
  const allPaths = appMode === 'renamer'
    ? Object.keys(state.assignments)
    : state.images.map(i => i.path);
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
  if (appMode === 'renamer' && selectedTreeIndex >= 0) {
    await buildSelectedTree();
    await loadSelectedFolder(selectedTreeIndex);
  } else {
    const scanResult = await window.api.scanFolder(state.rootFolder);
    state.subfolders = scanResult.subfolders;
    buildTreeView();
    loadResults();
    loadCurrentSubfolder();
  }
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

  if (code === 'pick') {
    badge.textContent = '\u2713';
    card.classList.add('assigned');
  } else if (code) {
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
    const codePart = code === 'pick' ? ' \u2713 picked'
      : code ? ` \u2192 _${code} (${VIEW_CODES[code]})` : '';
    selText = `Selected: ${name}${codePart}`;
  } else {
    selText = 'No selection';
  }

  dom.statusText.textContent = selText;
  dom.statusCount.textContent = appMode === 'picker'
    ? `${assigned} / ${total} picked`
    : `${assigned} / ${total} assigned`;
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

function getResultsRoot() {
  if (appMode === 'renamer') {
    return customExportFolder || (state.rootFolder + '/_Selected');
  }
  return state.rootFolder;
}

// === Live collaboration: periodic refresh of review_status.json ===
// Re-reads the shared status file every 10 seconds so changes from other
// users (assignments, status updates) appear automatically.
let statusRefreshInterval = null;

function startStatusRefresh() {
  stopStatusRefresh();
  statusRefreshInterval = setInterval(async () => {
    if (appMode !== 'renamer') return;
    const root = getResultsRoot();
    if (!root) return;
    try {
      const fresh = await window.api.loadReviewStatus(root);
      // Only update if something actually changed (avoid unnecessary redraws)
      const freshStr = JSON.stringify(fresh);
      const currentStr = JSON.stringify(resultsState.reviewStatus);
      if (freshStr !== currentStr) {
        resultsState.reviewStatus = fresh;
        updateTreeStatusIcons();
        updateResultSummary();
      }
    } catch (e) { /* ignore — file might be mid-sync on Drive */ }
  }, 10000);
}

function stopStatusRefresh() {
  if (statusRefreshInterval) {
    clearInterval(statusRefreshInterval);
    statusRefreshInterval = null;
  }
}

async function loadResults() {
  if (!state.rootFolder) return;

  const resultsRoot = getResultsRoot();
  const data = await window.api.scanResults(resultsRoot);
  resultsState.results = data.results;
  resultsState.hasResults = data.hasResults;

  if (data.hasResults) {
    resultsState.reviewStatus = await window.api.loadReviewStatus(resultsRoot);
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
    const statusClass = review?.status ? ` ${review.status}` : '';

    const card = document.createElement('div');
    card.className = `result-card${statusClass}`;
    card.dataset.index = i;

    const badge = document.createElement('div');
    badge.className = 'result-badge';
    badge.textContent = statusBadge(review?.status);
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
  resetResultZoom();
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
  resetResultZoom();
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

// Jump from a result preview back to the tablet's _Selected/ images so the
// user can re-edit (apply SAM, fix assignments, re-export, etc.).
async function editSelectedForCurrentResult() {
  const result = resultsState.results[resultsState.currentIndex];
  if (!result) return;

  closeResultPreview();

  // Ensure we're in Renamer mode (the _Selected/ tree)
  if (appMode !== 'renamer') {
    switchMode('renamer');
    // Wait for the tree to rebuild
    await new Promise(r => setTimeout(r, 50));
  }

  // Find the matching _Selected/ tablet folder by name
  // Rebuild the tree so we have fresh selectedTreeFolders
  await buildSelectedTree();
  const idx = selectedTreeFolders.findIndex(f => f.name === result.name);
  if (idx < 0) {
    setStatus(`No _Selected/ folder found for ${result.name}`);
    return;
  }

  // Load that tablet and switch to Tools tab for immediate editing
  await loadSelectedFolder(idx);
  document.querySelector('.right-tab[data-tab="tools"]')?.click();
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

  await window.api.saveReviewStatus(getResultsRoot(), resultsState.reviewStatus);

  const review = resultsState.reviewStatus[result.name];
  updateResultPreviewUI(review);

  // Update thumbnail card classes and badge
  const card = document.querySelector(`.result-card[data-index="${resultsState.currentIndex}"]`);
  if (card) {
    card.classList.remove('revision', 'updated', 'sent');
    if (review?.status) card.classList.add(review.status);
    const badge = card.querySelector('.result-badge');
    if (badge) badge.textContent = statusBadge(review?.status);
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
  document.getElementById('result-toggle-sent').classList.toggle('active', review?.status === 'sent');

  // Update info text
  const statusLabels = { revision: '  [REVISION]', updated: '  [UPDATED]', sent: '  [SENT]' };
  const statusLabel = statusLabels[review?.status] || '';
  const total = resultsState.results.length;
  document.getElementById('result-preview-info').textContent =
    `${result.name}${statusLabel}  |  ${resultsState.currentIndex + 1}/${total}  |  \u2190\u2192 navigate  |  R revision  |  U updated  |  Esc close`;
}

function statusBadge(status) {
  if (status === 'updated') return '\uD83D\uDFE2';   // 🟢
  if (status === 'sent') return '\uD83D\uDFE1';      // 🟡
  if (status === 'finished') return '\u26AA';        // ⚪ (filled white circle)
  return '\uD83D\uDD34';                              // 🔴
}

const STATUS_OPTIONS = [
  { key: null,         label: 'Clear',    badge: '\u25CB'  },  // ○ empty
  { key: 'updated',    label: 'Ready',    badge: '\uD83D\uDFE2' },
  { key: 'revision',   label: 'Revision', badge: '\uD83D\uDD34' },
  { key: 'sent',       label: 'Sent',     badge: '\uD83D\uDFE1' },
  { key: 'finished',   label: 'Finished', badge: '\u26AA' },
];

function updateResultSummary() {
  const statuses = Object.values(resultsState.reviewStatus);
  const revCount = statuses.filter(r => r.status === 'revision').length;
  const updCount = statuses.filter(r => r.status === 'updated').length;
  const sentCount = statuses.filter(r => r.status === 'sent').length;
  const finCount = statuses.filter(r => r.status === 'finished').length;
  const parts = [`${resultsState.results.length} results`];
  if (finCount) parts.push(`${finCount} finished`);
  if (sentCount) parts.push(`${sentCount} sent`);
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

  await window.api.saveReviewStatus(getResultsRoot(), resultsState.reviewStatus);
  setStatus(`Notes saved for ${result.name}.`);
}

function updateTreeStatusIcons() {
  if (appMode === 'picker') return;
  document.querySelectorAll('.tree-item').forEach(item => {
    const idx = parseInt(item.dataset.selectedIndex);
    const sub = selectedTreeFolders[idx];
    if (!sub) return;

    const oldIcon = item.querySelector('.tree-status');
    if (oldIcon) oldIcon.remove();
    const oldAssign = item.querySelector('.tree-assign');
    if (oldAssign) oldAssign.remove();

    const review = resultsState.reviewStatus[sub.name];
    const assignedTo = review?.assignedTo || null;
    const isMine = assignedTo === currentUserName;
    const isOther = assignedTo && !isMine;

    // Assignment indicator (before the status icon)
    if (assignedTo) {
      const assignEl = document.createElement('span');
      assignEl.className = 'tree-assign';
      if (isMine) {
        assignEl.textContent = '\u270B'; // ✋ (me)
        assignEl.title = 'Assigned to you';
      } else {
        assignEl.textContent = '\uD83D\uDD12'; // 🔒
        assignEl.title = `Assigned to ${assignedTo}`;
      }
      item.appendChild(assignEl);
    }

    // Status icon
    const icon = document.createElement('span');
    icon.className = 'tree-status';

    if (review?.status) {
      icon.textContent = statusBadge(review.status);
      icon.title = `Status: ${review.status}` + (assignedTo ? ` | ${assignedTo}` : '') + ' — click to change';
    } else {
      icon.textContent = '\u25CB';  // empty circle
      icon.title = 'Click to set status';
      icon.classList.add('tree-status-empty');
    }

    // Dim items assigned to someone else
    item.style.opacity = isOther ? '0.5' : '';

    icon.addEventListener('click', (e) => {
      e.stopPropagation();
      showStatusDropdown(icon, sub.name);
    });
    item.appendChild(icon);
  });

  updateProcessButton();
}

async function setTabletStatus(tabletName, newStatus) {
  const existing = resultsState.reviewStatus[tabletName] || {};

  if (newStatus) {
    resultsState.reviewStatus[tabletName] = {
      ...existing,
      status: newStatus,
      reviewedAt: new Date().toISOString(),
    };
  } else {
    delete existing.status;
    delete existing.reviewedAt;
    if (!existing.notes) {
      delete resultsState.reviewStatus[tabletName];
    }
  }

  await window.api.saveReviewStatus(getResultsRoot(), resultsState.reviewStatus);
  updateTreeStatusIcons();
  updateResultSummary();

  // Update the result card if visible
  const resultIdx = resultsState.results.findIndex(r => r.name === tabletName);
  if (resultIdx >= 0) {
    const card = document.querySelector(`.result-card[data-index="${resultIdx}"]`);
    if (card) {
      const review = resultsState.reviewStatus[tabletName];
      card.classList.remove('revision', 'updated', 'sent', 'finished');
      if (review?.status) card.classList.add(review.status);
      const badge = card.querySelector('.result-badge');
      if (badge) badge.textContent = statusBadge(review?.status);
    }
  }
}

// Popup dropdown near the clicked icon listing all status options
function showStatusDropdown(anchorEl, tabletName) {
  // Close any existing popup
  document.querySelectorAll('.status-dropdown').forEach(el => el.remove());

  const review = resultsState.reviewStatus[tabletName] || {};
  const existing = review.status || null;
  const assignedTo = review.assignedTo || null;
  const isMine = assignedTo === currentUserName;
  const isOther = assignedTo && !isMine;
  const rect = anchorEl.getBoundingClientRect();

  const menu = document.createElement('div');
  menu.className = 'status-dropdown';
  menu.style.left = `${rect.left}px`;
  // Position below the icon by default; flip above if it would go off-screen
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.visibility = 'hidden'; // measure first, then show

  // Assignment section at the top
  if (!assignedTo) {
    const assignRow = document.createElement('div');
    assignRow.className = 'status-dropdown-item';
    assignRow.innerHTML = `<span class="status-dropdown-badge">\uD83D\uDCCC</span><span>Assign to me</span>`;
    assignRow.addEventListener('click', async (e) => {
      e.stopPropagation();
      menu.remove();
      await assignTablet(tabletName, currentUserName);
    });
    menu.appendChild(assignRow);
  } else if (isMine) {
    const releaseRow = document.createElement('div');
    releaseRow.className = 'status-dropdown-item';
    releaseRow.innerHTML = `<span class="status-dropdown-badge">\uD83D\uDD13</span><span>Release</span>`;
    releaseRow.addEventListener('click', async (e) => {
      e.stopPropagation();
      menu.remove();
      await assignTablet(tabletName, null);
    });
    menu.appendChild(releaseRow);
  } else {
    const infoRow = document.createElement('div');
    infoRow.className = 'status-dropdown-item';
    infoRow.style.opacity = '0.6';
    infoRow.style.cursor = 'default';
    infoRow.innerHTML = `<span class="status-dropdown-badge">\uD83D\uDD12</span><span>Assigned to ${assignedTo}</span>`;
    menu.appendChild(infoRow);
  }

  // Divider
  const divider = document.createElement('div');
  divider.style.borderTop = '1px solid var(--border)';
  divider.style.margin = '3px 0';
  menu.appendChild(divider);

  // Status options (only clickable if unassigned or assigned to me)
  for (const opt of STATUS_OPTIONS) {
    const row = document.createElement('div');
    row.className = 'status-dropdown-item' + (opt.key === existing ? ' active' : '');
    if (isOther) row.style.opacity = '0.4';
    row.innerHTML = `<span class="status-dropdown-badge">${opt.badge}</span><span>${opt.label}</span>`;
    row.addEventListener('click', async (e) => {
      e.stopPropagation();
      menu.remove();
      if (isOther) return; // can't change someone else's status
      await setTabletStatus(tabletName, opt.key);
    });
    menu.appendChild(row);
  }

  document.body.appendChild(menu);

  // Flip above if the menu would go below the viewport
  const menuRect = menu.getBoundingClientRect();
  if (menuRect.bottom > window.innerHeight) {
    menu.style.top = `${rect.top - menuRect.height - 4}px`;
  }
  // Also keep it on-screen horizontally
  if (menuRect.right > window.innerWidth) {
    menu.style.left = `${window.innerWidth - menuRect.width - 8}px`;
  }
  menu.style.visibility = '';

  const closeOnOutside = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('mousedown', closeOnOutside);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', closeOnOutside), 0);
}

async function assignTablet(tabletName, userName) {
  const existing = resultsState.reviewStatus[tabletName] || {};
  if (userName) {
    resultsState.reviewStatus[tabletName] = {
      ...existing,
      assignedTo: userName,
      assignedAt: new Date().toISOString(),
    };
  } else {
    delete existing.assignedTo;
    delete existing.assignedAt;
    if (!existing.status && !existing.notes) {
      delete resultsState.reviewStatus[tabletName];
    }
  }
  await window.api.saveReviewStatus(getResultsRoot(), resultsState.reviewStatus);
  updateTreeStatusIcons();
  updateResultSummary();
}

// === Settings ===
let currentProjectName = '';

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

  // Load projects
  await loadProjectList(config.activeProject);

  document.getElementById('settings-overlay').classList.remove('hidden');
}

async function loadProjectList(selectName) {
  const projects = await window.api.listProjects();
  const select = document.getElementById('setting-project-select');
  select.innerHTML = '';

  for (const p of projects) {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name + (p.builtin ? '' : ' (custom)');
    select.appendChild(opt);
  }

  if (selectName && projects.some(p => p.name === selectName)) {
    select.value = selectName;
  } else if (projects.length > 0) {
    select.value = projects[0].name;
  }

  await loadProjectFields(select.value);

  select.addEventListener('change', async () => {
    await loadProjectFields(select.value);
  });
}

async function loadProjectFields(projectName) {
  currentProjectName = projectName;
  const project = await window.api.getProject(projectName);
  if (!project) return;

  document.getElementById('setting-photographer').value = project.photographer || '';
  document.getElementById('setting-institution').value = project.institution || '';
  document.getElementById('setting-measurements').value = project.measurements_file || '';
  document.getElementById('setting-ruler-position').value = project.fixed_ruler_position || 'top';
  document.getElementById('setting-credit').value = project.credit_line || '';

  const bg = project.background_color || [0, 0, 0];
  document.getElementById('setting-background').value =
    (bg[0] > 128 && bg[1] > 128 && bg[2] > 128) ? 'white' : 'black';
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
  // Save stitcher config
  const config = {
    stitcherExe: document.getElementById('setting-stitcher-exe').value.trim(),
    activeProject: document.getElementById('setting-project-select').value,
  };
  await window.api.saveStitcherConfig(config);

  // Save project settings
  if (currentProjectName) {
    const bgValue = document.getElementById('setting-background').value;
    const project = {
      name: currentProjectName,
      photographer: document.getElementById('setting-photographer').value.trim(),
      institution: document.getElementById('setting-institution').value.trim(),
      measurements_file: document.getElementById('setting-measurements').value.trim(),
      fixed_ruler_position: document.getElementById('setting-ruler-position').value,
      ruler_position_locked: true,
      credit_line: document.getElementById('setting-credit').value.trim(),
      background_color: bgValue === 'white' ? [255, 255, 255] : [0, 0, 0],
    };

    // Merge with existing project to preserve fields we don't edit here
    const existing = await window.api.getProject(currentProjectName);
    if (existing) {
      Object.assign(existing, project);
      await window.api.saveProject(existing);
    } else {
      await window.api.saveProject(project);
    }
  }

  setStatus('Settings saved.');
  closeSettings();
}

// === Stitcher Processing ===
let isStitcherRunning = false;

// Helper: check if a tablet can be processed by the current user.
// Only tablets assigned to the current user OR unassigned are processable.
function isMyTablet(review) {
  if (!review?.assignedTo) return true;   // unassigned = anyone can process
  return review.assignedTo === currentUserName;
}

function updateProcessButton() {
  const btn = document.getElementById('btn-process');
  const myReadyCount = Object.values(resultsState.reviewStatus)
    .filter(r => r.status === 'updated' && isMyTablet(r)).length;
  btn.disabled = myReadyCount === 0 || isStitcherRunning || !state.rootFolder;
  btn.title = myReadyCount > 0
    ? `Process ${myReadyCount} of your ready (green) folder(s)`
    : 'Mark your folders as ready (green) in the tree first';
}

async function onProcessReady() {
  if (isStitcherRunning) {
    alert('Stitcher is already running.');
    return;
  }

  const ready = Object.entries(resultsState.reviewStatus)
    .filter(([, v]) => v.status === 'updated' && isMyTablet(v))
    .map(([name]) => name);

  if (ready.length === 0) {
    alert('No folders assigned to you are marked as ready (green).\n\nAssign tablets to yourself first, then mark them as ready.');
    return;
  }

  const ok = confirm(`Process ${ready.length} ready folder(s)?\n\n${ready.join('\n')}`);
  if (!ok) return;

  await runStitcher(ready);
}

async function reprocessUpdated() {
  if (isStitcherRunning) {
    alert('Stitcher is already running.');
    return;
  }

  const updated = Object.entries(resultsState.reviewStatus)
    .filter(([, v]) => v.status === 'updated' && isMyTablet(v))
    .map(([name]) => name);

  if (updated.length === 0) {
    alert('No tablets assigned to you are marked as updated (green).');
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

  // In renamer mode, process from the Selected folder
  const exportBase = customExportFolder || (state.rootFolder + '/_Selected');
  const rootFolder = appMode === 'renamer' ? exportBase : state.rootFolder;

  isStitcherRunning = true;
  document.getElementById('btn-reprocess-updated').disabled = true;
  document.getElementById('btn-reprocess-all').disabled = true;

  const statusEl = document.getElementById('stitcher-status');
  statusEl.classList.remove('hidden');
  statusEl.textContent = 'Starting stitcher...\n';

  setStatus('Stitcher running...');

  // Track which tablets were sent
  const sentTablets = tablets || (appMode === 'renamer'
    ? selectedTreeFolders.map(f => f.name)
    : state.subfolders.map(s => s.name));

  // Clean cached _object.tif and _ruler.tif files so the stitcher
  // re-extracts from the (possibly edited) source images
  statusEl.textContent += 'Cleaning cached files...\n';
  const cleanedCount = await window.api.cleanTabletCache(rootFolder, tablets);
  if (cleanedCount > 0) {
    statusEl.textContent += `Removed ${cleanedCount} cached file(s).\n`;
  }

  const result = await window.api.processTablets(rootFolder, tablets);

  isStitcherRunning = false;
  document.getElementById('btn-reprocess-updated').disabled = false;
  document.getElementById('btn-reprocess-all').disabled = false;

  // Mark all sent tablets as 'sent' (yellow) so user knows to review them
  for (const name of sentTablets) {
    const existing = resultsState.reviewStatus[name] || {};
    resultsState.reviewStatus[name] = {
      ...existing,
      status: 'sent',
      reviewedAt: new Date().toISOString(),
    };
  }
  await window.api.saveReviewStatus(getResultsRoot(), resultsState.reviewStatus);

  if (result.success) {
    setStatus('Stitcher finished. Review the results.');
    statusEl.textContent += '\n=== DONE ===\n';
  } else {
    setStatus(`Stitcher finished with errors. Review the results.`);
    statusEl.textContent += `\n=== FINISHED (exit code ${result.exitCode}) ===\n`;
  }

  await loadResults();
  updateTreeStatusIcons();
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
// Picker Mode
// =====================================================================

function switchMode(mode) {
  if (mode === appMode) return;
  appMode = mode;

  document.getElementById('btn-mode-renamer').classList.toggle('active', mode === 'renamer');
  document.getElementById('btn-mode-picker').classList.toggle('active', mode === 'picker');
  document.body.classList.toggle('picker-mode', mode === 'picker');

  // Reset selection / thumbnails / panels on every mode switch
  // Close the full-image viewer if it was open (so we don't keep showing an
  // image that belongs to the other mode's folder)
  if (isViewerOpen()) exitViewerMode();

  // Also deactivate any active tool (like Segment) to avoid stale state
  if (previewTool.active) setActiveTool(previewTool.active);

  state.currentIndex = -1;
  selectedTreeIndex = -1;
  state.images = [];
  state.selectedImage = null;
  state.selectedImages.clear();
  state.assignments = {};
  state.reverseAssignments = {};
  dom.thumbGrid.innerHTML = '';
  dom.subfolderInfo.textContent = '';

  // Reset tree search
  const searchInput = document.getElementById('tree-search');
  if (searchInput) searchInput.value = '';

  // Always return to the Structure tab on mode switch
  document.querySelectorAll('.right-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === 'structure');
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('active', c.id === 'tab-structure');
  });
  activeTab = 'structure';

  // Refresh the structure diagram so stale slot highlights/filenames clear
  updateStructureDiagram();

  // Rebuild tree for the new mode
  buildTreeView();
  updateButtons();
  if (mode === 'renamer') {
    loadResults();
    startStatusRefresh();
  } else {
    stopStatusRefresh();
  }
}

let selectedTreeFolders = []; // cached selected folder scan results
let selectedTreeIndex = -1; // current index in selected tree

async function buildSelectedTree() {
  const treeList = document.getElementById('tree-list');
  treeList.innerHTML = '';
  document.getElementById('tree-header').textContent = 'Selected';

  const exportBase = customExportFolder || (state.rootFolder ? state.rootFolder + '/_Selected' : null);
  if (!exportBase) {
    treeList.innerHTML = '<div class="tree-empty">No export folder set</div>';
    selectedTreeFolders = [];
    return;
  }

  const folders = await window.api.scanSelectedFolder(exportBase);
  selectedTreeFolders = folders;
  if (folders.length === 0) {
    treeList.innerHTML = '<div class="tree-empty">No exported tablets yet</div>';
    return;
  }

  for (let i = 0; i < folders.length; i++) {
    const folder = folders[i];
    const item = document.createElement('div');
    item.className = 'tree-item tree-selected-item';
    item.dataset.selectedIndex = i;
    item.innerHTML = `${folder.name}<span class="tree-count">(${folder.imageCount})</span>`;
    item.addEventListener('click', () => {
      loadSelectedFolder(i);
    });
    treeList.appendChild(item);
  }

  updateTreeStatusIcons();
}

async function loadSelectedFolder(index) {
  const folder = selectedTreeFolders[index];
  if (!folder) return;
  selectedTreeIndex = index;

  // Highlight active item
  document.querySelectorAll('.tree-selected-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.selectedIndex) === index);
  });

  // Scan the export base to get proper image data for this subfolder
  const exportBase = customExportFolder || (state.rootFolder + '/_Selected');
  const result = await window.api.scanFolder(exportBase);
  const sub = result.subfolders.find(s => s.name === folder.name);
  if (!sub) {
    setStatus(`Could not load ${folder.name}`);
    return;
  }

  // Load into the main panel
  state.images = sub.images;
  state.selectedImage = null;
  state.selectedImages.clear();
  state.lastClickedIndex = -1;
  state.assignments = {};
  state.reverseAssignments = {};

  dom.subfolderInfo.textContent = `${folder.name}  (${index + 1} / ${selectedTreeFolders.length})`;
  dom.btnPrev.disabled = index === 0;
  dom.btnNext.disabled = index >= selectedTreeFolders.length - 1;
  dom.btnSkip.disabled = index >= selectedTreeFolders.length - 1;

  // Auto-detect existing assignments from filenames (to show in structure diagram)
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

  if (state.images.length > 0) {
    selectImage(state.images[0].path);
  }

  updateStructureDiagram();
  updateButtons();
  updateStatusCount();
}

function updatePickerList() {
  if (appMode !== 'picker') return;

  const listEl = document.getElementById('picker-list');
  const countEl = document.getElementById('picker-count');
  const exportBtn = document.getElementById('btn-export-selected');
  if (!listEl) return;

  listEl.innerHTML = '';
  const picks = Object.entries(state.assignments)
    .sort(([, a], [, b]) => a.localeCompare(b));

  countEl.textContent = `${picks.length} picked`;
  exportBtn.disabled = picks.length === 0;

  for (const [imgPath, code] of picks) {
    const img = state.images.find(i => i.path === imgPath);
    if (!img) continue;

    const item = document.createElement('div');
    item.className = 'pick-item';

    const codeSpan = document.createElement('span');
    codeSpan.className = 'pick-code';
    codeSpan.textContent = code === 'pick' ? '\u2713' : code;
    item.appendChild(codeSpan);

    const viewSpan = document.createElement('span');
    viewSpan.className = 'pick-name';
    viewSpan.textContent = code === 'pick' ? img.name : `${VIEW_CODES[code] || code} — ${img.name}`;
    item.appendChild(viewSpan);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'pick-remove';
    removeBtn.textContent = '\u00D7';
    removeBtn.title = 'Remove pick';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Unassign this pick
      delete state.reverseAssignments[code];
      delete state.assignments[imgPath];
      updateCardBadge(imgPath);
      updatePickerList();
      updateStatusCount();
      savePicksDebounced();
    });
    item.appendChild(removeBtn);

    item.addEventListener('click', () => {
      selectImage(imgPath);
    });

    listEl.appendChild(item);
  }
}

let picksDebounceTimer = null;
function savePicksDebounced() {
  if (picksDebounceTimer) clearTimeout(picksDebounceTimer);
  picksDebounceTimer = setTimeout(async () => {
    const sub = state.subfolders[state.currentIndex];
    if (!sub) return;
    // Convert assignments (imagePath -> viewCode) to (filename -> viewCode)
    const picks = {};
    for (const [imgPath, viewCode] of Object.entries(state.assignments)) {
      const img = state.images.find(i => i.path === imgPath);
      if (img) picks[img.name] = viewCode;
    }
    await window.api.savePicks(sub.path, picks);
  }, 500);
}

function updateExportFolderDisplay() {
  const el = document.getElementById('picker-folder-path');
  if (customExportFolder) {
    // Show just the folder name, not full path
    const parts = customExportFolder.replace(/\\/g, '/').split('/');
    el.textContent = parts[parts.length - 1] || customExportFolder;
    el.title = customExportFolder;
  } else {
    el.textContent = '_Selected';
    el.title = 'Default: _Selected folder in root';
  }
}

async function onExportSelected() {
  const count = Object.keys(state.assignments).length;
  if (count === 0) {
    alert('No images have been picked.');
    return;
  }

  // Determine export folder
  const exportBase = customExportFolder || (state.rootFolder ? state.rootFolder + '/_Selected' : null);
  if (!exportBase) {
    alert('No export folder set. Use the browse button to select one.');
    return;
  }

  const sub = state.subfolders[state.currentIndex];
  const tabletName = sub.name.replace(/(\w+)\s+(\d+)/g, '$1.$2');

  const lines = Object.entries(state.assignments)
    .sort(([, a], [, b]) => a.localeCompare(b))
    .map(([imgPath, code]) => {
      const img = state.images.find(i => i.path === imgPath);
      if (code === 'pick') {
        return `  ${img?.name || '?'}  (unnamed pick)`;
      }
      const ext = img ? img.ext : '.jpg';
      return `  ${img?.name || '?'}  \u2192  ${tabletName}_${code}${ext}`;
    });

  const folderLabel = customExportFolder
    ? customExportFolder.replace(/\\/g, '/').split('/').pop()
    : '_Selected';

  const ok = confirm(
    `Export ${count} picked image(s) to ${folderLabel}/${tabletName}/ ?\n\n${lines.join('\n')}`
  );
  if (!ok) return;

  setStatus('Exporting selected images...');

  const result = await window.api.exportSelected(
    state.rootFolder,
    tabletName,
    state.assignments,
    customExportFolder,
  );

  if (result.success) {
    setStatus(`Exported ${result.count} image(s) to ${folderLabel}/${tabletName}/`);
    buildSelectedTree(); // refresh the tree
  } else {
    setStatus(`Export failed: ${result.error}`);
  }
}

// === User Identity (collaboration) ===
// On startup, load or prompt for a display name. Used for tablet assignments.

function showUserNameDialog(prefill) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('user-name-overlay');
    const input = document.getElementById('user-name-input');
    const okBtn = document.getElementById('user-name-ok');
    input.value = prefill || '';
    overlay.classList.remove('hidden');
    input.focus();

    function submit() {
      const val = input.value.trim();
      overlay.classList.add('hidden');
      okBtn.removeEventListener('click', submit);
      input.removeEventListener('keydown', onKey);
      resolve(val || 'Anonymous');
    }
    function onKey(e) { if (e.key === 'Enter') submit(); }
    okBtn.addEventListener('click', submit);
    input.addEventListener('keydown', onKey);
  });
}

(async function initUserIdentity() {
  currentUserName = await window.api.getUserName();
  if (!currentUserName) {
    currentUserName = await showUserNameDialog('');
    await window.api.setUserName(currentUserName);
  }
  updateUserBadge();
})();

function updateUserBadge() {
  const el = document.getElementById('user-badge');
  if (el) el.textContent = '\uD83D\uDC64 ' + (currentUserName || 'Anonymous');
}

document.getElementById('user-badge').addEventListener('click', async () => {
  const newName = await showUserNameDialog(currentUserName);
  if (newName && newName !== currentUserName) {
    currentUserName = newName;
    await window.api.setUserName(currentUserName);
    updateUserBadge();
  }
});

// Picker is always the default mode on startup

// =====================================================================
// Tools tab + Segmentation tool
// =====================================================================
// Tool: 'segment' (draw rectangle → SAM segmentation) or null.
// Click the tool button to activate; click again (or Esc) to deactivate.

const previewTool = {
  active: null,
  busy: false,

  // Rectangle drawing state (coords are relative to #viewer-stage)
  drawing: false,
  startX: 0,
  startY: 0,
  rectDisplay: null,    // {x, y, w, h} in #viewer-stage CSS pixels
};

const segTool = {
  bgColor: 'white',
  maskOpacity: 0.5,

  // Server state
  serverReady: false,
  imageEncoded: false,
  encodedImagePath: null,
  imageWidth: 0,            // actual original image dimensions (from SAM encode)
  imageHeight: 0,

  // Bounding box being drawn right now (normalized 0..1 coordinates)
  box: null,              // { x1, y1, x2, y2 } in 0..1 range, or null

  // Operation for the current drag: 'new' | 'add' | 'sub' based on modifier keys
  dragOp: 'new',

  // The combined selection mask (accumulates via add/subtract operations)
  currentMaskBase64: null,

  // Fine rotation (degrees) applied at Apply time
  rotation: 0,

  // Canvas references (set on init)
  maskCanvas: null,
  maskCtx: null,
  interCanvas: null,
  interCtx: null,

  // Marching ants animation
  edgePixels: null,       // cached list of boundary pixels { x, y, t } (t=x+y for dash phase)
  edgeCanvasSize: null,   // { w, h } the edge pixels were computed for
  antsOffset: 0,          // current dash phase offset
  antsRAF: null,          // requestAnimationFrame id
  antsLastTick: 0,        // time of last offset increment
};

function setActiveTool(toolName) {
  const newTool = (previewTool.active === toolName) ? null : toolName;
  previewTool.active = newTool;
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === newTool);
  });
  document.getElementById('tool-options-segment').classList.toggle('visible', newTool === 'segment');
  dom.viewerStage.classList.toggle('tool-segment', newTool === 'segment');
  clearViewerRect();

  if (newTool === 'segment') {
    activateSegTool();
  } else {
    deactivateSegTool();
  }

  // The tool just activates. It only works when an image is open in the viewer,
  // so if the user isn't viewing one yet, give a hint instead of auto-opening.
  if (newTool && !isViewerOpen()) {
    setStatus('Open an image (double-click a thumbnail) to use the tool.');
  }
}

// --- Viewer rectangle (reused for segment bounding box) ---

function clearViewerRect() {
  previewTool.drawing = false;
  previewTool.rectDisplay = null;
  const overlay = document.getElementById('viewer-rect-overlay');
  if (overlay) overlay.classList.add('hidden');
}

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

function updateRectBox(box, r) {
  box.style.left = `${r.x}px`;
  box.style.top = `${r.y}px`;
  box.style.width = `${r.w}px`;
  box.style.height = `${r.h}px`;
}

// --- Segment tool: activation / state ---

function activateSegTool() {
  clearSegState();

  const container = document.getElementById('seg-canvas-container');
  container.classList.remove('hidden');
  container.classList.add('active');
  // Ensure no stale modifier-cursor classes from a previous session
  dom.viewerStage.classList.remove('mod-add', 'mod-sub');

  initSegCanvases();
  updateSegStatus('Draw a box. Shift+draw to add, Alt+draw to subtract.');
  updateSegActionButtons();
  refreshSegHistory();

  startSegServerIfNeeded();
}

// Reload the history list for the current viewer image
async function refreshSegHistory() {
  const listEl = document.getElementById('seg-history-list');
  if (!listEl) return;
  if (!viewerCurrentPath) {
    listEl.className = 'seg-history-empty';
    listEl.textContent = 'Open an image to see history.';
    updateSegSaveButton(false);
    return;
  }

  // Check if this image was already marked as saved earlier in the session
  try {
    const savedStatus = await window.api.segIsSaved(viewerCurrentPath);
    updateSegSaveButton(!!savedStatus?.saved);
  } catch (e) { updateSegSaveButton(false); }

  const data = await window.api.segGetHistory(viewerCurrentPath);
  const steps = data?.steps || [];
  const current = data?.current ?? -1;

  if (steps.length === 0) {
    listEl.className = 'seg-history-empty';
    listEl.textContent = 'No history yet.';
    return;
  }

  // Newest step first (top of list)
  const ordered = [...steps].sort((a, b) => b.step - a.step);

  listEl.className = '';
  listEl.innerHTML = '';
  for (const s of ordered) {
    const item = document.createElement('div');
    const isCurrent = s.step === current;
    item.className = 'seg-history-item' + (isCurrent ? ' seg-history-current' : '');
    const when = new Date(s.mtime);
    const label = s.step === 0 ? 'Original' : `Step ${s.step}`;
    item.innerHTML = `
      <span class="seg-history-marker">${isCurrent ? '\u25B6' : ''}</span>
      <div class="seg-history-label">
        <span>${label}</span>
        <span class="seg-history-time">${when.toLocaleString()}</span>
      </div>
    `;
    if (!isCurrent) {
      item.addEventListener('click', () => jumpToSegStep(s.step));
    }
    listEl.appendChild(item);
  }
}

async function markSegSaved() {
  if (!viewerCurrentPath) {
    setStatus('Open an image first.');
    return;
  }
  const ok = confirm('Mark this image as saved?\n\nThe history stays available for this session, but will be deleted when the app is restarted.');
  if (!ok) return;

  try {
    const result = await window.api.segMarkSaved(viewerCurrentPath);
    if (result && result.status === 'ok') {
      updateSegStatus('Saved. History will be cleaned up on next app start.');
      setStatus('Marked as saved.');
      updateSegSaveButton(true);
      // Return to the thumbnail grid — done editing this tablet
      if (previewTool.active) setActiveTool(previewTool.active);
      if (isViewerOpen()) exitViewerMode();
      // Switch right panel back to Structure — editing is done
      const structTab = document.querySelector('.right-tab[data-tab="structure"]');
      if (structTab) structTab.click();
    } else {
      updateSegStatus(`Save error: ${result?.error || 'failed'}`);
    }
  } catch (err) {
    updateSegStatus(`Save error: ${err.message}`);
  }
}

function updateSegSaveButton(isSaved) {
  const btn = document.getElementById('seg-save');
  if (!btn) return;
  if (isSaved) {
    btn.textContent = '\u2713 Saved';
    btn.disabled = true;
  } else {
    btn.innerHTML = '&#x1F4BE; Save';
    btn.disabled = false;
  }
}

async function jumpToSegStep(step) {
  if (!viewerCurrentPath) return;

  previewTool.busy = true;
  updateSegStatus(`Jumping to step ${step}...`);

  try {
    const result = await window.api.segJumpToStep(viewerCurrentPath, step);
    if (result && result.status === 'ok') {
      updateSegStatus(`Now at ${step === 0 ? 'Original' : 'step ' + step}.`);
      setStatus(`Jumped to ${step === 0 ? 'Original' : 'step ' + step}.`);

      if (result.thumbnail) {
        const card = getCardForImage(viewerCurrentPath);
        if (card) {
          const imgEl = card.querySelector('img');
          if (imgEl) imgEl.src = result.thumbnail;
        }
      }

      clearSegState();
      if (isViewerOpen()) await loadViewerImage(viewerCurrentPath);
      refreshSegHistory();
    } else {
      updateSegStatus(`Jump error: ${result?.error || 'failed'}`);
    }
  } catch (err) {
    updateSegStatus(`Jump error: ${err.message}`);
  }

  previewTool.busy = false;
}

function deactivateSegTool() {
  clearSegState();
  const container = document.getElementById('seg-canvas-container');
  container.classList.add('hidden');
  container.classList.remove('active');
  // Drop modifier-cursor classes
  dom.viewerStage.classList.remove('mod-add', 'mod-sub');
  clearSegCanvases();
}

function clearSegState() {
  segTool.box = null;
  segTool.currentMaskBase64 = null;
  segTool.imageEncoded = false;
  segTool.encodedImagePath = null;
  segTool.imageWidth = 0;
  segTool.imageHeight = 0;
  segTool.edgePixels = null;
  segTool.edgeCanvasSize = null;
  segTool.dragOp = 'new';
  segTool.rotation = 0;
  updateSegRotationUI();
  stopMarchingAntsAnimation();
  clearViewerRect();
  clearSegCanvases();
  updateSegActionButtons();
}

function updateSegRotationUI() {
  const slider = document.getElementById('seg-rotation');
  const num = document.getElementById('seg-rotation-num');
  if (slider) slider.value = segTool.rotation;
  if (num) num.value = segTool.rotation;
  applySegRotationPreview();
}

function applySegRotationPreview() {
  // Rotate only the mask/interaction canvases so the user sees the rotation live
  const maskC = segTool.maskCanvas;
  const interC = segTool.interCanvas;
  const t = `rotate(${segTool.rotation}deg)`;
  const origin = '50% 50%';
  if (maskC) { maskC.style.transformOrigin = origin; maskC.style.transform = t; }
  if (interC) { interC.style.transformOrigin = origin; interC.style.transform = t; }
}

function initSegCanvases() {
  segTool.maskCanvas = document.getElementById('seg-canvas-mask');
  segTool.interCanvas = document.getElementById('seg-canvas-interaction');
  segTool.maskCtx = segTool.maskCanvas.getContext('2d');
  segTool.interCtx = segTool.interCanvas.getContext('2d');
  resizeSegCanvases();
}

function resizeSegCanvases() {
  const disp = getDisplayedImageRect();
  if (!disp) return;

  for (const canvas of [segTool.maskCanvas, segTool.interCanvas]) {
    if (!canvas) continue;
    canvas.width = disp.width;
    canvas.height = disp.height;
    canvas.style.left = `${disp.left}px`;
    canvas.style.top = `${disp.top}px`;
    canvas.style.width = `${disp.width}px`;
    canvas.style.height = `${disp.height}px`;
  }
}

function clearSegCanvases() {
  if (segTool.maskCtx && segTool.maskCanvas) {
    segTool.maskCtx.clearRect(0, 0, segTool.maskCanvas.width, segTool.maskCanvas.height);
  }
  if (segTool.interCtx && segTool.interCanvas) {
    segTool.interCtx.clearRect(0, 0, segTool.interCanvas.width, segTool.interCanvas.height);
  }
}

// --- Coordinate conversion ---

function stageToCanvasCoords(stageX, stageY) {
  const disp = getDisplayedImageRect();
  if (!disp) return null;
  const cx = stageX - disp.left;
  const cy = stageY - disp.top;
  return {
    x: Math.max(0, Math.min(disp.width, cx)),
    y: Math.max(0, Math.min(disp.height, cy)),
  };
}

function canvasToImageCoords(canvasX, canvasY) {
  const disp = getDisplayedImageRect();
  if (!disp) return null;
  // Use the actual original image dimensions (from SAM encode) if available,
  // not the display-resolution natW/natH which may be a scaled-down preview.
  const targetW = segTool.imageWidth || disp.natW;
  const targetH = segTool.imageHeight || disp.natH;
  return {
    x: Math.round((canvasX / disp.width) * targetW),
    y: Math.round((canvasY / disp.height) * targetH),
  };
}

// --- Mouse handlers ---

function onViewerMouseDown(e) {
  if (previewTool.active !== 'segment' || previewTool.busy) return;
  if (!isViewerOpen()) return;
  if (e.button !== 0) return;

  const disp = getDisplayedImageRect();
  if (!disp) return;

  const stageRect = dom.viewerStage.getBoundingClientRect();
  const x = e.clientX - stageRect.left;
  const y = e.clientY - stageRect.top;

  // Only start drawing if the cursor is over the image
  if (x < disp.left || x > disp.left + disp.width ||
      y < disp.top || y > disp.top + disp.height) return;

  e.preventDefault();

  // Determine the operation from modifier keys (like Photoshop)
  if (e.shiftKey) segTool.dragOp = 'add';
  else if (e.altKey) segTool.dragOp = 'sub';
  else segTool.dragOp = 'new';

  previewTool.drawing = true;
  previewTool.startX = x;
  previewTool.startY = y;
  previewTool.rectDisplay = { x, y, w: 0, h: 0 };

  const overlay = document.getElementById('viewer-rect-overlay');
  const box = document.getElementById('viewer-rect-box');
  overlay.classList.remove('hidden');
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

function onViewerMouseUp(e) {
  if (!previewTool.drawing) return;
  previewTool.drawing = false;

  // Refresh modifier cursor classes based on the CURRENT key state — prevents
  // a stuck '−' or '+' cursor if a modifier was released mid-drag outside the
  // window and we missed the keyup event.
  if (e) {
    dom.viewerStage.classList.toggle('mod-add', !!e.shiftKey);
    dom.viewerStage.classList.toggle('mod-sub', !!e.altKey && !e.shiftKey);
  }

  const r = previewTool.rectDisplay;
  if (!r || r.w < 6 || r.h < 6) {
    clearViewerRect();
    return;
  }

  const disp = getDisplayedImageRect();
  if (!disp) return;

  // Store box in normalized (0..1) coords — will be converted to image pixels
  // when sending to SAM (after encode returns the real image dimensions).
  segTool.box = {
    x1: (r.x - disp.left) / disp.width,
    y1: (r.y - disp.top) / disp.height,
    x2: (r.x - disp.left + r.w) / disp.width,
    y2: (r.y - disp.top + r.h) / disp.height,
  };

  updateSegActionButtons();

  // For an "add" or "sub" drag, we need an existing mask to combine with.
  // If none exists, silently treat it as a "new" selection.
  if (segTool.dragOp !== 'new' && !segTool.currentMaskBase64) {
    segTool.dragOp = 'new';
  }

  const opLabel = segTool.dragOp === 'add' ? 'Adding…'
                : segTool.dragOp === 'sub' ? 'Subtracting…'
                : 'Encoding image…';
  updateSegStatus(opLabel);

  // Run the SAM pipeline: encode (if needed) then predict for the new box
  requestSegEncode().then(() => runSegPredictionForDrag());
}

function renderSegMask(maskPngBase64) {
  if (!maskPngBase64 || !segTool.maskCtx || !segTool.maskCanvas) return;

  // Ensure canvases are correctly sized/positioned for the current image
  resizeSegCanvases();

  const img = new Image();
  img.onload = () => {
    const ctx = segTool.maskCtx;
    const w = segTool.maskCanvas.width;
    const h = segTool.maskCanvas.height;

    console.log('[seg] mask image:', img.naturalWidth, 'x', img.naturalHeight,
                '→ canvas:', w, 'x', h,
                'pos:', segTool.maskCanvas.style.left, segTool.maskCanvas.style.top);

    ctx.clearRect(0, 0, w, h);

    // Draw mask scaled to canvas size into a temp canvas
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(img, 0, 0, w, h);
    const src = tempCtx.getImageData(0, 0, w, h).data;

    // Compute mask boundary pixels once and cache them. Animation just redraws
    // the cached list with a shifting dash offset → smooth marching-ants effect.
    function inside(x, y) {
      if (x < 0 || x >= w || y < 0 || y >= h) return false;
      return src[(y * w + x) * 4] > 128;
    }

    const edges = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!inside(x, y)) continue;
        if (inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1)) continue;
        edges.push({ x, y, t: x + y });
      }
    }

    segTool.edgePixels = edges;
    segTool.edgeCanvasSize = { w, h };
    segTool.antsOffset = 0;
    startMarchingAntsAnimation();
  };
  img.src = `data:image/png;base64,${maskPngBase64}`;
}

// Redraw the cached edge pixels with the current dash offset.
function drawMarchingAnts() {
  if (!segTool.edgePixels || !segTool.maskCtx || !segTool.edgeCanvasSize) return;
  const { w, h } = segTool.edgeCanvasSize;
  if (w !== segTool.maskCanvas.width || h !== segTool.maskCanvas.height) return;

  const ctx = segTool.maskCtx;
  const out = ctx.createImageData(w, h);
  const outData = out.data;
  const DASH = 6;
  const offset = segTool.antsOffset;

  for (const p of segTool.edgePixels) {
    const alt = Math.floor((p.t + offset) / DASH) % 2;
    const color = alt === 0 ? 0 : 255;
    // Draw 2×2 block for thickness
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) {
      const nx = p.x + dx, ny = p.y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const idx = (ny * w + nx) * 4;
      outData[idx]     = color;
      outData[idx + 1] = color;
      outData[idx + 2] = color;
      outData[idx + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

function startMarchingAntsAnimation() {
  stopMarchingAntsAnimation();
  segTool.antsLastTick = performance.now();
  const tick = (now) => {
    // Shift the dash phase ~1 pixel every ~60ms → comfortable crawl speed
    if (now - segTool.antsLastTick >= 60) {
      segTool.antsOffset = (segTool.antsOffset + 1) % 120;
      segTool.antsLastTick = now;
      drawMarchingAnts();
    }
    segTool.antsRAF = requestAnimationFrame(tick);
  };
  // Render the initial frame immediately
  drawMarchingAnts();
  segTool.antsRAF = requestAnimationFrame(tick);
}

function stopMarchingAntsAnimation() {
  if (segTool.antsRAF) {
    cancelAnimationFrame(segTool.antsRAF);
    segTool.antsRAF = null;
  }
}

// --- UI controls ---

function setSegBg(color) {
  segTool.bgColor = color;
  document.getElementById('seg-bg-white').classList.toggle('active', color === 'white');
  document.getElementById('seg-bg-black').classList.toggle('active', color === 'black');
}

function updateSegStatus(msg) {
  const el = document.getElementById('seg-status');
  if (el) el.textContent = msg;
}

function updateSegActionButtons() {
  const hasBox = !!segTool.box;
  const hasMask = !!segTool.currentMaskBase64;
  document.getElementById('seg-clear').disabled = !hasBox && !hasMask;
  document.getElementById('seg-apply').disabled = !hasMask;
  // Rotation row only makes sense once a mask exists
  const rotRow = document.getElementById('seg-rotation-row');
  if (rotRow) rotRow.style.display = hasMask ? '' : 'none';
}

function segClear() {
  clearSegState();
  updateSegStatus('Draw a box. Shift+draw to add, Alt+draw to subtract.');
}

// --- Backend communication (stubs until Phase 2-3 wired) ---

async function startSegServerIfNeeded() {
  if (segTool.serverReady) return;
  updateSegStatus('Starting segmentation server...');

  try {
    const result = await window.api.segStartServer();
    if (result && result.success) {
      segTool.serverReady = true;
      updateSegStatus('Server ready. Draw a rectangle around the tablet.');
    } else {
      updateSegStatus(`Server error: ${result?.error || 'unknown'}`);
    }
  } catch (err) {
    updateSegStatus(`Server not available: ${err.message}`);
    segTool.serverReady = false;
  }
}

async function requestSegEncode() {
  if (!viewerCurrentPath) return;
  if (segTool.encodedImagePath === viewerCurrentPath) return;

  // Ensure server is running before making HTTP calls
  if (!segTool.serverReady) {
    updateSegStatus('Waiting for segmentation server...');
    await startSegServerIfNeeded();
    if (!segTool.serverReady) {
      updateSegStatus('Server not available. Check Python installation.');
      return;
    }
  }

  previewTool.busy = true;
  updateSegStatus('Encoding image (this takes a few seconds)...');

  try {
    const result = await window.api.segEncodeImage(viewerCurrentPath);
    if (result && result.status === 'ready') {
      segTool.imageEncoded = true;
      segTool.encodedImagePath = viewerCurrentPath;
      segTool.imageWidth = result.width;
      segTool.imageHeight = result.height;
    } else {
      updateSegStatus(`Encode failed: ${result?.error || 'unknown'}`);
    }
  } catch (err) {
    updateSegStatus(`Encode error: ${err.message}`);
  }

  previewTool.busy = false;
}

// Run SAM on the current box and combine the result with the existing mask
// based on segTool.dragOp ('new' | 'add' | 'sub').
async function runSegPredictionForDrag() {
  if (!segTool.imageEncoded || !segTool.box) return;
  previewTool.busy = true;

  try {
    // Convert normalized box to image pixel coords
    const iw = segTool.imageWidth;
    const ih = segTool.imageHeight;
    const pixelBox = {
      x1: Math.round(segTool.box.x1 * iw),
      y1: Math.round(segTool.box.y1 * ih),
      x2: Math.round(segTool.box.x2 * iw),
      y2: Math.round(segTool.box.y2 * ih),
    };

    // Predict the mask for ONLY the new box — no points
    const result = await window.api.segPredictMask(pixelBox, [], []);
    if (!result || !result.mask) {
      updateSegStatus(`Prediction failed: ${result?.error || 'unknown'}`);
      previewTool.busy = false;
      return;
    }

    // Merge with the existing mask based on the drag operation
    let finalMask;
    if (segTool.dragOp === 'new' || !segTool.currentMaskBase64) {
      finalMask = result.mask;
    } else if (segTool.dragOp === 'add') {
      finalMask = await mergeMasksBase64(segTool.currentMaskBase64, result.mask, 'union');
    } else if (segTool.dragOp === 'sub') {
      finalMask = await mergeMasksBase64(segTool.currentMaskBase64, result.mask, 'subtract');
    } else {
      finalMask = result.mask;
    }

    segTool.currentMaskBase64 = finalMask;
    clearViewerRect();
    renderSegMask(finalMask);

    const verb = segTool.dragOp === 'add' ? 'Added to' : segTool.dragOp === 'sub' ? 'Subtracted from' : 'Created new';
    updateSegStatus(`${verb} selection. Apply to save.`);
    updateSegActionButtons();

    // Reset dragOp after applying (so next plain drag defaults to 'new')
    segTool.dragOp = 'new';
    segTool.box = null;
  } catch (err) {
    updateSegStatus(`Prediction error: ${err.message}`);
  }

  previewTool.busy = false;
}

/**
 * Merge two base64 grayscale PNG masks pixel-wise.
 * op = 'union' (OR) | 'subtract' (A AND NOT B).
 * Returns a new base64 PNG.
 */
function mergeMasksBase64(baseB64, newB64, op) {
  return new Promise((resolve, reject) => {
    const imgA = new Image();
    const imgB = new Image();
    let loaded = 0;
    function onLoad() {
      loaded++;
      if (loaded < 2) return;

      const w = Math.max(imgA.naturalWidth, imgB.naturalWidth);
      const h = Math.max(imgA.naturalHeight, imgB.naturalHeight);
      const canvasA = document.createElement('canvas');
      const canvasB = document.createElement('canvas');
      canvasA.width = w; canvasA.height = h;
      canvasB.width = w; canvasB.height = h;
      const ctxA = canvasA.getContext('2d');
      const ctxB = canvasB.getContext('2d');
      ctxA.drawImage(imgA, 0, 0, w, h);
      ctxB.drawImage(imgB, 0, 0, w, h);
      const dataA = ctxA.getImageData(0, 0, w, h);
      const dataB = ctxB.getImageData(0, 0, w, h).data;
      const a = dataA.data;

      for (let i = 0; i < a.length; i += 4) {
        const va = a[i] > 128 ? 255 : 0;
        const vb = dataB[i] > 128 ? 255 : 0;
        let v;
        if (op === 'union') v = Math.max(va, vb);
        else if (op === 'subtract') v = (va === 255 && vb === 0) ? 255 : 0;
        else v = vb;
        a[i] = a[i + 1] = a[i + 2] = v;
        a[i + 3] = 255;
      }

      ctxA.putImageData(dataA, 0, 0);
      const dataUrl = canvasA.toDataURL('image/png');
      const b64 = dataUrl.split(',')[1];
      resolve(b64);
    }
    imgA.onload = onLoad;
    imgB.onload = onLoad;
    imgA.onerror = reject;
    imgB.onerror = reject;
    imgA.src = `data:image/png;base64,${baseB64}`;
    imgB.src = `data:image/png;base64,${newB64}`;
  });
}

async function applySegMask() {
  if (!segTool.currentMaskBase64 || !viewerCurrentPath) return;

  previewTool.busy = true;
  updateSegStatus('Applying mask...');

  try {
    const result = await window.api.segApplyMask(
      viewerCurrentPath,
      null,  // main process computes _cleaned/ path
      segTool.currentMaskBase64,
      segTool.bgColor,
      segTool.rotation
    );

    if (result && result.status === 'ok') {
      updateSegStatus(`Image saved. Mask saved as _mask.png.`);
      setStatus('Segmentation applied successfully.');

      if (result.thumbnail) {
        const card = getCardForImage(viewerCurrentPath);
        if (card) {
          const imgEl = card.querySelector('img');
          if (imgEl) imgEl.src = result.thumbnail;
        }
      }

      // Reset segmentation state and reload the viewer with the new (cropped) file
      clearSegState();
      if (isViewerOpen()) {
        await loadViewerImage(viewerCurrentPath);
      }
      refreshSegHistory();
    } else {
      updateSegStatus(`Apply error: ${result?.error || 'failed'}`);
    }
  } catch (err) {
    updateSegStatus(`Apply error: ${err.message}`);
  }

  previewTool.busy = false;
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

// Segment tool controls
document.getElementById('seg-bg-white').addEventListener('click', () => setSegBg('white'));
document.getElementById('seg-bg-black').addEventListener('click', () => setSegBg('black'));
document.getElementById('seg-clear').addEventListener('click', segClear);
document.getElementById('seg-apply').addEventListener('click', applySegMask);
document.getElementById('seg-save').addEventListener('click', markSegSaved);
document.getElementById('seg-opacity').addEventListener('input', (e) => {
  segTool.maskOpacity = e.target.value / 100;
  if (segTool.maskCanvas) segTool.maskCanvas.style.opacity = segTool.maskOpacity;
  document.getElementById('seg-opacity-value').textContent = `${e.target.value}%`;
});

// Rotation: slider + number input stay in sync; preview updates live
function setSegRotation(val) {
  const clamped = Math.max(-180, Math.min(180, Number(val) || 0));
  segTool.rotation = clamped;
  const slider = document.getElementById('seg-rotation');
  const num = document.getElementById('seg-rotation-num');
  // Only set if different to avoid feedback loops
  if (slider && parseFloat(slider.value) !== clamped) slider.value = clamped;
  if (num && parseFloat(num.value) !== clamped) num.value = clamped;
  applySegRotationPreview();
}
document.getElementById('seg-rotation').addEventListener('input', (e) => setSegRotation(e.target.value));
document.getElementById('seg-rotation-num').addEventListener('input', (e) => setSegRotation(e.target.value));
document.getElementById('seg-rotation-reset').addEventListener('click', () => setSegRotation(0));

// Modifier-key cursor feedback (only relevant when the segment tool is active)
function updateSegModifierCursor(e) {
  if (previewTool.active !== 'segment') {
    dom.viewerStage.classList.remove('mod-add', 'mod-sub');
    return;
  }
  dom.viewerStage.classList.toggle('mod-add', !!e.shiftKey);
  dom.viewerStage.classList.toggle('mod-sub', !!e.altKey && !e.shiftKey);
}
window.addEventListener('keydown', updateSegModifierCursor);
window.addEventListener('keyup', updateSegModifierCursor);
// On window focus or mouse entering the stage, assume no modifiers are held
// unless explicit key events say otherwise.
window.addEventListener('blur', () => dom.viewerStage.classList.remove('mod-add', 'mod-sub'));
dom.viewerStage.addEventListener('mouseenter', () => dom.viewerStage.classList.remove('mod-add', 'mod-sub'));

dom.viewerStage.addEventListener('mousedown', onViewerMouseDown);
// Zoom (wheel) and pan (middle-mouse) on the viewer
dom.viewerStage.addEventListener('wheel', onViewerWheel, { passive: false });
dom.viewerStage.addEventListener('mousedown', onViewerPanStart);
window.addEventListener('mousemove', onViewerPanMove);
window.addEventListener('mouseup', onViewerPanEnd);
// Disable the default context menu on the stage so middle/right-click pans cleanly
dom.viewerStage.addEventListener('auxclick', (e) => e.preventDefault());
window.addEventListener('mousemove', onViewerMouseMove);
window.addEventListener('mouseup', onViewerMouseUp);

// Resize: reposition canvases and drop stale rect
window.addEventListener('resize', () => {
  clearViewerRect();
  if (previewTool.active === 'segment') resizeSegCanvases();
});
