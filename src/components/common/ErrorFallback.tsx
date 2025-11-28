/**
 * Error Fallback UI Component
 *
 * Displays when an error is caught by the ErrorBoundary.
 * Provides error details and recovery options.
 */

import React, { ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw, Home, Bug } from 'lucide-react';
import { Button } from './Button';
import logger from '@/utils/logger';

interface ErrorFallbackProps {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  onReset?: () => void;
}

export function ErrorFallback({ error, errorInfo, onReset }: ErrorFallbackProps) {
  const handleReload = () => {
    window.location.reload();
  };

  const handleGoHome = () => {
    // HASH ROUTER FIX: Use hash-based navigation for Electron app
    // window.location.href = '/' doesn't work with createHashRouter
    window.location.hash = '#/';
    window.location.reload();
  };

  const handleReportBug = () => {
    // In production, this could open a bug report dialog or navigate to a support page
    const errorDetails = {
      error: error?.toString(),
      stack: error?.stack,
      componentStack: errorInfo?.componentStack,
    };

    logger.debug('Bug Report Details:', errorDetails);
    // You could integrate with your bug tracking system here
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-2xl rounded-lg border border-destructive/20 bg-card p-8 shadow-lg">
        {/* Header */}
        <div className="mb-6 flex items-start gap-4">
          <div className="rounded-full bg-destructive/10 p-3">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-foreground">Oops! Something went wrong</h1>
            <p className="mt-2 text-muted-foreground">
              The application encountered an unexpected error. Don't worry, your data is safe.
            </p>
          </div>
        </div>

        {/* Error Details (collapsible) */}
        {error && (
          <details className="mb-6 rounded-md border border-border bg-muted/30 p-4">
            <summary className="cursor-pointer font-medium text-foreground">Error Details</summary>
            <div className="mt-3 space-y-2">
              <div className="rounded bg-destructive/5 p-3">
                <p className="text-sm font-mono text-destructive">{error.toString()}</p>
              </div>
              {error.stack && (
                <div className="max-h-48 overflow-y-auto rounded bg-muted p-3">
                  <pre className="text-xs text-muted-foreground">{error.stack}</pre>
                </div>
              )}
              {errorInfo?.componentStack && (
                <div className="max-h-48 overflow-y-auto rounded bg-muted p-3">
                  <p className="mb-2 text-xs font-semibold text-foreground">Component Stack:</p>
                  <pre className="text-xs text-muted-foreground">{errorInfo.componentStack}</pre>
                </div>
              )}
            </div>
          </details>
        )}

        {/* Recovery Actions */}
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">What would you like to do?</p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {onReset && (
              <Button onClick={onReset} variant="outline" className="w-full">
                <RefreshCw className="mr-2 h-4 w-4" />
                Try Again
              </Button>
            )}

            <Button onClick={handleReload} variant="default" className="w-full">
              <RefreshCw className="mr-2 h-4 w-4" />
              Reload Application
            </Button>

            <Button onClick={handleGoHome} variant="outline" className="w-full">
              <Home className="mr-2 h-4 w-4" />
              Go to Dashboard
            </Button>

            <Button onClick={handleReportBug} variant="outline" className="w-full">
              <Bug className="mr-2 h-4 w-4" />
              Report Issue
            </Button>
          </div>
        </div>

        {/* Additional Help */}
        <div className="mt-6 rounded-md bg-muted/50 p-4">
          <p className="text-sm text-muted-foreground">
            <strong>Tip:</strong> If this error persists, try restarting the application or clearing
            your browser cache. Your session data is automatically saved.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Context-specific Error Fallback
 *
 * A simplified error fallback for context provider errors.
 * Shows which context failed and provides recovery options.
 */
interface ContextErrorFallbackProps {
  context: 'theme' | 'settings' | 'stats' | 'session';
  error?: Error | null;
}

const contextInfo: Record<string, { name: string; description: string }> = {
  theme: {
    name: 'Theme System',
    description: 'Unable to load theme settings. The application will use default styling.',
  },
  settings: {
    name: 'User Settings',
    description: 'Unable to load your preferences. Default settings will be used.',
  },
  stats: {
    name: 'Statistics',
    description: 'Unable to load statistics data. Your session data is still safe.',
  },
  session: {
    name: 'Session Manager',
    description: 'Unable to load session data. Please try reloading the application.',
  },
};

export function ContextErrorFallback({ context, error }: ContextErrorFallbackProps) {
  const info = contextInfo[context] || { name: 'Unknown', description: 'An error occurred.' };

  const handleReload = () => {
    window.location.reload();
  };

  const handleClearAndReload = () => {
    // Clear potentially corrupted data for this context
    if (context === 'theme') {
      localStorage.removeItem('theme');
      localStorage.removeItem('density');
      localStorage.removeItem('accentColor');
    } else if (context === 'settings') {
      localStorage.removeItem('userSettings');
    } else if (context === 'stats') {
      // Stats are in IndexedDB, just reload
    } else if (context === 'session') {
      localStorage.removeItem('sessions-emergency-backup');
    }
    window.location.reload();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 dark:bg-gray-900 p-4">
      <div className="w-full max-w-md rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-gray-800 p-6 shadow-lg">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="h-6 w-6 text-red-500" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {info.name} Error
          </h2>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">{info.description}</p>

        {error && (
          <details className="mb-4 rounded border border-gray-200 dark:border-gray-700 p-2">
            <summary className="cursor-pointer text-sm text-gray-500 dark:text-gray-400">
              Technical Details
            </summary>
            <pre className="mt-2 text-xs text-red-600 dark:text-red-400 overflow-auto max-h-32">
              {error.message}
            </pre>
          </details>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleReload}
            className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm font-medium"
          >
            Reload App
          </button>
          <button
            onClick={handleClearAndReload}
            className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-sm font-medium"
          >
            Reset & Reload
          </button>
        </div>
      </div>
    </div>
  );
}

export default ErrorFallback;
