import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Terminal, AlertTriangle, Network, Shield, Download, Trash2, Copy } from 'lucide-react';
import { Button } from './Button';
import { cn } from '@/utils/cn';

interface LogEntry {
  id: string;
  timestamp: string;
  type: 'network' | 'cert-error' | 'network-error' | 'tls-error' | 'info' | 'warning';
  message: string;
  details?: any;
}

export function DebugConsole() {
  const [isVisible, setIsVisible] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<'all' | 'network' | 'errors'>('all');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    // Listen for debug mode activation (triggered by 5 clicks on logo)
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ctrl+Shift+D to toggle debug console
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        setIsVisible(!isVisible);
      }
    };

    window.addEventListener('keydown', handleKeyPress);

    // Listen for network requests
    const unsubNetworkRequest = window.electronAPI?.onDebugNetworkRequest?.((data) => {
      addLog('network', `${data.method} ${data.url}`, data);
    });

    // Listen for certificate errors
    const unsubCertError = window.electronAPI?.onDebugCertError?.((data) => {
      addLog('cert-error', `Certificate Error: ${data.url}`, data);
    });

    // Listen for network errors
    const unsubNetworkError = window.electronAPI?.onDebugNetworkError?.((data) => {
      addLog('network-error', `Network Error: ${data.error}`, data);
    });

    // Listen for TLS errors
    const unsubTLSError = window.electronAPI?.onDebugTLSError?.((data) => {
      addLog('tls-error', `TLS Error: ${data.message}`, data);
    });

    // Listen for update status
    const unsubUpdateStatus = window.electronAPI?.onUpdateStatus?.((data) => {
      if (data.message?.includes('PowerShell') || data.message?.includes('Mutual TLS')) {
        addLog('info', `Update: ${data.message}`, data);
      }
    });

    return () => {
      window.removeEventListener('keydown', handleKeyPress);
      unsubNetworkRequest?.();
      unsubCertError?.();
      unsubNetworkError?.();
      unsubTLSError?.();
      unsubUpdateStatus?.();
    };
  }, [isVisible]);

  useEffect(() => {
    // Auto-scroll to bottom when new logs are added
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const addLog = (type: LogEntry['type'], message: string, details?: any) => {
    const newLog: LogEntry = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date().toISOString(),
      type,
      message,
      details
    };
    setLogs(prev => [...prev.slice(-200), newLog]); // Keep last 200 logs
  };

  const clearLogs = () => {
    setLogs([]);
  };

  const exportLogs = () => {
    const logsJson = JSON.stringify(logs, null, 2);
    const blob = new Blob([logsJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debug-logs-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyLogs = () => {
    const logsText = logs.map(log =>
      `[${log.timestamp}] [${log.type.toUpperCase()}] ${log.message}`
    ).join('\n');
    navigator.clipboard.writeText(logsText);
  };

  const filteredLogs = logs.filter(log => {
    if (filter === 'all') return true;
    if (filter === 'network') return log.type === 'network';
    if (filter === 'errors') return log.type.includes('error');
    return true;
  });

  const getLogIcon = (type: LogEntry['type']) => {
    switch (type) {
      case 'network':
        return <Network className="w-3 h-3" />;
      case 'cert-error':
        return <Shield className="w-3 h-3 text-red-500" />;
      case 'network-error':
      case 'tls-error':
        return <AlertTriangle className="w-3 h-3 text-yellow-500" />;
      default:
        return <Terminal className="w-3 h-3" />;
    }
  };

  const getLogColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'cert-error':
      case 'tls-error':
        return 'text-red-400';
      case 'network-error':
        return 'text-yellow-400';
      case 'network':
        return 'text-blue-400';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 100 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 100 }}
          className="fixed bottom-4 right-4 z-[999] w-[600px] h-[400px] bg-background/95 backdrop-blur-xl border border-border rounded-lg shadow-2xl flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Debug Console</span>
              <span className="text-xs text-muted-foreground">
                ({filteredLogs.length} logs)
              </span>
            </div>
            <div className="flex items-center gap-1">
              {/* Filter buttons */}
              <button
                onClick={() => setFilter('all')}
                className={cn(
                  'px-2 py-1 text-xs rounded transition-colors',
                  filter === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                )}
              >
                All
              </button>
              <button
                onClick={() => setFilter('network')}
                className={cn(
                  'px-2 py-1 text-xs rounded transition-colors',
                  filter === 'network'
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                )}
              >
                Network
              </button>
              <button
                onClick={() => setFilter('errors')}
                className={cn(
                  'px-2 py-1 text-xs rounded transition-colors',
                  filter === 'errors'
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                )}
              >
                Errors
              </button>
              <div className="w-px h-4 bg-border mx-1" />
              <button
                onClick={copyLogs}
                className="p-1 hover:bg-muted rounded transition-colors"
                title="Copy logs"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={exportLogs}
                className="p-1 hover:bg-muted rounded transition-colors"
                title="Export logs"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={clearLogs}
                className="p-1 hover:bg-muted rounded transition-colors"
                title="Clear logs"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setIsVisible(false)}
                className="p-1 hover:bg-muted rounded transition-colors ml-2"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Log content */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-2 font-mono text-[11px] space-y-0.5"
            onScroll={(e) => {
              const target = e.target as HTMLDivElement;
              const isAtBottom = target.scrollHeight - target.scrollTop === target.clientHeight;
              setAutoScroll(isAtBottom);
            }}
          >
            {filteredLogs.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No logs to display. Press Ctrl+Shift+D to toggle this console.
              </div>
            ) : (
              filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-2 hover:bg-muted/30 px-2 py-0.5 rounded"
                >
                  <span className="flex-shrink-0 mt-0.5">{getLogIcon(log.type)}</span>
                  <span className="text-muted-foreground flex-shrink-0">
                    {log.timestamp.split('T')[1].split('.')[0]}
                  </span>
                  <span className={cn('flex-1 break-all', getLogColor(log.type))}>
                    {log.message}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="w-3 h-3"
                />
                Auto-scroll
              </label>
            </div>
            <div className="text-xs text-muted-foreground">
              Press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Ctrl</kbd>+
              <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Shift</kbd>+
              <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">D</kbd> to toggle
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}