/**
 * ChangeItem - Individual change display component
 *
 * Displays a single unified change with source badge, description,
 * optional diff view, and location context.
 */

import type { UnifiedChange } from '@/types/session';
import { cn } from '@/utils/cn';
import { FileText, User } from 'lucide-react';

interface ChangeItemProps {
  change: UnifiedChange;
}

export function ChangeItem({ change }: ChangeItemProps) {
  const hasContent = change.before || change.after;
  const hasDiff = change.before && change.after && change.before !== change.after;
  const isHyperlinkChange = change.category === 'hyperlink' && change.hyperlinkChange;

  return (
    <div className="group p-3 bg-muted/30 rounded-md hover:bg-muted/50 transition-colors">
      {/* Header Row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          {/* Source Badge */}
          <SourceBadge source={change.source} />

          {/* Description */}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground break-words">
              {change.description || 'Change applied'}
            </p>

            {/* Author (for Word revisions) */}
            {change.author && (
              <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                <User className="w-3 h-3" />
                <span>{change.author}</span>
                {change.date && (
                  <>
                    <span className="mx-1">-</span>
                    <span>{formatDate(change.date)}</span>
                  </>
                )}
              </div>
            )}

            {/* Location Context */}
            {change.location?.nearestHeading && (
              <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                <FileText className="w-3 h-3" />
                <span>Near: {change.location.nearestHeading}</span>
              </div>
            )}
          </div>
        </div>

        {/* Count Badge (for consolidated changes) */}
        {change.count && change.count > 1 && (
          <span className="shrink-0 px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded-full">
            {change.count} instances
          </span>
        )}
      </div>

      {/* Hyperlink Change View */}
      {isHyperlinkChange ? (
        <HyperlinkChangeView change={change.hyperlinkChange!} />
      ) : hasContent ? (
        <div className="mt-2 pl-7">
          {hasDiff ? (
            <DiffView before={change.before!} after={change.after!} />
          ) : change.before ? (
            <div className="text-xs">
              <span className="text-muted-foreground">Removed: </span>
              <span className="text-red-600 dark:text-red-400 line-through">
                {truncateText(change.before, 100)}
              </span>
            </div>
          ) : change.after ? (
            <div className="text-xs">
              <span className="text-muted-foreground">Added: </span>
              <span className="text-green-600 dark:text-green-400">
                {truncateText(change.after, 100)}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Sub-components

interface SourceBadgeProps {
  source: 'word' | 'processing';
}

function SourceBadge({ source }: SourceBadgeProps) {
  const isWord = source === 'word';

  return (
    <span
      className={cn(
        'shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded uppercase tracking-wide',
        isWord
          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
          : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
      )}
    >
      {isWord ? 'Word' : 'DocHub'}
    </span>
  );
}

interface DiffViewProps {
  before: string;
  after: string;
}

function DiffView({ before, after }: DiffViewProps) {
  return (
    <div className="space-y-1 text-xs font-mono">
      <div className="flex items-start gap-2">
        <span className="shrink-0 w-1 h-full bg-red-500 rounded-full" />
        <span className="text-red-600 dark:text-red-400 line-through break-all">
          {truncateText(before, 80)}
        </span>
      </div>
      <div className="flex items-start gap-2">
        <span className="shrink-0 w-1 h-full bg-green-500 rounded-full" />
        <span className="text-green-600 dark:text-green-400 break-all">
          {truncateText(after, 80)}
        </span>
      </div>
    </div>
  );
}

interface HyperlinkChangeViewProps {
  change: {
    urlBefore?: string;
    urlAfter?: string;
    textBefore?: string;
    textAfter?: string;
  };
}

function HyperlinkChangeView({ change }: HyperlinkChangeViewProps) {
  const urlChanged = change.urlBefore !== change.urlAfter;
  const textChanged = change.textBefore !== change.textAfter;

  return (
    <div className="mt-2 pl-7 space-y-3">
      {/* URL Change */}
      {urlChanged && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            URL
          </span>
          <div className="space-y-1 text-xs font-mono">
            {change.urlBefore && (
              <div className="flex items-start gap-2">
                <span className="shrink-0 w-1 h-full bg-red-500 rounded-full" />
                <span className="text-red-600 dark:text-red-400 line-through break-all">
                  {truncateUrl(change.urlBefore)}
                </span>
              </div>
            )}
            {change.urlAfter && (
              <div className="flex items-start gap-2">
                <span className="shrink-0 w-1 h-full bg-green-500 rounded-full" />
                <span className="text-green-600 dark:text-green-400 break-all">
                  {truncateUrl(change.urlAfter)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Text Change */}
      {textChanged && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Display Text
          </span>
          <div className="space-y-1 text-xs font-mono">
            {change.textBefore && (
              <div className="flex items-start gap-2">
                <span className="shrink-0 w-1 h-full bg-red-500 rounded-full" />
                <span className="text-red-600 dark:text-red-400 line-through break-all">
                  {truncateText(change.textBefore, 80)}
                </span>
              </div>
            )}
            {change.textAfter && (
              <div className="flex items-start gap-2">
                <span className="shrink-0 w-1 h-full bg-green-500 rounded-full" />
                <span className="text-green-600 dark:text-green-400 break-all">
                  {truncateText(change.textAfter, 80)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Utility functions

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function truncateUrl(url: string, maxLength: number = 60): string {
  if (url.length <= maxLength) return url;
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname;
    const remaining = maxLength - domain.length - 5;
    return `${domain}/...${url.slice(-Math.max(10, remaining))}`;
  } catch {
    return url.substring(0, maxLength) + '...';
  }
}
