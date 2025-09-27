# Documentation Hub - Modern Electron Desktop Application

A polished, modern TypeScript/Electron desktop application for managing document processing sessions. Features a clean, minimalist interface with smooth animations, glass morphism effects, and comprehensive theming support that meets 2025 design standards.

## Features

- 🎨 **Modern Design** - Clean, minimalist aesthetics surpassing current design leaders
- 🌓 **Theme Support** - Light/dark/system themes with custom color overrides
- 🎛️ **Interface Density** - Minimal/Compact/Comfortable modes for space optimization
- ✍️ **Typography Control** - Complete font customization with size, weight, and spacing controls
- 🎨 **Custom Colors** - Full color customization for all UI elements
- ⚡ **High Performance** - 60fps animations with optimized React rendering
- 🎯 **Command Palette** - Quick actions with Cmd/Ctrl+K
- 📱 **Responsive Layout** - Adaptive design for different window sizes
- ♿ **Accessibility** - WCAG 2.1 AA compliant with full keyboard navigation
- 🪟 **Frameless Window** - Custom titlebar with OS-specific controls
- ✨ **Micro-interactions** - Delightful animations powered by Framer Motion
- 📄 **Session Management** - Document processing sessions with stats tracking

## Tech Stack

- **Framework**: Electron + React 18
- **Language**: TypeScript
- **Bundler**: Vite
- **Styling**: Tailwind CSS
- **Animation**: Framer Motion
- **Components**: Radix UI primitives
- **Command Palette**: cmdk
- **State**: Zustand + React Context

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Git

### Installation

```bash
# Install dependencies
npm install

# Run in development mode
npm run electron:dev

# Build for production
npm run build

# Package for distribution
npm run dist
```

## Development

### Available Scripts

- `npm run dev` - Start Vite dev server
- `npm run electron:dev` - Run Electron with hot reload
- `npm run build` - Build for production
- `npm run lint` - Run ESLint
- `npm run format` - Format with Prettier
- `npm run typecheck` - TypeScript type checking

### Project Structure

```text
Template_UI/
├── electron/           # Electron main process
│   ├── main.ts        # Main process entry
│   └── preload.ts     # Preload script
├── src/               # React application
│   ├── components/    # UI components
│   ├── contexts/      # React contexts
│   ├── pages/         # Application views
│   ├── styles/        # CSS and themes
│   ├── utils/         # Utilities
│   └── App.tsx        # Root component
├── public/            # Static assets
└── index.html         # HTML entry point
```

## UI Components

### Layout

- Custom titlebar with window controls
- Collapsible sidebar navigation
- Breadcrumb header
- Responsive content area

### Components

- Buttons with multiple variants
- Advanced input fields
- Cards with glass morphism
- Loading skeletons
- Command palette
- Toast notifications

### Pages

- Dashboard with stats and charts
- Projects management
- Settings with multiple sections
- Profile management
- Analytics views

## Theming

The application supports dynamic theming with:

- Light and dark modes
- System preference detection
- CSS variables for easy customization
- Smooth theme transitions

## Performance

- Virtual DOM optimization
- Code splitting
- Lazy loading
- Memoization
- Optimized animations

## Building

### Windows

```bash
npm run dist
```

Outputs: `.exe` installer in `release/`

### macOS

```bash
npm run dist
```

Outputs: `.dmg` in `release/`

### Linux

```bash
npm run dist
```

Outputs: `.AppImage` in `release/`

## License

MIT

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Open a pull request
