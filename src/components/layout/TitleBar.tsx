import { useState, useEffect, useRef } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { cn } from '@/utils/cn';
import { motion, AnimatePresence } from 'framer-motion';

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [platform, setPlatform] = useState<NodeJS.Platform>('win32');
  const [clickCount, setClickCount] = useState(0);
  const [showDebugToast, setShowDebugToast] = useState(false);
  const resetTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  useEffect(() => {
    // Safely check if electronAPI is available (may not be in browser-only mode)
    if (typeof window.electronAPI === 'undefined') {
      console.warn('TitleBar: electronAPI not available (running in browser mode?)');
      return;
    }

    window.electronAPI.getPlatform().then((p: string) => setPlatform(p as NodeJS.Platform));
    window.electronAPI.isMaximized().then(setIsMaximized);

    const unsubMaximized = window.electronAPI.onWindowMaximized(() => setIsMaximized(true));
    const unsubUnmaximized = window.electronAPI.onWindowUnmaximized(() => setIsMaximized(false));

    return () => {
      unsubMaximized();
      unsubUnmaximized();
    };
  }, []);

  const handleMinimize = () => window.electronAPI?.minimizeWindow();
  const handleMaximize = () => window.electronAPI?.maximizeWindow();
  const handleClose = () => window.electronAPI?.closeWindow();

  const handleLogoClick = () => {
    // Clear existing timeout
    if (resetTimeoutRef.current) {
      clearTimeout(resetTimeoutRef.current);
    }

    // Increment click count
    const newCount = clickCount + 1;
    setClickCount(newCount);

    // Check if we've reached 5 clicks
    if (newCount === 5) {
      // Open dev tools
      window.electronAPI?.openDevTools();

      // Show toast notification
      setShowDebugToast(true);
      setTimeout(() => setShowDebugToast(false), 3000);

      // Reset click count
      setClickCount(0);
    } else {
      // Reset count after 2 seconds of inactivity
      resetTimeoutRef.current = setTimeout(() => {
        setClickCount(0);
      }, 2000);
    }
  };

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current) {
        clearTimeout(resetTimeoutRef.current);
      }
    };
  }, []);

  const isWindows = platform === 'win32';
  const isMac = platform === 'darwin';

  return (
    <>
      <div className="h-8 bg-background/80 backdrop-blur-xl border-b border-border flex items-center justify-between drag-region relative">
        <button
          onClick={handleLogoClick}
          className="flex items-center gap-2 px-3 no-drag hover:bg-muted/50 transition-colors"
        >
          <div className="w-4 h-4 rounded bg-primary/20" />
          <span className="text-xs font-medium text-muted-foreground select-none">
            Documentation Hub
          </span>
        </button>

      {isWindows && (
        <div className="flex no-drag">
          <button
            onClick={handleMinimize}
            className={cn(
              'px-4 h-8 hover:bg-muted transition-colors',
              'focus:outline-none focus-visible:bg-muted'
            )}
            aria-label="Minimize"
          >
            <Minus className="w-3 h-3" />
          </button>
          <button
            onClick={handleMaximize}
            className={cn(
              'px-4 h-8 hover:bg-muted transition-colors',
              'focus:outline-none focus-visible:bg-muted'
            )}
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
          >
            <Square className="w-2.5 h-2.5" />
          </button>
          <button
            onClick={handleClose}
            className={cn(
              'px-4 h-8 hover:bg-destructive hover:text-destructive-foreground transition-colors',
              'focus:outline-none focus-visible:bg-destructive focus-visible:text-destructive-foreground'
            )}
            aria-label="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {isMac && (
        <div className="flex gap-2 px-3 no-drag">
          <button
            onClick={handleClose}
            className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-600 transition-colors"
            aria-label="Close"
          />
          <button
            onClick={handleMinimize}
            className="w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-600 transition-colors"
            aria-label="Minimize"
          />
          <button
            onClick={handleMaximize}
            className="w-3 h-3 rounded-full bg-green-500 hover:bg-green-600 transition-colors"
            aria-label="Maximize"
          />
        </div>
      )}
    </div>

    {/* Debug Mode Toast */}
    <AnimatePresence>
      {showDebugToast && (
        <motion.div
          initial={{ opacity: 0, y: -50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -50 }}
          className="fixed top-12 left-1/2 transform -translate-x-1/2 z-[9999]"
        >
          <div className="bg-primary text-primary-foreground px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
            <span className="text-sm font-medium">🔧 Debug Mode Activated</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  </>
  );
}
