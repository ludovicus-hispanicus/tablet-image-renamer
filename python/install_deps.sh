#!/bin/bash
echo "============================================"
echo " Installing SAM Segmentation Dependencies"
echo "============================================"
echo

PYTHON=""

# Check for compatible Python (3.10-3.12)
for cmd in python3.12 python3.11 python3.10 python3; do
    if command -v "$cmd" &> /dev/null; then
        VER=$("$cmd" --version 2>&1 | grep -oP '\d+\.\d+')
        MAJOR=$(echo "$VER" | cut -d. -f1)
        MINOR=$(echo "$VER" | cut -d. -f2)
        if [ "$MAJOR" = "3" ] && [ "$MINOR" -ge 10 ] && [ "$MINOR" -le 12 ]; then
            PYTHON="$cmd"
            break
        fi
    fi
done

if [ -z "$PYTHON" ]; then
    echo "ERROR: No compatible Python (3.10-3.12) found."
    echo "  PyTorch does not support Python 3.13+ yet."
    echo ""
    echo "  macOS: brew install python@3.12"
    echo "  Linux: sudo apt install python3.12 python3.12-venv"
    exit 1
fi

echo "Found compatible Python:"
$PYTHON --version
PIP="$PYTHON -m pip"
echo

echo "Installing packages (this may take a few minutes)..."
echo

echo "[1/3] Installing PyTorch (CPU version)..."
$PIP install torch torchvision --index-url https://download.pytorch.org/whl/cpu

echo
echo "[2/3] Installing FastAPI, Uvicorn, NumPy, Pillow, timm..."
$PIP install fastapi "uvicorn[standard]" numpy Pillow timm

echo
echo "[3/3] Installing MobileSAM..."
$PIP install https://github.com/ChaoningZhang/MobileSAM/archive/refs/heads/master.zip

echo
echo "============================================"
echo " Done! You can now use the Segment tool."
echo " The model weights will download automatically"
echo " on first use (~4 MB)."
echo "============================================"
