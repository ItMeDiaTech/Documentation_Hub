import { useState, useMemo } from 'react';
import { FileText, GitBranch, ChevronDown, ChevronRight, Settings, Check, Undo, RotateCcw } from 'lucide-react';
import { cn } from '@/utils/cn';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession } from '@/contexts/SessionContext';
import { defaultOptions } from './ProcessingOptions';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Button } from '@/components/common/Button';

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
  const [showProcessingOptions, setShowProcessingOptions] = useState(true);
  const [revertDialogOpen, setRevertDialogOpen] = useState(false);
  const [revertAllDialogOpen, setRevertAllDialogOpen] = useState(false);
  const [changeToRevert, setChangeToRevert] = useState<{ docId: string; changeId: string } | null>(null);
  const [documentToRevertAll, setDocumentToRevertAll] = useState<string | null>(null);
  const { sessions, revertChange, revertAllChanges } = useSession();

  // Get the current session
  const session = sessions.find(s => s.id === sessionId);

  // Extract real changes from processed documents
  const documentChanges = useMemo(() => {
    if (!session) return [];

    const changes: DocumentChange[] = [];

    session.documents.forEach(doc => {
      if (doc.status === 'completed' && doc.processingResult?.changes) {
        // Group changes by original and new text to merge duplicates
        const changeMap = new Map<string, Change & { count: number }>();

        doc.processingResult.changes.forEach((change, idx) => {
          const key = `${change.before || ''}_${change.after || ''}`;

          if (changeMap.has(key)) {
            const existing = changeMap.get(key)!;
            existing.count += 1;
            // Update description to show count
            existing.description = `${change.description || 'Change applied'} (${existing.count} occurrences)`;
          } else {
            changeMap.set(key, {
              id: `${doc.id}-change-${idx}`,
              description: change.description || 'Change applied',
              type: change.type === 'hyperlink' ? 'modification' as const :
                    change.type === 'text' ? 'modification' as const :
                    'addition' as const,
              originalText: change.before || '',
              newText: change.after || '',
              count: 1
            });
          }
        });

        const docChanges: Change[] = Array.from(changeMap.values()).map(({ count, ...change }) => ({
          ...change,
          description: count > 1 ? `${change.description.replace(/ \(\d+ occurrences\)$/, '')} (${count} occurrences)` : change.description
        }));

        if (docChanges.length > 0) {
          changes.push({
            id: doc.id,
            documentName: doc.name,
            totalChanges: doc.processingResult.changes.length, // Use original count for total
            changes: docChanges
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
      .map(optionId => defaultOptions.find(opt => opt.id === optionId))
      .filter(Boolean)
      .map(opt => opt!.label);
  }, [session]);

  // Handle individual change revert
  const handleRevertChange = (docId: string, changeId: string) => {
    setChangeToRevert({ docId, changeId });
    setRevertDialogOpen(true);
  };

  const confirmRevertChange = async () => {
    if (!changeToRevert) return;

    try {
      await revertChange(sessionId, changeToRevert.docId, changeToRevert.changeId);
      setRevertDialogOpen(false);
      setChangeToRevert(null);
    } catch (error) {
      console.error('Failed to revert change:', error);
    }
  };

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
      console.error('Failed to revert all changes:', error);
      alert(`Failed to revert changes: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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
                    <div
                      key={idx}
                      className="flex items-center gap-2 p-2 rounded-lg bg-muted/30"
                    >
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
          <div
            key={doc.id}
            className="border border-border rounded-lg overflow-hidden"
          >
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
                            ? 'border-primary shadow-sm'
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
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRevertChange(doc.id, change.id);
                            }}
                            className="ml-2 p-1 rounded hover:bg-muted transition-colors group"
                            title="Revert this change"
                          >
                            <Undo className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
                          </button>
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
                              <span className="text-green-700">
                                {change.newText}
                              </span>
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

      {/* Individual Change Revert Confirmation */}
      <ConfirmDialog
        open={revertDialogOpen}
        onOpenChange={setRevertDialogOpen}
        title="Revert Change"
        message="Are you sure you want to revert this change? This will remove it from the tracked changes list."
        confirmText="Revert"
        cancelText="Cancel"
        variant="default"
        onConfirm={confirmRevertChange}
      />

      {/* Revert All Changes Confirmation */}
      <ConfirmDialog
        open={revertAllDialogOpen}
        onOpenChange={setRevertAllDialogOpen}
        title="Revert All Changes"
        message="Are you sure you want to revert ALL changes for this document? This will restore the document from the backup file and cannot be undone."
        confirmText="Revert All"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={confirmRevertAllChanges}
      />
    </div>
  );
}