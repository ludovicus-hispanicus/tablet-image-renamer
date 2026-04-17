@echo off
setlocal enabledelayedexpansion
echo ============================================
echo  Installing SAM Segmentation Dependencies
echo ============================================
echo.

:: Find a compatible Python (3.10-3.12). PyTorch does not support 3.13+.
set "PYTHON_EXE="

:: Check standard install locations first
for %%V in (312 311 310) do (
    set "CANDIDATE=%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe"
    if exist "!CANDIDATE!" (
        set "PYTHON_EXE=!CANDIDATE!"
        goto :found
    )
)

:: Check PATH
where python >nul 2>nul
if %errorlevel% equ 0 (
    for /f "tokens=2 delims= " %%A in ('python --version 2^>^&1') do set "PY_VER=%%A"
    for /f "tokens=1,2 delims=." %%A in ("!PY_VER!") do (
        set "PY_MAJOR=%%A"
        set "PY_MINOR=%%B"
    )
    if "!PY_MAJOR!"=="3" if !PY_MINOR! GEQ 10 if !PY_MINOR! LEQ 12 (
        set "PYTHON_EXE=python"
        goto :found
    )
    echo [!!] Python !PY_VER! found but NOT compatible (need 3.10-3.12^).
)

echo.
echo ERROR: No compatible Python (3.10-3.12) found.
echo Please install Python 3.12 from:
echo   https://www.python.org/downloads/release/python-3129/
echo Make sure to check "Add Python to PATH" during installation.
pause
exit /b 1

:found
echo Found compatible Python:
"%PYTHON_EXE%" --version
echo.

echo Installing packages (this may take a few minutes)...
echo.
echo [1/3] Installing PyTorch (CPU version)...
"%PYTHON_EXE%" -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu

echo.
echo [2/3] Installing FastAPI, Uvicorn, NumPy, Pillow, timm...
"%PYTHON_EXE%" -m pip install fastapi "uvicorn[standard]" numpy Pillow timm

echo.
echo [3/3] Installing MobileSAM...
"%PYTHON_EXE%" -m pip install https://github.com/ChaoningZhang/MobileSAM/archive/refs/heads/master.zip

echo.
echo ============================================
echo  Done! You can now use the Segment tool.
echo  The model weights will download automatically
echo  on first use (~4 MB).
echo ============================================
pause
