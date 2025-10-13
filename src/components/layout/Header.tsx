import { ChevronRight, Zap, Moon, Sun, Clock } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { cn } from '@/utils/cn';
import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const pathToTitle: Record<string, string> = {
  '/': 'Dashboard',
  '/projects': 'Projects',
  '/analytics': 'Analytics',
  '/team': 'Team',
  '/documents': 'Documents',
  '/plugins': 'Plugins',
  '/notifications': 'Notifications',
  '/search': 'Search',
  '/profile': 'Profile',
  '/settings': 'Settings',
  '/sessions': 'Sessions',
};

const pathDescriptions: Record<string, string> = {
  '/': 'Manage your document processing sessions',
  '/projects': 'View and manage your projects',
  '/analytics': 'Track performance and insights',
  '/team': 'Collaborate with your team members',
  '/documents': 'Browse and manage documents',
  '/plugins': 'Extend functionality with plugins',
  '/notifications': 'View your notifications',
  '/search': 'Search across your workspace',
  '/profile': 'Manage your profile',
  '/settings': 'Manage your account and application preferences',
  '/sessions': 'View and manage all sessions',
};

export function Header({ onCommandPalette }: { onCommandPalette: () => void }) {
  const { theme, setTheme } = useTheme();
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const getBreadcrumbs = () => {
    const paths = location.pathname.split('/').filter(Boolean);
    const breadcrumbs = [];
    let currentPath = '';

    for (const path of paths) {
      currentPath += `/${path}`;
      breadcrumbs.push({
        label: pathToTitle[currentPath] || path,
        path: currentPath,
      });
    }

    if (breadcrumbs.length === 0) {
      breadcrumbs.push({ label: 'Dashboard', path: '/' });
    }

    return breadcrumbs;
  };

  const breadcrumbs = getBreadcrumbs();

  const currentPath = location.pathname;
  const description = pathDescriptions[currentPath] || '';

  return (
    <header className="header-bg border-b border-border bg-background/50 backdrop-blur-xl px-6 py-2">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            {breadcrumbs.map((crumb, index) => (
              <div key={crumb.path} className="flex items-center gap-2">
                {index > 0 && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                <button
                  onClick={() => index < breadcrumbs.length - 1 && navigate(crumb.path)}
                  className={cn(
                    'text-base font-semibold transition-colors',
                    index === breadcrumbs.length - 1
                      ? 'text-foreground cursor-default'
                      : 'text-muted-foreground hover:text-foreground cursor-pointer'
                  )}
                  disabled={index === breadcrumbs.length - 1}
                >
                  {crumb.label}
                </button>
              </div>
            ))}
          </div>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>

        <div className="flex items-center gap-3">
          <div className="clock-widget flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/50 text-sm">
            <Clock className="w-4 h-4" />
            <span className="font-mono">{formatTime(currentTime)}</span>
          </div>

          <div className="w-px h-6 bg-border" />

          <button
            onClick={onCommandPalette}
            className={cn(
              'p-2 rounded-md',
              'hover:bg-accent hover:text-accent-foreground transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'group relative'
            )}
            aria-label="Quick actions (Ctrl+K)"
            title="Quick actions (Ctrl+K)"
          >
            <Zap className="w-4 h-4" />
            <span className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 text-xs bg-popover text-popover-foreground rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
              Ctrl+K to quickly access this menu
            </span>
          </button>

          <div className="relative">
            <button
              onClick={() => setShowThemeMenu(!showThemeMenu)}
              className={cn(
                'p-2 rounded-md',
                'hover:bg-accent hover:text-accent-foreground transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              )}
              aria-label="Theme switcher"
            >
              {theme === 'light' && <Sun className="w-4 h-4" />}
              {theme === 'dark' && <Moon className="w-4 h-4" />}
            </button>

            {showThemeMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowThemeMenu(false)} />
                <div className="absolute right-0 top-full mt-2 w-36 rounded-md border border-border bg-popover p-1 shadow-md z-20">
                  {[
                    { value: 'light' as const, icon: Sun, label: 'Light' },
                    { value: 'dark' as const, icon: Moon, label: 'Dark' },
                  ].map(({ value, icon: Icon, label }) => (
                    <button
                      key={value}
                      onClick={() => {
                        setTheme(value);
                        setShowThemeMenu(false);
                      }}
                      className={cn(
                        'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm',
                        'hover:bg-accent hover:text-accent-foreground transition-colors',
                        theme === value && 'bg-accent text-accent-foreground'
                      )}
                    >
                      <Icon className="w-3 h-3" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
