# Documentation Hub - TypeScript/Electron Desktop Application

A modern, polished desktop application built with TypeScript/Electron featuring a comprehensive document processing and session management system. This is a LOCAL application with no web deployment.

Every subfolder should have a detailed CLAUDE.md describing what each file does.

Every big change, CLAUDE.md files should be updated as needed and project should be added and committed with git.

The docx / xml structure is well defined within the file located at the root directory of this project called "docxmlater-functions-and-structure.md".

## Recent Updates

**Read ./GH_Issues for more details.**
**When a research is found, push issues in the format found in ./GH_Issues/fix-github-issues.md and ./GH_Issues/CLAUDE.md**
**Check on issues periodically to update your status and to alert me when they are all done after 1 or more issues h as been pushed to issues in github**
**Store Research in ./GH_Issues/scratchpads/**

### Hyperlink Formatting Standardization (November 2025)

**NEW: Remove Bold/Italic from Hyperlinks**

Implemented automatic standardization of hyperlink formatting to ensure all hyperlinks maintain consistent, professional styling throughout documents.

**Problem Solved:**

- Hyperlinks were sometimes bolded or italicized, making them appear inconsistent
- Users would manually apply formatting to hyperlinks, violating standard hyperlink conventions
- Hyperlinks could inherit formatting from surrounding text

**Implementation:**

- **Always Enabled**: This feature is ALWAYS active and cannot be disabled via UI
- **Reason**: Required for work environment to maintain professional document standards
- **Method**: `standardizeHyperlinkFormatting()` in `WordDocumentProcessor.ts:1680-1716`
- **Technology**: Uses docxmlater v1.15.0+ `resetToStandardFormatting()` method
- **Integration**: Automatic processing during document workflow

**Technical Details:**

- Resets all hyperlinks to standard formatting:
  - Font: Calibri 11pt
  - Color: Blue (#0563C1)
  - Underline: Single
  - Bold: false (removed)
  - Italic: false (removed)
- Processes all hyperlinks in document using `extractHyperlinks()` API
- Error handling: Continues processing even if individual hyperlinks fail
- Logging: Detailed debug logging for each standardized hyperlink

**Files Modified:**

- `src/services/document/WordDocumentProcessor.ts` - Added standardizeHyperlinkFormatting() method and integration
- `src/contexts/SessionContext.tsx` - Set standardizeHyperlinkFormatting to always true (hardcoded)

**Benefits:**

- ✅ Consistent hyperlink appearance across all documents
- ✅ Follows industry-standard hyperlink conventions
- ✅ Prevents user errors from manual formatting
- ✅ Leverages battle-tested docxmlater API
- ✅ **Always enabled** - no user configuration needed
- ✅ Enforces professional document standards for work environment

**Usage:**

This feature is **permanently enabled** and runs automatically on all processed documents. There is no UI toggle - hyperlink formatting standardization is a core requirement for maintaining professional document standards in the work environment. All hyperlinks will always be reset to standard blue underlined style without bold or italic formatting.

### MCP RAG Configuration (November 2025)

**NEW: Semantic Code Search & RAG Capabilities**

Implemented comprehensive RAG (Retrieval-Augmented Generation) configuration using MCP (Model Context Protocol) servers to enhance AI assistant capabilities and reduce token usage.

**Features:**

- **Claude Context Integration**: Semantic code search with vector embeddings (~40% token reduction)
- **Local Processing**: All embeddings generated locally using Ollama (no external services)
- **Hybrid Search**: Combines BM25 + dense vector search for optimal results
- **Team Configuration**: `.mcp.json` committed to repo for consistent experience across developers

**Files Added:**

- `.mcp.json`: MCP server configuration (committed)
- `MCP_RAG_SETUP.md`: Complete setup and usage documentation
- `.mcp-cache/`: Vector database and cache directory (gitignored)

**Benefits:**

- Natural language code search: "Find all authentication logic"
- Semantic understanding: Understands meaning, not just keywords
- Reduced token usage: 40% less than traditional grep-based search
- Better context: AI understands code relationships and dependencies

**Setup Required:**

1. Install Ollama: https://ollama.ai
2. Pull embedding model: `ollama pull nomic-embed-text`
3. Run: `claude mcp install`

**Documentation:** See `MCP_RAG_SETUP.md` for complete setup guide and usage examples.

### Project Organization & Cleanup (November 2025)

**Repository Cleanup: Removed Build Artifacts and Organized Documentation**

Performed comprehensive cleanup of the root directory to improve repository hygiene and organization:

**Changes Made:**

1. **Removed Large Build Artifacts**:
   - Removed from git tracking: `Documentation-Hub-Setup-1.0.40.exe` (100MB)
   - Removed from git tracking: `__pycache__/` (Python bytecode cache)
   - Removed from git tracking: `npm-audit-report.json` (auto-generated report)
   - Deleted physical files from disk to free up space

2. **Organized Technical Documentation**:
   - Created `docs/fixes/` directory for technical fix documentation
   - Moved 8 technical fix documents from root to organized location:
     - `BULLET_CHARACTER_FIX.md` → `docs/fixes/`
     - `CORRUPTION_FIX.md` → `docs/fixes/`
     - `EXECUTION_LOG_TEST_BASE.md` → `docs/fixes/`
     - `FIX_SUMMARY_DATA_LOSS_BUG.md` → `docs/fixes/`
     - `HYPERLINK_TEXT_SANITIZATION.md` → `docs/fixes/`
     - `LIST_FORMATTING_FIX.md` → `docs/fixes/`
     - `SDT_PROTECTION_FIX.md` → `docs/fixes/`
     - `TABLE_PROTECTION_FIX.md` → `docs/fixes/`
   - Moved `DOCXMLATER_ANALYSIS_SUMMARY.txt` → `docs/analysis/`
   - Created comprehensive `docs/fixes/README.md` documenting all fixes

3. **Organized Diagnostic Scripts**:
   - Created `scripts/diagnostics/` directory for development utilities
   - Moved diagnostic scripts from root to organized location:
     - `analyze-test6.js` → `scripts/diagnostics/`
     - `diagnose-before-tables.ts` → `scripts/diagnostics/`
     - `diagnose-styles.ts` → `scripts/diagnostics/`
     - `diagnose-tables.ts` → `scripts/diagnostics/`
   - Created `scripts/CLAUDE.md` documenting diagnostic tools

4. **Enhanced .gitignore**:
   - Added `*.exe` to ignore all executable installers
   - Added explicit `__pycache__/` and Python bytecode patterns
   - Added `npm-audit-report.json` to ignore audit reports
   - Added `/scripts/diagnostics/` to ignore diagnostic scripts
   - Fixed typo in existing gitignore entry

**Benefits:**

- ✅ Reduced repository size by removing 100MB+ build artifacts
- ✅ Significantly cleaner root directory (moved 9 documentation files)
- ✅ Logical organization: fixes in `docs/fixes/`, scripts in `scripts/diagnostics/`
- ✅ Prevents accidental commits of build artifacts and temporary files
- ✅ Organized development utilities in dedicated directories
- ✅ Comprehensive documentation with README files in each directory
- ✅ Improved developer experience with logical file structure

### Black Screen Prevention System (October 2025)

**CRITICAL: Multi-Layer Protection Against Recurring Black Screen Issues**

Implemented comprehensive protection system to prevent the black screen issue that occurred after every update. The black screen was NOT caused by the update mechanism itself, but by accidental modifications to Electron security settings during development.

**Problem:**

- Historical incidents: 159f47b (2025-10-17), 290ee59 (2025-10-16), 7575ba6 (2024-12)
- Changing `contextIsolation: true → false` causes React to fail rendering
- Changing `nodeIntegration: false → true` creates security vulnerabilities
- These changes would slip into commits and reach production via updates

**Solution - Four-Layer Protection:**

1. **TypeScript Const Assertion** (`electron/main.ts:352-356`)
   - Makes security settings read-only at compile-time
   - Any modification attempt causes TypeScript error
   - Cannot be bypassed

2. **Runtime Validation** (`electron/main.ts:405-471`)
   - Validates settings on app startup in development
   - Shows detailed error boxes explaining the issue
   - Educates developers about the consequences

3. **Git Pre-Commit Hook** (`.husky/pre-commit`)
   - Scans for dangerous changes before commit
   - Blocks commits that would cause black screen
   - Can be bypassed with `--no-verify` (not recommended)

4. **CI/CD Validation** (`.github/workflows/release.yml:23-50`)
   - Validates security settings before building release
   - Fails the workflow if violations detected
   - Final safety net - cannot be bypassed

**Documentation:**

- Complete guide: `BLACK_SCREEN_PREVENTION.md`
- Testing instructions included
- Maintenance guidelines provided

**Dependencies Added:**

- `husky`: ^9.1.7 (git hooks)

**Impact:**

- ✅ No more black screen after updates
- ✅ Protection at every development stage
- ✅ Self-documenting code with extensive comments
- ✅ Educational feedback for developers

### ECONNRESET Fix & Proxy Support (January 2025)

**MAJOR FIX: Resolved ECONNRESET and Certificate Validation Errors**

Completely overhauled the auto-updater to handle corporate proxy environments and network interruptions:

**Key Improvements:**

- **Electron's net.request Module**: Replaced Node.js https with Electron's net module for superior proxy support
- **Automatic Proxy Detection**: Detects and configures system proxy settings from environment variables
- **Exponential Backoff**: 5 retry attempts with delays: 1s, 2s, 4s, 8s, 16s for ECONNRESET errors
- **Better Certificate Handling**: Uses Chromium's network stack for proper certificate management
- **Proxy Authentication**: Supports NTLM, Kerberos, and basic auth for corporate proxies

**Technical Details:**

- `proxyConfig.ts`: New module for proxy detection and configuration
- `net.request`: Automatically uses system proxy settings
- Supports `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` environment variables
- Handles PAC files and WPAD protocol
- Works with traffic monitoring proxies (Fiddler-like)

**Benefits:**

- No more ECONNRESET errors in corporate environments
- Automatic retry with intelligent delays
- Works behind SSL-intercepting proxies
- No manual proxy configuration needed
- Better integration with Windows system settings

### TLS Error Handling & Network Resilience (January 2025)

**ENHANCEMENT: Comprehensive TLS/SSL Error Handling for Auto-Updates**

Enhanced the ZIP fallback system with robust TLS error handling to address Windows certificate and network configuration issues:

**Improvements:**

- **TLS Error Detection**: Specifically detects error state 10013 and other TLS/SSL issues
- **Certificate Error Handling**: Automatically trusts GitHub certificates when needed
- **Multi-Stage Fallback**:
  1. Standard .exe download with strict TLS
  2. Relaxed TLS settings on retry
  3. ZIP fallback with flexible HTTPS options
  4. Manual download button as last resort
- **Enhanced Error Messages**: Clear user feedback about connection issues
- **Automatic Retry Logic**: Attempts different TLS configurations automatically

**User Experience:**

- Transparent handling of TLS/network errors
- "Download Manually" button when automatic methods fail
- Progress indicators for all download stages
- Clear status messages explaining the issue

**Security:**

- Maintains file checksum validation regardless of TLS settings
- Only relaxes certificates for known GitHub hosts
- Logs all security exceptions for debugging
- Progressive degradation (strict → relaxed → manual)

### ZIP Fallback Auto-Update System (January 2025)

**NEW FEATURE: Network Restriction Bypass for Auto-Updates**

Implemented a sophisticated dual-channel update system that automatically bypasses corporate/educational network restrictions that block .exe downloads:

**Implementation:**

- **Primary Channel**: Standard .exe download via electron-updater
- **Fallback Channel**: Compressed .zip download with local extraction
- **Automatic Detection**: Detects network blocking errors (403/404/timeout) and switches seamlessly
- **Custom Updater Class**: New `customUpdater.ts` handles fallback logic intelligently

**Key Features:**

- Zero user intervention required - completely automatic
- Visual indicators in UI (archive icon for fallback mode)
- Progress tracking for both download and extraction phases
- Maintains code signing and security standards
- Same "Install & Restart" workflow regardless of update method

**Technical Details:**

- GitHub Actions workflow creates both .exe and .zip versions
- Uses `adm-zip` library for extraction
- Enhanced UpdateNotification component with fallback status
- IPC handlers for fallback-specific events

**Dependencies Added:**

- `adm-zip`: ^0.5.16 (ZIP file extraction)
- `@types/adm-zip`: ^0.5.7 (TypeScript definitions)

### Phase 2B - Feature Completion (January 2025)

**NEW FEATURES:**

1. **Analytics Page** (`/analytics`)
   - Complete data visualization dashboard with Recharts
   - View modes: Daily (30 days), Weekly (12 weeks), Monthly (12 months)
   - Line and bar charts for productivity trends
   - Stats summary cards with real-time data
   - Reset All Stats functionality with confirmation dialog

2. **Search Page** (`/search`)
   - Advanced fuzzy search powered by Fuse.js
   - Cross-session document search
   - Advanced filters: status, session, date range
   - Keyboard navigation (↑↓ navigate, Enter to open)
   - Real-time search results with highlighting
   - Auto-scroll to selected item

3. **Plugins Page** (`/plugins`)
   - Plugin marketplace and management system
   - Install/Uninstall plugins
   - Enable/Disable toggle for installed plugins
   - Category filtering (Document, UI, Integration, Automation)
   - Plugin stats (rating, downloads, version, author)
   - Verified badge system for official plugins
   - Search functionality

4. **Export/Import System**
   - Full data portability via JSON export/import
   - Export all settings, sessions, and global stats
   - Import with validation and version checking
   - Located in Settings → Storage section
   - IPC handlers for file dialogs and data persistence

5. **Global Statistics System**
   - Application-wide stats tracking (independent of sessions)
   - IndexedDB persistence with automatic rollover
   - Historical data: 30 days, 12 weeks, 12 months
   - Trend comparison (today vs yesterday, etc.)
   - Powers Dashboard and Analytics pages

**TECHNICAL IMPROVEMENTS:**

- Added Recharts library for data visualization
- Added Fuse.js for fuzzy search functionality
- Enhanced IPC communication for Export/Import
- New GlobalStatsContext with IndexedDB persistence
- Comprehensive TypeScript types for all new features

**DEPENDENCIES ADDED:**

- `recharts`: ^3.2.1 (charts and data visualization)
- `fuse.js`: ^7.1.0 (fuzzy search)

### UI/UX Improvements (December 2024)

#### Latest Updates

#### Interface Enhancements

- **Removed System Theme Option**: Simplified theme selection to Light/Dark only
- **Lightning Bolt Command Palette**: Replaced text-based command button with icon + tooltip
- **Enhanced Navigation**: Made breadcrumbs clickable for quick navigation
- **Visual Polish**: Added separator between DocHub branding and navigation items
- **Clock Widget**: Added real-time clock display in header

#### User Experience

- **Better Input Fields**: Lightened replacement input fields with muted backgrounds
- **Fixed Toggle Colors**: Improved visibility with standard theme colors
- **Save Feedback**: Added success animations for save/confirmation buttons
- **Process Documents Button**: Added batch processing capability for all pending documents
- **Save Styles Button**: Added explicit save action in Styles Editor

#### Content Features

- **Tracked Changes Tab**: New tab showing diff view of document modifications
- **Enhanced Color Picker**: Improved UI with explicit OK button and better visual feedback
- **Time Saved Statistics**: Display calculation of 101 seconds saved per hyperlink
- **Submit Idea Feature**: Added feedback form in Settings for user suggestions

#### Localization & Customization

- **Expanded Timezones**: Added all US timezones, common international zones, and UTC
- **Language Options**: Simplified to top 3 languages (English, Spanish, Mandarin)
- **Webdings Font**: Added as humorous option in Typography settings

#### Technical Improvements

- **Density Mode Fixes**: Resolved spacing issues in Compact/Minimal modes
- **TypeScript Compliance**: All changes validated with strict type checking
- **2025 Best Practices**: Code follows modern React patterns and conventions

#### Accessibility Improvements (Latest)

- **WCAG 2.1 AA Compliance**: Fixed all accessibility warnings in Settings.tsx
- **Button Labels**: Added aria-labels to all toggle and color picker buttons
- **Form Associations**: Properly linked labels with form controls using htmlFor/id
- **Range Inputs**: Added descriptive aria-labels for all sliders
- **Screen Reader Support**: Enhanced accessibility for assistive technologies

### UI Modernization

- **App Rebranding**: Changed from "Template UI" to "Documentation Hub"
- **Space Consolidation**: Removed duplicate section titles (now shown in breadcrumbs)
- **Page Descriptions**: Moved to header bar below breadcrumbs for better context
- **Density Modes**: Replaced "Spacious" with "Minimal" mode (Comfortable, Compact, Minimal)
- **Typography System**: Enhanced with customizable main and secondary text properties
- **Settings Overhaul**: Modernized with vertical navigation matching 2025 best practices

- **React Router v7**: Migrated to createBrowserRouter with future flags
- **Content Security Policy**: Added proper CSP for Electron security
- **DOM Validation**: Fixed nested button errors in navigation
- **Type Safety**: Resolved TypeScript conflicts in Button component
- **Clean Codebase**: Removed all unused imports and fixed JSX mismatches

## Implementation Status

✅ **22 UI/UX improvements successfully implemented** from Update_Needs_Implementation.md:

- All UI fixes completed
- All feature additions implemented
- TypeScript validation passing
- Code follows 2025 best practices

## Release Process & GitHub Actions Workflow

### Automated Release System

This project uses **GitHub Actions** for fully automated multi-platform releases. The workflow is triggered automatically when you push a version tag.

**Workflow Location**: `.github/workflows/release.yml`

### How to Create a Release

#### Step 1: Commit Your Changes

```bash
git add .
git commit -m "Your descriptive commit message
```

Never add:

```text
🤖 Generated with Claude Code

Co-Authored-By: Claude noreply@anthropic.com
```

#### Step 2: Push to Master

```bash
git push origin master
```

#### Step 3: Create and Push Version Tag

```bash
# Create tag (increment version number appropriately)
git tag v1.0.X -m "Release v1.0.X - Brief description"

# Push tag to GitHub (this triggers the workflow)
git push origin v1.0.X
```

**IMPORTANT**: The tag MUST start with `v` (e.g., `v1.0.12`) to trigger the workflow.

### What Happens Automatically

Once the tag is pushed, GitHub Actions will:

1. **Build on Three Platforms**:
   - Windows (windows-latest)
   - macOS (macos-latest)
   - Linux (ubuntu-latest)

2. **For Each Platform**:
   - Updates package.json version to match the tag
   - Installs dependencies (`npm ci`)
   - Runs TypeScript type checking (`npm run typecheck`)
   - Builds the React application (`npm run build`)
   - Packages the Electron app (`npm run build:electron`)

3. **Create Installers**:
   - **Windows**: `.exe` installer + `latest.yml` (for auto-updates)
   - **macOS**: `.dmg` installer + `latest-mac.yml`
   - **Linux**: `.AppImage` + `latest-linux.yml`

4. **Create GitHub Release**:
   - Automatically creates a release on GitHub
   - Uploads all installers and metadata files
   - Generates release notes from commit messages
   - Publishes as a public release (not draft)

### Monitoring the Release

#### Using GitHub CLI

```bash
# Watch the current workflow run
gh run watch

# List recent workflow runs
gh run list --limit 5

# View specific run details
gh run view <run-id>
```

#### Using GitHub Web Interface

- **Actions Page**: https://github.com/ItMeDiaTech/Documentation_Hub/actions
- **Releases Page**: https://github.com/ItMeDiaTech/Documentation_Hub/releases

### Workflow Timing

Based on historical data:

- **Total Duration**: 3-5 minutes
- **Build Phase**: ~2-4 minutes (all platforms in parallel)
- **Release Creation**: ~30-60 seconds
- **Upload**: ~30 seconds

### Auto-Update System

The `latest.yml`, `latest-mac.yml`, and `latest-linux.yml` files enable the built-in auto-update feature:

- Users are notified when new versions are available
- Updates download in the background
- Users prompted to restart and install
- Seamless update experience across all platforms

### Version Numbering

Follow semantic versioning (MAJOR.MINOR.PATCH):

- **MAJOR**: Breaking changes or major feature releases
- **MINOR**: New features, backward compatible
- **PATCH**: Bug fixes and minor improvements

Current version: Check latest tag with `git tag --sort=-v:refname | head -1`

### Troubleshooting

**If the workflow fails**:

1. Check the Actions tab for error messages
2. Common issues:
   - TypeScript errors: Run `npm run typecheck` locally first
   - Build errors: Run `npm run build` locally first
   - Dependency issues: Ensure `package-lock.json` is committed

**If you need to rebuild**:

```bash
# Delete the tag locally and remotely
git tag -d v1.0.X
git push origin :refs/tags/v1.0.X

# Fix issues, then recreate and push the tag
git tag v1.0.X -m "Release v1.0.X - Description"
git push origin v1.0.X
```

### Manual Building (Local Testing)

To build locally without creating a release:

```bash
# Build and package for current platform only
npm run dist

# Output will be in: release/
# Windows: Documentation Hub Setup 1.0.0.exe
# macOS: Documentation Hub-1.0.0.dmg
# Linux: Documentation Hub-1.0.0.AppImage
```

**Note**: Local builds will show GH_TOKEN errors when trying to publish - this is expected and can be ignored. The installers are still created successfully in the `release/` folder.

## Core Requirements

### Design Philosophy

- **Minimalist Aesthetics**: Clean, uncluttered interface with purposeful use of whitespace
- **2025 Design Standards**: Study and surpass current leaders like Linear, Raycast, Notion, Arc Browser, and Figma desktop apps
- **Coherent Visual Language**: Consistent spacing, typography, color schemes, and interaction patterns throughout

### Technical Stack

- TypeScript for type safety
- Electron latest stable version
- React 18+ with functional components and hooks
- CSS-in-JS solution (Emotion/styled-components) or Tailwind CSS
- Framer Motion for micro-interactions
- React Router for navigation

### UI Components to Implement

#### Navigation System

- Collapsible sidebar with icon-only and expanded states
- Breadcrumb navigation for hierarchical content
- Command palette (Cmd/Ctrl+K) for quick actions
- Tab system for multiple open views
- Context-aware toolbar

#### Visual Design Requirements

- **Color Scheme**:
  - Light/dark mode with system preference detection
  - Semantic color tokens for consistency
  - Subtle gradients and shadows for depth

- **Typography**:
  - Variable font with proper weight hierarchy
  - Responsive sizing using clamp()
  - Optimal line-height and letter-spacing

- **Spacing System**:
  - 4px base unit with consistent scale (4, 8, 12, 16, 24, 32, 48, 64)
  - Component-specific padding rules

- **Interactive Elements**:
  - Hover states with smooth transitions (150-200ms)
  - Focus indicators for accessibility
  - Loading skeletons instead of spinners
  - Subtle haptic feedback via animations

### Polish Details

- Custom window controls (minimize/maximize/close) matching OS style
- Blurred transparency effects using backdrop-filter
- Smooth scrolling with momentum
- Keyboard shortcuts displayed in tooltips
- Error states with graceful recovery options
- Empty states with actionable guidance
- Micro-animations on state changes (expand/collapse, appear/disappear)

### Navigation Structure

```text
Primary Navigation:
- Dashboard/Home (with active sessions)
- Sessions (grid/list view)
- Analytics
- Team
- Documents
- Plugins

Bottom Navigation:
- Notifications (with badge)
- Search (global)
- Profile
- Settings (modernized with vertical nav)

Secondary Navigation:
- Contextual actions bar
- Command palette (Cmd/Ctrl+K)
- Right-click context menus
- Keyboard navigation support
```

### Performance Requirements

- 60fps animations
- Instant perceived responsiveness (<100ms feedback)
- Virtual scrolling for long lists
- Lazy loading for heavy components
- Optimized re-renders using React.memo and useMemo

### Accessibility

- WCAG 2.1 AA compliance
- Keyboard navigation for all interactive elements
- Screen reader support with proper ARIA labels
- High contrast mode support
- Reduced motion preferences respected

### Code Organization

```text
src/
  components/
    layout/
      TitleBar.tsx        # Custom window controls
      Sidebar.tsx         # Collapsible navigation with active sessions
      Header.tsx          # Breadcrumbs with page descriptions
    common/
      Button.tsx          # Motion-enhanced buttons
      Input.tsx           # Search and form inputs
      Card.tsx           # Glass morphism cards
      Skeleton.tsx       # Loading states
      ColorPickerDialog.tsx # Theme customization
      BugReportButton.tsx # Floating action button
    navigation/
      CommandPalette.tsx  # Cmd/Ctrl+K quick actions
    sessions/
      SessionManager.tsx  # Session creation/management
      TabContainer.tsx    # Tab system for session views
      ProcessingOptions.tsx # Document processing settings
      ReplacementsTab.tsx # Text replacement rules
      StylesEditor.tsx    # Visual style customization
  contexts/
    ThemeContext.tsx      # Theme & density management
    SessionContext.tsx    # Session state management
  pages/
    Dashboard.tsx        # Main dashboard
    CurrentSession.tsx   # Active session workspace
    Sessions.tsx         # Session grid/list view
    Settings.tsx         # Modern vertical nav settings
    Projects.tsx         # Project management
  styles/
    global.css          # Tailwind & global styles
  utils/
    cn.ts              # Class name utilities
    colorConvert.ts    # Color manipulation
  types/
    session.ts         # TypeScript definitions

scripts/
  diagnostics/         # Diagnostic and testing scripts (gitignored)
    analyze-test6.js   # Test analysis utilities
    diagnose-*.ts      # Document processing diagnostics

docs/                  # Project documentation
  fixes/               # Technical fix documentation
    BULLET_CHARACTER_FIX.md
    CORRUPTION_FIX.md
    EXECUTION_LOG_TEST_BASE.md
    FIX_SUMMARY_DATA_LOSS_BUG.md
    HYPERLINK_TEXT_SANITIZATION.md
    LIST_FORMATTING_FIX.md
    SDT_PROTECTION_FIX.md
    TABLE_PROTECTION_FIX.md
  analysis/            # Analysis reports and research
    DOCXMLATER_ANALYSIS_SUMMARY.txt
  architecture/        # System architecture documentation
  implementation/      # Implementation guides and specifications
  github-issues/       # GitHub issue documentation

Test_Code/             # Test document structures
```

### Implementation Priorities

1. Set up theming system with CSS variables
2. Build navigation shell (sidebar, header, content area)
3. Implement core interactive components
4. Add animations and transitions
5. Polish with micro-interactions
6. Optimize performance
7. Ensure accessibility compliance

### Reference Implementations

Study these for inspiration but create something superior:

- Linear's command palette and keyboard shortcuts
- Raycast's smooth animations and glass morphism
- Notion's flexible layout system
- Arc Browser's innovative tab management
- Figma's precise component interactions

Build every component from scratch - no placeholder code. Each element should be production-ready with proper error boundaries, loading states, and edge case handling. The final product should feel premium, responsive, and delightful to use.
