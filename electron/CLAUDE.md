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

## Recent Updates

- Enhanced security with proper CSP headers
- Improved window state management
- Better development/production environment handling
- Updated for compatibility with latest Electron versions
