# Documentation Hub

A modern desktop application for managing document processing workflows with advanced hyperlink management, table of contents generation, and comprehensive document styling capabilities.

## Overview

Documentation Hub is a professional-grade Electron desktop application designed to streamline document processing tasks. Built with TypeScript, React, and modern web technologies, it provides a polished interface for managing multiple document processing sessions with powerful customization options.

## Core Features

### Session-Based Workflow

Organize your document processing tasks into sessions, each maintaining its own configuration, documents, and processing history. Sessions persist across application restarts and can be resumed at any time.

**Key Capabilities:**

- Create unlimited processing sessions with custom names
- Add multiple Word documents (.docx) to each session
- Track processing status for each document
- Maintain separate configurations per session
- View processing statistics and time saved
- Close and archive completed sessions

### Document Processing

Comprehensive document processing with support for multiple operations:

**Hyperlink Management:**

- Process and validate hyperlinks within documents
- Append custom content IDs to hyperlink URLs
- Distinguish between internal and external links
- Batch process multiple documents simultaneously
- Validate URL accessibility
- Automatic backup creation before processing

**Table of Contents Generation:**

- Generate custom table of contents with configurable heading levels
- Choose which heading levels to include (1-6)
- Enable or disable page numbers
- Right-align page numbers option
- Convert entries to clickable hyperlinks
- Customize tab leader style (none, dots, dashes, underline)
- Configure spacing between TOC entries
- Toggle TOC title visibility
- Custom TOC title text

**Table Uniformity:**

- Apply consistent formatting across all tables
- Configure border styles (single, double, dashed, or none)
- Set uniform border widths
- Bold and shade header rows
- Enable alternating row colors
- Adjust cell padding
- Auto-fit to content or window width
- Special formatting for Header 2 in 1x1 cells (custom shading and alignment)
- Dedicated large table styling (font, size, formatting, alignment)
- Conditional application based on patterns (If...Then detection)
- Apply formatting to top rows automatically

**List Bullet Formatting:**

- Configure indentation levels (up to 5 levels)
- Set custom bullet characters per level
- Define numbered list formats
- Adjust spacing between list items
- Maintain consistent indentation across documents

### Text Replacement Rules

Create and manage text replacement rules for consistent document formatting:

- Define find-and-replace patterns
- Support for regular expressions
- Case-sensitive matching options
- Apply rules across all documents in a session
- Enable or disable individual rules
- Bulk edit multiple replacement rules

### Style Management

Customize document styles with comprehensive formatting options:

**Supported Styles:**

- Normal text
- Header 1 through Header 6
- Custom style definitions

**Formatting Controls:**

- Font family selection
- Font size (points)
- Bold, italic, and underline toggles
- Text alignment (left, center, right, justify)
- Text color with visual picker
- Spacing before paragraph (points)
- Spacing after paragraph (points)

### Tracked Changes Visualization

View detailed before-and-after comparisons of document modifications:

- Side-by-side diff view of changes
- Color-coded additions (green) and removals (red)
- Line-by-line change tracking
- Export changes to review
- Track hyperlink modifications
- Monitor style changes
- Record structural alterations

### Advanced Theming

Fully customizable user interface with extensive theming options:

**Theme Modes:**

- Light mode
- Dark mode
- Automatic theme switching based on time

**Customization Options:**

- Custom accent colors with visual picker
- 24 preset color options (8 per row)
- Custom primary, background, and foreground colors
- Header and sidebar color customization
- Border color adjustments
- Secondary font color configuration
- Glass morphism effects with backdrop blur
- Smooth theme transitions

### Typography System

Comprehensive typography controls for optimal readability:

- Main text font family (system-ui, Inter, Roboto, etc.)
- Font size with slider (12-24px)
- Font weight (Light, Regular, Medium, Semibold, Bold)
- Font style (Normal, Italic)
- Letter spacing adjustment (-0.05em to 0.2em)
- Line height configuration (1.0 to 2.5)
- Secondary text font customization
- Real-time preview of changes

### Density Modes

Optimize screen real estate with three density modes:

- **Comfortable** - Generous spacing for relaxed reading
- **Compact** - Reduced spacing for more content visibility
- **Minimal** - Maximum content density for power users

### Statistics and Analytics

Track your productivity with comprehensive statistics:

- Total documents processed
- Total hyperlinks checked and modified
- Time saved calculations (101 seconds per hyperlink average)
- Processing duration per document
- Success and error rates
- Session-level metrics
- Cross-session aggregation

### User Experience Enhancements

**Interface Polish:**

- Custom frameless window with native controls
- Collapsible sidebar with icon-only mode
- Clickable breadcrumb navigation
- Real-time clock display
- Command palette (Ctrl/Cmd+K) for quick actions
- Smooth animations powered by Framer Motion
- Loading skeletons instead of spinners
- Success animations for save actions
- Responsive layout for different screen sizes

**Accessibility:**

- WCAG 2.1 AA compliant
- Full keyboard navigation support
- Screen reader compatibility
- High contrast mode support
- Reduced motion preferences respected
- Proper ARIA labels throughout

**File Management:**

- Open file location in system explorer
- Drag and drop document upload
- Multi-file selection support
- Document status indicators
- Automatic backup creation
- Error handling with recovery options

## Technology Stack

- **Framework:** Electron 38 with React 19
- **Language:** TypeScript with strict mode
- **Build Tool:** Vite 7
- **Styling:** Tailwind CSS 3.4
- **Animations:** Framer Motion 12
- **UI Components:** Radix UI primitives
- **Document Processing:** docx library with custom processing
- **State Management:** React Context with Zustand
- **Data Persistence:** IndexedDB for sessions, LocalStorage for settings
- **Command Palette:** cmdk library
- **Icons:** Lucide React

## System Requirements

- **Operating System:**
  - Windows 10 or later
  - macOS 10.14 (Mojave) or later
  - Ubuntu 18.04 or later (or equivalent Linux distribution)

- **Hardware:**
  - Minimum 4GB RAM (8GB recommended)
  - 500MB available disk space
  - 1280x720 minimum screen resolution

- **Software:**
  - Microsoft Word document support (.docx files)
  - Internet connection for update checks (optional)

## Installation

### Windows

**Installer (Recommended):**

```powershell
# Download and install using PowerShell
iwr https://raw.githubusercontent.com/ItMeDiaTech/Documentation_Hub/master/install.ps1 | iex
```

**Manual Installation:**

1. Download the latest `.exe` installer from the [Releases](https://github.com/ItMeDiaTech/Documentation_Hub/releases) page
2. Run the installer
3. Choose installation directory (defaults to `%LOCALAPPDATA%\Programs\Documentation Hub`)
4. Follow the installation wizard
5. Launch Documentation Hub from the Start Menu or desktop shortcut

No administrator rights required - installs to user directory.

### macOS

**Installer:**

```bash
# Download and install using curl
curl -fsSL https://raw.githubusercontent.com/ItMeDiaTech/Documentation_Hub/master/install.sh | bash
```

**Manual Installation:**

1. Download the latest `.dmg` file from the [Releases](https://github.com/ItMeDiaTech/Documentation_Hub/releases) page
2. Open the DMG file
3. Drag Documentation Hub to your Applications folder
4. Launch from Applications

### Linux

**AppImage:**

```bash
# Download and run
curl -fsSL https://raw.githubusercontent.com/ItMeDiaTech/Documentation_Hub/master/install.sh | bash
```

**Manual Installation:**

1. Download the latest `.AppImage` from the [Releases](https://github.com/ItMeDiaTech/Documentation_Hub/releases) page
2. Make it executable: `chmod +x Documentation-Hub-*.AppImage`
3. Run: `./Documentation-Hub-*.AppImage`

## Development

### Prerequisites

- Node.js 18 or later
- npm or yarn
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/ItMeDiaTech/Documentation_Hub.git
cd Documentation_Hub

# Install dependencies
npm install

# Run in development mode with hot reload
npm run electron:dev

# Type checking
npm run typecheck

# Linting
npm run lint

# Format code
npm run format
```

### Available Scripts

- `npm run dev` - Start Vite development server
- `npm run electron:dev` - Run Electron with hot reload
- `npm run build` - Build for production
- `npm run dist` - Package for distribution
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
- `npm run typecheck` - Run TypeScript type checking

### Building for Distribution

```bash
# Build for current platform
npm run build
npm run dist

# Output will be in the release/ directory
```

**Platform-Specific Builds:**

- Windows: Generates `.exe` installer (NSIS)
- macOS: Generates `.dmg` disk image
- Linux: Generates `.AppImage` executable

## Configuration

### Application Settings

Access settings via the gear icon in the sidebar or press `Ctrl/Cmd+,`.

**Appearance:**

- Theme (Light/Dark)
- Accent color selection
- Custom color configuration
- Glass effects toggle
- Animation preferences

**Typography:**

- Main text font and sizing
- Secondary text customization
- Letter spacing and line height
- Font weight and style

**Localization:**

- Language (English, Spanish, Mandarin)
- Timezone selection (US and international)
- Date format preferences

**API Connections:**

- PowerAutomate URL for automation
- Bug report endpoint
- Feature suggestion endpoint

**Updates:**

- Auto-update on launch (default: enabled)
- Manual update checks
- Release notes viewer

**Data Management:**

- Storage location
- Session cleanup preferences
- Export/import settings
- Reset to defaults

### Session Configuration

Each session maintains independent settings:

**Processing Options:**

- Append content ID to hyperlinks
- Content ID string
- URL validation
- Backup creation
- Internal/external link processing

**Styles:**

- Custom style definitions
- Font and formatting rules
- Spacing configurations

**Replacements:**

- Text replacement rules
- Pattern matching options

**Document Uniformity:**

- Table formatting rules
- List bullet configurations
- TOC generation settings

## Architecture

```
Documentation_Hub/
├── electron/              # Electron main process
│   ├── main.ts           # App initialization and IPC
│   └── preload.ts        # Context bridge (security)
├── src/                  # React application
│   ├── components/       # UI components
│   │   ├── common/      # Reusable components
│   │   ├── layout/      # Layout components
│   │   ├── navigation/  # Navigation components
│   │   └── sessions/    # Session-specific components
│   ├── contexts/        # React contexts
│   │   ├── ThemeContext.tsx
│   │   ├── SessionContext.tsx
│   │   └── UserSettingsContext.tsx
│   ├── pages/           # Application views
│   │   ├── Dashboard.tsx
│   │   ├── Sessions.tsx
│   │   ├── CurrentSession.tsx
│   │   ├── Documents.tsx
│   │   └── Settings.tsx
│   ├── services/        # Business logic
│   │   └── document/   # Document processing
│   ├── styles/          # Global styles and themes
│   ├── types/           # TypeScript definitions
│   ├── utils/           # Utility functions
│   └── App.tsx          # Root component
├── public/              # Static assets
└── build/               # Build resources (icons)
```

### Key Design Patterns

**State Management:**

- React Context for global state
- Zustand for complex state logic
- IndexedDB for persistent session data
- LocalStorage for user preferences

**Security:**

- Context isolation enabled
- Node integration disabled
- IPC communication via secure bridge
- Content Security Policy enforced
- Sandboxed renderer process

**Performance:**

- Code splitting and lazy loading
- Virtual scrolling for large lists
- Optimized re-renders with React.memo
- 60fps animations with GPU acceleration
- Efficient document processing with Web Workers

## Updates

Documentation Hub includes automatic update functionality:

1. **Automatic Updates (Recommended):**
   - Enable "Auto-update on launch" in Settings
   - App checks for updates on startup
   - Downloads and installs updates automatically
   - Prompts to restart when ready

2. **Manual Updates:**
   - Click "Check for Updates" in Settings
   - View available update details
   - Download and install when convenient

3. **Release Channels:**
   - Stable: Production-ready releases
   - All updates go through the stable channel

Updates are downloaded from GitHub Releases and verified before installation.

## Troubleshooting

### Application Won't Start

- **Windows:** Check that .NET Framework 4.5+ is installed
- **macOS:** Allow app in Security & Privacy settings
- **Linux:** Ensure AppImage has execute permissions

### Documents Not Processing

- Verify document is valid .docx format
- Check file is not password-protected
- Ensure file is not currently open in another application
- Review error messages in the application

### Settings Not Saving

- Check available disk space
- Verify IndexedDB is enabled in your system
- Try clearing application cache (Settings > Data)
- Reset settings to defaults if corrupted

### Performance Issues

- Reduce density mode to Minimal
- Disable glass effects and animations
- Close unnecessary sessions
- Process fewer documents simultaneously
- Increase available system memory

### Auto-Update Issues (Corporate Networks)

**ECONNRESET or Certificate Validation Errors:**

Documentation Hub includes advanced proxy support for corporate environments. If you encounter update issues:

1. **Automatic Proxy Detection:**
   - The app automatically detects proxy settings from environment variables
   - Supports HTTPS_PROXY, HTTP_PROXY, and NO_PROXY
   - Works with NTLM, Kerberos, and basic authentication

2. **Setting Proxy Environment Variables (if needed):**

   ```bash
   # Windows (Command Prompt)
   set HTTPS_PROXY=http://proxy.company.com:8080
   set HTTP_PROXY=http://proxy.company.com:8080
   set NO_PROXY=localhost,127.0.0.1

   # Windows (PowerShell)
   $env:HTTPS_PROXY="http://proxy.company.com:8080"
   $env:HTTP_PROXY="http://proxy.company.com:8080"
   $env:NO_PROXY="localhost,127.0.0.1"

   # With authentication
   set HTTPS_PROXY=http://username:password@proxy.company.com:8080
   ```

3. **Automatic Retry with Exponential Backoff:**
   - The app automatically retries failed downloads 5 times
   - Retry delays: 1s, 2s, 4s, 8s, 16s
   - Handles transient network issues gracefully

4. **ZIP Fallback System:**
   - If .exe downloads are blocked, the app automatically tries .zip format
   - Downloads compressed version and extracts locally
   - Maintains security and code signing

5. **Corporate Certificate Issues:**
   - For custom CA certificates: `set NODE_EXTRA_CA_CERTS=path\to\certificate.pem`
   - The app uses Chromium's network stack for better certificate handling

**Network Restriction Bypass:**

If your network blocks .exe downloads:

- The app automatically detects blocking and switches to ZIP fallback
- No manual intervention required
- Visual indicators show when fallback mode is active
- Same "Install & Restart" workflow regardless of update method

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Style

- Follow existing TypeScript conventions
- Use Prettier for code formatting
- Run ESLint before committing
- Write type-safe code with strict TypeScript
- Add comments for complex logic
- Update documentation for new features

### Testing

- Test on all supported platforms before submitting
- Verify accessibility compliance
- Check performance impact
- Ensure backward compatibility

## Security

### Reporting Vulnerabilities

If you discover a security vulnerability, please email security@example.com instead of using the issue tracker.

### Security Measures

- Automatic security updates
- Sandboxed renderer processes
- Content Security Policy
- No remote code execution
- Minimal permissions model
- Encrypted data storage options

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Acknowledgments

Built with these excellent open-source projects:

- Electron for cross-platform desktop capabilities
- React for UI components
- TypeScript for type safety
- Tailwind CSS for styling
- Framer Motion for animations
- Radix UI for accessible primitives
- docx library for document processing

## Support

- **Issues:** [GitHub Issues](https://github.com/ItMeDiaTech/Documentation_Hub/issues)
- **Discussions:** [GitHub Discussions](https://github.com/ItMeDiaTech/Documentation_Hub/discussions)
- **Email:** support@example.com

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and release notes.

## Roadmap

Planned features for future releases:

- Cloud sync for sessions across devices
- Plugin system for custom processors
- Team collaboration features
- Advanced analytics and reporting
- Batch processing scheduler
- Custom document templates
- Export to multiple formats
- Integration with cloud storage providers

---

**Version:** 1.0.0
**Last Updated:** 2025
**Maintainer:** ItMeDiaTech
