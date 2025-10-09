# Changelog

All notable changes to Documentation Hub will be documented in this file.

## [1.0.31] - 2025-01-10

### Fixed
- **MAJOR FIX: Resolved ECONNRESET and Certificate Validation Errors**
  - Completely overhauled auto-updater for corporate proxy environments
  - Replaced Node.js https module with Electron's net.request for superior proxy support
  - Added automatic proxy detection from environment variables (HTTPS_PROXY, HTTP_PROXY, NO_PROXY)
  - Implemented exponential backoff retry logic (5 attempts: 1s, 2s, 4s, 8s, 16s)
  - Better certificate handling using Chromium's network stack
  - Supports NTLM, Kerberos, and basic auth for corporate proxies
  - Works with PAC files and WPAD protocol
  - No manual proxy configuration needed

## [1.0.30] - 2025-01-10

### Added
- Initial implementation of proxy support module
- Net.request integration for better network handling

## [1.0.29] - 2025-01-09

### Fixed
- **TLS Error Handling & Network Resilience**
  - Enhanced ZIP fallback system with robust TLS error handling
  - Specifically detects Windows error state 10013 and other TLS/SSL issues
  - Automatic trust for GitHub certificates when needed
  - Multi-stage fallback (strict TLS → relaxed → ZIP → manual)
  - Enhanced error messages with clear user feedback
  - "Download Manually" button as last resort

## [1.0.28] - 2025-01-09

### Added
- **ZIP Fallback Auto-Update System**
  - Dual-channel update system for network restriction bypass
  - Automatic detection of .exe download blocks
  - Compressed .zip download with local extraction
  - Zero user intervention required
  - Visual indicators for fallback mode
  - Progress tracking for download and extraction
  - Maintains code signing and security

## [1.0.27] - 2025-01-09

### Added
- Initial ZIP fallback implementation for auto-updates
- GitHub Actions workflow for dual-format releases

## [1.0.26] - 2025-01-08

### Added
- Phase 2B Feature Completion
- Analytics page with data visualization (Recharts)
- Advanced search page with fuzzy search (Fuse.js)
- Plugins marketplace system
- Export/Import functionality for settings
- Global statistics system with IndexedDB persistence

### Improved
- Enhanced IPC communication
- Better TypeScript type definitions
- Accessibility improvements (WCAG 2.1 AA)

## [1.0.25] - 2025-01-07

### Improved
- UI/UX modernization
- Removed system theme option
- Lightning bolt command palette
- Enhanced navigation with clickable breadcrumbs
- Clock widget in header
- Better input field styling
- Fixed toggle colors
- Save feedback animations

### Added
- Tracked Changes tab with diff view
- Enhanced color picker UI
- Time saved statistics
- Submit Idea feature
- Expanded timezone support
- Webdings font option

## [1.0.0] - 2024-12-01

### Initial Release
- Core document processing functionality
- Session management system
- Hyperlink processing
- Table of contents generation
- Text replacement rules
- Style management
- Theme customization
- Auto-update system