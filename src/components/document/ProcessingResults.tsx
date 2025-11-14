import { motion } from 'framer-motion';
import {
  CheckCircle,
  AlertCircle,
  FileText,
  Link,
  Clock,
  TrendingUp,
  Download,
  RotateCcw,
  Share2,
  Archive,
  Hash,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { Button } from '@/components/common/Button';
import type { Document, DocumentChange } from '@/types/session';

interface ProcessingResultsProps {
  document: Document;
  onDownload?: () => void;
  onReprocess?: () => void;
  onShare?: () => void;
  onViewBackup?: () => void;
  className?: string;
}

export function ProcessingResults({
  document,
  onDownload,
  onReprocess,
  onShare,
  onViewBackup,
  className,
}: ProcessingResultsProps) {
  const { processingResult } = document;

  if (!processingResult) {
    return (
      <div className={cn('text-center py-8', className)}>
        <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">No processing results available</p>
      </div>
    );
  }

  const isSuccess = document.status === 'completed';
  const hasErrors = document.status === 'error';

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}m ${seconds}s`;
  };

  const getChangeIcon = (type: DocumentChange['type']) => {
    switch (type) {
      case 'hyperlink':
        return <Link className="w-4 h-4 text-blue-500" />;
      case 'text':
        return <FileText className="w-4 h-4 text-green-500" />;
      case 'style':
        return <TrendingUp className="w-4 h-4 text-purple-500" />;
      case 'structure':
        return <Archive className="w-4 h-4 text-orange-500" />;
    }
  };

  return (
    <div className={cn('space-y-6', className)}>
      {/* Status Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          'p-6 rounded-xl border-2',
          isSuccess
            ? 'bg-green-500/5 border-green-500/20'
            : hasErrors
              ? 'bg-red-500/5 border-red-500/20'
              : 'bg-muted/30 border-border'
        )}
      >
        <div className="flex items-start gap-4">
          {isSuccess ? (
            <CheckCircle className="w-8 h-8 text-green-500 mt-1" />
          ) : hasErrors ? (
            <AlertCircle className="w-8 h-8 text-red-500 mt-1" />
          ) : (
            <FileText className="w-8 h-8 text-muted-foreground mt-1" />
          )}

          <div className="flex-1">
            <h3 className="text-xl font-semibold mb-1">
              {isSuccess
                ? 'Processing Completed Successfully'
                : hasErrors
                  ? 'Processing Failed'
                  : 'Processing Results'}
            </h3>
            <p className="text-muted-foreground">{document.name}</p>

            {processingResult.duration && (
              <div className="flex items-center gap-2 mt-3 text-sm text-muted-foreground">
                <Clock className="w-4 h-4" />
                <span>Completed in {formatDuration(processingResult.duration)}</span>
              </div>
            )}

            {hasErrors && document.errors && document.errors.length > 0 && (
              <div className="mt-3 p-3 bg-red-500/10 rounded-lg">
                <p className="text-sm text-red-600 font-medium mb-1">Errors:</p>
                <ul className="text-sm text-red-600 space-y-1">
                  {document.errors.map((error, index) => (
                    <li key={index}>• {error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {onDownload && (
              <Button variant="outline" size="sm" onClick={onDownload} className="gap-2">
                <Download className="w-4 h-4" />
                Download
              </Button>
            )}
            {onShare && (
              <Button variant="outline" size="sm" onClick={onShare} className="gap-2">
                <Share2 className="w-4 h-4" />
                Share
              </Button>
            )}
          </div>
        </div>
      </motion.div>

      {/* Statistics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="bg-muted/30 rounded-lg p-4 text-center"
        >
          <Link className="w-6 h-6 text-blue-500 mx-auto mb-2" />
          <p className="text-2xl font-bold">{processingResult.hyperlinksProcessed || 0}</p>
          <p className="text-xs text-muted-foreground">Hyperlinks Processed</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="bg-muted/30 rounded-lg p-4 text-center"
        >
          <ArrowRight className="w-6 h-6 text-green-500 mx-auto mb-2" />
          <p className="text-2xl font-bold text-green-500">
            {processingResult.hyperlinksModified || 0}
          </p>
          <p className="text-xs text-muted-foreground">Links Modified</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
          className="bg-muted/30 rounded-lg p-4 text-center"
        >
          <Hash className="w-6 h-6 text-purple-500 mx-auto mb-2" />
          <p className="text-2xl font-bold text-purple-500">
            {processingResult.contentIdsAppended || 0}
          </p>
          <p className="text-xs text-muted-foreground">Content IDs Added</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4 }}
          className="bg-muted/30 rounded-lg p-4 text-center"
        >
          <Clock className="w-6 h-6 text-orange-500 mx-auto mb-2" />
          <p className="text-2xl font-bold text-orange-500">
            {processingResult.duration ? formatDuration(processingResult.duration) : 'N/A'}
          </p>
          <p className="text-xs text-muted-foreground">Processing Time</p>
        </motion.div>
      </div>

      {/* Changes List */}
      {processingResult.changes && processingResult.changes.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-medium text-sm text-muted-foreground">
            Applied Changes ({processingResult.changes.length})
          </h4>

          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {processingResult.changes.map((change, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="flex items-start gap-3 p-3 bg-muted/20 rounded-lg"
              >
                {getChangeIcon(change.type)}

                <div className="flex-1">
                  <p className="font-medium text-sm">{change.description}</p>
                  {change.before && change.after && (
                    <div className="mt-1 space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Before:</span>
                        <code className="bg-muted px-1 py-0.5 rounded truncate max-w-xs">
                          {change.before}
                        </code>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">After:</span>
                        <code className="bg-primary/10 text-primary px-1 py-0.5 rounded truncate max-w-xs">
                          {change.after}
                        </code>
                      </div>
                    </div>
                  )}
                  {change.count !== undefined && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {change.count} occurrence{change.count !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Backup Information */}
      {processingResult.backupPath && (
        <div className="p-4 bg-muted/20 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Archive className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="font-medium text-sm">Backup Created</p>
                <p className="text-xs text-muted-foreground">
                  Original document saved before processing
                </p>
              </div>
            </div>
            {onViewBackup && (
              <Button variant="ghost" size="sm" onClick={onViewBackup}>
                View Backup
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex justify-between items-center pt-4 border-t">
        <div>
          {isSuccess && (
            <p className="text-sm text-green-600 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              All changes applied successfully
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onReprocess && (
            <Button variant="outline" onClick={onReprocess} className="gap-2">
              <RotateCcw className="w-4 h-4" />
              Reprocess
            </Button>
          )}
        </div>
      </div>

      {/* Success Animation Overlay */}
      {isSuccess && (
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: [0, 1.2, 1], opacity: [0, 0.2, 0] }}
          transition={{ duration: 1 }}
          className="absolute inset-0 pointer-events-none"
        >
          <div className="w-full h-full bg-green-500 rounded-xl" />
        </motion.div>
      )}
    </div>
  );
}
