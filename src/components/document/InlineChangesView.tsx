/**
 * InlineChangesView - Word-like inline tracked changes display
 *
 * Renders document text with tracked changes highlighted:
 * - Insertions: Green background
 * - Deletions: Red background with strikethrough
 * - Formatting changes: Blue dashed underline with tooltip
 * - Hyperlink changes: Link icon badge with URL diff tooltip
 */

import { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  FileText,
  Link2,
  Type,
  Table,
  Trash2,
  Plus,
  Edit3,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import type { ChangeEntry, UnifiedChange } from '@/types/session';
import { DEFAULT_INLINE_CHANGE_STYLES } from '@/types/editor';

interface InlineChangesViewProps {
  /** All changes from tracked changes */
  changes: ChangeEntry[];
  /** Document paragraphs (if available) */
  paragraphs?: Array<{
    text: string;
    runs?: Array<{
      text: string;
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
    }>;
  }>;
  /** Callback when a change is clicked */
  onChangeClick?: (change: ChangeEntry, index: number) => void;
  /** Current highlighted change index */
  highlightedChangeIndex?: number;
  /** Whether to use virtualization for large documents */
  virtualized?: boolean;
}

/**
 * Get icon for change type
 */
function getChangeIcon(revisionType: string) {
  switch (revisionType) {
    case 'insert':
      return Plus;
    case 'delete':
      return Trash2;
    case 'runPropertiesChange':
    case 'paragraphPropertiesChange':
      return Edit3;
    case 'hyperlinkChange':
      return Link2;
    case 'tablePropertiesChange':
    case 'tableCellPropertiesChange':
      return Table;
    default:
      return Type;
  }
}

/**
 * Get styling classes for change type
 */
function getChangeStyles(revisionType: string, isHighlighted: boolean) {
  const baseClasses = 'inline-flex items-center rounded px-1 py-0.5 transition-all';
  const highlightClasses = isHighlighted ? 'ring-2 ring-primary ring-offset-1' : '';

  switch (revisionType) {
    case 'insert':
      return cn(
        baseClasses,
        highlightClasses,
        'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
      );
    case 'delete':
      return cn(
        baseClasses,
        highlightClasses,
        'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 line-through'
      );
    case 'runPropertiesChange':
    case 'paragraphPropertiesChange':
      return cn(
        baseClasses,
        highlightClasses,
        'border-b-2 border-dashed border-blue-500 text-blue-700 dark:text-blue-300'
      );
    case 'hyperlinkChange':
      return cn(
        baseClasses,
        highlightClasses,
        'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300'
      );
    case 'tablePropertiesChange':
    case 'tableCellPropertiesChange':
      return cn(
        baseClasses,
        highlightClasses,
        'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
      );
    default:
      return cn(
        baseClasses,
        highlightClasses,
        'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
      );
  }
}

/**
 * Change badge component for inline display
 */
function ChangeBadge({
  change,
  index,
  isHighlighted,
  onClick,
}: {
  change: ChangeEntry;
  index: number;
  isHighlighted: boolean;
  onClick?: () => void;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const Icon = getChangeIcon(change.revisionType);

  const getDisplayText = () => {
    if (change.content?.affectedText) {
      return change.content.affectedText;
    }
    if (change.content?.after) {
      return change.content.after;
    }
    if (change.content?.before) {
      return change.content.before;
    }
    return change.description || 'Change';
  };

  return (
    <span className="relative inline-block">
      <span
        className={cn(getChangeStyles(change.revisionType, isHighlighted), 'cursor-pointer')}
        onClick={onClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <Icon className="w-3 h-3 mr-1 inline" />
        <span className="text-sm">{getDisplayText()}</span>
      </span>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute z-50 bottom-full left-0 mb-1 p-2 bg-popover border border-border rounded-lg shadow-lg text-xs max-w-xs">
          <div className="font-medium mb-1">{change.description}</div>
          {change.author && (
            <div className="text-muted-foreground">By: {change.author}</div>
          )}
          {change.date && (
            <div className="text-muted-foreground">
              {new Date(change.date).toLocaleString()}
            </div>
          )}
          {/* Content ID for hyperlink changes */}
          {change.content?.hyperlinkChange?.contentId && (
            <div className="mt-1 pt-1 border-t border-border">
              <span className="text-muted-foreground">Content ID:</span>{' '}
              <code className="bg-primary/10 text-primary px-1 py-0.5 rounded text-[10px]">
                {change.content.hyperlinkChange.contentId}
              </code>
            </div>
          )}
          {/* URL change for hyperlinks */}
          {change.content?.hyperlinkChange?.urlBefore && change.content?.hyperlinkChange?.urlAfter && (
            <div className="mt-1 pt-1 border-t border-border">
              <div className="text-muted-foreground mb-0.5">URL:</div>
              <div className="line-through text-red-500 break-all">
                {change.content.hyperlinkChange.urlBefore.slice(0, 60)}
                {change.content.hyperlinkChange.urlBefore.length > 60 && '...'}
              </div>
              <div className="text-green-500 break-all">
                {change.content.hyperlinkChange.urlAfter.slice(0, 60)}
                {change.content.hyperlinkChange.urlAfter.length > 60 && '...'}
              </div>
            </div>
          )}
          {/* Text to Display change for hyperlinks */}
          {change.content?.hyperlinkChange?.textBefore && change.content?.hyperlinkChange?.textAfter && (
            <div className="mt-1 pt-1 border-t border-border">
              <div className="text-muted-foreground mb-0.5">Text to Display:</div>
              <div className="line-through text-red-500">
                {change.content.hyperlinkChange.textBefore.slice(0, 50)}
                {change.content.hyperlinkChange.textBefore.length > 50 && '...'}
              </div>
              <div className="text-green-500">
                {change.content.hyperlinkChange.textAfter.slice(0, 50)}
                {change.content.hyperlinkChange.textAfter.length > 50 && '...'}
              </div>
            </div>
          )}
          {change.propertyChange && (
            <div className="mt-1 pt-1 border-t border-border">
              <span className="text-muted-foreground">{change.propertyChange.property}:</span>{' '}
              <span className="line-through text-red-500">
                {change.propertyChange.oldValue || 'none'}
              </span>{' '}
              <span className="text-green-500">
                {change.propertyChange.newValue || 'none'}
              </span>
            </div>
          )}
          {/* Generic before/after (for non-hyperlink changes) */}
          {!change.content?.hyperlinkChange && change.content?.before && change.content?.after && (
            <div className="mt-1 pt-1 border-t border-border">
              <div className="line-through text-red-500">
                {change.content.before.slice(0, 50)}
                {change.content.before.length > 50 && '...'}
              </div>
              <div className="text-green-500">
                {change.content.after.slice(0, 50)}
                {change.content.after.length > 50 && '...'}
              </div>
            </div>
          )}
        </div>
      )}
    </span>
  );
}

/**
 * Group changes by paragraph
 */
function groupChangesByParagraph(changes: ChangeEntry[]) {
  const groups = new Map<number, ChangeEntry[]>();

  for (const change of changes) {
    const paragraphIndex = change.location?.paragraphIndex ?? -1;
    if (!groups.has(paragraphIndex)) {
      groups.set(paragraphIndex, []);
    }
    groups.get(paragraphIndex)!.push(change);
  }

  // Sort by paragraph index
  return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
}

/**
 * Paragraph with inline changes
 */
function ParagraphWithChanges({
  paragraphIndex,
  paragraphText,
  changes,
  highlightedChangeIndex,
  onChangeClick,
}: {
  paragraphIndex: number;
  paragraphText?: string;
  changes: ChangeEntry[];
  highlightedChangeIndex?: number;
  onChangeClick?: (change: ChangeEntry, index: number) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  // Sort changes by run index
  const sortedChanges = useMemo(() => {
    return [...changes].sort((a, b) => {
      const aRun = a.location?.runIndex ?? 0;
      const bRun = b.location?.runIndex ?? 0;
      return aRun - bRun;
    });
  }, [changes]);

  return (
    <div className="border-b border-border/50 last:border-b-0">
      {/* Paragraph header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <span>Paragraph {paragraphIndex + 1}</span>
        <span className="ml-auto px-1.5 py-0.5 bg-muted rounded-full">
          {changes.length} {changes.length === 1 ? 'change' : 'changes'}
        </span>
      </button>

      {/* Paragraph content */}
      {isExpanded && (
        <div className="px-4 py-3 bg-muted/10">
          {paragraphText && (
            <p className="text-sm text-muted-foreground mb-2 font-mono">
              {paragraphText.slice(0, 200)}
              {paragraphText.length > 200 && '...'}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {sortedChanges.map((change, idx) => (
              <ChangeBadge
                key={`${change.id || idx}-${idx}`}
                change={change}
                index={idx}
                isHighlighted={
                  highlightedChangeIndex !== undefined &&
                  changes.indexOf(change) === highlightedChangeIndex
                }
                onClick={() => onChangeClick?.(change, idx)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Changes without paragraph location
 */
function OtherChanges({
  changes,
  highlightedChangeIndex,
  onChangeClick,
}: {
  changes: ChangeEntry[];
  highlightedChangeIndex?: number;
  onChangeClick?: (change: ChangeEntry, index: number) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (changes.length === 0) return null;

  return (
    <div className="border-b border-border/50">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <span>Document-level Changes</span>
        <span className="ml-auto px-1.5 py-0.5 bg-muted rounded-full">
          {changes.length} {changes.length === 1 ? 'change' : 'changes'}
        </span>
      </button>

      {isExpanded && (
        <div className="px-4 py-3 bg-muted/10">
          <div className="flex flex-wrap gap-2">
            {changes.map((change, idx) => (
              <ChangeBadge
                key={`other-${change.id || idx}-${idx}`}
                change={change}
                index={idx}
                isHighlighted={highlightedChangeIndex === idx}
                onClick={() => onChangeClick?.(change, idx)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Main InlineChangesView component
 */
export function InlineChangesView({
  changes,
  paragraphs,
  onChangeClick,
  highlightedChangeIndex,
  virtualized = false,
}: InlineChangesViewProps) {
  // Group changes by paragraph
  const groupedChanges = useMemo(() => groupChangesByParagraph(changes), [changes]);

  // Separate paragraph changes from document-level changes
  const paragraphChanges = groupedChanges.filter(([index]) => index >= 0);
  const otherChanges = groupedChanges.find(([index]) => index === -1)?.[1] || [];

  // Statistics
  const stats = useMemo(() => {
    const insertions = changes.filter((c) => c.revisionType === 'insert').length;
    const deletions = changes.filter((c) => c.revisionType === 'delete').length;
    const formatting = changes.filter(
      (c) =>
        c.revisionType === 'runPropertiesChange' ||
        c.revisionType === 'paragraphPropertiesChange'
    ).length;
    const hyperlinks = changes.filter((c) => c.revisionType === 'hyperlinkChange').length;

    return { insertions, deletions, formatting, hyperlinks };
  }, [changes]);

  if (changes.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No tracked changes to display</p>
        <p className="text-xs mt-1">Process a document to see tracked changes here</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Statistics bar */}
      <div className="flex items-center gap-4 px-4 py-2 bg-muted/30 border-b border-border text-xs">
        <span className="text-muted-foreground">Changes:</span>
        {stats.insertions > 0 && (
          <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
            <Plus className="w-3 h-3" />
            {stats.insertions} inserted
          </span>
        )}
        {stats.deletions > 0 && (
          <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
            <Trash2 className="w-3 h-3" />
            {stats.deletions} deleted
          </span>
        )}
        {stats.formatting > 0 && (
          <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
            <Type className="w-3 h-3" />
            {stats.formatting} formatted
          </span>
        )}
        {stats.hyperlinks > 0 && (
          <span className="flex items-center gap-1 text-cyan-600 dark:text-cyan-400">
            <Link2 className="w-3 h-3" />
            {stats.hyperlinks} links
          </span>
        )}
      </div>

      {/* Changes by paragraph */}
      <div className="divide-y divide-border/50">
        {paragraphChanges.map(([paragraphIndex, paragraphChangesList]) => (
          <ParagraphWithChanges
            key={`para-${paragraphIndex}`}
            paragraphIndex={paragraphIndex}
            paragraphText={paragraphs?.[paragraphIndex]?.text}
            changes={paragraphChangesList}
            highlightedChangeIndex={highlightedChangeIndex}
            onChangeClick={onChangeClick}
          />
        ))}

        {/* Document-level changes */}
        <OtherChanges
          changes={otherChanges}
          highlightedChangeIndex={highlightedChangeIndex}
          onChangeClick={onChangeClick}
        />
      </div>
    </div>
  );
}

export default InlineChangesView;
