/**
 * SideBySideDiff - GitHub/VS Code style side-by-side document comparison
 *
 * Features:
 * - Word-level diff highlighting
 * - Synchronized scrolling
 * - Line numbers on both sides
 * - Change indicators in gutter (+, -, ~)
 * - Jump to next/previous change
 * - Collapse unchanged sections
 */

import { useState, useRef, useCallback, useMemo } from 'react';
import {
  Columns,
  ChevronUp,
  ChevronDown,
  Link,
  Unlink,
  Minimize2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { generateDocumentDiff, filterChangedParagraphs } from '@/utils/diffUtils';
import type { ParagraphDiff, DiffSegment } from '@/types/editor';

interface SideBySideDiffProps {
  /** Original content (pre-processing paragraphs) */
  originalContent: string[];
  /** Modified content (post-processing paragraphs) */
  modifiedContent: string[];
  /** Enable synchronized scrolling (default: true) */
  syncScroll?: boolean;
  /** Show line numbers (default: true) */
  showLineNumbers?: boolean;
  /** Number of context lines around changes (default: 3) */
  contextLines?: number;
  /** Collapse unchanged sections (default: true) */
  collapseUnchanged?: boolean;
  /** Height of the component */
  height?: string | number;
}

/**
 * Render diff segments with appropriate styling
 */
function DiffSegments({
  segments,
  side,
}: {
  segments: DiffSegment[];
  side: 'left' | 'right';
}) {
  return (
    <>
      {segments.map((segment, idx) => {
        let className = '';

        if (segment.type === 'added') {
          className =
            'bg-green-200 dark:bg-green-900/50 text-green-800 dark:text-green-200';
        } else if (segment.type === 'removed') {
          className =
            'bg-red-200 dark:bg-red-900/50 text-red-800 dark:text-red-200 line-through';
        } else if (segment.type === 'modified') {
          className =
            'bg-yellow-200 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-200';
        }

        return (
          <span key={idx} className={className}>
            {segment.text}
          </span>
        );
      })}
    </>
  );
}

/**
 * Single diff line component
 */
function DiffLine({
  paragraphDiff,
  showLineNumbers,
  side,
  isHighlighted,
  onClick,
}: {
  paragraphDiff: ParagraphDiff;
  showLineNumbers: boolean;
  side: 'left' | 'right';
  isHighlighted: boolean;
  onClick?: () => void;
}) {
  const text = side === 'left' ? paragraphDiff.original : paragraphDiff.modified;
  const segments =
    side === 'left' ? paragraphDiff.originalSegments : paragraphDiff.modifiedSegments;

  // Determine line type
  let lineType: 'added' | 'removed' | 'modified' | 'unchanged' = 'unchanged';
  if (paragraphDiff.hasChanges) {
    if (paragraphDiff.original === '' && paragraphDiff.modified !== '') {
      lineType = side === 'right' ? 'added' : 'removed';
    } else if (paragraphDiff.original !== '' && paragraphDiff.modified === '') {
      lineType = side === 'left' ? 'removed' : 'added';
    } else {
      lineType = 'modified';
    }
  }

  // Background colors
  const bgColors = {
    added: 'bg-green-50 dark:bg-green-950/30',
    removed: 'bg-red-50 dark:bg-red-950/30',
    modified: 'bg-yellow-50 dark:bg-yellow-950/30',
    unchanged: 'bg-transparent',
  };

  // Gutter indicator
  const gutterIndicators = {
    added: <span className="text-green-600 dark:text-green-400 font-bold">+</span>,
    removed: <span className="text-red-600 dark:text-red-400 font-bold">-</span>,
    modified: <span className="text-yellow-600 dark:text-yellow-400 font-bold">~</span>,
    unchanged: <span className="text-muted-foreground">&nbsp;</span>,
  };

  // Skip empty lines for the opposite side of added/removed
  if (
    (lineType === 'added' && side === 'left') ||
    (lineType === 'removed' && side === 'right')
  ) {
    return (
      <div
        className={cn(
          'flex items-stretch min-h-[28px] border-b border-border/30',
          bgColors[lineType],
          isHighlighted && 'ring-2 ring-primary ring-inset'
        )}
        onClick={onClick}
      >
        {showLineNumbers && (
          <div className="w-12 flex-shrink-0 px-2 py-1 text-xs text-muted-foreground/50 text-right border-r border-border/30 select-none">
            -
          </div>
        )}
        <div className="w-6 flex-shrink-0 flex items-center justify-center border-r border-border/30 select-none">
          {gutterIndicators[lineType]}
        </div>
        <div className="flex-1 px-3 py-1 text-sm font-mono text-muted-foreground/50 italic">
          {/* Empty space */}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-stretch min-h-[28px] border-b border-border/30 cursor-pointer hover:bg-muted/50 transition-colors',
        bgColors[lineType],
        isHighlighted && 'ring-2 ring-primary ring-inset'
      )}
      onClick={onClick}
    >
      {/* Line number */}
      {showLineNumbers && (
        <div className="w-12 flex-shrink-0 px-2 py-1 text-xs text-muted-foreground text-right border-r border-border/30 select-none">
          {paragraphDiff.index + 1}
        </div>
      )}

      {/* Gutter indicator */}
      <div className="w-6 flex-shrink-0 flex items-center justify-center border-r border-border/30 select-none">
        {gutterIndicators[lineType]}
      </div>

      {/* Content */}
      <div className="flex-1 px-3 py-1 text-sm font-mono whitespace-pre-wrap break-words">
        {segments.length > 0 ? (
          <DiffSegments segments={segments} side={side} />
        ) : (
          <span className={lineType !== 'unchanged' ? 'opacity-50' : ''}>
            {text || '\u00A0'}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Collapsed section indicator
 */
function CollapsedSection({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-center gap-2 py-2 bg-muted/50 text-xs text-muted-foreground hover:bg-muted transition-colors border-y border-border/30"
    >
      <Minimize2 className="w-3 h-3" />
      <span>{count} unchanged paragraphs</span>
      <span className="text-primary">(click to expand)</span>
    </button>
  );
}

/**
 * Main SideBySideDiff component
 */
export function SideBySideDiff({
  originalContent,
  modifiedContent,
  syncScroll = true,
  showLineNumbers = true,
  contextLines = 3,
  collapseUnchanged = true,
  height = '400px',
}: SideBySideDiffProps) {
  const [isSyncScrollEnabled, setIsSyncScrollEnabled] = useState(syncScroll);
  const [isCollapsed, setIsCollapsed] = useState(collapseUnchanged);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [currentChangeIndex, setCurrentChangeIndex] = useState(0);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);

  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const isScrolling = useRef(false);

  // Generate diff
  const diff = useMemo(() => {
    return generateDocumentDiff(originalContent, modifiedContent);
  }, [originalContent, modifiedContent]);

  // Get changed paragraph indices for navigation
  const changedIndices = useMemo(() => {
    return diff.paragraphDiffs
      .map((p, i) => (p.hasChanges ? i : -1))
      .filter((i) => i !== -1);
  }, [diff.paragraphDiffs]);

  // Filter paragraphs based on collapse setting
  const visibleParagraphs = useMemo(() => {
    if (!isCollapsed) {
      return diff.paragraphDiffs;
    }
    return filterChangedParagraphs(diff.paragraphDiffs, contextLines);
  }, [diff.paragraphDiffs, isCollapsed, contextLines]);

  // Sync scroll handler
  const handleScroll = useCallback(
    (source: 'left' | 'right') => {
      if (!isSyncScrollEnabled || isScrolling.current) return;

      isScrolling.current = true;
      const sourceRef = source === 'left' ? leftScrollRef : rightScrollRef;
      const targetRef = source === 'left' ? rightScrollRef : leftScrollRef;

      if (sourceRef.current && targetRef.current) {
        targetRef.current.scrollTop = sourceRef.current.scrollTop;
      }

      setTimeout(() => {
        isScrolling.current = false;
      }, 50);
    },
    [isSyncScrollEnabled]
  );

  // Navigate to change
  const navigateToChange = useCallback(
    (direction: 'prev' | 'next') => {
      const newIndex =
        direction === 'next'
          ? Math.min(changedIndices.length - 1, currentChangeIndex + 1)
          : Math.max(0, currentChangeIndex - 1);

      setCurrentChangeIndex(newIndex);
      const paragraphIndex = changedIndices[newIndex];
      setHighlightedIndex(paragraphIndex);

      // Scroll to the change
      // This is a simplified version - in production, you'd scroll to the actual element
    },
    [changedIndices, currentChangeIndex]
  );

  // Stats display
  const statsText = useMemo(() => {
    const { stats } = diff;
    const parts: string[] = [];
    if (stats.changedParagraphs > 0) parts.push(`${stats.changedParagraphs} modified`);
    if (stats.addedParagraphs > 0) parts.push(`${stats.addedParagraphs} added`);
    if (stats.removedParagraphs > 0) parts.push(`${stats.removedParagraphs} removed`);
    return parts.length > 0 ? parts.join(', ') : 'No changes';
  }, [diff]);

  // Handle empty content
  if (originalContent.length === 0 && modifiedContent.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <Columns className="w-12 h-12 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No content to compare</p>
        <p className="text-xs mt-1">
          Process a document to see before/after comparison
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-muted/30 border-b border-border">
        {/* Stats */}
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">{diff.stats.totalParagraphs}</span> paragraphs |{' '}
          <span>{statsText}</span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {/* Navigation */}
          <div className="flex items-center gap-1 mr-2">
            <button
              onClick={() => navigateToChange('prev')}
              disabled={currentChangeIndex === 0 || changedIndices.length === 0}
              className="p-1 rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
              title="Previous change"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <span className="text-xs text-muted-foreground min-w-[40px] text-center">
              {changedIndices.length > 0
                ? `${currentChangeIndex + 1}/${changedIndices.length}`
                : '0/0'}
            </span>
            <button
              onClick={() => navigateToChange('next')}
              disabled={
                currentChangeIndex === changedIndices.length - 1 ||
                changedIndices.length === 0
              }
              className="p-1 rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
              title="Next change"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>

          {/* Sync scroll toggle */}
          <button
            onClick={() => setIsSyncScrollEnabled(!isSyncScrollEnabled)}
            className={cn(
              'p-1.5 rounded transition-colors',
              isSyncScrollEnabled
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted'
            )}
            title={isSyncScrollEnabled ? 'Disable sync scroll' : 'Enable sync scroll'}
          >
            {isSyncScrollEnabled ? (
              <Link className="w-4 h-4" />
            ) : (
              <Unlink className="w-4 h-4" />
            )}
          </button>

          {/* Collapse toggle */}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={cn(
              'p-1.5 rounded transition-colors',
              isCollapsed ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
            )}
            title={isCollapsed ? 'Show all' : 'Collapse unchanged'}
          >
            {isCollapsed ? (
              <Eye className="w-4 h-4" />
            ) : (
              <EyeOff className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Diff panels */}
      <div
        className="flex"
        style={{ height: typeof height === 'number' ? `${height}px` : height }}
      >
        {/* Left panel (Original) */}
        <div className="flex-1 flex flex-col border-r border-border">
          <div className="px-4 py-2 bg-red-50 dark:bg-red-950/30 border-b border-border text-sm font-medium text-red-700 dark:text-red-300">
            Original (Before)
          </div>
          <div
            ref={leftScrollRef}
            className="flex-1 overflow-auto"
            onScroll={() => handleScroll('left')}
          >
            {visibleParagraphs.map((paragraphDiff, idx) => (
              <DiffLine
                key={`left-${paragraphDiff.index}`}
                paragraphDiff={paragraphDiff}
                showLineNumbers={showLineNumbers}
                side="left"
                isHighlighted={highlightedIndex === paragraphDiff.index}
                onClick={() => setHighlightedIndex(paragraphDiff.index)}
              />
            ))}
          </div>
        </div>

        {/* Right panel (Modified) */}
        <div className="flex-1 flex flex-col">
          <div className="px-4 py-2 bg-green-50 dark:bg-green-950/30 border-b border-border text-sm font-medium text-green-700 dark:text-green-300">
            Processed (After)
          </div>
          <div
            ref={rightScrollRef}
            className="flex-1 overflow-auto"
            onScroll={() => handleScroll('right')}
          >
            {visibleParagraphs.map((paragraphDiff, idx) => (
              <DiffLine
                key={`right-${paragraphDiff.index}`}
                paragraphDiff={paragraphDiff}
                showLineNumbers={showLineNumbers}
                side="right"
                isHighlighted={highlightedIndex === paragraphDiff.index}
                onClick={() => setHighlightedIndex(paragraphDiff.index)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SideBySideDiff;
