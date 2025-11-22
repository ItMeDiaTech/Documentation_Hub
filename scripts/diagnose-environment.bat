@echo off
:: ============================================================================
:: Environment Diagnostic Script for Documentation Hub Build
:: ============================================================================
:: This script helps diagnose common issues that prevent npm install from working
:: ============================================================================

echo.
echo ========================================================================
echo  Documentation Hub - Environment Diagnostic
echo ========================================================================
echo.

echo [1/6] Checking Node.js and npm installation...
echo.

node --version >nul 2>&1
if errorlevel 1 (
    echo   ^✗ Node.js is not installed or not in PATH
    echo   Please install Node.js from https://nodejs.org/
    goto :error
) else (
    for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
    echo   ^✓ Node.js version: %NODE_VERSION%
)

npm --version >nul 2>&1
if errorlevel 1 (
    echo   ^✗ npm is not installed or not in PATH
    echo   Please reinstall Node.js (npm comes with it)
    goto :error
) else (
    for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
    echo   ^✓ npm version: %NPM_VERSION%
)

echo.
echo [2/6] Checking internet connectivity...
echo.

ping -n 1 registry.npmjs.org >nul 2>&1
if errorlevel 1 (
    echo   ^✗ Cannot reach npm registry (registry.npmjs.org)
    echo   Please check your internet connection
    goto :error
) else (
    echo   ^✓ npm registry is reachable
)

echo.
echo [3/6] Checking disk space...
echo.

for /f "tokens=3" %%i in ('dir /-c "%CD%" ^| find "bytes free"') do set FREE_SPACE=%%i
echo   Available disk space: %FREE_SPACE% bytes

:: Convert to MB (rough estimate)
set /a FREE_SPACE_MB=%FREE_SPACE:~0,-6%
if %FREE_SPACE_MB% LSS 1000 (
    echo   ^! Warning: Low disk space (^<1GB free^)
    echo   npm install may require 500MB+ of free space
) else (
    echo   ^✓ Sufficient disk space available
)

echo.
echo [4/6] Checking file permissions...
echo.

:: Test if we can create a temporary file
echo test > temp_permission_test.txt 2>nul
if exist temp_permission_test.txt (
    echo   ^✓ Write permissions OK
    del temp_permission_test.txt >nul 2>&1
) else (
    echo   ^✗ No write permissions in current directory
    echo   Please run as administrator or change directory
    goto :error
)

echo.
echo [5/6] Checking for corrupted node_modules...
echo.

if exist "node_modules\" (
    echo   ! node_modules folder exists - checking for corruption
    dir /b "node_modules\" >nul 2>&1
    if errorlevel 1 (
        echo   ^✗ node_modules folder exists but is inaccessible
        echo   Try running as administrator to remove it
        goto :error
    ) else (
        echo   ^✓ node_modules folder is accessible
    )
) else (
    echo   ^- node_modules folder not found ^(clean state^)
)

echo.
echo [6/6] Testing npm functionality...
echo.

echo   Testing npm cache verification...
call npm cache verify
if errorlevel 1 (
    echo   ^✗ npm cache verification failed
    echo   Try running: npm cache clean --force
    goto :error
) else (
    echo   ^✓ npm cache is OK
)

echo.
echo   Testing simple npm command...
call npm list --depth=0 --no-package-lock >nul 2>&1
if errorlevel 1 (
    echo   ^✗ npm basic command failed
    echo   There may be an issue with npm configuration
    goto :error
) else (
    echo   ^✓ npm basic commands work
)

echo.
echo ========================================================================
echo  DIAGNOSTIC COMPLETED
echo ========================================================================
echo.
echo   If all checks passed but npm install still fails, try:
echo.
echo   1. Clear npm cache: npm cache clean --force
echo   2. Remove node_modules manually if it exists
echo   3. Check for antivirus blocking npm
echo   4. Try running as administrator
echo   5. Check corporate firewall/proxy settings
echo.
echo   Common solutions:
echo   - npm config set registry https://registry.npmjs.org/
echo   - npm install --verbose ^(to see detailed error messages^)
echo   - npm install --no-optional ^(to skip optional packages^)
echo.
goto :end

:error
echo.
echo ========================================================================
echo  DIAGNOSTIC FAILED
echo ========================================================================
echo.
echo   Please resolve the issues above and run the build script again.
echo.
pause
exit /b 1

:end
pause
exit /b 0
