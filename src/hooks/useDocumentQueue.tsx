import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '@/contexts/SessionContext';
import type { QueueItem } from '@/types/session';

export interface UseDocumentQueueOptions {
  onDocumentComplete?: (documentId: string, success: boolean) => void;
  onQueueComplete?: () => void;
  onError?: (documentId: string, error: string) => void;
}

export interface UseDocumentQueueReturn {
  // State
  queue: QueueItem[];
  isProcessing: boolean;
  currentDocumentId: string | null;

  // Actions
  addToQueue: (sessionId: string, documentId: string) => void;
  addManyToQueue: (sessionId: string, documentIds: string[]) => void;
  removeFromQueue: (documentId: string) => void;
  clearQueue: () => void;

  // Utility
  getQueuePosition: (documentId: string) => number; // -1 if not in queue
  isInQueue: (documentId: string) => boolean;
}

export function useDocumentQueue(
  options: UseDocumentQueueOptions = {}
): UseDocumentQueueReturn {
  const { processDocument } = useSession();
  const { onDocumentComplete, onQueueComplete, onError } = options;

  // Use refs for queue management to prevent stale closures
  const queueRef = useRef<QueueItem[]>([]);
  const isProcessingRef = useRef(false);
  const isMountedRef = useRef(true);

  // State for UI reactivity (synced from refs)
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentDocumentId, setCurrentDocumentId] = useState<string | null>(null);

  // Sync ref to state for UI updates
  const syncState = useCallback(() => {
    if (isMountedRef.current) {
      setQueue([...queueRef.current]);
      setIsProcessing(isProcessingRef.current);
    }
  }, []);

  // Process next document in queue
  const processNext = useCallback(async () => {
    // Check if we should process
    if (isProcessingRef.current || queueRef.current.length === 0) {
      return;
    }

    // Get next item that is still queued
    const nextItem = queueRef.current.find(item => item.status === 'queued');
    if (!nextItem) {
      return;
    }

    // Mark as processing
    isProcessingRef.current = true;
    nextItem.status = 'processing';
    setCurrentDocumentId(nextItem.documentId);
    syncState();

    try {
      // Process the document (this is the IPC call that makes the API request)
      await processDocument(nextItem.sessionId, nextItem.documentId);

      // Mark as completed
      nextItem.status = 'completed';
      onDocumentComplete?.(nextItem.documentId, true);
    } catch (error) {
      // Mark as error
      nextItem.status = 'error';
      const errorMessage = error instanceof Error ? error.message : 'Processing failed';
      onError?.(nextItem.documentId, errorMessage);
      onDocumentComplete?.(nextItem.documentId, false);
    }

    // Remove from queue
    queueRef.current = queueRef.current.filter(item => item.documentId !== nextItem.documentId);
    isProcessingRef.current = false;
    setCurrentDocumentId(null);
    syncState();

    // Check if queue is complete
    if (queueRef.current.length === 0) {
      onQueueComplete?.();
    } else {
      // Process next item with small delay to prevent overwhelming
      setTimeout(processNext, 100);
    }
  }, [processDocument, syncState, onDocumentComplete, onQueueComplete, onError]);

  // Add single document to queue
  const addToQueue = useCallback((sessionId: string, documentId: string) => {
    // Check if already in queue
    if (queueRef.current.some(item => item.documentId === documentId)) {
      return;
    }

    const newItem: QueueItem = {
      documentId,
      sessionId,
      addedAt: new Date(),
      status: 'queued',
    };

    queueRef.current = [...queueRef.current, newItem];
    syncState();

    // Start processing if not already
    processNext();
  }, [syncState, processNext]);

  // Add multiple documents to queue
  const addManyToQueue = useCallback((sessionId: string, documentIds: string[]) => {
    const newItems: QueueItem[] = documentIds
      .filter(id => !queueRef.current.some(item => item.documentId === id))
      .map(documentId => ({
        documentId,
        sessionId,
        addedAt: new Date(),
        status: 'queued' as const,
      }));

    if (newItems.length > 0) {
      queueRef.current = [...queueRef.current, ...newItems];
      syncState();
      processNext();
    }
  }, [syncState, processNext]);

  // Remove document from queue
  const removeFromQueue = useCallback((documentId: string) => {
    queueRef.current = queueRef.current.filter(item => item.documentId !== documentId);
    syncState();
  }, [syncState]);

  // Clear entire queue
  const clearQueue = useCallback(() => {
    queueRef.current = [];
    syncState();
  }, [syncState]);

  // Get queue position for a document
  const getQueuePosition = useCallback((documentId: string): number => {
    return queueRef.current.findIndex(item => item.documentId === documentId);
  }, []);

  // Check if document is in queue
  const isInQueue = useCallback((documentId: string): boolean => {
    return queueRef.current.some(item => item.documentId === documentId);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return {
    queue,
    isProcessing,
    currentDocumentId,
    addToQueue,
    addManyToQueue,
    removeFromQueue,
    clearQueue,
    getQueuePosition,
    isInQueue,
  };
}
