@echo off
echo ============================================
echo  Installing SAM Segmentation Dependencies
echo ============================================
echo.

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Python not found. Please install Python 3.10+ from:
    echo   https://www.python.org/downloads/
    echo.
    echo Make sure to check "Add Python to PATH" during installation.
    pause
    exit /b 1
)

echo Found Python:
python --version
echo.

echo Installing packages (this may take a few minutes)...
echo.
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install fastapi "uvicorn[standard]" numpy Pillow
pip install git+https://github.com/ChaoningZhang/MobileSAM.git

echo.
echo ============================================
echo  Done! You can now use the Segment tool.
echo  The model weights will download automatically
echo  on first use (~4 MB).
echo ============================================
pause
