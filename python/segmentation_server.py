"""
MobileSAM segmentation server for tablet-image-renamer.
Communicates via stdin/stdout JSON lines (no HTTP, no network).
"""

import io
import sys
import json
import base64
import logging
import traceback

import numpy as np
from pathlib import Path
from PIL import Image, ImageOps

logging.basicConfig(level=logging.INFO, stream=sys.stderr)
logger = logging.getLogger(__name__)

predictor = None
current_image_path = None


def load_model(weights_dir=None):
    global predictor
    from mobile_sam import sam_model_registry, SamPredictor

    model_type = "vit_t"
    if weights_dir:
        checkpoint = str(Path(weights_dir) / "mobile_sam.pt")
    else:
        checkpoint = str(Path(__file__).parent / "weights" / "mobile_sam.pt")

    if not Path(checkpoint).exists():
        logger.error(f"Weights not found at {checkpoint}")
        return False

    import torch
    sam = sam_model_registry[model_type](checkpoint=checkpoint)
    sam.to(device="cpu")
    sam.eval()
    predictor = SamPredictor(sam)
    logger.info("MobileSAM loaded successfully")
    return True


def handle_encode(params):
    global current_image_path
    image_path = params["image_path"]
    image = Image.open(image_path).convert("RGB")
    image = ImageOps.exif_transpose(image)
    image_np = np.array(image)
    current_image_path = image_path
    predictor.set_image(image_np)
    logger.info(f"Encoded {image_path} ({image_np.shape[1]}x{image_np.shape[0]})")
    return {"status": "ready", "width": image_np.shape[1], "height": image_np.shape[0]}


def handle_predict(params):
    if predictor is None or current_image_path is None:
        return {"status": "error", "error": "No image encoded"}

    point_coords = []
    point_labels = []

    for pt in (params.get("positive_points") or []):
        point_coords.append(pt)
        point_labels.append(1)
    for pt in (params.get("negative_points") or []):
        point_coords.append(pt)
        point_labels.append(0)

    kwargs = {"multimask_output": True}
    if point_coords:
        kwargs["point_coords"] = np.array(point_coords, dtype=np.float32)
        kwargs["point_labels"] = np.array(point_labels, dtype=np.int32)
    if params.get("box"):
        kwargs["box"] = np.array(params["box"], dtype=np.float32)

    masks, scores, _ = predictor.predict(**kwargs)
    best_idx = int(np.argmax(scores))
    best_mask = masks[best_idx]

    mask_img = Image.fromarray((best_mask * 255).astype(np.uint8), mode="L")
    buf = io.BytesIO()
    mask_img.save(buf, format="PNG")
    mask_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    logger.info(f"Predicted mask (score: {scores[best_idx]:.3f})")
    return {"mask": mask_b64, "score": float(scores[best_idx])}


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights-dir", default=None)
    args = parser.parse_args()

    logger.info("Loading model...")
    if not load_model(args.weights_dir):
        # Signal failure
        sys.stdout.write(json.dumps({"ready": False, "error": "Model load failed"}) + "\n")
        sys.stdout.flush()
        return

    # Signal ready
    sys.stdout.write(json.dumps({"ready": True}) + "\n")
    sys.stdout.flush()

    # Read JSON commands from stdin, one per line
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            cmd = msg.get("cmd")
            params = msg.get("params", {})

            if cmd == "encode":
                result = handle_encode(params)
            elif cmd == "predict":
                result = handle_predict(params)
            elif cmd == "quit":
                break
            else:
                result = {"status": "error", "error": f"Unknown command: {cmd}"}

            sys.stdout.write(json.dumps(result) + "\n")
            sys.stdout.flush()
        except Exception as e:
            logger.error(traceback.format_exc())
            sys.stdout.write(json.dumps({"status": "error", "error": str(e)}) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
