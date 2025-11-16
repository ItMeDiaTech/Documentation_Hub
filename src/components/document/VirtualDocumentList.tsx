import { memo, useCallback, CSSProperties } from 'react';
// @ts-ignore - react-window exports these despite TypeScript not recognizing them
import { VariableSizeList as List } from 'react-window';
import { motion } from 'framer-motion';
import { FileText, CheckCircle, Clock, AlertCircle, ExternalLink, Download } from 'lucide-react';
import { Document } from '@/types/session';
import { cn } from '@/utils/cn';
import { Button } from '../common/Button';

interface VirtualDocumentListProps {
  documents: Document[];
  height: number;
  onDocumentClick?: (document: Document) => void;
  onProcessDocument?: (document: Document) => void;
  selectedDocumentId?: string;
  showActions?: boolean;
}

interface DocumentRowProps {
  index: number;
  style: CSSProperties;
  data: {
    documents: Document[];
    onDocumentClick?: (document: Document) => void;
    onProcessDocument?: (document: Document) => void;
    selectedDocumentId?: string;
    showActions?: boolean;
    getItemSize: (index: number) => number;
  };
}

/**
 * Individual document row component
 * Memoized to prevent unnecessary re-renders
 */
const DocumentRow = memo(({ index, style, data }: DocumentRowProps) => {
  const document = data.documents[index];
  const isSelected = document.id === data.selectedDocumentId;

  const handleClick = useCallback(() => {
    if (data.onDocumentClick) {
      data.onDocumentClick(document);
    }
  }, [document, data]);

  const handleProcess = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (data.onProcessDocument) {
        data.onProcessDocument(document);
      }
    },
    [document, data]
  );

  const getStatusIcon = () => {
    switch (document.status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'processing':
        return (
          <div className="animate-spin">
            <Clock className="w-4 h-4 text-primary" />
          </div>
        );
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return <FileText className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return 'Unknown size';
    const mb = bytes / (1024 * 1024);
    return mb < 1 ? `${(bytes / 1024).toFixed(1)} KB` : `${mb.toFixed(1)} MB`;
  };

  const hasChanges =
    document.processingResult?.changes && document.processingResult.changes.length > 0;
  const changeCount = document.processingResult?.changes?.length || 0;

  return (
    <div style={style}>
      <motion.div
        whileHover={{ scale: 1.005 }}
        whileTap={{ scale: 0.995 }}
        onClick={handleClick}
        className={cn(
          'mx-2 p-3 rounded-lg border cursor-pointer transition-all',
          'hover:shadow-sm hover:border-primary/20',
          isSelected && 'border-primary bg-primary/5',
          !isSelected && 'border-border bg-card'
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1">
            {getStatusIcon()}

            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-sm truncate" title={document.name}>
                {document.name}
              </h4>

              <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                <span>{formatFileSize(document.size)}</span>
                {document.processedAt && (
                  <>
                    <span>•</span>
                    <span>Processed {new Date(document.processedAt).toLocaleDateString()}</span>
                  </>
                )}
              </div>

              {/* Processing result summary */}
              {hasChanges && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex items-center gap-1 px-2 py-0.5 bg-green-500/10 text-green-700 dark:text-green-400 rounded-full text-xs">
                    <CheckCircle className="w-3 h-3" />
                    <span>{changeCount} changes</span>
                  </div>

                  {document.processingResult?.hyperlinksModified && (
                    <div className="px-2 py-0.5 bg-primary/10 text-primary rounded-full text-xs">
                      {Math.round(document.processingResult.hyperlinksModified * 101)} sec saved
                    </div>
                  )}
                </div>
              )}

              {/* Error message */}
              {document.status === 'error' && document.errors && document.errors.length > 0 && (
                <div className="mt-2 text-xs text-red-600 dark:text-red-400">
                  {document.errors[0]}
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          {data.showActions && (
            <div className="flex items-center gap-1">
              {document.status === 'pending' && (
                <Button size="sm" variant="ghost" onClick={handleProcess} className="h-7 px-2">
                  Process
                </Button>
              )}

              {document.status === 'completed' && (
                <>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Open document">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Button>

                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Download">
                    <Download className="w-3.5 h-3.5" />
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Progress bar for processing */}
        {document.status === 'processing' && (
          <div className="mt-3 w-full bg-muted rounded-full h-1.5">
            <div className="bg-primary h-1.5 rounded-full animate-pulse" style={{ width: '50%' }} />
          </div>
        )}
      </motion.div>
    </div>
  );
});

DocumentRow.displayName = 'DocumentRow';

/**
 * Virtual scrolling document list component
 * Uses variable size list to handle different content heights
 */
export const VirtualDocumentList = memo(function VirtualDocumentList({
  documents,
  height,
  onDocumentClick,
  onProcessDocument,
  selectedDocumentId,
  showActions = true,
}: VirtualDocumentListProps) {
  // Calculate item size based on content
  const getItemSize = useCallback(
    (index: number) => {
      const document = documents[index];
      let baseHeight = 80; // Base height for minimal content

      // Add height for error messages
      if (document.status === 'error' && document.errors && document.errors.length > 0) {
        baseHeight += 20;
      }

      // Add height for processing results
      if (document.processingResult?.changes?.length) {
        baseHeight += 30;
      }

      // Add height for progress bar
      if (document.status === 'processing') {
        baseHeight += 20;
      }

      return baseHeight;
    },
    [documents]
  );

  // Data passed to each row
  const itemData = {
    documents,
    onDocumentClick,
    onProcessDocument,
    selectedDocumentId,
    showActions,
    getItemSize,
  };

  return (
    <List
      height={height}
      itemCount={documents.length}
      estimatedItemSize={90} // Average estimated size
      itemSize={getItemSize}
      width="100%"
      itemData={itemData}
      className="scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent"
    >
      {DocumentRow}
    </List>
  );
});
