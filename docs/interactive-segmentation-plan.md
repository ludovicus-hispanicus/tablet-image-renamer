# Interactive AI Segmentation Tool — Implementation Plan

## Problem

The current background removal in ebl-photo-stitcher is fully automatic (U2NET via rembg). It works well for most tablets, but when it doesn't — uneven lighting, shadows, similar-colored backgrounds, broken edges — there is no way to correct it. The user either accepts the result or re-photographs the tablet.

Photoshop-style interactive selection (draw a box, click to add/remove regions) would let users guide the AI when automatic extraction fails, without needing Photoshop.

## Goal

Add an **interactive segmentation tool** to the tablet-image-renamer app where users can:

1. **Draw a rectangle** around the object of interest
2. The AI **segments the object** within that rectangle
3. **Click to add** regions the AI missed (positive points)
4. **Click to remove** regions the AI incorrectly included (negative points)
5. See the **mask update in real-time** after each interaction
6. **Export the mask** for use in the stitching pipeline

---

## The Model: SAM (Segment Anything Model)

Meta's [Segment Anything Model (SAM)](https://github.com/facebookresearch/segment-anything) is purpose-built for interactive segmentation. Unlike U2NET (which only does automatic foreground/background), SAM accepts **user prompts**:

| Prompt Type | User Action | Effect |
|-------------|-------------|--------|
| Bounding box | Draw rectangle | "Segment what's inside this box" |
| Positive point | Left-click | "Include this area in the mask" |
| Negative point | Right-click | "Exclude this area from the mask" |
| Combined | Box + clicks | Refine progressively |

### How SAM works internally

SAM has two stages:

1. **Image encoder** (heavy, runs once per image): Encodes the full image into an embedding. This is the slow step (~1-5 seconds depending on variant and hardware).

2. **Mask decoder** (lightweight, runs per interaction): Takes the embedding + user prompts (box, points) and produces a mask. This is fast (~50ms), which is what makes the interactive click-refine loop feel responsive.

### Model variants

| Variant | Size | Encode time (CPU) | Encode time (GPU) | Quality | Best for |
|---------|------|-------------------|-------------------|---------|----------|
| SAM 2 (ViT-H) | ~2.5GB | ~15-30s | ~1-2s | Best | Server with GPU |
| SAM ViT-B | ~375MB | ~5-10s | ~0.5s | Good | Server or fast CPU |
| MobileSAM | ~40MB | ~1-3s | ~0.2s | Good enough | Local CPU, responsive UI |
| EfficientSAM-S | ~25MB | ~1-2s | ~0.1s | Acceptable | Lightest local option |

**Recommendation:** Start with **MobileSAM** for local/CPU use. If quality isn't sufficient for tablet edges, move to SAM ViT-B on a server.

---

## Architecture Options

### Option A: Local Python backend (simplest)

```
Electron App (renderer)              Python process (local)
┌──────────────────────┐            ┌─────────────────────┐
│  Canvas UI           │   HTTP     │  FastAPI server      │
│  - draw box          │ ────────►  │  - /encode (slow)    │
│  - click add/remove  │            │  - /predict (fast)   │
│  - show mask overlay │ ◄────────  │  - MobileSAM model   │
│                      │   mask     │                      │
└──────────────────────┘            └─────────────────────┘
```

- Python server starts as a child process when the tool is opened
- `python/` directory (already exists, currently empty) hosts the server
- MobileSAM (~40MB) bundled or downloaded on first use
- Works offline, no API costs
- **macOS/Windows/Linux compatible** — Python + ONNX runs everywhere

### Option B: Remote server (for heavier models)

```
Electron App (renderer)              Remote Server
┌──────────────────────┐            ┌─────────────────────┐
│  Canvas UI           │   HTTPS    │  FastAPI + GPU       │
│  - draw box          │ ────────►  │  - /encode           │
│  - click add/remove  │            │  - /predict          │
│  - show mask overlay │ ◄────────  │  - SAM 2 / ViT-B    │
│                      │   mask     │                      │
└──────────────────────┘            └─────────────────────┘
```

- Better quality models (SAM 2 with GPU)
- Shared server for multiple users
- Requires internet connection
- Could be the same server used for stitching (see server-client plan)

### Option C: Hybrid (recommended for production)

- **Default: local MobileSAM** (works offline, responsive enough)
- **Optional: remote server** for better quality when available
- User configures server URL in settings (like the stitcher EXE path today)
- Falls back to local if server is unreachable

---

## UI Design

### Where it fits in the app

The app already has a **viewer mode** with rectangle drawing (the trim tool). The segmentation tool would be a new tool in the **Tools tab** alongside trim.

### Interaction flow

```
1. User opens an image in the viewer
2. Clicks "Segment" tool in the Tools tab
3. Toolbar appears: [Box] [Add Point] [Remove Point] [Clear] [Apply] [Cancel]
4. User draws a rectangle around the tablet
   → mask overlay appears (semi-transparent blue/red)
   → ~1-3 seconds for first result (image encoding + prediction)
5. User left-clicks on missed areas → mask expands (~50ms)
6. User right-clicks on unwanted areas → mask shrinks (~50ms)
7. User clicks [Apply]
   → mask is saved as {filename}_mask.png
   → masked image saved as {filename}_object.tif (transparent background)
```

### Visual feedback

- **Blue overlay (50% opacity):** selected/masked region
- **Red outline:** mask boundary
- **Green dots:** positive click points
- **Red dots:** negative click points
- **Checkerboard pattern:** transparent areas (like Photoshop)

### Canvas implementation

The current viewer uses plain `<img>` elements with CSS. For mask overlay, we need an actual `<canvas>`:

```
┌─────────────────────────────────┐
│  <div id="segmentation-viewer"> │
│    <canvas id="image-layer">    │  ← base image
│    <canvas id="mask-layer">     │  ← semi-transparent mask overlay
│    <canvas id="interaction">    │  ← click points, rectangle, cursor
│  </div>                         │
└─────────────────────────────────┘
```

Three stacked canvases:
1. **Image layer:** renders the photo (static after load)
2. **Mask layer:** renders the segmentation mask (updates on each interaction)
3. **Interaction layer:** renders click points, the bounding box, and cursor feedback

No need for Fabric.js or Konva.js — vanilla Canvas API is sufficient for this. We only draw simple shapes (rectangles, circles, image data).

---

## Python Backend

### Dependencies

```
# python/requirements.txt
fastapi>=0.100.0
uvicorn>=0.23.0
mobile-sam>=1.0          # or segment-anything + checkpoint
numpy>=1.24.0
Pillow>=10.0.0
onnxruntime>=1.15.0      # CPU inference
```

Total additional footprint: **~50-60MB** (MobileSAM checkpoint + dependencies, most shared with existing rembg stack).

### API endpoints

```python
# python/segmentation_server.py

from fastapi import FastAPI
from mobile_sam import sam_model_registry, SamPredictor

app = FastAPI()
predictor = None  # lazy-loaded

@app.post("/encode")
async def encode_image(image_path: str):
    """Encode image embedding (slow, called once per image)."""
    image = cv2.imread(image_path)
    predictor.set_image(image)
    return {"status": "ready", "image_shape": image.shape[:2]}

@app.post("/predict")
async def predict_mask(
    box: list[int] = None,           # [x1, y1, x2, y2]
    positive_points: list = None,     # [[x, y], ...]
    negative_points: list = None      # [[x, y], ...]
):
    """Predict mask from prompts (fast, called per interaction)."""
    point_coords = []
    point_labels = []

    if positive_points:
        point_coords.extend(positive_points)
        point_labels.extend([1] * len(positive_points))
    if negative_points:
        point_coords.extend(negative_points)
        point_labels.extend([0] * len(negative_points))

    masks, scores, _ = predictor.predict(
        point_coords=np.array(point_coords) if point_coords else None,
        point_labels=np.array(point_labels) if point_labels else None,
        box=np.array(box) if box else None,
        multimask_output=True
    )

    # Return the highest-scoring mask
    best = masks[np.argmax(scores)]
    # Encode as PNG for transfer
    mask_png = encode_mask_to_png(best)
    return Response(content=mask_png, media_type="image/png")

@app.post("/apply")
async def apply_mask(image_path: str, output_path: str):
    """Apply the current mask to the image and save."""
    # Save object with transparent background
    ...
```

### Electron integration

```javascript
// src/main/segmentation-bridge.js

const { spawn } = require('child_process');
let pythonProcess = null;

function startSegmentationServer() {
    pythonProcess = spawn('python', [
        '-m', 'uvicorn',
        'segmentation_server:app',
        '--host', '127.0.0.1',
        '--port', '8765'
    ], { cwd: path.join(__dirname, '../../python') });

    // Wait for "Uvicorn running on..." message
    return new Promise((resolve) => {
        pythonProcess.stdout.on('data', (data) => {
            if (data.toString().includes('running on')) resolve();
        });
    });
}

function stopSegmentationServer() {
    if (pythonProcess) pythonProcess.kill();
}
```

IPC handlers in `main.js`:
- `start-segmentation` → starts Python server
- `encode-image` → `POST /encode`
- `predict-mask` → `POST /predict`
- `apply-mask` → `POST /apply`
- `stop-segmentation` → kills Python process

Preload bridge in `preload.js`:
- `window.api.startSegmentation()`
- `window.api.encodImage(imagePath)`
- `window.api.predictMask({ box, positivePoints, negativePoints })`
- `window.api.applyMask(imagePath, outputPath)`

---

## macOS Compatibility

### Current status

The tablet-image-renamer already builds and runs on macOS:
- **DMG builds** for both x64 (Intel) and arm64 (Apple Silicon)
- **Ad-hoc code signing** (users run `xattr -cr` once after install)
- **Sharp** works on both architectures (platform-specific binaries installed in CI)

### Segmentation tool compatibility

| Component | macOS support |
|-----------|--------------|
| Canvas API (browser) | Yes — Chromium in Electron |
| Python 3.x | Yes — pre-installed or via Homebrew |
| MobileSAM / SAM | Yes — PyTorch and ONNX support macOS |
| ONNX Runtime CPU | Yes — ARM64 and x64 wheels available |
| FastAPI + Uvicorn | Yes — pure Python, platform-independent |
| Metal GPU acceleration | Partial — ONNX supports CoreML provider on macOS |

### Python bundling on macOS

Two options:

1. **Require system Python** (simpler): User installs Python + pip dependencies. The app checks for Python on startup and shows setup instructions if missing.

2. **Bundle Python** (better UX): Use PyInstaller or similar to create a self-contained Python binary. Distribute alongside the Electron app. Adds ~30-50MB to the DMG.

**Recommendation:** Start with option 1 (require system Python). Move to option 2 if user feedback demands a simpler install.

---

## Integration with ebl-photo-stitcher

### How the stitcher handles files today

After processing, the stitcher's cleanup step moves background-removed images into a
`_cleaned/` subfolder inside each tablet folder. Originals stay untouched:

```
Working folder/
  SI.41/
    SI.41_01.tif              ← original (untouched)
    SI.41_02.tif              ← original (untouched)
    SI.41_03.tif              ← original (untouched)
    _cleaned/
      SI.41_01.tif            ← background-removed by U2NET
      SI.41_02.tif            ← background-removed by U2NET
      SI.41_03.tif            ← background-removed by U2NET
  SI.42/
    ...
  _Final_JPG/
    SI.41_stitched.jpg        ← stitched output
  _Final_TIFF/
    SI.41_stitched.tif        ← stitched output
```

Key points:
- The **renamer app only sees the originals** — it lists files directly in the tablet
  folder and does not recurse into subfolders. Folders starting with `_` are also
  skipped at the root scan level.
- The `_cleaned/` folder is **invisible to the renamer** (verified in `file-ops.js`:
  `getImagesInFolder` uses flat `readdirSync` + `isFile()` check, and `scanFolder`
  skips `_`-prefixed directories).
- The stitcher reads `_object.tif` files **before** cleanup runs, so the move to
  `_cleaned/` does not affect the stitching process.

### Correction workflow with SAM

```
Round 1 — Automatic (stitcher)
  1. User sends all images to the stitcher
  2. Stitcher runs U2NET → produces _object.tif files
  3. Stitcher stitches the composite from _object.tif files
  4. Cleanup moves _object.tif → _cleaned/{name}.tif
  5. Originals remain in tablet folder

Round 2 — Correction (renamer + SAM, only the bad ones)
  1. User reviews stitched results in the renamer's Results tab
  2. User identifies images where extraction failed
  3. User opens the original image in the renamer viewer (it's right there)
  4. User clicks "Segment" tool → SAM works on the original
  5. User draws box + clicks to refine → mask saved
  6. Corrected clean image replaces the bad one in _cleaned/
  7. User re-runs stitcher for that tablet only
     (stitcher can check for existing _cleaned/ images and skip U2NET
      for those that already have a good extraction)
```

### Mask format

- **PNG, single channel** (grayscale): 0 = background, 255 = foreground
- Same dimensions as the source image
- Naming convention: `{original_filename}_mask.png`
- Stored alongside the original in the tablet folder:

```
SI.41/
  SI.41_01.tif              ← original
  SI.41_01_mask.png         ← manual SAM mask (only for corrected images)
  _cleaned/
    SI.41_01.tif            ← re-extracted using the manual mask
```

---

## Implementation Steps

### Phase 1: Canvas viewer with box drawing

1. Add a `<canvas>` overlay to the existing image viewer
2. Implement rectangle drawing (adapt from existing trim tool)
3. Implement click-point visualization (green = add, red = remove)
4. Add toolbar: Box, Add, Remove, Clear, Apply, Cancel

### Phase 2: Python segmentation backend

1. Set up `python/segmentation_server.py` with FastAPI
2. Integrate MobileSAM with `/encode` and `/predict` endpoints
3. Create `src/main/segmentation-bridge.js` for process management
4. Add IPC handlers and preload bridge

### Phase 3: Connect UI to backend

1. On rectangle drawn → call `/encode` then `/predict`
2. On click → call `/predict` with accumulated points
3. Render returned mask as overlay on canvas
4. On apply → call `/apply`, refresh thumbnail

### Phase 4: Polish

1. Undo/redo for click points
2. Mask opacity slider
3. Brush tool for manual mask painting (edge corrections)
4. Keyboard shortcuts (B = box, A = add, R = remove, Enter = apply, Esc = cancel)
5. Save/load mask for re-editing later

### Phase 5: Server option

1. Add server URL field in settings
2. Route API calls to remote server when configured
3. Fall back to local Python when server is unreachable

---

## Cost & Size Impact

| Component | Size | One-time? |
|-----------|------|-----------|
| MobileSAM checkpoint | ~40MB | Downloaded on first use |
| Python dependencies (FastAPI, numpy, etc.) | ~20MB | Installed once |
| Canvas UI code | ~500 lines JS | Part of app |
| Segmentation server | ~200 lines Python | Part of app |

**No API costs.** Everything runs locally. The remote server option is optional and self-hosted.

---

## Comparison: Current vs. Proposed

| Aspect | Current (U2NET in stitcher) | Proposed (SAM in renamer) |
|--------|---------------------------|--------------------------|
| User control | None — fully automatic | Full — box, add, remove |
| Correction path | None — re-photograph | Click to fix |
| Where it runs | Inside stitcher EXE | Renamer app (before stitching) |
| Model | U2NET (176MB) | MobileSAM (40MB) |
| Speed per image | ~5-15s (CPU) | ~1-3s encode + ~50ms per click |
| Works offline | Yes | Yes |
| macOS compatible | Yes | Yes |

---

## References

- [Segment Anything (SAM)](https://github.com/facebookresearch/segment-anything) — Meta AI, 2023
- [MobileSAM](https://github.com/ChaoningZhang/MobileSAM) — lightweight SAM variant
- [EfficientSAM](https://github.com/yformer/EfficientSAM) — smallest SAM variant
- [SAM 2](https://github.com/facebookresearch/sam2) — Meta AI, 2024 (video + image)
