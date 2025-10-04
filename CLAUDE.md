# Documentation Hub - TypeScript/Electron Desktop Application

A modern, polished desktop application built with TypeScript/Electron featuring a comprehensive document processing and session management system. This is a LOCAL application with no web deployment.

Every subfolder should have a detailed CLAUDE.md describing what each file does.

Every big change, CLAUDE.md files should be updated as needed and project should be added and committed with git.

## Recent Updates

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

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
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
