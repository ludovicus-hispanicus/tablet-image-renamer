# AI-Assisted Photo Selection — Future Implementation Plan

## Problem

A typical cuneiform tablet photography session produces 20–60 photos per tablet: multiple angles, varying lighting, with and without rulers/labels, handheld and tripod shots. From these, a scholar needs to select the **best 6 images** (obverse, reverse, top, bottom, left, right) plus optional intermediate views. Doing this manually across hundreds of tablets is the main bottleneck in the picker workflow.

## Goal

Add an **AI Suggest** feature to the picker mode that automatically identifies the best photo for each standard view, pre-fills the picks, and optionally auto-exports — reducing manual selection from minutes per tablet to a quick review.

---

## Architecture: Two-Stage Pipeline

### Stage A — Local Pre-Filter (No AI tokens, runs on user's machine)

Before sending images to any AI model, reduce the candidate set using deterministic computer vision. This saves API costs and improves AI accuracy by removing obvious rejects.

#### A1. Sharpness Scoring (Laplacian Variance)

Use `sharp` (already a dependency) to compute sharpness:

```js
// Concept: convert to grayscale, apply Laplacian-like filter, measure variance
const grey = await sharp(imagePath).greyscale().raw().toBuffer({ resolveWithObject: true });
// High variance = sharp image, low variance = blurry
```

- Score every image in the folder
- Auto-discard images below a configurable threshold (e.g., bottom 20%)
- Show a sharpness indicator on thumbnails so the user can see why images were skipped

#### A2. Near-Duplicate Detection (Perceptual Hashing)

When the photographer takes 5 shots of the same face with minor adjustments, we only need the best one:

- Resize each image to 8x8 grayscale, compute a 64-bit hash
- Compare Hamming distance between all pairs
- Within each cluster of near-duplicates, keep only the sharpest
- This can reduce 58 images to ~15–20 distinct candidates

#### A3. Orientation Grouping (Aspect Ratio + Histogram)

- **Flat face-on shots** (obverse/reverse) tend to have similar aspect ratios and a dominant dark background
- **Edge shots** (top/bottom/left/right) are narrower, often with the tablet propped on foam
- **Handheld shots** have skin-tone pixels in the histogram
- Group images by these features to pre-cluster before AI analysis

### Stage B — AI Model Selection (API call)

Send the filtered, de-duplicated candidates to a vision model.

#### Supported Providers

| Provider | Model | Strength | Cost |
|----------|-------|----------|------|
| **Google Gemini** | gemini-2.5-flash / gemini-2.5-pro | Large context window (1M+ tokens), can process an entire folder in one call. Cheapest for high volume. | ~$0.01–0.05 per tablet |
| **Anthropic Claude** | claude-sonnet-4-20250514 | Strong reasoning about subtle details (edge vs. face, wedge direction). Accurate for final selection. | ~$0.03–0.10 per tablet |
| **OpenAI GPT-4o** | gpt-4o | Reliable structured JSON output. Batch API offers 50% discount for overnight processing. | ~$0.02–0.08 per tablet |

#### The Prompt

The AI receives thumbnails (512px) of the filtered candidates along with instructions to:

1. **Classify each image** by which face/edge of the tablet it shows
2. **Score quality** within each group based on:
   - Face-on angle (straight-on, not oblique)
   - Sharpness and focus
   - Even, diffuse lighting — specifically **raking light** that makes cuneiform wedges most readable
   - Framing (centered, fully visible)
   - Minimal obstruction (no hands/labels/rulers covering the surface)
3. **Select the single best image** per view code
4. **Return structured JSON**: `{"assignments": {"filename.jpg": "01", ...}, "reasoning": "..."}`

#### Cuneiform-Specific Criteria

The prompt should emphasize:
- **Raking light**: side-lighting that creates shadows in the wedge impressions, making signs readable. This is more important than overall brightness.
- **Wedge direction**: the AI can distinguish obverse from reverse by the direction of writing and the curvature of the tablet.
- **Edge identification**: left vs. right edge can be determined by which main face's writing is partially visible on the edge.
- **Seal impressions**: if present, these should be captured with appropriate lighting.

---

## UI Design

### Picker Panel Additions

```
[Claude ▼]  ← dropdown to select AI provider
[AI Suggest] ← purple gradient button
[Export Selected] ← existing button

AI: Picked 6 views for "Si 47". Obverse: sharpest face-on shot...
```

### Settings Dialog

- Claude API Key: `sk-ant-...` (password field with show/hide)
- Gemini API Key: `AIza...` (password field with show/hide)
- OpenAI API Key: `sk-...` (password field with show/hide)
- Pre-filter threshold: slider (0 = keep all, 100 = aggressive filtering)

### Tree View Highlighting

After AI suggestion + export, the folder gets:
- A **purple left border** and subtle background tint
- A small **"AI"** badge (purple pill) floated right
- CSS class `.ai-suggested` for distinct visual identity

### Progress Feedback

During analysis:
1. "Preparing thumbnails..." (0–20%)
2. "Filtering duplicates..." (20–35%)
3. "Scoring sharpness..." (35–50%)
4. "Sending N candidates to Claude..." (50–60%)
5. "AI analyzing..." (60–90%)
6. "Applying suggestions..." (90–100%)

---

## Implementation Steps

### Phase 1: Local Pre-Filter (no external dependencies)

1. Add sharpness scoring using `sharp` (Laplacian variance approximation)
2. Add perceptual hashing for near-duplicate detection
3. Show sharpness scores on thumbnails in the grid
4. Add a "Filter" button that removes blurry/duplicate images from view

### Phase 2: AI Integration

1. Install AI SDKs: `@anthropic-ai/sdk`, `@google/generative-ai`, `openai`
2. Create `src/main/ai-suggest.js` module with:
   - `makeAiThumb(imagePath)` — generate 512px JPEG thumbnail
   - `buildPrompt(tabletName)` — shared prompt with cuneiform-specific criteria
   - `callClaude(apiKey, thumbs, tabletName)` — Anthropic API call
   - `callGemini(apiKey, thumbs, tabletName)` — Google API call
   - `callOpenAI(apiKey, thumbs, tabletName)` — OpenAI API call
   - `aiSuggestViews(apiKey, imagePaths, tabletName, provider, onProgress)` — orchestrator
3. Add IPC handler in `main.js`
4. Add preload bridge in `preload.js`
5. Add UI elements (button, provider selector, API key settings, progress bar)
6. Wire up in `app.js`: button handler, auto-apply assignments, auto-export, tree badge

### Phase 3: Batch Processing

1. "AI Suggest All" button that processes every folder sequentially
2. Progress overlay showing current folder, estimated time, cost estimate
3. Resume capability (skip folders already AI-suggested)
4. Export a summary CSV: tablet name, assigned views, AI confidence, provider used

### Phase 4: Learning / Feedback Loop

1. When the user overrides an AI suggestion, log the correction
2. Over time, build a set of "gold standard" examples per tablet type
3. Use these as few-shot examples in the prompt to improve accuracy
4. Optionally fine-tune a lightweight local classifier for Stage A grouping

---

## Cost Estimates

For a collection of 1,000 tablets averaging 30 photos each:

| Stage | What happens | Images processed | Cost |
|-------|-------------|-----------------|------|
| Stage A (local) | Sharpness + dedup filter | 30,000 → ~12,000 | $0 |
| Stage B (AI) | Vision model classification | ~12,000 thumbnails across 1,000 calls | $10–50 |

Total estimated cost: **$10–50** for 1,000 tablets, depending on provider and model.

---

## Technical Notes

- **Thumbnail size**: 512px max dimension at JPEG quality 70. This balances AI accuracy with token cost (~30KB per image).
- **Batch size**: Process 8 thumbnails in parallel to avoid memory spikes with sharp.
- **Rate limits**: Gemini allows 15 RPM on free tier, Claude 50 RPM on paid. Add retry logic with exponential backoff.
- **Caching**: Store AI results in `ai-picks.json` per subfolder so re-running doesn't re-call the API.
- **Offline fallback**: Stage A (local filter) works without internet. Stage B requires API access.

---

## Prototype Reference

A working prototype was built and tested during development (April 2026) using Claude Sonnet and Gemini 2.5 Flash. Both providers successfully identified obverse, reverse, and edge views from the Si 47 test set (58 images). The prototype was removed to implement the proper two-stage pipeline described above. Key learnings:

- Both Claude and Gemini correctly identified the 6 main views from 58 unstructured photos
- Images with labels/paper notes were correctly deprioritized
- Handheld photos were accepted when they were the sharpest available for that view
- The shared prompt format (JSON output) worked reliably with both providers
- Total API time was ~10–15 seconds per tablet folder
