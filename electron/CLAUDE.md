# Documentation Hub - Electron Module

This directory contains the Electron main process and preload scripts for the Documentation Hub desktop application.

## File Structure

- **main.ts**: Main Electron process that creates and manages the application window
  - Handles window creation with frameless design
  - Manages window state (minimize, maximize, close)
  - Sets up IPC communication handlers
  - Configures development vs production environments

- **preload.ts**: Preload script that safely exposes Electron APIs to the renderer
  - Provides secure IPC communication bridge
  - Exposes window control functions
  - Handles window state change events
  - Includes TypeScript definitions for the exposed API
  - File operation handlers (select, process, show in folder, restore from backup)

## Key Features

- **Frameless Window**: Custom titlebar implementation for modern UI
- **IPC Communication**: Secure context bridge for renderer-main communication
- **Window State Management**: Full control over window minimize/maximize/close
- **Platform Detection**: Exposes platform information to renderer for OS-specific styling
- **Development Mode**: Auto-opens DevTools and loads from Vite dev server
- **Production Mode**: Loads built files with proper security settings

## Security

- Context isolation enabled for renderer process safety
- Node integration disabled to prevent arbitrary code execution
- All APIs exposed through secure contextBridge
- External URLs open in default browser
- Content Security Policy (CSP) configured in index.html
- Sandboxing enabled for additional security

## Window Configuration

- **Size**: 1200x800 pixels (default)
- **Min Size**: 800x600 pixels
- **Frame**: Custom (frameless)
- **Background**: #000000
- **Title Bar**: Overlay with custom controls

## IPC Handlers

### File Operations

- **select-documents**: File picker dialog for .docx files
- **process-document**: Process single document with validation
- **show-in-folder**: Open file location in system explorer
- **restore-from-backup**: Restore document from backup file
  - **Parameters**: `{backupPath: string, targetPath: string}`
  - **Validation**:
    - Verifies backup file exists
    - Validates .docx file extension for both paths
    - Ensures file type security
  - **Operation**: Safe file copy with overwrite
  - **Error Handling**: Detailed error messages for debugging
  - **Security**: Path validation and file type verification
  - **Use Case**: Revert all changes functionality in TrackedChanges

### Window Controls

- **window-minimize**: Minimize window
- **window-maximize**: Toggle maximize/unmaximize
- **window-close**: Close application
- **window-is-maximized**: Check maximization state
- **window-is-fullscreen**: Check fullscreen state

### Hyperlink Processing

- **hyperlink:select-files**: Multi-file picker for batch processing
- **hyperlink:process-document**: Process single document with options
- **hyperlink:batch-process**: Process multiple documents concurrently
- **hyperlink:validate-api**: Validate PowerAutomate endpoint
- **hyperlink:cancel-operation**: Cancel ongoing processing

### Auto-Updater

- **check-for-updates**: Check for application updates
- **download-update**: Download available update
- **install-update**: Quit and install downloaded update
- **get-app-version**: Get current application version

## Recent Updates

- **Added restore-from-backup IPC handler** for revert changes functionality (January 2025)
- Enhanced security with proper CSP headers
- Improved window state management
- Better development/production environment handling
- Updated for compatibility with latest Electron versions
