/**
 * ChangeViewer - Unified viewer for Word revisions and DocHub processing changes
 *
 * Displays both Word tracked changes (from docxmlater) and DocHub processing changes
 * in a unified, filterable interface with export capabilities.
 */

import { Button } from '@/components/common/Button';
import { useSession } from '@/contexts/SessionContext';
import type {
  ChangeCategory,
  ChangeEntry,
  Document,
  PreviousRevisionState,
  UnifiedChange,
} from '@/types/session';
import { cn } from '@/utils/cn';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bookmark,
  Box,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Columns,
  FileText,
  Filter,
  Hash,
  History,
  Image,
  Link,
  MessageCircle,
  Minus,
  Paintbrush,
  Plus,
  Settings,
  Table,
  User,
  X,
} from 'lucide-react';
import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { ChangeItem } from './ChangeItem';
// DEFERRED: Side-by-side document comparison feature for future implementation
// import { DocumentComparisonModal } from './DocumentComparisonModal';

interface ChangeViewerProps {
  sessionId: string;
  expandDocumentId?: string | null;
  onExpandHandled?: () => void;
}

type SourceFilter = 'all' | 'word' | 'processing';
type CategoryFilter = 'all' | ChangeCategory;

/**
 * Converts Word revision entries to unified format
 * All changes (both original Word changes and DocHub changes) come from wordRevisions.entries
 * DocHub changes are identified by matching the processingAuthor from the document
 */
function getUnifiedChanges(document: Document): UnifiedChange[] {
  if (!document.wordRevisions?.entries) {
    return [];
  }

  // Get the processing author used for this document's DocHub changes
  // This allows proper source detection regardless of the actual author name used
  const processingAuthor = document.wordRevisions.processingAuthor;

  const rawChanges = document.wordRevisions.entries.map((entry: ChangeEntry) => ({
    id: entry.id,
    // Distinguish source by comparing to the actual processing author, not a hardcoded string
    source: processingAuthor && entry.author === processingAuthor
      ? ('processing' as const)
      : ('word' as const),
    category: entry.category,
    description: entry.description,
    author: entry.author,
    date: entry.date,
    location: entry.location
      ? {
          paragraphIndex: entry.location.paragraphIndex,
          nearestHeading: entry.location.nearestHeading,
        }
      : undefined,
    before: entry.content?.before,
    after: entry.content?.after,
    // Extract affected text: prefer explicit affectedText, fallback to before/after content
    affectedText: entry.content?.affectedText || entry.content?.before || entry.content?.after,
    hyperlinkChange: entry.content?.hyperlinkChange,
    propertyChange: entry.propertyChange,
  }));

  // Apply processing pipeline:
  // 1. Filter out unhelpful changes (empty spaces, etc.)
  // 2. Combine delete+insert pairs into "Updated" changes
  // 3. Group formatting changes that affect the same text
  const filtered = rawChanges.filter(isHelpfulChange);
  const combined = combineDeleteInsertPairs(filtered);
  return groupPropertyChanges(combined);
}

/**
 * Gets pre-existing tracked changes that were in the document BEFORE DocHub processing
 * These are stored separately in document.previousRevisions
 */
function getPreviousChanges(document: Document): UnifiedChange[] {
  if (!document.previousRevisions?.entries || document.previousRevisions.entries.length === 0) {
    return [];
  }

  const rawChanges = document.previousRevisions.entries.map((entry: ChangeEntry) => ({
    id: `previous-${entry.id}`,
    // All previous changes are marked as 'word' source since they came from Word before DocHub
    source: 'word' as const,
    category: entry.category,
    description: entry.description,
    author: entry.author,
    date: entry.date,
    location: entry.location
      ? {
          paragraphIndex: entry.location.paragraphIndex,
          nearestHeading: entry.location.nearestHeading,
        }
      : undefined,
    before: entry.content?.before,
    after: entry.content?.after,
    affectedText: entry.content?.affectedText || entry.content?.before || entry.content?.after,
    hyperlinkChange: entry.content?.hyperlinkChange,
    propertyChange: entry.propertyChange,
  }));

  // Apply processing pipeline:
  // 1. Filter out unhelpful changes (empty spaces, etc.)
  // 2. Combine delete+insert pairs into "Updated" changes
  // 3. Group formatting changes that affect the same text
  const filtered = rawChanges.filter(isHelpfulChange);
  const combined = combineDeleteInsertPairs(filtered);
  return groupPropertyChanges(combined);
}

/**
 * Filters out unhelpful/trivial changes that don't provide meaningful context
 * Examples: empty spaces, whitespace-only insertions/deletions
 */
function isHelpfulChange(change: UnifiedChange): boolean {
  // Always keep hyperlink changes - they're meaningful
  if (change.hyperlinkChange) {
    return true;
  }

  // Always keep property/formatting changes
  if (change.propertyChange) {
    return true;
  }

  // Check if content is meaningful
  const beforeTrimmed = change.before?.trim() || '';
  const afterTrimmed = change.after?.trim() || '';
  const affectedTrimmed = change.affectedText?.trim() || '';

  // Skip if all content fields are empty/whitespace
  if (!beforeTrimmed && !afterTrimmed && !affectedTrimmed) {
    return false;
  }

  // Skip changes that are just single spaces or very short whitespace
  if (
    (beforeTrimmed.length === 0 && afterTrimmed.length <= 1) ||
    (afterTrimmed.length === 0 && beforeTrimmed.length <= 1)
  ) {
    // Allow if it's part of a larger description that's meaningful
    const desc = change.description?.toLowerCase() || '';
    if (desc.includes('inserted " "') || desc.includes('deleted " "') ||
        desc.includes("inserted ' '") || desc.includes("deleted ' '")) {
      return false;
    }
  }

  return true;
}

/**
 * Combines deletion + insertion pairs at the same location into "Updated" changes
 * This provides cleaner display when text is replaced rather than showing separate delete/insert
 */
function combineDeleteInsertPairs(changes: UnifiedChange[]): UnifiedChange[] {
  const result: UnifiedChange[] = [];
  const processed = new Set<string>();

  // Collect all deletions and insertions for potential pairing
  const deletions: UnifiedChange[] = [];
  const insertions: UnifiedChange[] = [];

  for (const change of changes) {
    // Only consider content changes for pairing
    if (change.category === 'content') {
      const isDeletion = change.before && !change.after;
      const isInsertion = change.after && !change.before;

      if (isDeletion) {
        deletions.push(change);
        continue;
      }
      if (isInsertion) {
        insertions.push(change);
        continue;
      }
    }

    // Non-pairable changes go directly to result
    result.push(change);
  }

  // Try to pair deletions with insertions using multiple matching strategies
  for (const deletion of deletions) {
    if (processed.has(deletion.id)) continue;

    let matchingInsertion: UnifiedChange | null = null;
    let bestScore = 0;

    for (const insertion of insertions) {
      if (processed.has(insertion.id)) continue;

      // Must have same source and author to be paired
      if (deletion.source !== insertion.source) continue;
      if (deletion.author !== insertion.author) continue;

      let score = 0;

      // Strategy 1: Same paragraph index (strongest signal)
      const delPara = deletion.location?.paragraphIndex ?? -1;
      const insPara = insertion.location?.paragraphIndex ?? -1;
      if (delPara >= 0 && insPara >= 0) {
        if (delPara === insPara) {
          score += 10;
        } else if (Math.abs(delPara - insPara) <= 1) {
          score += 5;
        } else if (Math.abs(delPara - insPara) <= 3) {
          score += 2;
        }
      }

      // Strategy 2: Same nearest heading (strong signal)
      const delHeading = deletion.location?.nearestHeading;
      const insHeading = insertion.location?.nearestHeading;
      if (delHeading && insHeading && delHeading === insHeading) {
        score += 8;
      }

      // Strategy 3: Same or similar text content (very strong signal)
      const delText = deletion.before?.trim().toLowerCase() || '';
      const insText = insertion.after?.trim().toLowerCase() || '';
      if (delText && insText) {
        if (delText === insText) {
          // Exact same text deleted and inserted - definitely a pair
          score += 15;
        } else if (delText.includes(insText) || insText.includes(delText)) {
          // One contains the other - likely a pair
          score += 7;
        }
      }

      // Require minimum score to consider it a match
      if (score > bestScore && score >= 5) {
        bestScore = score;
        matchingInsertion = insertion;
      }
    }

    if (matchingInsertion) {
      // Combine into "Updated" change
      processed.add(deletion.id);
      processed.add(matchingInsertion.id);

      // Create context from before/after content
      const beforeText = deletion.before || '';
      const afterText = matchingInsertion.after || '';
      const contextWords = getContextSnippet(beforeText, afterText);

      result.push({
        id: `updated-${deletion.id}`,
        source: deletion.source,
        category: 'content',
        description: `Updated${contextWords ? `: "${contextWords}"` : ''}`,
        author: deletion.author,
        date: deletion.date || matchingInsertion.date,
        location: deletion.location,
        before: beforeText,
        after: afterText,
        affectedText: beforeText || afterText,
      });
    } else {
      // No matching insertion - keep as deletion
      result.push(deletion);
      processed.add(deletion.id);
    }
  }

  // Add remaining unpaired insertions
  for (const insertion of insertions) {
    if (!processed.has(insertion.id)) {
      result.push(insertion);
      processed.add(insertion.id);
    }
  }

  return result;
}

/**
 * Extracts a context snippet (5-8 words) from text for display
 */
function getContextSnippet(before: string, after: string): string {
  const text = after || before || '';
  if (!text) return '';

  // Clean up the text
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  // Split into words and take up to 8 words
  const words = cleaned.split(' ').filter(w => w.length > 0);
  if (words.length === 0) return '';

  if (words.length <= 8) {
    return cleaned;
  }

  // Take first 5-8 words and add ellipsis
  return words.slice(0, 6).join(' ') + '...';
}

/**
 * Groups multiple property changes on the same text into a single change entry
 * This consolidates entries like: "Changed alignment", "Changed spacing.before", "Changed size"
 * for the same "Part 1" text into one entry with groupedProperties
 *
 * Also consolidates duplicate entries (same description, author, affected text)
 */
function groupPropertyChanges(changes: UnifiedChange[]): UnifiedChange[] {
  const result: UnifiedChange[] = [];
  const formattingByKey = new Map<string, UnifiedChange[]>();
  const duplicatesByKey = new Map<string, UnifiedChange[]>();

  for (const change of changes) {
    // Group formatting changes with propertyChange and affectedText
    if (
      change.category === 'formatting' &&
      change.propertyChange?.property &&
      change.affectedText
    ) {
      // Create a grouping key based on text, source, author, AND location
      // This ensures changes at different paragraphs are NOT incorrectly consolidated
      const locationKey = change.location?.paragraphIndex ?? 'unknown';
      const key = `${change.affectedText}|${change.source}|${change.author || ''}|${locationKey}`;

      if (!formattingByKey.has(key)) {
        formattingByKey.set(key, []);
      }
      formattingByKey.get(key)!.push(change);
    }
    // Also consolidate duplicate entries (same description, author, affected text, AND location)
    else if (change.affectedText && change.description) {
      const locationKey = change.location?.paragraphIndex ?? 'unknown';
      const key = `${change.description}|${change.affectedText}|${change.source}|${change.author || ''}|${locationKey}`;

      if (!duplicatesByKey.has(key)) {
        duplicatesByKey.set(key, []);
      }
      duplicatesByKey.get(key)!.push(change);
    } else {
      // Non-groupable changes go directly to result
      result.push(change);
    }
  }

  // Process grouped formatting changes (with propertyChange)
  for (const [, groupedChanges] of formattingByKey) {
    if (groupedChanges.length === 1) {
      // Single change - no grouping needed
      result.push(groupedChanges[0]);
    } else {
      // Multiple changes - create a grouped entry
      const first = groupedChanges[0];
      const groupedProperties = groupedChanges.map((c) => ({
        property: c.propertyChange!.property,
        oldValue: c.propertyChange!.oldValue,
        newValue: c.propertyChange!.newValue,
      }));

      result.push({
        id: first.id,
        source: first.source,
        category: first.category,
        description: `Changed ${groupedChanges.length} formatting properties`,
        author: first.author,
        date: first.date,
        location: first.location,
        affectedText: first.affectedText,
        count: groupedChanges.length,
        groupedProperties,
      });
    }
  }

  // Process duplicate entries (same description/affectedText but no propertyChange)
  for (const [, groupedChanges] of duplicatesByKey) {
    if (groupedChanges.length === 1) {
      result.push(groupedChanges[0]);
    } else {
      // Consolidate duplicates - show count
      const first = groupedChanges[0];
      result.push({
        ...first,
        count: groupedChanges.length,
        description: first.description,
      });
    }
  }

  return result;
}

/**
 * Category display configuration
 */
const categoryConfig: Record<
  ChangeCategory,
  { label: string; icon: typeof Plus; color: string }
> = {
  content: { label: 'Content', icon: FileText, color: 'text-blue-500' },
  formatting: { label: 'Formatting', icon: Paintbrush, color: 'text-purple-500' },
  structural: { label: 'Structural', icon: Settings, color: 'text-orange-500' },
  table: { label: 'Table', icon: Table, color: 'text-green-500' },
  hyperlink: { label: 'Hyperlinks', icon: Link, color: 'text-cyan-500' },
  image: { label: 'Images', icon: Image, color: 'text-pink-500' },
  field: { label: 'Fields', icon: Hash, color: 'text-yellow-500' },
  comment: { label: 'Comments', icon: MessageCircle, color: 'text-indigo-500' },
  bookmark: { label: 'Bookmarks', icon: Bookmark, color: 'text-red-500' },
  contentControl: { label: 'Content Controls', icon: Box, color: 'text-teal-500' },
};

export function ChangeViewer({ sessionId, expandDocumentId, onExpandHandled }: ChangeViewerProps) {
  const { sessions } = useSession();
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [authorFilter, setAuthorFilter] = useState<string>('all');
  const [showAuthorDropdown, setShowAuthorDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);
  const authorDropdownRef = useRef<HTMLDivElement>(null);
  // DEFERRED: Compare Documents modal state
  // const [showComparisonModal, setShowComparisonModal] = useState(false);

  // Handle external expand request (from double-click on document)
  useEffect(() => {
    if (expandDocumentId) {
      // Expand only the requested document, collapse others
      setExpandedDocs(new Set([expandDocumentId]));
      onExpandHandled?.();
    }
  }, [expandDocumentId, onExpandHandled]);

  // Get the current session
  const session = sessions.find((s) => s.id === sessionId);

  // Get all changes from all documents (DocHub processing changes)
  const documentChanges = useMemo(() => {
    if (!session) return [];

    return session.documents
      .filter((doc) => doc.status === 'completed')
      .map((doc) => ({
        document: doc,
        changes: getUnifiedChanges(doc),
      }))
      .filter((item) => item.changes.length > 0);
  }, [session]);

  // Get previous tracked changes (pre-existing changes from before DocHub processing)
  const previousChanges = useMemo(() => {
    if (!session) return [];

    return session.documents
      .filter((doc) => doc.status === 'completed')
      .map((doc) => ({
        document: doc,
        changes: getPreviousChanges(doc),
      }))
      .filter((item) => item.changes.length > 0);
  }, [session]);

  // Check if there are any previous changes to display
  const hasPreviousChanges = previousChanges.length > 0;
  const totalPreviousChanges = previousChanges.reduce((acc, item) => acc + item.changes.length, 0);

  // Calculate summary statistics
  const stats = useMemo(() => {
    const allChanges = documentChanges.flatMap((d) => d.changes);
    return {
      total: allChanges.length,
      insertions: allChanges.filter(
        (c) => c.category === 'content' && c.after && !c.before
      ).length,
      deletions: allChanges.filter(
        (c) => c.category === 'content' && c.before && !c.after
      ).length,
      formatting: allChanges.filter((c) => c.category === 'formatting').length,
      structural: allChanges.filter((c) => c.category === 'structural').length,
      table: allChanges.filter((c) => c.category === 'table').length,
      hyperlink: allChanges.filter((c) => c.category === 'hyperlink').length,
      wordRevisions: allChanges.filter((c) => c.source === 'word').length,
      processingChanges: allChanges.filter((c) => c.source === 'processing').length,
    };
  }, [documentChanges]);

  // Extract unique authors from all changes
  const uniqueAuthors = useMemo(() => {
    const allChanges = documentChanges.flatMap((d) => d.changes);
    const authors = new Set<string>();
    allChanges.forEach((change) => {
      if (change.author) {
        authors.add(change.author);
      }
    });
    return Array.from(authors).sort();
  }, [documentChanges]);

  // Close author dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (authorDropdownRef.current && !authorDropdownRef.current.contains(event.target as Node)) {
        setShowAuthorDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter changes based on current filters
  const filteredDocumentChanges = useMemo(() => {
    return documentChanges.map((item) => ({
      ...item,
      changes: item.changes.filter((change) => {
        // Source filter
        if (sourceFilter !== 'all' && change.source !== sourceFilter) return false;
        // Category filter
        if (categoryFilter !== 'all' && change.category !== categoryFilter) return false;
        // Author filter
        if (authorFilter !== 'all' && change.author !== authorFilter) return false;
        // Search filter
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          const matchesDescription = change.description?.toLowerCase().includes(query);
          const matchesBefore = change.before?.toLowerCase().includes(query);
          const matchesAfter = change.after?.toLowerCase().includes(query);
          if (!matchesDescription && !matchesBefore && !matchesAfter) return false;
        }
        return true;
      }),
    })).filter((item) => item.changes.length > 0);
  }, [documentChanges, sourceFilter, categoryFilter, authorFilter, searchQuery]);

  // Group changes by category within each document
  const groupedDocumentChanges = useMemo(() => {
    return filteredDocumentChanges.map((item) => {
      const grouped: Record<ChangeCategory, UnifiedChange[]> = {
        content: [],
        formatting: [],
        structural: [],
        table: [],
        hyperlink: [],
        image: [],
        field: [],
        comment: [],
        bookmark: [],
        contentControl: [],
      };
      item.changes.forEach((change) => {
        grouped[change.category].push(change);
      });
      return {
        document: item.document,
        grouped,
        total: item.changes.length,
      };
    });
  }, [filteredDocumentChanges]);

  // Toggle document expansion
  const toggleDocument = useCallback((docId: string) => {
    setExpandedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  }, []);

  // Export changes as markdown
  const exportAsMarkdown = useCallback(() => {
    let markdown = '# Document Changes\n\n';

    filteredDocumentChanges.forEach((item) => {
      markdown += `## ${item.document.name}\n\n`;

      // Group by category
      const grouped: Record<ChangeCategory, UnifiedChange[]> = {
        content: [],
        formatting: [],
        structural: [],
        table: [],
        hyperlink: [],
        image: [],
        field: [],
        comment: [],
        bookmark: [],
        contentControl: [],
      };
      item.changes.forEach((change) => {
        grouped[change.category].push(change);
      });

      (Object.keys(grouped) as ChangeCategory[]).forEach((category) => {
        const changes = grouped[category];
        if (changes.length === 0) return;

        markdown += `### ${categoryConfig[category].label} Changes\n\n`;
        changes.forEach((change) => {
          markdown += `- ${change.description}`;
          if (change.source === 'word' && change.author) {
            markdown += ` (by ${change.author})`;
          }
          // Include the affected text for context
          if (change.affectedText) {
            markdown += `\n  - Text: "${change.affectedText}"`;
          }
          if (change.before && change.after) {
            markdown += `\n  - Before: \`${change.before}\`\n  - After: \`${change.after}\``;
          }
          markdown += '\n';
        });
        markdown += '\n';
      });
    });

    // Copy to clipboard
    navigator.clipboard.writeText(markdown).then(() => {
      setCopiedToClipboard(true);
      setTimeout(() => setCopiedToClipboard(false), 2000);
    });
  }, [filteredDocumentChanges]);

  // Empty state - only show if there are no DocHub changes AND no previous changes
  if (documentChanges.length === 0 && !hasPreviousChanges) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <FileText className="w-12 h-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">No Changes to Display</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Process documents to see tracked changes here. Both Word tracked changes
          and DocHub processing changes will be displayed.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with Summary Stats - only show if there are DocHub changes */}
      {documentChanges.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Document Changes</h3>
              <p className="text-sm text-muted-foreground">
                {stats.total} total changes across {documentChanges.length} document(s)
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* DEFERRED: Compare Documents feature - Side-by-side comparison for future implementation
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowComparisonModal(true)}
                className="gap-2"
                disabled={documentChanges.length === 0}
                title="Compare original vs processed documents"
              >
                <Columns className="w-4 h-4" />
                Compare Documents
              </Button>
              */}
              <Button
                variant="outline"
                size="sm"
                onClick={exportAsMarkdown}
                className="gap-2"
              >
                <ClipboardCopy className="w-4 h-4" />
                {copiedToClipboard ? 'Copied!' : 'Copy Markdown'}
              </Button>
            </div>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            <StatBadge
              icon={Plus}
              label="Insertions"
              count={stats.insertions}
              color="text-green-500"
            />
            <StatBadge
              icon={Minus}
              label="Deletions"
              count={stats.deletions}
              color="text-red-500"
            />
            <StatBadge
              icon={Paintbrush}
              label="Formatting"
              count={stats.formatting}
              color="text-purple-500"
            />
            <StatBadge
              icon={Settings}
              label="Structural"
              count={stats.structural}
              color="text-orange-500"
            />
            <StatBadge
              icon={FileText}
              label="Word"
              count={stats.wordRevisions}
              color="text-blue-500"
            />
            <StatBadge
              icon={Settings}
              label="Processing"
              count={stats.processingChanges}
              color="text-gray-500"
            />
          </div>
        </>
      )}

      {/* Filter Controls - only show if there are DocHub changes */}
      {documentChanges.length > 0 && (
      <div className="flex flex-wrap items-center gap-3 p-3 bg-muted/50 rounded-lg">
        <Filter className="w-4 h-4 text-muted-foreground" />

        {/* Source Filter */}
        <div className="flex items-center gap-1">
          <span className="text-sm text-muted-foreground mr-1">Source:</span>
          <FilterButton
            active={sourceFilter === 'all'}
            onClick={() => setSourceFilter('all')}
          >
            All
          </FilterButton>
          <FilterButton
            active={sourceFilter === 'word'}
            onClick={() => setSourceFilter('word')}
          >
            Word
          </FilterButton>
          <FilterButton
            active={sourceFilter === 'processing'}
            onClick={() => setSourceFilter('processing')}
          >
            DocHub
          </FilterButton>
        </div>

        <div className="w-px h-6 bg-border" />

        {/* Category Filter */}
        <div className="flex items-center gap-1">
          <span className="text-sm text-muted-foreground mr-1">Category:</span>
          <FilterButton
            active={categoryFilter === 'all'}
            onClick={() => setCategoryFilter('all')}
          >
            All
          </FilterButton>
          {(Object.keys(categoryConfig) as ChangeCategory[]).map((category) => (
            <FilterButton
              key={category}
              active={categoryFilter === category}
              onClick={() => setCategoryFilter(category)}
            >
              {categoryConfig[category].label}
            </FilterButton>
          ))}
        </div>

        <div className="w-px h-6 bg-border" />

        {/* Author Filter Dropdown */}
        {uniqueAuthors.length > 0 && (
          <>
            <div className="relative" ref={authorDropdownRef}>
              <button
                onClick={() => setShowAuthorDropdown(!showAuthorDropdown)}
                className={cn(
                  'flex items-center gap-2 px-2 py-1 text-xs rounded-md transition-colors',
                  authorFilter !== 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background hover:bg-muted border border-border'
                )}
              >
                <User className="w-3 h-3" />
                <span>{authorFilter === 'all' ? 'All Authors' : authorFilter}</span>
                <ChevronDown className="w-3 h-3" />
              </button>

              {/* Dropdown menu */}
              {showAuthorDropdown && (
                <div className="absolute top-full left-0 mt-1 z-50 min-w-[180px] bg-popover border border-border rounded-md shadow-lg py-1">
                  <button
                    onClick={() => {
                      setAuthorFilter('all');
                      setShowAuthorDropdown(false);
                    }}
                    className={cn(
                      'w-full px-3 py-1.5 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2',
                      authorFilter === 'all' && 'bg-muted'
                    )}
                  >
                    <span className="w-4" />
                    All Authors
                  </button>
                  <div className="h-px bg-border my-1" />
                  {uniqueAuthors.map((author) => (
                    <button
                      key={author}
                      onClick={() => {
                        setAuthorFilter(author);
                        setShowAuthorDropdown(false);
                      }}
                      className={cn(
                        'w-full px-3 py-1.5 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2',
                        authorFilter === author && 'bg-muted'
                      )}
                    >
                      <User className="w-3 h-3 text-muted-foreground" />
                      {author}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Clear author filter button */}
            {authorFilter !== 'all' && (
              <button
                onClick={() => setAuthorFilter('all')}
                className="p-1 rounded hover:bg-muted transition-colors"
                title="Clear author filter"
              >
                <X className="w-3 h-3" />
              </button>
            )}

            <div className="w-px h-6 bg-border" />
          </>
        )}

        {/* Search */}
        <input
          type="text"
          placeholder="Search changes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="px-3 py-1 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>
      )}

      {/* Document List - only show if there are DocHub changes */}
      {documentChanges.length > 0 && (
      <div className="space-y-3">
        {groupedDocumentChanges.map((item) => (
          <div
            key={item.document.id}
            className="border border-border rounded-lg overflow-hidden"
          >
            {/* Document Header */}
            <button
              onClick={() => toggleDocument(item.document.id)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                {expandedDocs.has(item.document.id) ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
                <FileText className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium">{item.document.name}</span>
              </div>
              <span className="text-sm text-muted-foreground">
                {item.total} change{item.total !== 1 ? 's' : ''}
              </span>
            </button>

            {/* Document Changes */}
            <AnimatePresence>
              {expandedDocs.has(item.document.id) && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 space-y-4">
                    {(Object.keys(categoryConfig) as ChangeCategory[]).map((category) => {
                      const changes = item.grouped[category];
                      if (changes.length === 0) return null;

                      const config = categoryConfig[category];
                      const Icon = config.icon;

                      return (
                        <div key={category} className="space-y-2">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <Icon className={cn('w-4 h-4', config.color)} />
                            <span>{config.label}</span>
                            <span className="text-muted-foreground">
                              ({changes.length})
                            </span>
                          </div>
                          <div className="pl-6 space-y-2">
                            {changes.map((change) => (
                              <ChangeItem key={change.id} change={change} />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
      )}

      {/* Empty filtered state */}
      {filteredDocumentChanges.length === 0 && documentChanges.length > 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Filter className="w-8 h-8 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">
            No changes match the current filters
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => {
              setSourceFilter('all');
              setCategoryFilter('all');
              setAuthorFilter('all');
              setSearchQuery('');
            }}
          >
            Clear Filters
          </Button>
        </div>
      )}

      {/* Previous Tracked Changes Section */}
      {hasPreviousChanges && (
        <div className="mt-8 pt-6 border-t border-border">
          <div className="flex items-center gap-3 mb-4">
            <History className="w-5 h-5 text-amber-500" />
            <div>
              <h3 className="text-lg font-semibold">Previous Tracked Changes</h3>
              <p className="text-sm text-muted-foreground">
                {totalPreviousChanges} change{totalPreviousChanges !== 1 ? 's' : ''} that existed in the document before DocHub processing
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {previousChanges.map((item) => (
              <PreviousChangesSection
                key={`previous-${item.document.id}`}
                document={item.document}
                changes={item.changes}
              />
            ))}
          </div>
        </div>
      )}

      {/* DEFERRED: Document Comparison Modal - Side-by-side comparison for future implementation
      <DocumentComparisonModal
        isOpen={showComparisonModal}
        onClose={() => setShowComparisonModal(false)}
        sessionId={sessionId}
        documents={documentChanges.map((item) => item.document)}
      />
      */}
    </div>
  );
}

// Helper Components

interface StatBadgeProps {
  icon: typeof Plus;
  label: string;
  count: number;
  color: string;
}

function StatBadge({ icon: Icon, label, count, color }: StatBadgeProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-md">
      <Icon className={cn('w-4 h-4', color)} />
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-sm font-medium">{count}</span>
      </div>
    </div>
  );
}

interface FilterButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function FilterButton({ active, onClick, children }: FilterButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-2 py-1 text-xs rounded-md transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-background hover:bg-muted border border-border'
      )}
    >
      {children}
    </button>
  );
}

/**
 * Component for displaying previous tracked changes for a single document
 */
interface PreviousChangesSectionProps {
  document: Document;
  changes: UnifiedChange[];
}

function PreviousChangesSection({ document, changes }: PreviousChangesSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Group changes by category
  const grouped = useMemo(() => {
    const result: Record<ChangeCategory, UnifiedChange[]> = {
      content: [],
      formatting: [],
      structural: [],
      table: [],
      hyperlink: [],
      image: [],
      field: [],
      comment: [],
      bookmark: [],
      contentControl: [],
    };
    changes.forEach((change) => {
      result[change.category].push(change);
    });
    return result;
  }, [changes]);

  return (
    <div className="border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 rounded-lg overflow-hidden">
      {/* Document Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-amber-100/50 dark:hover:bg-amber-900/20 transition-colors"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-amber-600" />
          ) : (
            <ChevronRight className="w-4 h-4 text-amber-600" />
          )}
          <FileText className="w-4 h-4 text-amber-600" />
          <span className="font-medium">{document.name}</span>
        </div>
        <span className="text-sm text-amber-700 dark:text-amber-400">
          {changes.length} previous change{changes.length !== 1 ? 's' : ''}
        </span>
      </button>

      {/* Previous Changes */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4">
              {(Object.keys(categoryConfig) as ChangeCategory[]).map((category) => {
                const categoryChanges = grouped[category];
                if (categoryChanges.length === 0) return null;

                const config = categoryConfig[category];
                const Icon = config.icon;

                return (
                  <div key={category} className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Icon className={cn('w-4 h-4', config.color)} />
                      <span>{config.label}</span>
                      <span className="text-muted-foreground">
                        ({categoryChanges.length})
                      </span>
                    </div>
                    <div className="pl-6 space-y-2">
                      {categoryChanges.map((change) => (
                        <ChangeItem key={change.id} change={change} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
