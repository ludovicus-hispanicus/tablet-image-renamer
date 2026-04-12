# Tablet Image Processor - Architecture & Roadmap

## Vision

A unified desktop application for processing cuneiform tablet photographs: renaming, stitching, editing, and measuring. Built incrementally on Electron with Python backends for heavy image processing.

## Architecture

```
tablet-processor/                   (Electron app)
src/
  main/                             (Node.js main process)
    main.js                         Entry point, window management
    file-ops.js                     File system operations
    python-bridge.js                Spawns Python scripts for heavy tasks
    preload.js                      Secure IPC bridge to renderer

  renderer/                         (UI - HTML/CSS/JS)
    modules/
      renamer/                      Image renaming & organization
      stitcher/                     Stitching layout preview & control
      editor/                       Canvas-based image editor
        canvas.js                   Fabric.js/Konva.js integration
        tools/                      Crop, rotate, brush, measure, etc.
        layers.js                   Layer management
      measurements/                 Ruler detection & measurement UI
      batch/                        Batch processing dashboard
    app.js                          Module router / navigation

python/                             (Heavy processing backend)
  convert.py                        CR3/HEIC conversion (rawpy, pillow-heif)
  extract_object.py                 Background removal (rembg)
  stitch.py                         Image stitching (OpenCV)
  detect_ruler.py                   Ruler detection & scale calculation
  measure.py                        Tablet measurements
```

### Design Principles

- **Electron handles the UI.** HTML/CSS/JS for layout, interaction, and visualization.
- **Python handles the heavy lifting.** rembg, OpenCV, rawpy, stitching algorithms stay in Python. Electron calls them via child processes or a local HTTP API.
- **Sharp (Node.js native) handles fast image ops.** Thumbnails, rotation, format conversion, basic transforms. No need to call Python for simple operations.
- **Each module is independent.** The renamer doesn't depend on the stitcher. Users can use what they need.

## Technology Choices

### Why Electron?

| Consideration | Assessment |
|---------------|------------|
| Cross-platform | Single codebase for Windows, macOS, Linux |
| UI flexibility | Full web stack: CSS Grid, animations, drag-and-drop |
| Ecosystem | Massive library ecosystem (Fabric.js, Konva.js, Sharp) |
| Developer productivity | Fast iteration with hot reload |
| Memory overhead | ~100-300MB baseline, acceptable for a desktop tool |
| Precedent | VS Code, Figma desktop, Obsidian use the same approach |

### Alternatives Considered

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| Qt + Python (PySide6) | Good perf, stays in Python | Limited UI flexibility, dated look | Good but UI ceiling is lower |
| Qt + C++ | Best native performance | High learning curve, slow iteration | Overkill for this project |
| Rust + Tauri | Lightweight (~5MB), fast | Small ecosystem, steep learning curve | Future option if Electron hits limits |
| Java + JavaFX | Cross-platform, mature | JVM overhead, declining desktop ecosystem | Viable but less modern |
| Pure web app | No install needed | Can't access filesystem, no Python integration | Not suitable |

### Key Libraries

| Library | Purpose | Used in |
|---------|---------|---------|
| **Sharp** | Fast image resize, rotate, convert, thumbnails | Main process |
| **Fabric.js** | Canvas with layers, selection, transforms, filters | Editor module |
| **Konva.js** | Alternative to Fabric.js for canvas manipulation | Editor module (alternative) |
| **electron-reload** | Hot reload during development | Dev only |

### Python Dependencies (inherited from ebl-photo-stitcher)

| Library | Purpose |
|---------|---------|
| **rembg** | Background removal / object extraction |
| **rawpy** | CR3 raw file processing |
| **OpenCV** | Image processing, stitching, ruler detection |
| **Pillow** | Image format conversion, EXIF handling |
| **pillow-heif** | HEIC format support |
| **pandas + openpyxl** | Excel measurement I/O |

## Incremental Migration Roadmap

### Phase 1: Renamer (Current)

**Status: In progress**

- Thumbnail grid with keyboard shortcuts
- Clickable structure diagram for view assignment
- Image rotation (individual + batch)
- CR3/HEIC detection and conversion
- Raw file preservation in `_Raw/` archive
- Folder name normalization

### Phase 2: Image Editor (Basic)

Add a canvas-based editor for individual image adjustments:

- **Crop** - remove unwanted borders or background
- **Rotate** - fine rotation (not just 90 degree increments)
- **Brightness / Contrast** - adjust exposure
- **White balance** - correct color temperature
- **Levels / Curves** - histogram-based adjustments

Implementation: Fabric.js canvas with toolbar. Non-destructive editing (keep original, export modified version).

### Phase 3: Stitching Preview

Migrate the stitching layout from ebl-photo-stitcher:

- Visual preview of the tablet layout (spine + sides)
- Drag to reposition views
- Adjust gaps and margins
- Preview ruler placement
- Trigger Python stitching backend

### Phase 4: Measurement Tools

- Canvas overlay for ruler detection visualization
- Manual measurement drawing tools
- Excel import/export of tablet dimensions
- Scale calibration from ruler marks

### Phase 5: Batch Processing Dashboard

- Queue management for processing multiple tablets
- Progress visualization
- Error recovery and retry
- Processing statistics and reports

### Phase 6: Advanced Editor

If needed, extend the editor with:

- Clone stamp / healing brush (for damaged tablet areas)
- Layer compositing
- Mask editing for background removal corrections
- Color profile management
- GPU-accelerated filters via WebGL

## Performance Considerations

### When Electron is sufficient

- Thumbnail grids (Sharp generates them fast)
- Canvas editing of images up to ~6000x4000px (Fabric.js handles this)
- File management, renaming, organization
- UI interactions, drag-and-drop, keyboard shortcuts

### When to call Python

- Background removal (rembg / neural network inference)
- Raw file conversion (CR3 via rawpy)
- Stitching (OpenCV alignment and blending)
- Ruler detection (computer vision algorithms)

### When native modules might be needed (future)

- Real-time brush painting on 50+ megapixel images
- GPU-accelerated batch processing
- Real-time histogram computation on full-resolution images

Solution: Node.js C++ addons or Rust WASM modules. Cross that bridge when needed.

## File Conventions

### Image naming

```
{TabletID}_{ViewCode}.{ext}

View codes:
  01 = obverse       02 = reverse
  03 = top           04 = bottom
  05 = left          06 = right
  ot = obverse top   ob = obverse bottom
  ol = obverse left  or = obverse right
  rt = reverse top   rb = reverse bottom
  rl = reverse left  rr = reverse right
```

### Folder structure

```
Project Root/
  {TabletID}/           Working folder (JPEGs)
  _Raw/                 Preserved raw originals
    {TabletID}/
  _Final_JPG/           Stitched output (JPEG)
  _Final_TIFF/          Stitched output (TIFF)
```

### Folder naming

Normalized with dots: `Si.10` not `Si 10`. Spaces are replaced with dots between prefix and number.
