import { useState, useMemo } from 'react';
import { FileText, GitBranch, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/utils/cn';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession } from '@/contexts/SessionContext';

interface Change {
  id: string;
  type: 'addition' | 'deletion' | 'modification';
  lineNumber: number;
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

// Mock data for demonstration (will be replaced with real data)
const mockChanges: DocumentChange[] = [
  {
    id: 'doc1',
    documentName: 'Project_Report_2024.docx',
    totalChanges: 12,
    changes: [
      {
        id: 'change1',
        type: 'modification',
        lineNumber: 15,
        originalText: 'The project timeline extends through December 2023',
        newText: 'The project timeline extends through March 2024'
      },
      {
        id: 'change2',
        type: 'addition',
        lineNumber: 23,
        originalText: '',
        newText: 'Additional resources have been allocated to ensure timely completion.'
      },
      {
        id: 'change3',
        type: 'deletion',
        lineNumber: 45,
        originalText: 'Legacy system integration is required for this phase.',
        newText: ''
      }
    ]
  },
  {
    id: 'doc2',
    documentName: 'Technical_Specifications.docx',
    totalChanges: 8,
    changes: [
      {
        id: 'change4',
        type: 'modification',
        lineNumber: 10,
        originalText: 'API version 2.0',
        newText: 'API version 3.0'
      },
      {
        id: 'change5',
        type: 'addition',
        lineNumber: 35,
        originalText: '',
        newText: 'New authentication mechanism using OAuth 2.0'
      }
    ]
  }
];

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
          type: change.type === 'hyperlink' ? 'modification' as const :
                change.type === 'text' ? 'modification' as const :
                'addition' as const,
          lineNumber: idx + 1, // Line numbers would need to be tracked during processing
          originalText: change.before || '',
          newText: change.after || change.description || ''
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

    // If no real changes yet, use mock data for demonstration
    return changes.length > 0 ? changes : mockChanges;
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

  const getChangeTypeColor = (type: Change['type']) => {
    switch (type) {
      case 'addition':
        return 'text-green-600 bg-green-50';
      case 'deletion':
        return 'text-red-600 bg-red-50';
      case 'modification':
        return 'text-blue-600 bg-blue-50';
    }
  };

  const getChangeTypeLabel = (type: Change['type']) => {
    switch (type) {
      case 'addition':
        return 'Added';
      case 'deletion':
        return 'Deleted';
      case 'modification':
        return 'Modified';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Tracked Changes</h3>
          <p className="text-sm text-muted-foreground">
            Review all changes made during document processing
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="px-2 py-1 bg-green-50 text-green-600 rounded">
            Additions
          </span>
          <span className="px-2 py-1 bg-blue-50 text-blue-600 rounded">
            Modifications
          </span>
          <span className="px-2 py-1 bg-red-50 text-red-600 rounded">
            Deletions
          </span>
        </div>
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
                            <span
                              className={cn(
                                'px-2 py-0.5 text-xs rounded font-medium',
                                getChangeTypeColor(change.type)
                              )}
                            >
                              {getChangeTypeLabel(change.type)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Line {change.lineNumber}
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