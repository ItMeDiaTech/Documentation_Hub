import { createHashRouter, RouterProvider, Outlet } from 'react-router-dom';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { SessionProvider } from '@/contexts/SessionContext';
import { UserSettingsProvider } from '@/contexts/UserSettingsContext';
import { GlobalStatsProvider } from '@/contexts/GlobalStatsContext';
import { TitleBar } from '@/components/layout/TitleBar';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { CommandPalette } from '@/components/navigation/CommandPalette';
import { BugReportButton } from '@/components/common/BugReportButton';
import { UpdateNotification } from '@/components/common/UpdateNotification';
import { Dashboard } from '@/pages/Dashboard';
import { Settings } from '@/pages/Settings';
import { CurrentSession } from '@/pages/CurrentSession';
import { Sessions } from '@/pages/Sessions';
import { Documents } from '@/pages/Documents';
import { Analytics } from '@/pages/Analytics';
import { Search } from '@/pages/Search';
import { Plugins } from '@/pages/Plugins';
import { useState } from 'react';

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

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <TitleBar />

      <div className="flex-1 flex overflow-hidden">
        <Sidebar />

        <div className="flex-1 flex flex-col overflow-hidden">
          <Header onCommandPalette={() => setCommandPaletteOpen(true)} />

          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>

      <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />

      <BugReportButton />

      <UpdateNotification />
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
        { path: 'plugins', element: <Plugins /> },
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
    <ThemeProvider>
      <UserSettingsProvider>
        <GlobalStatsProvider>
          <SessionProvider>
            <RouterProvider router={router} />
          </SessionProvider>
        </GlobalStatsProvider>
      </UserSettingsProvider>
    </ThemeProvider>
  );
}

export default App;
