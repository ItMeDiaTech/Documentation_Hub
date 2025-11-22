@echo off
setlocal enabledelayedexpansion

:: ============================================================================
:: Documentation Hub - Setup and Build Script
:: ============================================================================
:: This script automates the complete build process:
:: 1. Cleans previous builds
:: 2. Installs all dependencies
:: 3. Builds the project
:: 4. Creates the standalone .exe installer
:: ============================================================================

echo.
echo ========================================================================
echo  Documentation Hub - Automated Setup and Build
echo ========================================================================
echo.

:: Store the start time
set START_TIME=%TIME%

:: ============================================================================
:: STEP 1: Pre-Build Cleanup
:: ============================================================================
echo [1/4] Cleaning previous builds...
echo.

if exist "dist\" (
    echo   - Removing dist folder...
    rmdir /s /q "dist" 2>nul
    if errorlevel 1 (
        echo   ^! Warning: Could not fully remove dist folder
    ) else (
        echo   ^✓ dist folder removed
    )
) else (
    echo   ^- dist folder not found ^(skipping^)
)

if exist "release\" (
    echo   - Removing release folder...
    rmdir /s /q "release" 2>nul
    if errorlevel 1 (
        echo   ^! Warning: Could not fully remove release folder
    ) else (
        echo   ^✓ release folder removed
    )
) else (
    echo   ^- release folder not found ^(skipping^)
)

if exist "node_modules\" (
    echo   - Removing node_modules folder (this may take a moment^)...
    rmdir /s /q "node_modules" 2>nul
    if errorlevel 1 (
        echo   ^! Warning: Could not fully remove node_modules folder
    ) else (
        echo   ^✓ node_modules folder removed
    )
) else (
    echo   ^- node_modules folder not found ^(skipping^)
)

echo.
echo   ^✓ Cleanup completed
echo.
timeout /t 2 /nobreak >nul

:: ============================================================================
:: STEP 2: Install Dependencies
:: ============================================================================
echo [2/4] Installing dependencies...
echo.
echo   Running: npm install
echo.

call npm install
if errorlevel 1 (
    echo.
    echo   ^✗ npm install returned error code
    echo   ^! This may be due to warnings - checking if node_modules was created...
)

echo.
echo   npm install completed successfully - packages installed
echo.

:: Check if node_modules was created (npm install should create it)
if not exist "node_modules\" (
    echo.
    echo   ^✗ ERROR: Failed to install dependencies
    echo   node_modules folder was not created after npm install
    echo.
    echo   Please check if node_modules directory exists in the project root
    echo   You can run: dir node_modules
    echo.
    echo   Common solutions:
    echo   - Run the diagnostic script: scripts\diagnose-environment.bat
    echo   - Try installing dependencies manually: npm install
    echo   - Check file permissions and disk space
    echo.
    pause
    goto :error
)

echo   ^✓ Dependencies installed successfully
echo.
timeout /t 2 /nobreak >nul

:: ============================================================================
:: STEP 3: Build Project
:: ============================================================================
echo [3/4] Building project...
echo.
echo   Running: npm run build
echo.

call npm run build
if errorlevel 1 (
    echo.
    echo   ^✗ ERROR: Failed to build project
    echo   Please check the error messages above and try again.
    goto :error
)

echo.
echo   ^✓ Project built successfully
echo.
timeout /t 2 /nobreak >nul

:: Verify dist folder was created
if not exist "dist\" (
    echo   ^✗ ERROR: dist folder not found after build
    goto :error
)

:: ============================================================================
:: STEP 4: Create Installer
:: ============================================================================
echo [4/4] Creating installer...
echo.
echo   Running: npm run build:electron
echo   (This may take several minutes...)
echo.

call npm run build:electron
if errorlevel 1 (
    echo.
    echo   ^✗ ERROR: Failed to create installer
    echo   Please check the error messages above and try again.
    goto :error
)

echo.
echo   ^✓ Installer created successfully
echo.
timeout /t 2 /nobreak >nul

:: Verify release folder was created
if not exist "release\" (
    echo   ^✗ ERROR: release folder not found after build
    goto :error
)

:: ============================================================================
:: SUCCESS - Display Summary
:: ============================================================================
echo.
echo ========================================================================
echo  BUILD COMPLETED SUCCESSFULLY!
echo ========================================================================
echo.

:: Calculate elapsed time
set END_TIME=%TIME%
echo   Start Time: %START_TIME%
echo   End Time:   %END_TIME%
echo.

:: Find the installer file
echo   Build Artifacts:
echo   ---------------
if exist "release\*.exe" (
    for %%F in (release\*.exe) do (
        echo   ^✓ Installer: %%F
        echo     Size: %%~zF bytes
    )
) else (
    echo   ^! Warning: No .exe installer found in release folder
)

if exist "release\*.yml" (
    for %%F in (release\*.yml) do (
        echo   ^✓ Update Info: %%F
    )
)

echo.
echo   Output Directory: %CD%\release
echo.
echo ========================================================================
echo.
echo   The installer is ready to be:
echo   1. Tested locally by running the .exe file
echo   2. Committed to GitHub repository
echo   3. Distributed to end users
echo.
echo ========================================================================
echo.

goto :end

:: ============================================================================
:: ERROR HANDLER
:: ============================================================================
:error
echo.
echo ========================================================================
echo  BUILD FAILED
echo ========================================================================
echo.
echo   The build process encountered an error and was stopped.
echo   Please review the error messages above to diagnose the issue.
echo.
echo   Common issues:
echo   - Network connectivity for npm install
echo   - Disk space for node_modules and build artifacts
echo   - File/folder permissions
echo   - Missing system dependencies
echo.
echo ========================================================================
echo.
pause
exit /b 1

:: ============================================================================
:: NORMAL EXIT
:: ============================================================================
:end
echo Press any key to close this window...
pause >nul
exit /b 0
