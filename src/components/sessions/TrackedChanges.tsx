import { Button } from '@/components/common/Button';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useSession } from '@/contexts/SessionContext';
import { cn } from '@/utils/cn';
import logger from '@/utils/logger';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  GitBranch,
  RotateCcw,
  Settings,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { defaultOptions } from './ProcessingOptions';

interface Change {
  id: string;
  description: string;
  type: 'addition' | 'deletion' | 'modification';
  lineNumber?: number;
  originalText: string;
  newText: string;
}

interface DocumentChange {
  id: string;
  documentName: string;
  changes: Change[];
  totalChanges: number;
}

interface TrackedChangesProps {
  sessionId: string;
}

export function TrackedChanges({ sessionId }: TrackedChangesProps) {
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());
  const [selectedChange, setSelectedChange] = useState<string | null>(null);
  const [showProcessingOptions, setShowProcessingOptions] = useState(false);
  const [revertAllDialogOpen, setRevertAllDialogOpen] = useState(false);
  const [documentToRevertAll, setDocumentToRevertAll] = useState<string | null>(null);
  const { sessions, revertAllChanges } = useSession();

  // Get the current session
  const session = sessions.find((s) => s.id === sessionId);

  // Extract real changes from processed documents with intelligent filtering
  const documentChanges = useMemo(() => {
    if (!session) return [];

    const changes: DocumentChange[] = [];

    session.documents.forEach((doc) => {
      if (doc.status === 'completed' && doc.processingResult?.changes) {
        // First, filter out trivial changes and enhance descriptions
        const meaningfulChanges = doc.processingResult.changes
          .filter((change) => {
            // KEEP changes with count value (aggregate operations like "Standardized 11 hyperlinks")
            if (change.count !== undefined && change.count > 0) {
              return true;
            }

            // KEEP changes with before OR after values
            if (change.before || change.after) {
              // Skip ONLY if both exist and are identical
              if (change.before === change.after) return false;

              // Skip pure whitespace-only changes (but keep if count exists)
              if (
                change.type === 'text' &&
                change.before?.trim() === '' &&
                change.after?.trim() === ''
              ) {
                return false;
              }

              return true;
            }

            // KEEP changes with meaningful descriptions (structural changes)
            if (change.description && change.description.trim().length > 0) {
              return true;
            }

            // Only filter out completely empty changes
            return false;
          })
          .map((change) => {
            // Enhance descriptions for better clarity
            let enhancedDescription = change.description || 'Change applied';

            // Special handling for invisible hyperlinks
            if (
              change.type === 'hyperlink' ||
              enhancedDescription.toLowerCase().includes('hyperlink')
            ) {
              if (change.type === 'deletion' && (!change.before || change.before.trim() === '')) {
                enhancedDescription = 'Invisible hyperlink deleted';
              } else if (!change.before && change.after) {
                enhancedDescription = `Hyperlink added: ${change.after}`;
              } else if (change.before && change.after && change.before !== change.after) {
                enhancedDescription = `Hyperlink updated`;
              }
            }

            // Handle style changes with better descriptions
            if (change.type === 'style') {
              // Extract style name if present
              const styleMatch = enhancedDescription.match(/(\w+)\s+style/i);
              const styleName = styleMatch ? styleMatch[1] : 'Style';

              // Only show if values actually changed
              if (change.before === change.after) {
                return null; // Will be filtered out
              }

              if (change.before && change.after) {
                enhancedDescription = `${styleName} style updated: ${change.before} → ${change.after}`;
              } else if (!change.before && change.after) {
                enhancedDescription = `${styleName} style applied: ${change.after}`;
              }
            }

            return { ...change, description: enhancedDescription };
          })
          .filter(Boolean); // Remove null entries

        // Group similar changes for consolidation
        const changeGroups = new Map<string, { changes: typeof meaningfulChanges; key: string }>();

        meaningfulChanges.forEach((change) => {
          if (!change) return; // Skip null entries

          // Create a grouping key based on change type and pattern
          let groupKey = '';

          if (change.type === 'style' && change.description) {
            // Group style changes by style name and change type
            const styleMatch = change.description.match(/^(\w+\s+style)\s+/);
            if (styleMatch) {
              groupKey = `style_${styleMatch[1]}_${change.before}_${change.after}`;
            }
          } else if (change.type === 'hyperlink') {
            // Don't consolidate hyperlink changes - each is unique
            groupKey = `unique_${change.id || Math.random()}`;
          } else {
            // For other changes, group by exact before/after
            groupKey = `${change.type}_${change.before || ''}_${change.after || ''}`;
          }

          if (!changeGroups.has(groupKey)) {
            changeGroups.set(groupKey, { changes: [], key: groupKey });
          }
          changeGroups.get(groupKey)!.changes.push(change);
        });

        // Convert groups to final changes with consolidation
        const docChanges: Change[] = [];

        changeGroups.forEach((group) => {
          if (group.changes.length === 1) {
            // Single change - use as is
            const change = group.changes[0];
            if (change) {
              docChanges.push({
                id: change.id || `${doc.id}-change-${docChanges.length}`,
                description: change.description || 'Change applied',
                type:
                  change.type === 'hyperlink'
                    ? ('modification' as const)
                    : change.type === 'text'
                      ? ('modification' as const)
                      : change.type === 'style'
                        ? ('modification' as const)
                        : ('addition' as const),
                originalText: change.before || '',
                newText: change.after || '',
              });
            }
          } else if (group.changes.length > 0) {
            // Multiple similar changes - consolidate
            const firstChange = group.changes[0];
            if (firstChange) {
              let consolidatedDescription = firstChange.description || 'Changes applied';

              // Add occurrence count
              if (group.changes.length > 1) {
                // Remove any existing occurrence count and add new one
                consolidatedDescription = consolidatedDescription.replace(
                  / \(\d+ occurrences\)$/,
                  ''
                );
                consolidatedDescription += ` (${group.changes.length} occurrences)`;
              }

              docChanges.push({
                id: `${doc.id}-group-${docChanges.length}`,
                description: consolidatedDescription,
                type:
                  firstChange.type === 'hyperlink'
                    ? ('modification' as const)
                    : firstChange.type === 'text'
                      ? ('modification' as const)
                      : firstChange.type === 'style'
                        ? ('modification' as const)
                        : ('addition' as const),
                originalText: firstChange.before || '',
                newText: firstChange.after || '',
              });
            }
          }
        });

        if (docChanges.length > 0) {
          changes.push({
            id: doc.id,
            documentName: doc.name,
            totalChanges: docChanges.length, // Use consolidated count
            changes: docChanges,
          });
        }
      }
    });

    return changes;
  }, [session]);

  const toggleDocument = (docId: string) => {
    const newExpanded = new Set(expandedDocs);
    if (newExpanded.has(docId)) {
      newExpanded.delete(docId);
    } else {
      newExpanded.add(docId);
    }
    setExpandedDocs(newExpanded);
  };

  // Get enabled processing options
  const enabledOptions = useMemo(() => {
    if (!session?.processingOptions?.enabledOperations) return [];

    return session.processingOptions.enabledOperations
      .map((optionId) => defaultOptions.find((opt) => opt.id === optionId))
      .filter(Boolean)
      .map((opt) => opt!.label);
  }, [session]);

  // Handle revert all changes for a document
  const handleRevertAllChanges = (docId: string) => {
    setDocumentToRevertAll(docId);
    setRevertAllDialogOpen(true);
  };

  const confirmRevertAllChanges = async () => {
    if (!documentToRevertAll) return;

    try {
      await revertAllChanges(sessionId, documentToRevertAll);
      setRevertAllDialogOpen(false);
      setDocumentToRevertAll(null);
    } catch (error) {
      logger.error('Failed to revert all changes:', error);
      alert(
        `Failed to revert changes: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  // Open comparison window for a document
  // Note: Comparison window feature is planned for future implementation
  const openComparisonWindow = async (docId: string) => {
    logger.info('Comparison window feature not yet implemented for document:', docId);
    alert('Document comparison feature coming soon!');
  };

  return (
    <div className="space-y-4">
      <div className="mb-4">
        <h3 className="text-lg font-semibold">Tracked Changes</h3>
        <p className="text-sm text-muted-foreground">
          Review all changes made during document processing
        </p>
      </div>

      {/* Processing Options Used Section */}
      {enabledOptions.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setShowProcessingOptions(!showProcessingOptions)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              {showProcessingOptions ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              <Settings className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium">Processing Options Used</span>
              <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full">
                {enabledOptions.length} enabled
              </span>
            </div>
          </button>

          <AnimatePresence>
            {showProcessingOptions && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="border-t border-border"
              >
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {enabledOptions.map((option, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
                      <Check className="w-4 h-4 text-green-600" />
                      <span className="text-sm">{option}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <div className="space-y-2">
        {documentChanges.map((doc) => (
          <div key={doc.id} className="border border-border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between">
              <button
                onClick={() => toggleDocument(doc.id)}
                className="flex-1 px-4 py-3 flex items-center gap-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {expandedDocs.has(doc.id) ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium">{doc.documentName}</span>
                  <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full">
                    {doc.totalChanges} changes
                  </span>
                </div>
              </button>
              <div className="px-4 flex items-center gap-2">
                {/* View Comparison Button - Feature planned for future */}
                {/* Commented out until comparison data is implemented
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    openComparisonWindow(doc.id);
                  }}
                  className="flex items-center gap-1"
                >
                  <Eye className="w-3 h-3" />
                  View Comparison
                </Button>
                */}
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRevertAllChanges(doc.id);
                  }}
                  className="flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  Revert All Changes
                </Button>
                <GitBranch className="w-4 h-4 text-muted-foreground" />
              </div>
            </div>

            <AnimatePresence>
              {expandedDocs.has(doc.id) && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="border-t border-border"
                >
                  <div className="p-4 space-y-3">
                    {doc.changes.map((change) => (
                      <div
                        key={change.id}
                        className={cn(
                          'p-3 rounded-lg border transition-all',
                          selectedChange === change.id
                            ? 'border-primary shadow-xs'
                            : 'border-border hover:border-muted-foreground'
                        )}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div
                            className="flex items-center gap-2 flex-1 cursor-pointer"
                            onClick={() => setSelectedChange(change.id)}
                          >
                            <span className="px-2 py-0.5 text-xs rounded font-medium bg-blue-50 text-blue-600">
                              {change.description}
                            </span>
                          </div>
                        </div>

                        <div className="space-y-2">
                          {change.originalText && (
                            <div className="p-2 bg-red-50 rounded text-sm">
                              <span className="text-red-500 font-medium mr-2">-</span>
                              <span className="text-red-700 line-through">
                                {change.originalText}
                              </span>
                            </div>
                          )}
                          {change.newText && (
                            <div className="p-2 bg-green-50 rounded text-sm">
                              <span className="text-green-500 font-medium mr-2">+</span>
                              <span className="text-green-700">{change.newText}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>

      {documentChanges.length === 0 && (
        <div className="text-center py-12">
          <GitBranch className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            No changes tracked yet. Process documents to see changes.
          </p>
        </div>
      )}

      {/* Revert All Changes Confirmation */}
      <ConfirmDialog
        open={revertAllDialogOpen}
        onOpenChange={setRevertAllDialogOpen}
        title="Revert All Changes"
        message="Are you sure you want to revert ALL changes for this document? This action will restore the document from its backup file, preserving the original filename. This is IRREVERSIBLE and will permanently discard all processing changes made to this document."
        confirmText="Revert All"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={confirmRevertAllChanges}
      />
    </div>
  );
}
