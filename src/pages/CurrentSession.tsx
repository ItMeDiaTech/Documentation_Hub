import { Button } from '@/components/common/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/common/Card';
import { Toaster } from '@/components/common/Toast';
import {
  ProcessingOption,
  ProcessingOptions,
  defaultOptions,
} from '@/components/sessions/ProcessingOptions';
import { ReplacementsTab } from '@/components/sessions/ReplacementsTab';
import { StylesEditor } from '@/components/sessions/StylesEditor';
import { TabContainer } from '@/components/sessions/TabContainer';
import { ChangeViewer } from '@/components/sessions/ChangeViewer';
import { useSession } from '@/contexts/SessionContext';
import { useToast } from '@/hooks/useToast';
import type { Document } from '@/types/session';
import { cn } from '@/utils/cn';
import logger from '@/utils/logger';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  Check,
  CheckCircle,
  Clock,
  Edit2,
  FileCheck,
  FileText,
  FolderOpen,
  Link,
  Loader2,
  MessageSquare,
  Play,
  RotateCcw,
  Save,
  Timer,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

export function CurrentSession() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toasts, toast, dismiss } = useToast();
  const {
    sessions,
    currentSession,
    loadSession,
    closeSession,
    addDocuments,
    removeDocument,
    processDocument,
    updateSessionName,
    updateSessionOptions,
    updateSessionStyles,
    updateSessionListBulletSettings,
    updateSessionTableShadingSettings,
    resetSessionToDefaults,
    saveAsCustomDefaults,
  } = useSession();

  const [isDragging, setIsDragging] = useState(false);
  const [processingQueue, setProcessingQueue] = useState<string[]>([]);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');

  // Refs for preventing race conditions
  const isSelectingFiles = useRef(false);
  const isMountedRef = useRef(true);

  // STALE CLOSURE FIX: Track latest sessions for async operations
  // This ref always holds the current sessions value, even inside async callbacks
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions; // Update on every render

  // Track component mount status for safe async operations
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (id && !currentSession) {
      loadSession(id);
    }
  }, [id, currentSession, loadSession]);

  const session = sessions.find((s) => s.id === id);

  // REFACTORED: Convert session processing options to ProcessingOption[] format
  // Using useMemo to ensure we always have latest session data
  // This prevents stale closure issues that caused toggle auto-revert bug
  // IMPORTANT: Must be called before any conditional returns (Rules of Hooks)
  const processingOptions = useMemo((): ProcessingOption[] => {
    const enabledOps = session?.processingOptions?.enabledOperations || [];
    return defaultOptions.map((opt) => ({
      ...opt,
      enabled: enabledOps.includes(opt.id),
    }));
  }, [session?.processingOptions]);

  const handleFileSelect = useCallback(async () => {
    // Prevent concurrent file selections
    if (isSelectingFiles.current) {
      logger.debug('[File Select] Already selecting files, ignoring request');
      return;
    }

    // Store current session ID for stale reference check
    const currentSessionId = session?.id;
    if (!currentSessionId) {
      toast({
        title: 'No active session',
        variant: 'destructive',
      });
      return;
    }

    // Safely check if electronAPI is available
    const api = window.electronAPI;
    if (!api?.selectDocuments || !api?.getFileStats) {
      console.warn('CurrentSession: electronAPI methods not available');
      toast({
        title: 'File selection unavailable',
        description: 'Please restart app',
        variant: 'destructive',
      });
      return;
    }

    isSelectingFiles.current = true;

    try {
      // Use Electron's native file dialog
      const filePaths = await api.selectDocuments();

      // Check if component is still mounted and session hasn't changed
      if (!isMountedRef.current) {
        logger.debug('[File Select] Component unmounted during file selection');
        return;
      }

      if (!filePaths || filePaths.length === 0) {
        return; // User cancelled
      }

      // Verify session is still valid
      if (session?.id !== currentSessionId) {
        logger.warn('[File Select] Session changed during file selection');
        toast({
          title: 'Session changed',
          description: 'Please try again',
          variant: 'destructive',
        });
        return;
      }

      // Convert file paths to File-like objects with path property and actual size
      const validFiles: (File & { path: string })[] = [];
      const invalidFiles: string[] = [];

      for (const filePath of filePaths) {
        // Early exit if component unmounted
        if (!isMountedRef.current) {
          logger.debug('[File Select] Component unmounted during file processing');
          return;
        }

        const name = filePath.split(/[\\/]/).pop() || 'document.docx';

        try {
          // Get actual file size from filesystem
          const stats = await api.getFileStats(filePath);

          // Create a File-like object with the required properties
          // Note: File methods are stubs since we use the path for actual file operations
          const fileWithPath = {
            path: filePath,
            name: name,
            size: stats.size,
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            lastModified: stats.mtimeMs || Date.now(),
            webkitRelativePath: '',
            // Stub methods - these are not used since we process via Electron IPC with file paths
            arrayBuffer: async () => {
              throw new Error('Use Electron IPC for file operations');
            },
            slice: () => new Blob(),
            stream: () => {
              throw new Error('Use Electron IPC for file operations');
            },
            text: async () => {
              throw new Error('Use Electron IPC for file operations');
            },
            bytes: async () => {
              throw new Error('Use Electron IPC for file operations');
            },
          } as unknown as File & { path: string };

          validFiles.push(fileWithPath);
          logger.debug(`[File Select] Valid file: ${name} (${stats.size} bytes) at ${filePath}`);
        } catch (error) {
          logger.error(`[File Select] Failed to access file at "${filePath}":`, error);
          invalidFiles.push(name);
        }
      }

      // Final mount check before updating state
      if (!isMountedRef.current) {
        return;
      }

      // Add valid files to the session
      if (validFiles.length > 0) {
        await addDocuments(currentSessionId, validFiles);

        if (isMountedRef.current) {
          toast({
            title: `${validFiles.length} file${validFiles.length > 1 ? 's' : ''} added`,
            variant: 'success',
          });
        }
      }

      // Show error toast if any files were invalid
      if (invalidFiles.length > 0 && isMountedRef.current) {
        logger.warn(`[File Select] Rejected ${invalidFiles.length} file(s):`, invalidFiles);
        toast({
          title: 'Access denied',
          description: `${invalidFiles.length} file${invalidFiles.length > 1 ? 's' : ''} skipped`,
          variant: 'destructive',
        });
      }

      // If no files were valid at all
      if (validFiles.length === 0 && filePaths.length > 0 && isMountedRef.current) {
        toast({
          title: 'Cannot access files',
          description: 'Check file permissions',
          variant: 'destructive',
        });
      }
    } catch (error) {
      if (isMountedRef.current) {
        logger.error('[File Select] Unexpected error:', error);
        toast({
          title: 'Selection failed',
          description: error instanceof Error ? error.message : 'Unexpected error',
          variant: 'destructive',
        });
      }
    } finally {
      isSelectingFiles.current = false;
    }
  }, [session?.id, addDocuments, toast]);

  if (!session) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="max-w-md">
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">Session Not Found</h2>
            <p className="text-muted-foreground mb-4">
              The session you are looking for does not exist or has been deleted.
            </p>
            <Button onClick={() => navigate('/')}>Return to Dashboard</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  // Handle drag-drop files using getPathsForFiles API
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (!session || !e.dataTransfer?.files?.length) return;

    const files = Array.from(e.dataTransfer.files);

    // Get file paths using the preload API
    const paths = window.electronAPI?.getPathsForFiles?.(files) || [];

    // Filter for .docx files with valid paths
    const validFiles = files
      .map((file, i) => ({
        file,
        path: paths[i] || '',
      }))
      .filter(({ file, path }) => file.name.endsWith('.docx') && path)
      .map(({ file, path }) => ({
        name: file.name,
        path: path,
        size: file.size,
        type: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        lastModified: file.lastModified,
        arrayBuffer: async () => new ArrayBuffer(0),
        slice: () => new Blob(),
        stream: () => new ReadableStream(),
        text: async () => '',
        webkitRelativePath: '',
      } as File & { path: string }));

    if (validFiles.length === 0) {
      logger.warn('[Drag-Drop] No valid .docx files dropped');
      return;
    }

    addDocuments(session.id, validFiles);

    toast({
      title: `${validFiles.length} file${validFiles.length > 1 ? 's' : ''} added`,
      variant: 'success',
    });
  };

  const handleProcessDocument = async (documentId: string) => {
    // Show brief processing indicator
    const enabledOps = session.processingOptions?.enabledOperations || [];
    const operationsCount = enabledOps.length;

    if (operationsCount > 0) {
      toast({
        title: 'Processing...',
        description: `${operationsCount} operation${operationsCount > 1 ? 's' : ''}`,
        variant: 'default',
        duration: 2000,
      });
    }

    setProcessingQueue((prev) => [...prev, documentId]);
    const sessionId = session.id; // Capture sessionId before async operation
    await processDocument(sessionId, documentId);
    setProcessingQueue((prev) => prev.filter((id) => id !== documentId));

    // STALE CLOSURE FIX: Get fresh session data from sessionsRef after async operation
    // The `session` and `sessions` variables from the closure would be stale after processDocument completes
    // because React state updates are batched and the closure captures the old value.
    // Using sessionsRef.current ensures we always get the latest state.
    const freshSession = sessionsRef.current.find((s) => s.id === sessionId);
    const processedDoc = freshSession?.documents.find((d) => d.id === documentId);

    if (processedDoc?.status === 'completed' && processedDoc.path) {
      toast({
        title: 'Done',
        description: processedDoc.name,
        variant: 'success',
      });
    } else if (processedDoc?.status === 'error') {
      toast({
        title: 'Processing failed',
        description: processedDoc.errors?.[0] || 'Document error',
        variant: 'destructive',
      });
    }
  };

  const handleSaveAndClose = () => {
    closeSession(session.id);
    navigate('/');
  };

  const handleEditTitle = () => {
    setEditedTitle(session.name);
    setIsEditingTitle(true);
  };

  const handleSaveTitle = () => {
    if (editedTitle.trim() && editedTitle !== session.name) {
      updateSessionName(session.id, editedTitle.trim());
    }
    setIsEditingTitle(false);
  };

  const handleCancelEdit = () => {
    setIsEditingTitle(false);
    setEditedTitle('');
  };

  const handleProcessingOptionsChange = (options: Array<{ id: string; enabled: boolean }>) => {
    // Update session with selected processing options
    const enabledOperations = options.filter((opt) => opt.enabled).map((opt) => opt.id);

    // DEBUG: Log processing options changes
    console.log('[CurrentSession] Processing options changed:');
    console.log('  - Enabled operations:', enabledOperations);
    console.log('  - TOC enabled:', enabledOperations.includes('update-toc-hyperlinks'));
    console.log(
      '  - Validate styles enabled:',
      enabledOperations.includes('validate-document-styles')
    );
    console.log(
      '  - Validate Header2 tables enabled:',
      enabledOperations.includes('validate-header2-tables')
    );

    // Update session processing options using the context method
    updateSessionOptions(session.id, {
      validateUrls: true,
      createBackup: true,
      processInternalLinks: enabledOperations.includes('fix-internal-hyperlinks'),
      processExternalLinks: true,
      enabledOperations: enabledOperations,
    });
  };

  const handleTableShadingChange = (header2: string, other: string) => {
    // Update session table shading settings
    updateSessionTableShadingSettings(session.id, {
      header2Shading: header2,
      otherShading: other,
    });
  };

  const handleAutoAcceptRevisionsChange = (autoAccept: boolean) => {
    // Update session auto-accept revisions setting
    // Note: We need to provide all required fields since TypeScript expects them
    updateSessionOptions(session.id, {
      validateUrls: session.processingOptions?.validateUrls ?? true,
      createBackup: session.processingOptions?.createBackup ?? true,
      processInternalLinks: session.processingOptions?.processInternalLinks ?? true,
      processExternalLinks: session.processingOptions?.processExternalLinks ?? true,
      enabledOperations: session.processingOptions?.enabledOperations ?? [],
      autoAcceptRevisions: autoAccept,
    });
  };

  const getStatusIcon = (status: Document['status']) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-muted-foreground" />;
      case 'processing':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Create session content for the Session tab
  const sessionContent = (
    <div className="space-y-6">
      {/* Save and Close Button */}
      <div className="flex justify-end">
        <Button
          onClick={handleSaveAndClose}
          variant="default"
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
          icon={<Save className="w-4 h-4" />}
        >
          Save and Close Session
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <FileCheck className="w-8 h-8 text-green-500" />
              <div>
                <p className="text-xs text-muted-foreground">Documents</p>
                <p className="text-2xl font-bold">{session.stats.documentsProcessed}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Link className="w-8 h-8 text-blue-500" />
              <div>
                <p className="text-xs text-muted-foreground">Hyperlinks</p>
                <p className="text-2xl font-bold">{session.stats.hyperlinksChecked}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <MessageSquare className="w-8 h-8 text-purple-500" />
              <div>
                <p className="text-xs text-muted-foreground">Feedback</p>
                <p className="text-2xl font-bold">{session.stats.feedbackImported}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Timer className="w-8 h-8 text-orange-500" />
              <div>
                <p className="text-xs text-muted-foreground">Time Saved</p>
                <p className="text-2xl font-bold">
                  {Math.round((session.stats.hyperlinksChecked * 101) / 60)}m
                </p>
                <p className="text-xs text-muted-foreground">101 seconds per hyperlink</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Document Upload Area */}
      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
          <CardDescription>Upload and process Word documents (.docx)</CardDescription>
        </CardHeader>
        <CardContent>
          {session.documents.length === 0 ? (
            <div
              className={cn(
                'border-2 border-dashed rounded-lg p-8 text-center transition-colors',
                isDragging ? 'border-primary bg-primary/5' : 'border-border'
              )}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <Upload className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">
                {isDragging ? 'Drop files here' : 'Upload Documents'}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Drag and drop .docx files here, or click to browse
              </p>
              <Button onClick={handleFileSelect} icon={<Upload className="w-4 h-4" />}>
                Load Files
              </Button>
            </div>
          ) : (
            <>
              <div className="mb-4 flex justify-between">
                <Button
                  onClick={() => {
                    // Process all pending documents
                    session.documents
                      .filter((doc) => doc.status === 'pending')
                      .forEach((doc) => handleProcessDocument(doc.id));
                  }}
                  size="sm"
                  variant="default"
                  className="bg-green-600 hover:bg-green-700 text-white"
                  icon={<Play className="w-4 h-4" />}
                  disabled={!session.documents.some((doc) => doc.status === 'pending')}
                >
                  Process Documents
                </Button>
                <Button
                  onClick={handleFileSelect}
                  size="sm"
                  variant="default"
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  icon={<Upload className="w-4 h-4" />}
                >
                  Add More Files
                </Button>
              </div>

              <div className="space-y-2">
                <AnimatePresence>
                  {session.documents.map((doc) => (
                    <motion.div
                      key={doc.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition-all group"
                    >
                      <div className="flex items-center gap-3">
                        {getStatusIcon(doc.status)}
                        <div>
                          <p className="font-medium text-sm">{doc.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(doc.size)}
                            {doc.processedAt &&
                              ` • Processed ${new Date(doc.processedAt).toLocaleTimeString()}`}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {doc.status === 'pending' && (
                          <Button
                            size="xs"
                            onClick={() => handleProcessDocument(doc.id)}
                            disabled={processingQueue.includes(doc.id)}
                          >
                            Process
                          </Button>
                        )}

                        {doc.status === 'processing' && (
                          <span className="text-xs text-blue-500 font-medium">Processing...</span>
                        )}

                        {doc.status === 'completed' && (
                          <span className="text-xs text-green-500 font-medium">Completed</span>
                        )}

                        {doc.status === 'error' && (
                          <span className="text-xs text-red-500 font-medium">Error</span>
                        )}

                        {/* Open Document button - only show for completed documents */}
                        {doc.status === 'completed' && doc.path && (
                          <button
                            onClick={async () => {
                              try {
                                await window.electronAPI.openDocument(doc.path!);
                                toast({
                                  title: 'Opening in Word',
                                  variant: 'default',
                                });
                              } catch (err) {
                                logger.error('Failed to open document:', err);
                                toast({
                                  title: 'Cannot open file',
                                  description: err instanceof Error ? err.message : undefined,
                                  variant: 'destructive',
                                });
                              }
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-green-50 dark:hover:bg-green-950"
                            title="Open document in Word"
                          >
                            <FileText className="w-4 h-4 text-green-600 dark:text-green-400" />
                          </button>
                        )}

                        {/* Show in Folder button */}
                        {doc.path && (
                          <button
                            onClick={async () => {
                              try {
                                await window.electronAPI.showInFolder(doc.path!);
                              } catch (err) {
                                logger.error('Failed to open file location:', err);
                              }
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-background"
                            title="Open file location"
                          >
                            <FolderOpen className="w-4 h-4 text-muted-foreground" />
                          </button>
                        )}

                        <button
                          onClick={() => removeDocument(session.id, doc.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-background"
                        >
                          <X className="w-4 h-4 text-muted-foreground" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              <div
                className={cn(
                  'mt-4 border-2 border-dashed rounded-lg p-4 text-center transition-colors',
                  isDragging ? 'border-primary bg-primary/5' : 'border-border'
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <p className="text-sm text-muted-foreground">
                  {isDragging ? 'Drop files here to add' : 'Drag and drop more files here'}
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );

  // Header actions for tab headers - Reset/Save Default buttons
  const handleResetToDefaults = () => {
    if (session) {
      resetSessionToDefaults(session.id);
      toast({
        title: 'Settings reset',
        variant: 'default',
      });
    }
  };

  const handleSaveAsDefaults = () => {
    if (session) {
      saveAsCustomDefaults(session.id);
      toast({
        title: 'Saved as default',
        variant: 'success',
      });
    }
  };

  const settingsButtons = (
    <div className="flex items-center gap-2">
      <Button
        size="xs"
        variant="ghost"
        onClick={handleResetToDefaults}
        className="text-xs"
        icon={<RotateCcw className="w-3 h-3" />}
      >
        Reset
      </Button>
      <Button
        size="xs"
        variant="outline"
        onClick={handleSaveAsDefaults}
        className="text-xs"
        icon={<Save className="w-3 h-3" />}
      >
        Save as Default
      </Button>
    </div>
  );

  const headerActions: Record<string, React.ReactNode> = {
    processing: settingsButtons,
    styles: settingsButtons,
  };

  // Create tabs configuration
  const tabs = [
    {
      id: 'session',
      label: `Session: ${session.name}`,
      content: sessionContent,
    },
    {
      id: 'processing',
      label: 'Processing Options',
      content: (
        <ProcessingOptions
          sessionId={session.id}
          options={processingOptions}
          onOptionsChange={handleProcessingOptionsChange}
          autoAcceptRevisions={session.processingOptions?.autoAcceptRevisions ?? true}
          onAutoAcceptRevisionsChange={handleAutoAcceptRevisionsChange}
        />
      ),
    },
    {
      id: 'styles',
      label: 'Styles',
      content: (
        <StylesEditor
          initialStyles={session.styles}
          initialListBulletSettings={session.listBulletSettings}
          onStylesChange={(styles) => {
            // Auto-save: changes are persisted immediately to SessionContext
            updateSessionStyles(session.id, styles);
          }}
          onListBulletSettingsChange={(settings) => {
            // Auto-save: changes are persisted immediately to SessionContext
            updateSessionListBulletSettings(session.id, settings);
          }}
          tableHeader2Shading={session.tableShadingSettings?.header2Shading || '#BFBFBF'}
          tableOtherShading={session.tableShadingSettings?.otherShading || '#DFDFDF'}
          onTableShadingChange={handleTableShadingChange}
        />
      ),
    },
    {
      id: 'replacements',
      label: 'Replacements',
      content: <ReplacementsTab sessionId={session.id} />,
    },
    {
      id: 'tracked-changes',
      label: 'Document Changes',
      content: <ChangeViewer sessionId={session.id} />,
    },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Toast notifications */}
      <Toaster toasts={toasts} onDismiss={dismiss} />

      {/* Sticky Header Section */}
      <div className="sticky top-0 z-30 bg-background p-6 pb-0 max-w-6xl mx-auto w-full">
        {/* Title Edit */}
        <div className="flex items-center gap-2 mb-6">
          {isEditingTitle ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveTitle();
                  if (e.key === 'Escape') handleCancelEdit();
                }}
                className="text-3xl font-bold bg-transparent border-b-2 border-primary outline-none px-1"
                autoFocus
              />
              <button
                onClick={handleSaveTitle}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors"
              >
                <Check className="w-5 h-5 text-green-500" />
              </button>
              <button
                onClick={handleCancelEdit}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors"
              >
                <X className="w-5 h-5 text-red-500" />
              </button>
            </div>
          ) : (
            <>
              <h1 className="text-3xl font-bold">{session.name}</h1>
              <button
                onClick={handleEditTitle}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                title="Edit session name"
              >
                <Edit2 className="w-4 h-4 text-muted-foreground" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-auto px-6 max-w-6xl mx-auto w-full">
        <Card>
          <TabContainer tabs={tabs} defaultTab="session" headerActions={headerActions} />
        </Card>
      </div>
    </div>
  );
}
