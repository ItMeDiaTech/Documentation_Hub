@echo off
REM ===================================================================
REM Project Cleanup Script
REM Removes temporary files, test documents, and organizes test files
REM ===================================================================

echo.
echo ===================================================================
echo  Documentation Hub - Project Cleanup Script
echo ===================================================================
echo.

REM Create test directory structure
echo Creating test directory structure...
if not exist "test" mkdir test
if not exist "test\scripts" mkdir test\scripts
if not exist "test\data" mkdir test\data
echo   Created: test\
echo   Created: test\scripts\
echo   Created: test\data\
echo.

REM Move test scripts
echo Moving test scripts to test\scripts\...
if exist "test-debug-toc.js" (
    move /Y "test-debug-toc.js" "test\scripts\test-debug-toc.js" >nul
    echo   Moved: test-debug-toc.js -^> test\scripts\
)
if exist "run-toc-test.bat" (
    move /Y "run-toc-test.bat" "test\scripts\run-toc-test.bat" >nul
    echo   Moved: run-toc-test.bat -^> test\scripts\
)
if exist "run-toc-test.ps1" (
    move /Y "run-toc-test.ps1" "test\scripts\run-toc-test.ps1" >nul
    echo   Moved: run-toc-test.ps1 -^> test\scripts\
)
if exist "TOC_TEST_INSTRUCTIONS.md" (
    move /Y "TOC_TEST_INSTRUCTIONS.md" "test\scripts\TOC_TEST_INSTRUCTIONS.md" >nul
    echo   Moved: TOC_TEST_INSTRUCTIONS.md -^> test\scripts\
)
echo.

REM Delete temporary .docx files
echo Deleting temporary .docx files...
set DOCX_COUNT=0
for %%F in (*.docx) do (
    if not "%%F"=="template.docx" (
        del /F /Q "%%F" 2>nul
        set /A DOCX_COUNT+=1
        echo   Deleted: %%F
    )
)
if %DOCX_COUNT%==0 echo   No temporary .docx files found
echo.

REM Delete temporary folders
echo Deleting temporary debug folders...
set FOLDER_COUNT=0
for %%D in (Debug "Debug - Copy" Debug_Fixed "Test_Code - Copy (9) - Copy") do (
    if exist "%%~D" (
        rmdir /S /Q "%%~D" 2>nul
        set /A FOLDER_COUNT+=1
        echo   Deleted: %%~D\
    )
)
if %FOLDER_COUNT%==0 echo   No temporary folders found
echo.

REM Delete temporary files
echo Deleting temporary files...
set TEMP_COUNT=0
if exist "temp_original.txt" (
    del /F /Q "temp_original.txt" 2>nul
    set /A TEMP_COUNT+=1
    echo   Deleted: temp_original.txt
)
if exist "~$*.docx" (
    del /F /Q "~$*.docx" 2>nul
    set /A TEMP_COUNT+=1
    echo   Deleted: Word temp files (~$*.docx)
)
if %TEMP_COUNT%==0 echo   No temporary files found
echo.

REM Delete old executable
echo Checking for old executables...
if exist "pyenv-win-installer.exe" (
    del /F /Q "pyenv-win-installer.exe" 2>nul
    echo   Deleted: pyenv-win-installer.exe
) else (
    echo   No old executables found
)
echo.

echo ===================================================================
echo  Cleanup Complete!
echo ===================================================================
echo.
echo Test files moved to: test\scripts\
echo Temporary files removed
echo.
echo To run TOC test, use: node test\scripts\test-debug-toc.js
echo.

pause
