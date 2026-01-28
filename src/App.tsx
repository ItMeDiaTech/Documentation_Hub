import { createHashRouter, RouterProvider, Outlet } from 'react-router-dom';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { SessionProvider } from '@/contexts/SessionContext';
import { UserSettingsProvider } from '@/contexts/UserSettingsContext';
import { GlobalStatsProvider } from '@/contexts/GlobalStatsContext';
import { TitleBar } from '@/components/layout/TitleBar';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { CommandPalette } from '@/components/navigation/CommandPalette';
import { KeyboardShortcutsModal } from '@/components/navigation/KeyboardShortcutsModal';
import { TooltipProvider } from '@/components/common/Tooltip';
import { BugReportButton } from '@/components/common/BugReportButton';
import { UpdateNotification } from '@/components/common/UpdateNotification';
import { DebugConsole } from '@/components/common/DebugConsole';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { ContextErrorFallback } from '@/components/common/ErrorFallback';
import { SplashScreen } from '@/components/common/SplashScreen';
import { useState, lazy, Suspense, useEffect, useCallback } from 'react';
import { useGlobalStats } from '@/contexts/GlobalStatsContext';
import { useNavigate } from 'react-router-dom';

// Lazy load pages for code splitting and faster initial load
const Dashboard = lazy(() => import('@/pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Settings = lazy(() => import('@/pages/Settings').then((m) => ({ default: m.Settings })));
const CurrentSession = lazy(() =>
  import('@/pages/CurrentSession').then((m) => ({ default: m.CurrentSession }))
);
const Sessions = lazy(() => import('@/pages/Sessions').then((m) => ({ default: m.Sessions })));
const Documents = lazy(() => import('@/pages/Documents').then((m) => ({ default: m.Documents })));
const Analytics = lazy(() => import('@/pages/Analytics').then((m) => ({ default: m.Analytics })));
const Reporting = lazy(() => import('@/pages/Reporting').then((m) => ({ default: m.Reporting })));
const Search = lazy(() => import('@/pages/Search').then((m) => ({ default: m.Search })));

// Loading fallback component
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

function EmptyPage({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">{title}</h2>
        <p className="text-muted-foreground">This page is under construction</p>
      </div>
    </div>
  );
}

function Layout() {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const { isLoading } = useGlobalStats();
  const [isInitialized, setIsInitialized] = useState(false);
  const navigate = useNavigate();

  // Global keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't trigger shortcuts when typing in inputs
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    // ? - Show keyboard shortcuts
    if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      setShortcutsModalOpen(true);
      return;
    }

    const isMod = e.ctrlKey || e.metaKey;

    // Mod+K - Command palette (handled elsewhere, but ensure consistency)
    if (isMod && e.key === 'k') {
      e.preventDefault();
      setCommandPaletteOpen(true);
      return;
    }

    // Navigation shortcuts
    if (isMod && e.key >= '1' && e.key <= '4') {
      e.preventDefault();
      const routes = ['/', '/sessions', '/analytics', '/documents'];
      const index = parseInt(e.key) - 1;
      if (routes[index]) {
        navigate(routes[index]);
      }
      return;
    }

    // Mod+, - Settings
    if (isMod && e.key === ',') {
      e.preventDefault();
      navigate('/settings');
      return;
    }
  }, [navigate]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Track initialization completion with slight delay for smooth transition
  useEffect(() => {
    if (!isLoading && !isInitialized) {
      // Add 300ms delay to ensure smooth transition
      const timer = setTimeout(() => {
        setIsInitialized(true);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isLoading, isInitialized]);

  // Show splash screen during initialization
  if (!isInitialized) {
    return <SplashScreen message="Loading your workspace..." />;
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <TitleBar />

      <div className="flex-1 flex overflow-hidden">
        <Sidebar />

        <div className="flex-1 flex flex-col overflow-hidden">
          <Header onCommandPalette={() => setCommandPaletteOpen(true)} />

          <main className="flex-1 overflow-auto">
            <Suspense fallback={<PageLoader />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>

      <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />

      <KeyboardShortcutsModal open={shortcutsModalOpen} onOpenChange={setShortcutsModalOpen} />

      <BugReportButton />

      <UpdateNotification />

      <DebugConsole />
    </div>
  );
}

const router = createHashRouter(
  [
    {
      path: '/',
      element: <Layout />,
      children: [
        { index: true, element: <Dashboard /> },
        { path: 'sessions', element: <Sessions /> },
        { path: 'session/:id', element: <CurrentSession /> },
        { path: 'analytics', element: <Analytics /> },
        { path: 'team', element: <EmptyPage title="Team" /> },
        { path: 'documents', element: <Documents /> },
        { path: 'reporting', element: <Reporting /> },
        { path: 'search', element: <Search /> },
        { path: 'profile', element: <EmptyPage title="Profile" /> },
        { path: 'settings', element: <Settings /> },
      ],
    },
  ],
  {
    future: {
      v7_startTransition: true,
      v7_relativeSplatPath: true,
      v7_fetcherPersist: true,
      v7_normalizeFormMethod: true,
      v7_partialHydration: true,
      v7_skipActionErrorRevalidation: true,
    },
  }
);

function App() {
  return (
    <ErrorBoundary>
      <ErrorBoundary fallback={<ContextErrorFallback context="theme" />}>
        <ThemeProvider>
          <ErrorBoundary fallback={<ContextErrorFallback context="settings" />}>
            <UserSettingsProvider>
              <ErrorBoundary fallback={<ContextErrorFallback context="stats" />}>
                <GlobalStatsProvider>
                  <ErrorBoundary fallback={<ContextErrorFallback context="session" />}>
                    <SessionProvider>
                      <TooltipProvider>
                        <RouterProvider router={router} />
                      </TooltipProvider>
                    </SessionProvider>
                  </ErrorBoundary>
                </GlobalStatsProvider>
              </ErrorBoundary>
            </UserSettingsProvider>
          </ErrorBoundary>
        </ThemeProvider>
      </ErrorBoundary>
    </ErrorBoundary>
  );
}

export default App;
