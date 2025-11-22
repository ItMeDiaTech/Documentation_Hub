# Project Cleanup Guide

This document explains how to clean up temporary files and organize the project structure.

## Cleanup Script

### Location
`scripts/cleanup-project.bat`

### What It Does

The cleanup script performs the following tasks:

1. **Creates organized directory structure:**
   - `test/` - Main test directory
   - `test/scripts/` - Test scripts and utilities
   - `test/data/` - Test documents and fixtures

2. **Moves test files:**
   - `test-debug-toc.js` → `test/scripts/`
   - `run-toc-test.bat` → `test/scripts/`
   - `run-toc-test.ps1` → `test/scripts/`
   - `TOC_TEST_INSTRUCTIONS.md` → `test/scripts/`

3. **Deletes temporary .docx files:**
   - All `.docx` files in root directory (except template.docx)
   - Includes: Debug.docx, Debug_Fixed.docx, Test_Run_*.docx, etc.

4. **Removes temporary folders:**
   - `Debug/`
   - `Debug - Copy/`
   - `Debug_Fixed/`
   - `Test_Code - Copy (9) - Copy/`

5. **Cleans up temporary files:**
   - `temp_original.txt`
   - Word temporary files (`~$*.docx`)
   - Old executables (pyenv-win-installer.exe)

### How to Run

#### Option 1: Double-click
Simply double-click `scripts/cleanup-project.bat` in Windows Explorer

#### Option 2: Command Line
```cmd
cd C:\Users\DiaTech\Pictures\DiaTech\Programs\DocHub\development\Template_UI
scripts\cleanup-project.bat
```

#### Option 3: From npm
Add to package.json scripts:
```json
{
  "scripts": {
    "clean": "scripts\\cleanup-project.bat"
  }
}
```

Then run: `npm run clean`

### After Cleanup

Once cleanup is complete:

- Test scripts are in: `test/scripts/`
- To run TOC test: `node test/scripts/test-debug-toc.js`
- Update package.json test:toc script to point to new location

### .gitignore Coverage

The following patterns in `.gitignore` ensure these files stay ignored:

```gitignore
# Test and debug Word documents
*.docx
*.doc

# Test/debug unzipped DOCX folders
Debug/
Debug - Copy/
Debug_Fixed/

# Test scripts and instructions
test-debug-toc.js
run-toc-test.bat
run-toc-test.ps1

# Temporary files
temp_original.txt
~$*.docx

# Executable files
*.exe
```

### Manual Cleanup

If you prefer manual cleanup instead of running the script:

1. **Create directories:**
   ```cmd
   mkdir test
   mkdir test\scripts
   mkdir test\data
   ```

2. **Move test files:**
   ```cmd
   move test-debug-toc.js test\scripts\
   move run-toc-test.bat test\scripts\
   move run-toc-test.ps1 test\scripts\
   ```

3. **Delete temporary files:**
   ```cmd
   del /F /Q *.docx
   del /F /Q temp_original.txt
   del /F /Q ~$*.docx
   ```

4. **Delete temporary folders:**
   ```cmd
   rmdir /S /Q Debug
   rmdir /S /Q "Debug - Copy"
   rmdir /S /Q Debug_Fixed
   ```

### Safety

The cleanup script:
- ✅ Only deletes files matched by .gitignore patterns
- ✅ Preserves all source code and configuration files
- ✅ Backs up by moving (not deleting) test scripts
- ✅ Shows confirmation of all actions
- ✅ Can be safely run multiple times

### Troubleshooting

**Files not deleting:**
- Close Microsoft Word or any program with .docx files open
- Run Command Prompt as Administrator
- Check file permissions

**Script won't run:**
- Right-click → "Run as administrator"
- Check Windows execution policy for batch files
- Verify you're in the correct directory

## Maintenance

Run this cleanup script:
- After finishing a development session
- Before committing to git
- When switching between branches
- When disk space is low
