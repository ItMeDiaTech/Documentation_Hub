# Documentation Hub Components

This directory contains all reusable React components for the Documentation Hub application, organized by functionality and purpose.

## Component Organization

### layout/

Layout components that structure the application shell:

- **TitleBar.tsx** - Custom frameless window titlebar with OS-specific controls
  - Displays "Documentation Hub" branding
  - Handles window minimize/maximize/close
  - Platform detection for Windows/Mac styling
  - Integrates with Electron IPC

- **Sidebar.tsx** - Collapsible navigation sidebar
  - Dynamic active sessions display
  - Icon-based navigation items with nested structure
  - Animated collapse/expand with motion button
  - Badge support for notifications
  - Active route highlighting
  - Close button for active sessions

- **Header.tsx** - Application header
  - **ENHANCED**: Clickable breadcrumb navigation for quick access
  - Page descriptions below breadcrumbs
  - **NEW**: Real-time clock widget in top-right
  - **UPDATED**: Lightning bolt icon for command palette with tooltip
  - Theme switcher (simplified to Light/Dark only)
  - Responsive text sizing

### common/

Reusable UI components used throughout the application:

- **Button.tsx** - Enhanced button component
  - Multiple variants: default, destructive, outline, secondary, ghost, link, gradient
  - Size options: xs, sm, default, lg, icon
  - Loading state with spinner
  - Icon support
  - Framer Motion animations
  - **NEW**: Success state with checkmark animation
  - **NEW**: showSuccess prop for visual feedback
  - **NEW**: onSuccess callback after animation completes

- **Input.tsx** - Advanced input field
  - Label and helper text support
  - Error state handling
  - Password visibility toggle
  - Search variant with icon
  - Clear button for controlled inputs
  - Left/right icon slots

- **Card.tsx** - Container component
  - Variants: default, bordered, ghost, glass
  - Interactive mode with hover effects
  - Glass morphism support with backdrop blur
  - Compound components: CardHeader, CardTitle, CardDescription, CardContent, CardFooter
  - Framer Motion animations

- **Skeleton.tsx** - Loading placeholders
  - Variants: default, circle, text, card
  - Shimmer animation effect
  - Compound components: SkeletonCard, SkeletonList

- **ColorPickerDialog.tsx** - Theme color customization
  - Accent color selection
  - Predefined color palette (8 colors per row, 24 total)
  - Visual preview with hover tooltip
  - Dialog overlay
  - **ENHANCED**: Click-to-pick color with visual feedback
  - **ENHANCED**: Icon indicators in hex input field
  - **ENHANCED**: "Quick Colors" label for palette
  - **ENHANCED**: Explicit OK/Cancel buttons for better UX

- **BugReportButton.tsx** - Floating feedback button
  - Fixed position bottom-right
  - External link to feedback form
  - Hover animations

### sessions/

Session management components:

- **SessionManager.tsx** - Modal for creating/loading sessions
  - Create new session or load existing
  - Session naming and configuration
  - Modal overlay with animations

- **TabContainer.tsx** - Reusable tabbed interface
  - Scrollable tab list
  - Active tab indicator
  - Content switching

- **ProcessingOptions.tsx** - Document processing settings
  - Toggle switches for various options
  - Grouped settings layout

- **StylesEditor.tsx** - Document style configuration
  - Visual style settings
  - Form controls for customization

- **ReplacementsTab.tsx** - Text/hyperlink replacement rules
  - Add/remove replacement rules
  - Pattern matching configuration

### navigation/

Navigation-specific components:

- **CommandPalette.tsx** - Global command palette
  - Keyboard shortcut activation (Cmd/Ctrl+K)
  - Fuzzy search with cmdk library
  - Categorized commands
  - Route navigation
  - Theme switching
  - Animated modal overlay

## Component Patterns

### Composition

Components use compound component patterns for flexibility:

```tsx
<Card variant="glass" interactive>
  <CardHeader>
    <CardTitle>Title</CardTitle>
    <CardDescription>Description</CardDescription>
  </CardHeader>
  <CardContent>Content</CardContent>
</Card>
```

### Styling

- Uses Tailwind CSS classes via cn() utility
- Class Variance Authority (CVA) for variant management
- CSS variables for theme tokens
- Density-based scaling (minimal, compact, comfortable)
- Custom color system with HSL values

### Accessibility

- Proper ARIA labels and roles
- Keyboard navigation support
- Focus management
- Screen reader compatibility

### Performance

- ForwardRef for ref forwarding
- React.memo for expensive components
- Optimized re-renders with proper dependencies
- Lazy loading for routes
- Framer Motion for 60fps animations
- Virtual scrolling ready for long lists

## Recent Updates

- Enhanced typography system with customizable fonts
- Added density modes for space optimization
- Fixed nested button DOM validation errors
- Modernized with 2025 design patterns
- Improved glass morphism effects
