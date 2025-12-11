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
  const hasPropertyChange = change.propertyChange && change.propertyChange.property;
  const hasGroupedProperties = change.groupedProperties && change.groupedProperties.length > 0;

  // Detect if this is a combined "Updated" change (has both before and after)
  const isUpdatedChange = hasDiff || change.description?.toLowerCase().startsWith('updated');

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
              {/* Show Content ID in title for hyperlink changes */}
              {isHyperlinkChange && change.hyperlinkChange?.contentId && (
                <code className="ml-2 bg-primary/10 text-primary px-1.5 py-0.5 rounded text-xs font-medium">
                  {extractContentIdSuffix(change.hyperlinkChange.contentId)}
                </code>
              )}
            </p>

            {/* Affected Text - Show context of what was changed (5-8 words) */}
            {change.affectedText && !change.hyperlinkChange && !isUpdatedChange && (
              <p className="text-xs text-muted-foreground mt-1" title={change.affectedText}>
                Text: "{getContextWords(change.affectedText)}"
              </p>
            )}

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
            <UpdatedDiffView before={change.before!} after={change.after!} />
          ) : change.before ? (
            <div className="text-xs">
              <span className="text-muted-foreground">Removed: </span>
              <span className="text-red-600 dark:text-red-400 line-through">
                "{getContextWords(change.before)}"
              </span>
            </div>
          ) : change.after ? (
            <div className="text-xs">
              <span className="text-muted-foreground">Added: </span>
              <span className="text-green-600 dark:text-green-400">
                "{getContextWords(change.after)}"
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Property Change View (for single formatting change) */}
      {hasPropertyChange && !hasGroupedProperties && (
        <div className="mt-2 pl-7 text-xs">
          <span className="text-muted-foreground">Property: </span>
          <span className="font-medium">{change.propertyChange!.property}</span>
          {change.affectedText && (
            <span className="text-muted-foreground ml-1" title={change.affectedText}>
              on "{truncateText(change.affectedText, 30)}"
            </span>
          )}
          {(change.propertyChange!.oldValue || change.propertyChange!.newValue) && (
            <span className="ml-2">
              {change.propertyChange!.oldValue && (
                <span className="text-red-600 dark:text-red-400 line-through mr-1">
                  {formatPropertyValue(change.propertyChange!.oldValue)}
                </span>
              )}
              <span className="text-muted-foreground mx-1">-&gt;</span>
              {change.propertyChange!.newValue && (
                <span className="text-green-600 dark:text-green-400">
                  {formatPropertyValue(change.propertyChange!.newValue)}
                </span>
              )}
            </span>
          )}
        </div>
      )}

      {/* Grouped Property Changes View (multiple formatting changes on same text) */}
      {hasGroupedProperties && (
        <div className="mt-2 pl-7">
          <div className="text-xs text-muted-foreground mb-1">Properties changed:</div>
          <div className="space-y-1">
            {change.groupedProperties!.map((prop, idx) => (
              <div key={idx} className="text-xs flex items-center gap-2">
                <span className="text-muted-foreground">-</span>
                <span className="font-medium min-w-[100px]">{prop.property}:</span>
                {prop.oldValue && (
                  <span className="text-red-600 dark:text-red-400 line-through">
                    {formatPropertyValue(prop.oldValue)}
                  </span>
                )}
                <span className="text-muted-foreground">-&gt;</span>
                {prop.newValue && (
                  <span className="text-green-600 dark:text-green-400">
                    {formatPropertyValue(prop.newValue)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
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

interface UpdatedDiffViewProps {
  before: string;
  after: string;
}

/**
 * Shows "Updated" change with before/after in a clean format
 */
function UpdatedDiffView({ before, after }: UpdatedDiffViewProps) {
  const beforeContext = getContextWords(before);
  const afterContext = getContextWords(after);

  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground shrink-0">From:</span>
        <span className="text-red-600 dark:text-red-400 line-through break-words">
          "{beforeContext}"
        </span>
      </div>
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground shrink-0">To:</span>
        <span className="text-green-600 dark:text-green-400 break-words">
          "{afterContext}"
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
    status?: 'updated' | 'not_found' | 'expired';
    contentId?: string;
  };
}

function HyperlinkChangeView({ change }: HyperlinkChangeViewProps) {
  const urlChanged = change.urlBefore !== change.urlAfter;
  const textChanged = change.textBefore !== change.textAfter;

  return (
    <div className="mt-2 pl-7 space-y-3">
      {/* Content ID - Always shown prominently at top for identification */}
      {change.contentId && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Content ID:</span>
          <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-xs font-medium">
            {change.contentId}
          </code>
        </div>
      )}

      {/* Status Badge (for not_found or expired) */}
      {change.status && change.status !== 'updated' && (
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'px-2 py-0.5 text-xs font-medium rounded uppercase',
              change.status === 'not_found'
                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
            )}
          >
            {change.status === 'not_found' ? 'Source Not Found' : 'Source Expired'}
          </span>
        </div>
      )}

      {/* What Changed section */}
      {(urlChanged || textChanged) && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            What Changed:
          </span>

          {/* URL Change */}
          {urlChanged && (
            <div className="space-y-1 ml-2">
              <span className="text-xs text-muted-foreground">URL:</span>
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

          {/* Text to Display Change */}
          {textChanged && (
            <div className="space-y-1 ml-2">
              <span className="text-xs text-muted-foreground">Text to Display:</span>
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

/**
 * Gets a context snippet (5-8 words) from text for display
 * Provides meaningful context without overwhelming the UI
 */
function getContextWords(text: string): string {
  if (!text) return '';

  // Clean up whitespace
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  // Split into words
  const words = cleaned.split(' ').filter((w) => w.length > 0);
  if (words.length === 0) return '';

  // If 8 words or less, return as-is
  if (words.length <= 8) {
    return cleaned;
  }

  // Take first 6 words and add ellipsis
  return words.slice(0, 6).join(' ') + '...';
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

/**
 * Extract the numeric suffix from a Content ID for compact display
 * e.g., "TSRC-ABC-123456" -> "123456"
 */
function extractContentIdSuffix(contentId: string): string {
  // Try to extract the last numeric/alphanumeric segment
  const parts = contentId.split(/[-_]/);
  const lastPart = parts[parts.length - 1];
  if (lastPart && lastPart.length > 0) {
    return lastPart;
  }
  // Fallback to last 6 characters if no delimiter found
  return contentId.slice(-6);
}

/**
 * Format property values for display, handling objects that would show as [object Object]
 */
function formatPropertyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      // For complex objects, show a simplified JSON representation
      const json = JSON.stringify(value);
      // Truncate if too long
      return json.length > 50 ? json.substring(0, 47) + '...' : json;
    } catch {
      return '[complex value]';
    }
  }
  return String(value);
}
