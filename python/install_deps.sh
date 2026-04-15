#!/bin/bash
echo "============================================"
echo " Installing SAM Segmentation Dependencies"
echo "============================================"
echo

if ! command -v python3 &> /dev/null; then
    echo "ERROR: python3 not found."
    echo "  macOS: brew install python3"
    echo "  Linux: sudo apt install python3 python3-pip"
    exit 1
fi

echo "Found Python:"
python3 --version
echo

echo "Installing packages (this may take a few minutes)..."
echo
pip3 install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip3 install fastapi "uvicorn[standard]" numpy Pillow
pip3 install git+https://github.com/ChaoningZhang/MobileSAM.git

echo
echo "============================================"
echo " Done! You can now use the Segment tool."
echo " The model weights will download automatically"
echo " on first use (~4 MB)."
echo "============================================"
