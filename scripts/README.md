# Scripts Directory

This directory contains automation scripts for building and maintaining the Documentation Hub application.

## Available Scripts

### `setup-and-build.bat` - Complete Build Automation

### `diagnose-environment.bat` - Environment Diagnostic

**Purpose:** Diagnoses common issues that prevent the build process from working.

**What it checks:**

1. Node.js and npm installation
2. Internet connectivity to npm registry
3. Available disk space
4. File permissions
5. node_modules folder corruption
6. npm functionality

**Usage:**

```cmd
# From project root directory:
scripts\diagnose-environment.bat

# Or double-click the file in Windows Explorer
```

**When to use:**

- If `setup-and-build.bat` fails during npm install
- Before running the build script on a new machine
- When troubleshooting build issues

**Output:** Detailed diagnostic report with specific solutions for each issue found.

**Purpose:** Automates the entire build process from clean slate to distributable installer.

**What it does:**

1. **Cleans previous builds** - Removes `dist/`, `release/`, and `node_modules/` folders
2. **Installs dependencies** - Runs `npm install` to install all packages from package.json
3. **Builds the project** - Compiles TypeScript and bundles with Vite (`npm run build`)
4. **Creates installer** - Generates standalone .exe installer using electron-builder (`npm run build:electron`)

**Usage:**

```cmd
# From project root directory:
scripts\setup-and-build.bat

# Or double-click the file in Windows Explorer
```

**Output:**

- Installer: `release/Documentation-Hub-Setup-{version}.exe`
- Update metadata: `release/latest.yml`

**Build Configuration:**
The installer is configured in `package.json` under the `build` section:

- **Product Name:** Documentation Hub
- **App ID:** com.documentationhub.app
- **Installer Type:** NSIS (Windows)
- **Installation:** Per-user (not per-machine)
- **GitHub Publishing:** Configured for releases

**Debug Configuration:**
Debug configurations are pre-configured in `.vscode/launch.json` including:

- 🚀 Debug via npm dev
- 🔧 Debug Development (Full Stack)
- 🧪 Debug Jest Tests
- 🌐 Debug Renderer Process (React)
- And many more...

**Requirements:**

- Node.js installed
- npm available in PATH
- Internet connection for dependency download
- Sufficient disk space (~500MB for node_modules + build artifacts)

**Expected Runtime:**

- Clean install: 5-15 minutes (depending on internet speed)
- Incremental build: 2-5 minutes (if node_modules exists)

**Exit Codes:**

- `0` - Success
- `1` - Error occurred (check console output for details)

**Troubleshooting:**

If the build fails:

1. Check internet connectivity (for npm install)
2. Verify Node.js and npm are installed: `node --version` and `npm --version`
3. Ensure you have write permissions in the project directory
4. Check available disk space
5. Try running individual steps manually:
   ```cmd
   npm install
   npm run build
   npm run build:electron
   ```

**Common Warnings (Normal):**

During `npm install`, you may see these warnings which are safe to ignore:

- `npm warn cleanup Failed to remove some directories` - Permission issues with nested folders
- `> documentation-hub@2.1.0 prepare` - Husky git hooks being installed

These warnings don't affect the build process and can be safely ignored.

## Document Diagnostic Scripts

### `docx_diagnostic.py` - DOCX File Diagnostic Tool

**Purpose:** Analyzes Word documents (.docx) for potential processing issues without requiring the full application. Detects common problems that cause document processing errors.

**What it checks:**

1. **ZIP Structure** - Verifies DOCX is a valid ZIP archive with required files
2. **Invalid XML Characters** - Scans for control characters (0x00-0x1F) that break XML parsing
3. **Tracked Changes** - Counts revisions (w:ins, w:del) and detects nested revisions
4. **Smart Tags** - Finds deprecated smart tag elements
5. **Content Controls** - Detects SDT elements and locked controls
6. **Field Codes** - Identifies TOC, cross-references, mail merge fields
7. **Embedded Objects** - Checks for OLE objects that may cause issues
8. **Equations** - Finds OMML equations that may not process correctly
9. **Relationships** - Validates internal references and detects broken links
10. **Custom Namespaces** - Detects third-party extensions

**Requirements:**

- Python 3.6 or higher
- No external dependencies (uses only standard library)

**Usage:**

```bash
# Basic usage - analyze a single file
python scripts/docx_diagnostic.py document.docx

# Verbose mode - show detailed context for issues
python scripts/docx_diagnostic.py document.docx --verbose

# JSON output - for programmatic use
python scripts/docx_diagnostic.py document.docx --json

# Analyze multiple files
python scripts/docx_diagnostic.py *.docx

# Save JSON report to file
python scripts/docx_diagnostic.py document.docx --json > report.json

# Disable colored output
python scripts/docx_diagnostic.py document.docx --no-color
```

**Output:**

- Color-coded console output with severity levels (ERROR, WARNING, INFO)
- Detailed location and context for each issue found
- Suggestions for how to fix each issue
- Summary statistics (tracked changes count, hyperlinks, embedded objects, etc.)

**Exit Codes:**

- `0` - All files passed (no errors found)
- `1` - One or more files had errors
- `2` - Invalid arguments or file not found

**When to use:**

- Before processing a document that shows "Error" status
- To diagnose why a document fails to process
- To check documents from external sources before importing
- To verify document integrity after manual edits

**Example Output:**

```
Analyzing: problematic_document.docx

==============================================================
DOCX Diagnostic Report
File: problematic_document.docx
Size: 2.45 MB
==============================================================

[Invalid Characters]
[ERROR] Invalid Characters: Found 3 invalid XML character(s) in word/document.xml
  Location: Characters found: 0x03: 2x, 0x1f: 1x
  Suggestion: Remove control characters. These often come from copy/paste operations.

[Tracked Changes]
[WARNING] Tracked Changes: Document contains 47 tracked change(s)
  Location: Insertions: 23, Deletions: 20, Paragraph changes: 4, Run changes: 0
  Suggestion: Accept or reject all tracked changes before processing to avoid issues.

==============================================================
Status: FAIL
Errors: 1
Warnings: 1
Info: 3

Statistics:
  Tracked Changes: 47
  Hyperlinks: 15
  Media Files: 8
==============================================================
```

### Internal Diagnostic Scripts

Located in `scripts/diagnostics/` (gitignored - development only):

- `analyze-test6.js` - Test file analysis
- `diagnose-before-tables.ts` - Table diagnostics
- `diagnose-styles.ts` - Style diagnostics
- `diagnose-tables.ts` - Table structure diagnostics

## Adding New Scripts

When adding new automation scripts:

1. Use `.bat` for Windows batch scripts
2. Use `.sh` for Unix/Linux shell scripts
3. Add proper error handling
4. Include progress indicators
5. Document in this README
6. Test on clean environment before committing

## Notes

- The setup-and-build script performs a **clean build** (removes node_modules)
- For faster incremental builds, use `npm run build` and `npm run build:electron` directly
- The built installer will be ready for GitHub releases or local distribution
- Debug configurations are already set up in VS Code - no additional setup needed
