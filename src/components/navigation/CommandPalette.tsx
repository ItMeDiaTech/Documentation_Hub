import { useEffect, useState, useCallback, useMemo } from 'react';
import { Command } from 'cmdk';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Home,
  FolderOpen,
  Settings,
  User,
  FileText,
  Plug,
  Moon,
  Sun,
  X,
  ArrowRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@/contexts/ThemeContext';
import { cn } from '@/utils/cn';

interface CommandItem {
  id: string;
  label: string;
  category: string;
  icon: React.ElementType;
  action: () => void;
  keywords?: string[];
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const { setTheme } = useTheme();

  const handleNavigate = useCallback(
    (path: string) => {
      navigate(path);
      onOpenChange(false);
    },
    [navigate, onOpenChange]
  );

  const items: CommandItem[] = useMemo(
    () => [
      {
        id: 'home',
        label: 'Go to Dashboard',
        category: 'Navigation',
        icon: Home,
        action: () => handleNavigate('/'),
        keywords: ['dashboard', 'home', 'main'],
      },
      {
        id: 'projects',
        label: 'Open Projects',
        category: 'Navigation',
        icon: FolderOpen,
        action: () => handleNavigate('/projects'),
        keywords: ['project', 'folder', 'workspace'],
      },
      {
        id: 'documents',
        label: 'Browse Documents',
        category: 'Navigation',
        icon: FileText,
        action: () => handleNavigate('/documents'),
        keywords: ['docs', 'files', 'text'],
      },
      {
        id: 'plugins',
        label: 'View Plugins',
        category: 'Navigation',
        icon: Plug,
        action: () => handleNavigate('/plugins'),
        keywords: ['plugins', 'extensions', 'addons', 'modules'],
      },
      {
        id: 'profile',
        label: 'View Profile',
        category: 'Account',
        icon: User,
        action: () => handleNavigate('/profile'),
        keywords: ['user', 'account', 'me'],
      },
      {
        id: 'settings',
        label: 'Open Settings',
        category: 'Account',
        icon: Settings,
        action: () => handleNavigate('/settings'),
        keywords: ['preferences', 'config', 'options'],
      },
      {
        id: 'theme-light',
        label: 'Switch to Light Theme',
        category: 'Theme',
        icon: Sun,
        action: () => {
          setTheme('light');
          onOpenChange(false);
        },
        keywords: ['light', 'bright', 'day'],
      },
      {
        id: 'theme-dark',
        label: 'Switch to Dark Theme',
        category: 'Theme',
        icon: Moon,
        action: () => {
          setTheme('dark');
          onOpenChange(false);
        },
        keywords: ['dark', 'night', 'dim'],
      },
    ],
    [handleNavigate, setTheme, onOpenChange]
  );

  const groupedItems = items.reduce(
    (acc, item) => {
      if (!acc[item.category]) {
        acc[item.category] = [];
      }
      acc[item.category].push(item);
      return acc;
    },
    {} as Record<string, CommandItem[]>
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
      if (e.key === 'Escape') {
        onOpenChange(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange]);

  const handleSelect = useCallback(
    (itemId: string) => {
      const item = items.find((i) => i.id === itemId);
      if (item) {
        item.action();
      }
    },
    [items]
  );

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50"
            onClick={() => onOpenChange(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl z-50"
          >
            <Command className="rounded-xl border border-border bg-popover shadow-2xl">
              <div className="flex items-center border-b border-border px-3">
                <Search className="w-4 h-4 text-muted-foreground mr-2 shrink-0" />
                <Command.Input
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Type a command or search..."
                  className="flex-1 py-3 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
                />
                <button
                  onClick={() => onOpenChange(false)}
                  className="p-1 rounded hover:bg-accent"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <Command.List className="max-h-96 overflow-y-auto p-2">
                <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
                  No results found.
                </Command.Empty>
                {Object.entries(groupedItems).map(([category, categoryItems]) => (
                  <Command.Group key={category} heading={category} className="px-2 pb-2">
                    <div className="text-xs text-muted-foreground font-medium mb-1 px-2">
                      {category}
                    </div>
                    {categoryItems.map((item) => {
                      const Icon = item.icon;
                      return (
                        <Command.Item
                          key={item.id}
                          value={`${item.label} ${item.keywords?.join(' ') || ''}`}
                          onSelect={() => handleSelect(item.id)}
                          className={cn(
                            'flex items-center gap-3 px-2 py-2 rounded-md cursor-pointer',
                            'hover:bg-accent hover:text-accent-foreground',
                            'aria-selected:bg-accent aria-selected:text-accent-foreground'
                          )}
                        >
                          <Icon className="w-4 h-4 text-muted-foreground" />
                          <span className="flex-1">{item.label}</span>
                          <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        </Command.Item>
                      );
                    })}
                  </Command.Group>
                ))}
              </Command.List>
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
