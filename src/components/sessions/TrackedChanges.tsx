import { useState, useMemo } from 'react';
import { FileText, GitBranch, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/utils/cn';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession } from '@/contexts/SessionContext';

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
  const { sessions } = useSession();

  // Get the current session
  const session = sessions.find(s => s.id === sessionId);

  // Extract real changes from processed documents
  const documentChanges = useMemo(() => {
    if (!session) return [];

    const changes: DocumentChange[] = [];

    session.documents.forEach(doc => {
      if (doc.status === 'completed' && doc.processingResult?.changes) {
        const docChanges: Change[] = doc.processingResult.changes.map((change, idx) => ({
          id: `${doc.id}-change-${idx}`,
          description: change.description || 'Change applied',
          type: change.type === 'hyperlink' ? 'modification' as const :
                change.type === 'text' ? 'modification' as const :
                'addition' as const,
          originalText: change.before || '',
          newText: change.after || ''
        }));

        if (docChanges.length > 0) {
          changes.push({
            id: doc.id,
            documentName: doc.name,
            totalChanges: docChanges.length,
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

  return (
    <div className="space-y-4">
      <div className="mb-4">
        <h3 className="text-lg font-semibold">Tracked Changes</h3>
        <p className="text-sm text-muted-foreground">
          Review all changes made during document processing
        </p>
      </div>

      <div className="space-y-2">
        {documentChanges.map((doc) => (
          <div
            key={doc.id}
            className="border border-border rounded-lg overflow-hidden"
          >
            <button
              onClick={() => toggleDocument(doc.id)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors"
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
              <GitBranch className="w-4 h-4 text-muted-foreground" />
            </button>

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
                          'p-3 rounded-lg border cursor-pointer transition-all',
                          selectedChange === change.id
                            ? 'border-primary shadow-sm'
                            : 'border-border hover:border-muted-foreground'
                        )}
                        onClick={() => setSelectedChange(change.id)}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
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
    </div>
  );
}