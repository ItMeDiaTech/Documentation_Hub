import { useState, useEffect } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { cn } from '@/utils/cn';

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [platform, setPlatform] = useState<NodeJS.Platform>('win32');

  useEffect(() => {
    window.electronAPI.getPlatform().then(setPlatform);
    window.electronAPI.isMaximized().then(setIsMaximized);

    const unsubMaximized = window.electronAPI.onWindowMaximized(() => setIsMaximized(true));
    const unsubUnmaximized = window.electronAPI.onWindowUnmaximized(() => setIsMaximized(false));

    return () => {
      unsubMaximized();
      unsubUnmaximized();
    };
  }, []);

  const handleMinimize = () => window.electronAPI.minimizeWindow();
  const handleMaximize = () => window.electronAPI.maximizeWindow();
  const handleClose = () => window.electronAPI.closeWindow();

  const isWindows = platform === 'win32';
  const isMac = platform === 'darwin';

  return (
    <div className="h-8 bg-background/80 backdrop-blur-xl border-b border-border flex items-center justify-between drag-region">
      <div className="flex items-center gap-2 px-3">
        <div className="w-4 h-4 rounded bg-primary/20" />
        <span className="text-xs font-medium text-muted-foreground select-none">Documentation Hub</span>
      </div>

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
  );
}
