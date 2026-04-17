@echo off
setlocal enabledelayedexpansion
echo ============================================
echo  SAM Segmentation Tool - Complete Installer
echo ============================================
echo.

:: We need Python 3.10-3.12 (PyTorch does not support 3.13+ yet).
:: Strategy: check for a compatible Python already installed. If none found,
:: download and install Python 3.12 automatically.

set "PYTHON_EXE="

:: 1. Check the standard install location for 3.12, 3.11, 3.10
for %%V in (312 311 310) do (
    set "CANDIDATE=%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe"
    if exist "!CANDIDATE!" (
        echo [OK] Found compatible Python at: !CANDIDATE!
        set "PYTHON_EXE=!CANDIDATE!"
        goto :found_python
    )
)

:: 2. Check PATH for python and verify version is compatible
where python >nul 2>nul
if %errorlevel% equ 0 (
    for /f "tokens=2 delims= " %%A in ('python --version 2^>^&1') do set "PY_VER=%%A"
    for /f "tokens=1,2 delims=." %%A in ("!PY_VER!") do (
        set "PY_MAJOR=%%A"
        set "PY_MINOR=%%B"
    )
    if "!PY_MAJOR!"=="3" if !PY_MINOR! GEQ 10 if !PY_MINOR! LEQ 12 (
        echo [OK] Found compatible Python !PY_VER! in PATH
        set "PYTHON_EXE=python"
        goto :found_python
    )
    echo [!!] Python !PY_VER! found but NOT compatible (need 3.10-3.12^).
)

:: 3. No compatible Python found — install 3.12
echo.
echo [!!] No compatible Python (3.10-3.12) found. Installing Python 3.12...
echo.

set PYTHON_URL=https://www.python.org/ftp/python/3.12.9/python-3.12.9-amd64.exe
set INSTALLER=%TEMP%\python-3.12.9-installer.exe

echo Downloading Python 3.12 installer...
echo   (this may take a minute)
curl -L -o "%INSTALLER%" %PYTHON_URL% 2>nul
if not exist "%INSTALLER%" (
    echo Trying alternative download method...
    certutil -urlcache -split -f "%PYTHON_URL%" "%INSTALLER%" >nul 2>nul
)

if not exist "%INSTALLER%" (
    echo.
    echo ERROR: Could not download Python installer.
    echo Please install Python 3.12 manually from:
    echo   https://www.python.org/downloads/release/python-3129/
    echo Make sure to check "Add Python to PATH" during installation.
    pause
    exit /b 1
)

echo Installing Python 3.12 (this takes about a minute)...
echo   - Adding to PATH automatically
echo   - Installing pip
"%INSTALLER%" /quiet PrependPath=1 Include_pip=1 InstallAllUsers=0

:: Wait briefly for install to settle
timeout /t 3 /nobreak >nul

:: Set up the path to the freshly installed Python
set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"

if not exist "%PYTHON_EXE%" (
    echo.
    echo ERROR: Python 3.12 installed but not found at expected location.
    echo Please close this window, open a NEW terminal, and run this script again.
    pause
    exit /b 1
)

echo [OK] Python 3.12 installed successfully.
del "%INSTALLER%" 2>nul

:found_python
echo.
"%PYTHON_EXE%" --version
echo.
echo ============================================
echo  Installing SAM libraries (this takes ~5 min)
echo ============================================
echo.

echo [1/3] Installing PyTorch (CPU version)...
"%PYTHON_EXE%" -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
if %errorlevel% neq 0 (
    echo ERROR: PyTorch installation failed.
    pause
    exit /b 1
)

echo.
echo [2/3] Installing FastAPI, Uvicorn, NumPy, Pillow, timm...
"%PYTHON_EXE%" -m pip install fastapi "uvicorn[standard]" numpy Pillow timm
if %errorlevel% neq 0 (
    echo ERROR: Library installation failed.
    pause
    exit /b 1
)

echo.
echo [3/3] Installing MobileSAM...
"%PYTHON_EXE%" -m pip install https://github.com/ChaoningZhang/MobileSAM/archive/refs/heads/master.zip
if %errorlevel% neq 0 (
    echo ERROR: MobileSAM installation failed.
    pause
    exit /b 1
)

echo.
echo ============================================
echo  Done! Everything is installed.
echo.
echo  Open Tablet Image Renamer, switch to
echo  Renamer mode, open an image, and press S
echo  to use the Segment tool.
echo.
echo  The SAM model weights (~4 MB) will download
echo  automatically on first use.
echo ============================================
pause
exit /b 0
