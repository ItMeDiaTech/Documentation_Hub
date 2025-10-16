/**
 * Error Fallback UI Component
 *
 * Displays when an error is caught by the ErrorBoundary.
 * Provides error details and recovery options.
 */

import React, { ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw, Home, Bug } from 'lucide-react';
import { Button } from './Button';

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
    window.location.href = '/';
  };

  const handleReportBug = () => {
    // In production, this could open a bug report dialog or navigate to a support page
    const errorDetails = {
      error: error?.toString(),
      stack: error?.stack,
      componentStack: errorInfo?.componentStack,
    };

    console.log('Bug Report Details:', errorDetails);
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
            <h1 className="text-2xl font-bold text-foreground">
              Oops! Something went wrong
            </h1>
            <p className="mt-2 text-muted-foreground">
              The application encountered an unexpected error. Don't worry, your data is safe.
            </p>
          </div>
        </div>

        {/* Error Details (collapsible) */}
        {error && (
          <details className="mb-6 rounded-md border border-border bg-muted/30 p-4">
            <summary className="cursor-pointer font-medium text-foreground">
              Error Details
            </summary>
            <div className="mt-3 space-y-2">
              <div className="rounded bg-destructive/5 p-3">
                <p className="text-sm font-mono text-destructive">
                  {error.toString()}
                </p>
              </div>
              {error.stack && (
                <div className="max-h-48 overflow-y-auto rounded bg-muted p-3">
                  <pre className="text-xs text-muted-foreground">
                    {error.stack}
                  </pre>
                </div>
              )}
              {errorInfo?.componentStack && (
                <div className="max-h-48 overflow-y-auto rounded bg-muted p-3">
                  <p className="mb-2 text-xs font-semibold text-foreground">
                    Component Stack:
                  </p>
                  <pre className="text-xs text-muted-foreground">
                    {errorInfo.componentStack}
                  </pre>
                </div>
              )}
            </div>
          </details>
        )}

        {/* Recovery Actions */}
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            What would you like to do?
          </p>

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
            <strong>Tip:</strong> If this error persists, try restarting the application or
            clearing your browser cache. Your session data is automatically saved.
          </p>
        </div>
      </div>
    </div>
  );
}

export default ErrorFallback;
