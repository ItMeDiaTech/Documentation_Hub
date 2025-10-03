# Documentation Hub - Session Components

This directory contains all session-related components for the Documentation Hub's document processing and management system. These components enable users to create, manage, and configure document processing sessions with advanced options.

## Components

### SessionManager.tsx
- **Purpose**: Modal for creating new sessions or loading existing ones
- **Features**:
  - Create new session with custom name
  - Load from list of existing sessions
  - Display session metadata (date, document count, status)
  - Animated modal with backdrop blur
  - Glass morphism effects
  - Motion animations for smooth transitions
- **Props**:
  - `mode`: 'new' | 'load' - Determines modal behavior
  - `onClose`: Callback when modal closes
  - `onSessionCreated`: Callback with new session ID
  - `onSessionLoaded`: Callback with loaded session ID

### TabContainer.tsx
- **Purpose**: Reusable tabbed interface component for session workspace
- **Features**:
  - Dynamic tab navigation with animated indicator
  - Spring physics animations for smooth transitions
  - Content switching with fade animations
  - Responsive design with scrollable tabs
  - Active tab indicator with primary color
- **Props**:
  - `tabs`: Array of tab configurations (id, label, content)
  - `defaultTab`: Initial active tab ID
  - `className`: Optional styling class

### ProcessingOptions.tsx
- **Purpose**: Configure autonomous document processing options
- **Features**:
  - Master toggle for all processing options
  - Grouped options by category:
    - Text Formatting (whitespace, paragraphs, italics)
    - Hyperlinks (TOC, outdated titles, internal links)
    - Content Structure (IDs, styles, images)
    - Lists & Tables (indentation, bullets, uniformity)
    - Keywords (fix key words)
  - Group-level toggles for bulk operations
  - Individual option checkboxes with animations
- **Props**:
  - `sessionId`: Current session identifier
  - `onOptionsChange`: Callback with updated options array

### StylesEditor.tsx
- **Purpose**: Configure document styles (Header 1, Header 2, Normal)
- **Features**:
  - Font family and size selection
  - Text formatting toggles (bold, italic, underline)
  - Alignment options (left, center, right, justify)
  - Color picker for text
  - Spacing controls (before/after)
  - Live preview of style appearance
  - Special option for Normal style: "Don't add space between paragraphs"
- **Default Values**:
  - Header 1: 18pt, bold, black, Verdana, left, 0pt before/12pt after
  - Header 2: 14pt, bold, black, Verdana, left, 6pt before/6pt after
  - Normal: 12pt, normal, black, Verdana, left, 3pt before/3pt after
- **Props**:
  - `sessionId`: Current session identifier
  - `onStylesChange`: Callback with updated styles array

### TrackedChanges.tsx
- **Purpose**: Display diff view of all document changes after processing
- **Features**:
  - Expandable document list showing change counts
  - Color-coded change types (additions, modifications, deletions)
  - Side-by-side diff view with original and new text
  - Line number references for each change
  - Animated expand/collapse for document sections
  - Visual indicators for change types
  - Empty state when no changes tracked
- **Change Types**:
  - **Additions** (green): New content added to document
  - **Modifications** (blue): Existing content that was changed
  - **Deletions** (red): Content removed from document
- **Props**:
  - `sessionId`: Current session identifier for tracking changes

### ReplacementsTab.tsx
- **Purpose**: Configure text and hyperlink replacement rules
- **Features**:
  - Two sections: Hyperlink replacements and Text replacements
  - Master toggles for each replacement type
  - Dynamic table interfaces for rules management
  - Add/remove rules functionality
  - Individual rule enable/disable checkboxes
  - Animated row additions/removals
- **Table Columns**:
  - Hyperlinks: Enable checkbox | Old Hyperlink Text | New Content ID | Delete
  - Text: Enable checkbox | Old Text | New Text | Delete
- **Props**:
  - `sessionId`: Current session identifier
  - `onRulesChange`: Callback with updated rules arrays

## Integration with Documentation Hub

These components are integrated into the CurrentSession page via the TabContainer:

1. **Session Tab**: Main document management interface with "Process Documents" button
2. **Processing Options Tab**: Configure automated document processing
3. **Styles Tab**: Define document styling rules with live preview and Save button
4. **Replacements Tab**: Set up text/hyperlink replacements with lighter input fields
5. **Tracked Changes Tab**: Review all document modifications with diff view

The session components work seamlessly with:
- **SessionContext**: Global session state management
- **ThemeContext**: Respects user's theme and density preferences
- **Navigation**: Integrated with sidebar for quick session access

## State Management

- Processing options, styles, and replacement rules are managed at the session level
- Settings persist across session loads via SessionContext
- Changes are applied when documents are processed
- Active sessions appear dynamically in the sidebar navigation
- Session state includes documents, stats, and configuration

## Animations & Performance

All components use Framer Motion for smooth 60fps transitions:
- Tab switching with spring physics
- Checkbox animations with scale transforms
- Row additions/removals with opacity and position animations
- Toggle switches with smooth position transitions
- Staggered animations for grouped elements
- Optimized re-renders with React.memo
- Lazy loading for heavy components

## Accessibility & UX

- WCAG 2.1 AA compliant
- Proper ARIA labels for all interactive elements
- Full keyboard navigation support (Tab, Space, Enter)
- Screen reader friendly labels and descriptions
- Focus indicators matching theme colors
- Reduced motion support for accessibility preferences
- Responsive design for various screen sizes
- Clear visual hierarchy with typography scaling

## Recent Updates

- Enhanced with density modes (minimal, compact, comfortable)
- Improved typography system integration
- Glass morphism effects for modern appearance
- Fixed DOM validation issues
- Modernized UI following 2025 design patterns