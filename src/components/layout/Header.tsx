import { ChevronRight, Command, Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { cn } from '@/utils/cn';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';

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
  const location = useLocation();

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
                <span
                  className={cn(
                    'text-base font-semibold',
                    index === breadcrumbs.length - 1 ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  {crumb.label}
                </span>
              </div>
            ))}
          </div>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onCommandPalette}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-md',
              'bg-muted text-muted-foreground text-sm',
              'hover:bg-accent hover:text-accent-foreground transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            )}
          >
            <Command className="w-3 h-3" />
            <span>Command</span>
            <kbd className="px-1 py-0.5 text-xs bg-background border border-border rounded">K</kbd>
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
              {theme === 'system' && <Monitor className="w-4 h-4" />}
            </button>

            {showThemeMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowThemeMenu(false)} />
                <div className="absolute right-0 top-full mt-2 w-36 rounded-md border border-border bg-popover p-1 shadow-md z-20">
                  {[
                    { value: 'light' as const, icon: Sun, label: 'Light' },
                    { value: 'dark' as const, icon: Moon, label: 'Dark' },
                    { value: 'system' as const, icon: Monitor, label: 'System' },
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
