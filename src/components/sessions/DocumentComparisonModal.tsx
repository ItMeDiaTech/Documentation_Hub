/**
 * DocumentComparisonModal - Side-by-side comparison of original vs processed documents
 *
 * DEFERRED FEATURE: This component is currently disabled in the UI.
 * The side-by-side comparison feature may be implemented in a future release.
 * See ChangeViewer.tsx for the deferred button implementation.
 *
 * Opens a modal dialog displaying SideBySideDiff for comparing document states
 * before and after processing. Supports navigation between multiple documents.
 */

import { useState, useEffect, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  X,
  ChevronLeft,
  ChevronRight,
  FileText,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { Button } from '@/components/common/Button';
import { SideBySideDiff } from '@/components/comparison/SideBySideDiff';
import { DocumentSnapshotService } from '@/services/document/DocumentSnapshotService';
import type { Document } from '@/types/session';
import logger from '@/utils/logger';

interface DocumentComparisonModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Session ID for snapshot lookup */
  sessionId: string;
  /** List of completed documents to compare */
  documents: Document[];
  /** Initial document index to display */
  initialDocumentIndex?: number;
}

interface ComparisonState {
  originalText: string[];
  processedText: string[];
  isLoading: boolean;
  error: string | null;
}

export function DocumentComparisonModal({
  isOpen,
  onClose,
  sessionId,
  documents,
  initialDocumentIndex = 0,
}: DocumentComparisonModalProps) {
  const [currentDocIndex, setCurrentDocIndex] = useState(initialDocumentIndex);
  const [comparisonState, setComparisonState] = useState<ComparisonState>({
    originalText: [],
    processedText: [],
    isLoading: false,
    error: null,
  });

  const currentDoc = documents[currentDocIndex];

  // Load comparison data for current document
  const loadComparisonData = useCallback(async () => {
    if (!currentDoc || !currentDoc.path) {
      setComparisonState({
        originalText: [],
        processedText: [],
        isLoading: false,
        error: 'Document path not available',
      });
      return;
    }

    setComparisonState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      // Load original text from snapshot
      const snapshot = await DocumentSnapshotService.getSnapshot(
        sessionId,
        currentDoc.id
      );

      if (!snapshot) {
        setComparisonState({
          originalText: [],
          processedText: [],
          isLoading: false,
          error: 'Original document snapshot not available. The snapshot may have expired or was not captured.',
        });
        return;
      }

      // Load processed text from current document file
      const result = await window.electronAPI.extractDocumentText(currentDoc.path);

      if (!result.success || !result.textContent) {
        setComparisonState({
          originalText: snapshot.textContent,
          processedText: [],
          isLoading: false,
          error: result.error || 'Failed to extract processed document text',
        });
        return;
      }

      setComparisonState({
        originalText: snapshot.textContent,
        processedText: result.textContent,
        isLoading: false,
        error: null,
      });

      logger.info(
        `[DocumentComparisonModal] Loaded comparison for ${currentDoc.name}: ` +
          `${snapshot.textContent.length} original paragraphs, ${result.textContent.length} processed paragraphs`
      );
    } catch (error) {
      logger.error('[DocumentComparisonModal] Error loading comparison:', error);
      setComparisonState({
        originalText: [],
        processedText: [],
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load comparison data',
      });
    }
  }, [currentDoc, sessionId]);

  // Load data when document changes
  useEffect(() => {
    if (isOpen && currentDoc) {
      loadComparisonData();
    }
  }, [isOpen, currentDoc, loadComparisonData]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setCurrentDocIndex(initialDocumentIndex);
      setComparisonState({
        originalText: [],
        processedText: [],
        isLoading: false,
        error: null,
      });
    }
  }, [isOpen, initialDocumentIndex]);

  // Navigation handlers
  const handlePrevious = useCallback(() => {
    if (currentDocIndex > 0) {
      setCurrentDocIndex((prev) => prev - 1);
    }
  }, [currentDocIndex]);

  const handleNext = useCallback(() => {
    if (currentDocIndex < documents.length - 1) {
      setCurrentDocIndex((prev) => prev + 1);
    }
  }, [currentDocIndex, documents.length]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && currentDocIndex > 0) {
        handlePrevious();
      } else if (e.key === 'ArrowRight' && currentDocIndex < documents.length - 1) {
        handleNext();
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentDocIndex, documents.length, handlePrevious, handleNext, onClose]);

  if (documents.length === 0) {
    return null;
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 z-50" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            'fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%]',
            'w-[95vw] max-w-6xl h-[90vh] rounded-lg border border-border bg-card shadow-xl',
            'flex flex-col overflow-hidden',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]',
            'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]'
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-primary" />
              <Dialog.Title className="font-semibold text-foreground">
                Compare: {currentDoc?.name || 'Document'}
              </Dialog.Title>
            </div>

            <div className="flex items-center gap-4">
              {/* Navigation */}
              {documents.length > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handlePrevious}
                    disabled={currentDocIndex === 0}
                    className="h-8 w-8 p-0"
                    title="Previous document (Left Arrow)"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground min-w-[4rem] text-center">
                    {currentDocIndex + 1} / {documents.length}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleNext}
                    disabled={currentDocIndex === documents.length - 1}
                    className="h-8 w-8 p-0"
                    title="Next document (Right Arrow)"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              )}

              {/* Close button */}
              <Dialog.Close asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  title="Close (Escape)"
                >
                  <X className="w-4 h-4" />
                </Button>
              </Dialog.Close>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {comparisonState.isLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <RefreshCw className="w-10 h-10 mb-4 animate-spin" />
                <p className="text-lg font-medium">Loading comparison data...</p>
                <p className="text-sm mt-1">Extracting document content</p>
              </div>
            ) : comparisonState.error ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <AlertCircle className="w-10 h-10 mb-4 text-destructive" />
                <p className="text-lg font-medium text-destructive">Unable to load comparison</p>
                <p className="text-sm mt-2 max-w-md text-center">{comparisonState.error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={loadComparisonData}
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Retry
                </Button>
              </div>
            ) : (
              <SideBySideDiff
                originalContent={comparisonState.originalText}
                modifiedContent={comparisonState.processedText}
                syncScroll={true}
                showLineNumbers={true}
                collapseUnchanged={false}
                height="100%"
              />
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground">
            <div>
              Original: {comparisonState.originalText.length} paragraphs |
              Processed: {comparisonState.processedText.length} paragraphs
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                Removed
              </span>
              <span className="px-2 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                Added
              </span>
              <span className="px-2 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300">
                Modified
              </span>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
