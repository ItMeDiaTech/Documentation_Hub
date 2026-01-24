import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from './Button';
import { AlertCircle, X } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface ErrorDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentName: string;
  errors: string[];
  errorType?: 'file_locked' | 'general';
  processedAt?: Date;
}

export function ErrorDetailsDialog({
  open,
  onOpenChange,
  documentName,
  errors,
  errorType,
  processedAt,
}: ErrorDetailsDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-xs data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 z-50" />
        <Dialog.Content
          className={cn(
            'fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%]',
            'w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]',
            'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]'
          )}
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <Dialog.Title className="text-lg font-semibold text-foreground">
                Processing Error
              </Dialog.Title>
            </div>
            <Dialog.Close className="rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Dialog.Close>
          </div>

          {/* Document Info */}
          <div className="mb-4">
            <p className="font-medium text-foreground">{documentName}</p>
            {processedAt && (
              <p className="text-xs text-muted-foreground mt-1">
                {new Date(processedAt).toLocaleString()}
              </p>
            )}
          </div>

          {/* Error Type Badge */}
          <div className="mb-4">
            {errorType === 'file_locked' ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                File Locked
              </span>
            ) : (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                Error
              </span>
            )}
          </div>

          {/* Error Messages */}
          <div className="mb-4">
            <p className="text-sm font-medium text-foreground mb-2">Error Details:</p>
            <div className="max-h-48 overflow-y-auto rounded-md bg-muted/50 p-3 space-y-2">
              {errors.length > 0 ? (
                errors.map((error, index) => (
                  <p key={index} className="text-sm text-red-600 dark:text-red-400">
                    {error}
                  </p>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No error details available.</p>
              )}
            </div>
          </div>

          {/* Helpful Tip for File Locked */}
          {errorType === 'file_locked' && (
            <div className="mb-4 p-3 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                <strong>Tip:</strong> Please close the document in Microsoft Word and try processing again.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
