import { BugReportButton } from '@/components/common/BugReportButton';
import { DebugConsole } from '@/components/common/DebugConsole';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { SplashScreen } from '@/components/common/SplashScreen';
import { UpdateNotification } from '@/components/common/UpdateNotification';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { TitleBar } from '@/components/layout/TitleBar';
import { CommandPalette } from '@/components/navigation/CommandPalette';
import { GlobalStatsProvider, useGlobalStats } from '@/contexts/GlobalStatsContext';
import { SessionProvider } from '@/contexts/SessionContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { UserSettingsProvider } from '@/contexts/UserSettingsContext';
import { lazy, Suspense, useEffect, useState } from 'react';
import { createHashRouter, Outlet, RouterProvider } from 'react-router-dom';

// Lazy load pages for code splitting and faster initial load
const Dashboard = lazy(() => import('@/pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Settings = lazy(() => import('@/pages/Settings').then((m) => ({ default: m.Settings })));
const CurrentSession = lazy(() =>
  import('@/pages/CurrentSession').then((m) => ({ default: m.CurrentSession }))
);
const Sessions = lazy(() => import('@/pages/Sessions').then((m) => ({ default: m.Sessions })));
const Documents = lazy(() => import('@/pages/Documents').then((m) => ({ default: m.Documents })));
const Analytics = lazy(() => import('@/pages/Analytics').then((m) => ({ default: m.Analytics })));

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
  const { isLoading } = useGlobalStats();
  const [isInitialized, setIsInitialized] = useState(false);

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
        { path: 'documents', element: <Documents /> },
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
      <ThemeProvider>
        <UserSettingsProvider>
          <GlobalStatsProvider>
            <SessionProvider>
              <RouterProvider router={router} />
            </SessionProvider>
          </GlobalStatsProvider>
        </UserSettingsProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
