/**
 * TrackedChangesPanel - Container for tracked changes views
 *
 * Provides tabbed interface for:
 * - Inline view: Word-like tracked changes display
 * - List view: Categorized list of changes (existing ChangeViewer)
 * - Comparison view: Side-by-side pre vs post processing diff
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  List,
  Columns,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ChevronsUpDown,
  ChevronsDownUp,
  Keyboard,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import type { TrackedChangesViewMode, TrackedChangesPanelProps } from '@/types/editor';
import type { ChangeEntry, UnifiedChange } from '@/types/session';
import { DocumentSnapshotService } from '@/services/document/DocumentSnapshotService';
import { InlineChangesView } from './InlineChangesView';
import { SideBySideDiff } from '../comparison/SideBySideDiff';

interface TrackedChangesPanelFullProps extends TrackedChangesPanelProps {
  /** Changes from docxmlater tracked changes */
  wordRevisions?: ChangeEntry[];
  /** Changes from DocHub processing */
  processingChanges?: ChangeEntry[];
  /** Post-processing paragraph text (for comparison) */
  postProcessingText?: string[];
  /** Whether panel is expanded */
  defaultExpanded?: boolean;
  /** Callback when editor is opened */
  onOpenEditor: () => void;
}

/**
 * Tab button component
 */
function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      <Icon className="w-4 h-4" />
      <span>{label}</span>
      {count !== undefined && count > 0 && (
        <span
          className={cn(
            'px-1.5 py-0.5 text-xs rounded-full',
            active
              ? 'bg-primary-foreground/20 text-primary-foreground'
              : 'bg-muted-foreground/20 text-muted-foreground'
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}


/**
 * Simple list view placeholder (existing ChangeViewer logic)
 */
function ListViewContent({ changes }: { changes: ChangeEntry[] }) {
  const grouped = useMemo(() => {
    const groups: Record<string, ChangeEntry[]> = {};
    for (const change of changes) {
      const category = change.category || 'other';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(change);
    }
    return groups;
  }, [changes]);

  const categoryLabels: Record<string, string> = {
    content: 'Content Changes',
    formatting: 'Formatting Changes',
    structural: 'Structural Changes',
    table: 'Table Changes',
    hyperlink: 'Hyperlink Changes',
    other: 'Other Changes',
  };

  const categoryColors: Record<string, string> = {
    content: 'border-l-blue-500',
    formatting: 'border-l-purple-500',
    structural: 'border-l-orange-500',
    table: 'border-l-cyan-500',
    hyperlink: 'border-l-green-500',
    other: 'border-l-gray-500',
  };

  if (changes.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <List className="w-12 h-12 mx-auto mb-2 opacity-50" />
        <p>No tracked changes</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {Object.entries(grouped).map(([category, categoryChanges]) => (
        <div key={category} className="p-4">
          <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
            <span
              className={cn(
                'w-2 h-2 rounded-full',
                categoryColors[category]?.replace('border-l-', 'bg-') || 'bg-gray-500'
              )}
            />
            {categoryLabels[category] || category} ({categoryChanges.length})
          </h4>
          <div className="space-y-2">
            {categoryChanges.slice(0, 10).map((change, index) => (
              <div
                key={`${category}-${index}`}
                className={cn(
                  'p-3 bg-muted/50 rounded-lg border-l-2',
                  categoryColors[category] || 'border-l-gray-500'
                )}
              >
                <p className="text-sm">{change.description}</p>
                {change.content?.before && change.content?.after && (
                  <div className="mt-2 text-xs grid grid-cols-2 gap-2">
                    <div className="bg-red-50 dark:bg-red-900/20 p-2 rounded">
                      <span className="text-red-700 dark:text-red-300 line-through">
                        {change.content.before.slice(0, 100)}
                        {change.content.before.length > 100 && '...'}
                      </span>
                    </div>
                    <div className="bg-green-50 dark:bg-green-900/20 p-2 rounded">
                      <span className="text-green-700 dark:text-green-300">
                        {change.content.after.slice(0, 100)}
                        {change.content.after.length > 100 && '...'}
                      </span>
                    </div>
                  </div>
                )}
                <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                  {change.author && <span>By: {change.author}</span>}
                  {change.date && (
                    <span>{new Date(change.date).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            ))}
            {categoryChanges.length > 10 && (
              <p className="text-xs text-muted-foreground text-center">
                + {categoryChanges.length - 10} more changes
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Main TrackedChangesPanel component
 */
export function TrackedChangesPanel({
  sessionId,
  documentId,
  wordRevisions = [],
  processingChanges = [],
  postProcessingText = [],
  defaultExpanded = true,
  onOpenEditor,
}: TrackedChangesPanelFullProps) {
  const [activeTab, setActiveTab] = useState<TrackedChangesViewMode>('list');
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [originalText, setOriginalText] = useState<string[]>([]);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(false);
  const [currentChangeIndex, setCurrentChangeIndex] = useState(0);
  const [allParagraphsExpanded, setAllParagraphsExpanded] = useState(true);
  const [showKeyboardHint, setShowKeyboardHint] = useState(false);

  // Ref for keyboard focus
  const panelRef = useRef<HTMLDivElement>(null);

  // Combine all changes for total count
  const allChanges = useMemo(() => {
    return [...wordRevisions, ...processingChanges];
  }, [wordRevisions, processingChanges]);

  // Load snapshot for comparison view
  useEffect(() => {
    if (activeTab === 'comparison' && originalText.length === 0) {
      setIsLoadingSnapshot(true);
      DocumentSnapshotService.getSnapshot(sessionId, documentId)
        .then((snapshot) => {
          if (snapshot) {
            setOriginalText(snapshot.textContent);
          }
        })
        .catch((error) => {
          console.error('Failed to load snapshot:', error);
        })
        .finally(() => {
          setIsLoadingSnapshot(false);
        });
    }
  }, [activeTab, sessionId, documentId, originalText.length]);

  // Change navigation
  const handlePreviousChange = useCallback(() => {
    setCurrentChangeIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleNextChange = useCallback(() => {
    setCurrentChangeIndex((prev) => Math.min(allChanges.length - 1, prev + 1));
  }, [allChanges.length]);

  // Toggle all paragraphs expanded/collapsed
  const toggleAllParagraphs = useCallback(() => {
    setAllParagraphsExpanded((prev) => !prev);
  }, []);

  // Keyboard navigation handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if panel is focused or contains focus
      if (!panelRef.current?.contains(document.activeElement) && document.activeElement !== panelRef.current) {
        return;
      }

      // Don't handle if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            handleNextChange();
          }
          break;
        case 'k':
        case 'ArrowUp':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            handlePreviousChange();
          }
          break;
        case 'e':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            toggleAllParagraphs();
          }
          break;
        case '1':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            setActiveTab('inline');
          }
          break;
        case '2':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            setActiveTab('list');
          }
          break;
        case '3':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            setActiveTab('comparison');
          }
          break;
        case '?':
          e.preventDefault();
          setShowKeyboardHint((prev) => !prev);
          break;
        case 'Escape':
          setShowKeyboardHint(false);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNextChange, handlePreviousChange, toggleAllParagraphs]);

  return (
    <div
      ref={panelRef}
      tabIndex={0}
      className="bg-card border border-border rounded-lg overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary/50"
    >
      {/* Keyboard Shortcuts Hint Overlay */}
      <AnimatePresence>
        {showKeyboardHint && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-background/95 backdrop-blur-sm flex items-center justify-center"
            onClick={() => setShowKeyboardHint(false)}
          >
            <div className="bg-card border border-border rounded-lg p-6 shadow-lg max-w-sm">
              <h4 className="font-medium mb-4 flex items-center gap-2">
                <Keyboard className="w-4 h-4" />
                Keyboard Shortcuts
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-8">
                  <span className="text-muted-foreground">Next change</span>
                  <kbd className="px-2 py-0.5 bg-muted rounded text-xs font-mono">j</kbd>
                </div>
                <div className="flex justify-between gap-8">
                  <span className="text-muted-foreground">Previous change</span>
                  <kbd className="px-2 py-0.5 bg-muted rounded text-xs font-mono">k</kbd>
                </div>
                <div className="flex justify-between gap-8">
                  <span className="text-muted-foreground">Expand/Collapse all</span>
                  <kbd className="px-2 py-0.5 bg-muted rounded text-xs font-mono">e</kbd>
                </div>
                <div className="flex justify-between gap-8">
                  <span className="text-muted-foreground">Inline view</span>
                  <kbd className="px-2 py-0.5 bg-muted rounded text-xs font-mono">1</kbd>
                </div>
                <div className="flex justify-between gap-8">
                  <span className="text-muted-foreground">List view</span>
                  <kbd className="px-2 py-0.5 bg-muted rounded text-xs font-mono">2</kbd>
                </div>
                <div className="flex justify-between gap-8">
                  <span className="text-muted-foreground">Comparison view</span>
                  <kbd className="px-2 py-0.5 bg-muted rounded text-xs font-mono">3</kbd>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-4">
                Press <kbd className="px-1 bg-muted rounded">?</kbd> or <kbd className="px-1 bg-muted rounded">Esc</kbd> to close
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-muted/30 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-primary" />
          <h3 className="font-medium">Tracked Changes</h3>
          {allChanges.length > 0 && (
            <span className="px-2 py-0.5 text-xs bg-primary/10 text-primary rounded-full">
              {allChanges.length} changes
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Keyboard hint button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowKeyboardHint(true);
            }}
            className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground"
            title="Keyboard shortcuts (?)"
          >
            <Keyboard className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenEditor();
            }}
            className="p-1.5 rounded-md hover:bg-muted transition-colors"
            title="Open in Editor"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-5 h-5 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Tab Bar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/10">
              <div className="flex items-center gap-1">
                <TabButton
                  active={activeTab === 'inline'}
                  onClick={() => setActiveTab('inline')}
                  icon={FileText}
                  label="Inline"
                  count={allChanges.length}
                />
                <TabButton
                  active={activeTab === 'list'}
                  onClick={() => setActiveTab('list')}
                  icon={List}
                  label="List"
                  count={allChanges.length}
                />
                <TabButton
                  active={activeTab === 'comparison'}
                  onClick={() => setActiveTab('comparison')}
                  icon={Columns}
                  label="Before/After"
                />
              </div>

              {/* Controls */}
              {allChanges.length > 0 && activeTab !== 'comparison' && (
                <div className="flex items-center gap-2">
                  {/* Expand/Collapse All button (for inline view) */}
                  {activeTab === 'inline' && (
                    <button
                      onClick={toggleAllParagraphs}
                      className="p-1.5 rounded hover:bg-muted transition-colors flex items-center gap-1 text-xs text-muted-foreground"
                      title={allParagraphsExpanded ? 'Collapse all paragraphs (e)' : 'Expand all paragraphs (e)'}
                    >
                      {allParagraphsExpanded ? (
                        <ChevronsDownUp className="w-4 h-4" />
                      ) : (
                        <ChevronsUpDown className="w-4 h-4" />
                      )}
                      <span className="hidden sm:inline">
                        {allParagraphsExpanded ? 'Collapse' : 'Expand'}
                      </span>
                    </button>
                  )}

                  {/* Separator */}
                  {activeTab === 'inline' && (
                    <div className="w-px h-4 bg-border" />
                  )}

                  {/* Navigation controls */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handlePreviousChange}
                      disabled={currentChangeIndex === 0}
                      className="p-1 rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Previous change (k)"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-xs text-muted-foreground px-2">
                      {currentChangeIndex + 1} / {allChanges.length}
                    </span>
                    <button
                      onClick={handleNextChange}
                      disabled={currentChangeIndex === allChanges.length - 1}
                      className="p-1 rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Next change (j)"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Tab Content */}
            <div className="max-h-[500px] overflow-y-auto">
              {activeTab === 'inline' && (
                <InlineChangesView
                  changes={allChanges}
                  highlightedChangeIndex={currentChangeIndex}
                  onChangeClick={(change, index) => setCurrentChangeIndex(index)}
                  allExpanded={allParagraphsExpanded}
                />
              )}

              {activeTab === 'list' && <ListViewContent changes={allChanges} />}

              {activeTab === 'comparison' && (
                <>
                  {isLoadingSnapshot ? (
                    <div className="p-8 text-center text-muted-foreground">
                      <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin" />
                      <p>Loading comparison data...</p>
                    </div>
                  ) : (
                    <SideBySideDiff
                      originalContent={originalText}
                      modifiedContent={postProcessingText}
                      syncScroll={true}
                      showLineNumbers={true}
                      collapseUnchanged={false}
                      height={400}
                    />
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default TrackedChangesPanel;
