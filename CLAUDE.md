# Documentation Hub - TypeScript/Electron Desktop Application

A modern, polished desktop application built with TypeScript/Electron featuring a comprehensive document processing and session management system. This is a LOCAL application with no web deployment.

Every subfolder should have a detailed CLAUDE.md describing what each file does.

Every big change, CLAUDE.md files should be updated as needed and project should be added and committed with git.

## Recent Updates (December 2024)

### UI Modernization

- **App Rebranding**: Changed from "Template UI" to "Documentation Hub"
- **Space Consolidation**: Removed duplicate section titles (now shown in breadcrumbs)
- **Page Descriptions**: Moved to header bar below breadcrumbs for better context
- **Density Modes**: Replaced "Spacious" with "Minimal" mode (Comfortable, Compact, Minimal)
- **Typography System**: Enhanced with customizable main and secondary text properties
- **Settings Overhaul**: Modernized with vertical navigation matching 2025 best practices

### Technical Improvements

- **React Router v7**: Migrated to createBrowserRouter with future flags
- **Content Security Policy**: Added proper CSP for Electron security
- **DOM Validation**: Fixed nested button errors in navigation
- **Type Safety**: Resolved TypeScript conflicts in Button component
- **Clean Codebase**: Removed all unused imports and fixed JSX mismatches

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
