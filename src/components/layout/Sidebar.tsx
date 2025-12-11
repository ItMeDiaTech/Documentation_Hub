import { useState, useEffect, useRef, memo, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home,
  FolderOpen,
  Settings,
  ChevronRight,
  BarChart3,
  FileText,
  X,
  Circle,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSession } from '@/contexts/SessionContext';
import iconPng from '/icon.png';

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  path: string;
  badge?: number;
  indented?: boolean;
  closeable?: boolean;
  onClose?: () => void;
}

export const Sidebar = memo(function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [logoClickCount, setLogoClickCount] = useState(0);
  const clickTimerRef = useRef<NodeJS.Timeout | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { sessions, activeSessions, closeSession } = useSession();

  // Reset click count after 2 seconds of inactivity
  useEffect(() => {
    if (logoClickCount > 0) {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
      }
      clickTimerRef.current = setTimeout(() => {
        setLogoClickCount(0);
      }, 2000);
    }
    return () => {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
      }
    };
  }, [logoClickCount]);

  const handleLogoClick = useCallback(() => {
    const newCount = logoClickCount + 1;
    setLogoClickCount(newCount);

    if (newCount === 5) {
      // Easter egg: open dev tools!
      window.electronAPI.openDevTools();
      setLogoClickCount(0);
    }
  }, [logoClickCount]);

  const handleNavClick = useCallback(
    (path: string) => {
      navigate(path);
    },
    [navigate]
  );

  // Build navigation items with dynamic sessions
  const navItems = useMemo(() => {
    const items: NavItem[] = [{ id: 'home', label: 'Dashboard', icon: Home, path: '/' }];

    // Add active sessions under Dashboard
    activeSessions.forEach((session) => {
      items.push({
        id: `session-${session.id}`,
        label: session.name,
        icon: Circle,
        path: `/session/${session.id}`,
        indented: true,
        closeable: true,
        onClose: () => closeSession(session.id),
      });
    });

    // Add other navigation items
    items.push(
      { id: 'sessions', label: 'Sessions', icon: FolderOpen, path: '/sessions' },
      { id: 'analytics', label: 'Analytics', icon: BarChart3, path: '/analytics' },
      { id: 'documents', label: 'Documents', icon: FileText, path: '/documents' }
    );

    return items;
  }, [activeSessions, closeSession]);

  const bottomItems = useMemo<NavItem[]>(
    () => [
      { id: 'settings', label: 'Settings', icon: Settings, path: '/settings' },
    ],
    []
  );

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = location.pathname === item.path;

    return (
      <div
        key={item.id}
        className={cn(
          'relative group',
          item.indented && !collapsed && 'ml-4',
          item.indented && collapsed && 'ml-0'
        )}
      >
        <div
          onClick={() => handleNavClick(item.path)}
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200',
            'hover:bg-accent hover:text-accent-foreground',
            isActive && 'bg-primary text-primary-foreground hover:bg-primary/90',
            collapsed && 'justify-center',
            'cursor-pointer'
          )}
        >
          <div className="flex items-center gap-3 flex-1 pointer-events-none">
            {item.indented && !collapsed && (
              <div className="w-4 h-4 flex items-center justify-center">
                <Circle className="w-2 h-2" />
              </div>
            )}
            {(!item.indented || collapsed) && (
              <Icon className={cn('w-4 h-4 flex-shrink-0', collapsed && 'w-5 h-5')} />
            )}
            <AnimatePresence mode="wait">
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.2 }}
                  className="text-sm font-medium whitespace-nowrap overflow-hidden flex-1 text-left"
                >
                  {item.label}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          {item.closeable && !collapsed && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                item.onClose?.();
              }}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-background/20 pointer-events-none group-hover:pointer-events-auto"
            >
              <X className="w-3 h-3" />
            </button>
          )}
          {item.badge && !collapsed && (
            <span className="ml-auto px-1.5 py-0.5 text-xs bg-destructive text-destructive-foreground rounded-full">
              {item.badge}
            </span>
          )}
          {item.badge && collapsed && (
            <span className="absolute top-1 right-1 w-2 h-2 bg-destructive rounded-full" />
          )}
        </div>
      </div>
    );
  };

  return (
    <motion.aside
      initial={{ width: 240 }}
      animate={{ width: collapsed ? 64 : 240 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      className="sidebar-bg h-full bg-background/50 backdrop-blur-xl border-r border-border flex flex-col relative"
    >
      <div className="p-4 flex items-center justify-between">
        <AnimatePresence mode="wait">
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2"
            >
              <motion.div
                onClick={handleLogoClick}
                whileTap={{ scale: 0.9 }}
                className="w-8 h-8 rounded-lg cursor-pointer hover:opacity-90 transition-opacity overflow-hidden"
              >
                <img src={iconPng} alt="DocHub" className="w-full h-full" />
              </motion.div>
              <span className="font-semibold text-sm">DocHub</span>
            </motion.div>
          )}
        </AnimatePresence>
        {collapsed && (
          <motion.div
            onClick={handleLogoClick}
            whileTap={{ scale: 0.9 }}
            className="w-8 h-8 rounded-lg cursor-pointer hover:opacity-90 transition-opacity overflow-hidden"
          >
            <img src={iconPng} alt="DocHub" className="w-full h-full" />
          </motion.div>
        )}
      </div>

      <div className="mx-4 mb-3 h-px bg-border/50" />

      <nav className="flex-1 px-3 pb-3 overflow-y-auto">
        <div className="space-y-1">{navItems.map(renderNavItem)}</div>
      </nav>

      <div className="px-3 pb-3 space-y-1 border-t border-border pt-3">
        {bottomItems.map(renderNavItem)}
      </div>

      <motion.button
        onClick={() => setCollapsed(!collapsed)}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        className={cn(
          'absolute -right-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full',
          'bg-background border-2 border-border',
          'hover:border-primary hover:shadow-lg transition-all',
          'flex items-center justify-center',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'group'
        )}
      >
        <motion.div animate={{ rotate: collapsed ? 0 : 180 }} transition={{ duration: 0.3 }}>
          <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
        </motion.div>
      </motion.button>
    </motion.aside>
  );
});
