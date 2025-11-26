/**
 * RevisionHandlingOptions - Controls for Word tracked changes handling
 *
 * All DocHub modifications are automatically tracked as Word revisions.
 * This component provides the option to auto-accept revisions for clean output.
 */

import { cn } from '@/utils/cn';
import { Check, FileText, GitBranch } from 'lucide-react';

interface RevisionHandlingOptionsProps {
  autoAccept: boolean;
  onAutoAcceptChange: (autoAccept: boolean) => void;
  disabled?: boolean;
}

export function RevisionHandlingOptions({
  autoAccept,
  onAutoAcceptChange,
  disabled = false,
}: RevisionHandlingOptionsProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <GitBranch className="w-4 h-4 text-muted-foreground" />
        <span className="font-medium">Track Changes</span>
      </div>

      <div className="p-3 bg-muted/30 rounded-lg border border-border">
        <div className="flex items-start gap-2">
          <FileText className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium">All changes are tracked</p>
            <p className="text-xs text-muted-foreground mt-1">
              DocHub tracks all modifications as Word tracked changes.
              You can view these changes in the Document Changes tab and in Microsoft Word.
            </p>
          </div>
        </div>
      </div>

      <label
        className={cn(
          'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
          autoAccept
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary/50 hover:bg-muted/50',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <div className="relative mt-0.5">
          <input
            type="checkbox"
            checked={autoAccept}
            onChange={(e) => onAutoAcceptChange(e.target.checked)}
            disabled={disabled}
            className="sr-only"
          />
          <div
            className={cn(
              'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
              autoAccept
                ? 'bg-primary border-primary'
                : 'border-muted-foreground/50'
            )}
          >
            {autoAccept && <Check className="w-3 h-3 text-primary-foreground" />}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">Auto-accept revisions</span>
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 rounded">
              Recommended
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            Creates a clean document without visible tracked changes.
            Changes are still recorded in DocHub for review.
          </p>
        </div>
      </label>

      {!autoAccept && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Note: When disabled, tracked changes will be visible when the document is opened in Microsoft Word.
        </p>
      )}
    </div>
  );
}
