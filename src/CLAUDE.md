# Documentation Hub - Source Code

This directory contains the React application source code for the Documentation Hub desktop application, a modern document processing and session management system.

## Directory Structure

- **components/** - Reusable UI components
  - **layout/** - Layout components (TitleBar, Sidebar, Header)
  - **common/** - Common UI components (Button, Input, Card, Skeleton, ColorPickerDialog, BugReportButton)
  - **navigation/** - Navigation components (CommandPalette)
  - **sessions/** - Session management components (SessionManager, TabContainer, ProcessingOptions, ReplacementsTab, StylesEditor)

- **contexts/** - React contexts for global state
  - ThemeContext - Manages theme, density modes, and typography settings
  - SessionContext - Manages active sessions and session state

- **pages/** - Application views/pages
  - Dashboard - Main dashboard with stats and activity
  - CurrentSession - Active session workspace with tabs
  - Sessions - Session grid/list view with search
  - Settings - Modern vertical nav settings with live preview
  - Projects - Project management view (placeholder)

- **styles/** - CSS and styling
  - global.css - Global styles and Tailwind configuration
  - themes/ - Theme configurations
  - tokens/ - Design tokens

- **utils/** - Utility functions
  - cn.ts - Class name utility for merging Tailwind classes
  - colorConvert.ts - Color format conversion utilities

- **types/** - TypeScript type definitions
  - session.ts - Session and document type definitions

- **hooks/** - Custom React hooks

## Key Components

### Layout Components

- **TitleBar**: Custom window frame with OS-specific controls (shows "Documentation Hub")
- **Sidebar**: Collapsible navigation sidebar with active sessions, icons, and badges
- **Header**: Top header with breadcrumbs, page descriptions, and command palette trigger

### UI Components

- **Button**: Motion-enhanced button with multiple variants and loading states
- **Input**: Enhanced input field with search, clear button, and icons
- **Card**: Container component with glass morphism and interactive states
- **Skeleton**: Loading placeholder animations
- **ColorPickerDialog**: Theme accent color customization
- **BugReportButton**: Floating action button for feedback

### Navigation

- **CommandPalette**: Cmd/Ctrl+K command palette for quick actions

## Features

- **Theme System**: Light/dark/system modes with custom accent colors
- **Density Modes**: Comfortable, Compact, and Minimal layouts
- **Typography**: Customizable main and secondary text properties
- **Animations**: Framer Motion for smooth micro-interactions
- **Glass Morphism**: Modern frosted glass effects (toggleable)
- **Session Management**: Create, load, and manage document processing sessions
- **Responsive Design**: Adaptive layouts for different screen sizes
- **Keyboard Navigation**: Full keyboard support with command palette
- **Accessibility**: ARIA labels and screen reader support

## State Management

- Theme & density state via ThemeContext
- Session state via SessionContext
- Local component state with hooks
- URL-based routing with React Router v7

## Styling

- Tailwind CSS for utility-first styling
- CSS variables for dynamic theming
- Class variance authority for component variants
- Custom animations and transitions

## Performance

- React.memo for expensive components
- Lazy loading for routes
- Virtual scrolling ready
- Optimized re-renders
- 60fps animations with Framer Motion
- Efficient list rendering for sessions

## Recent Updates

- Migrated to React Router v7 with createBrowserRouter
- Fixed nested button DOM validation errors
- Added Content Security Policy for Electron
- Modernized Settings page with vertical navigation
- Enhanced typography customization system
- Consolidated UI space by removing duplicate titles
