import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  X,
  CheckCircle,
  AlertCircle,
  Clock,
  Loader2,
  Save,
  FileCheck,
  FileText,
  Link,
  MessageSquare,
  Timer,
  Edit2,
  Check,
  Play,
  FolderOpen,
} from 'lucide-react';
import { Button } from '@/components/common/Button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/common/Card';
import { cn } from '@/utils/cn';
import { useSession } from '@/contexts/SessionContext';
import { Session } from '@/types/session';
import { Document } from '@/types/session';
import { TabContainer } from '@/components/sessions/TabContainer';
import { ProcessingOptions, ProcessingOption, defaultOptions } from '@/components/sessions/ProcessingOptions';
import { StylesEditor } from '@/components/sessions/StylesEditor';
import { ReplacementsTab } from '@/components/sessions/ReplacementsTab';
import { TrackedChanges } from '@/components/sessions/TrackedChanges';
import { useToast } from '@/hooks/useToast';
import { Toaster } from '@/components/common/Toast';
import logger from '@/utils/logger';

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
    updateSessionTableUniformitySettings,
  } = useSession();

  const [isDragging, setIsDragging] = useState(false);
  const [processingQueue, setProcessingQueue] = useState<string[]>([]);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [showStylesSaveSuccess, setShowStylesSaveSuccess] = useState(false);

  // Create a stable callback for the save handler
  const handleStylesSave = useCallback(() => {
    // This will trigger the success animation
    setShowStylesSaveSuccess(true);
  }, []);

  useEffect(() => {
    if (id && !currentSession) {
      loadSession(id);
    }
  }, [id, currentSession, loadSession]);

  const session = sessions.find((s) => s.id === id);

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

  const handleFileSelect = async () => {
    // Safely check if electronAPI is available
    if (!window.electronAPI?.selectFiles) {
      console.warn('CurrentSession: electronAPI.selectFiles not available');
      toast({
        title: 'Error',
        description: 'File selection not available. Please restart the application.',
        variant: 'destructive',
      });
      return;
    }

    try {
      // Use Electron's native file dialog
      const filePaths = await window.electronAPI.selectFiles();
      if (!filePaths || filePaths.length === 0) {
        return; // User cancelled
      }

      // Convert file paths to File-like objects with path property and actual size
      const validFiles: (File & { path: string })[] = [];
      const invalidFiles: string[] = [];

      for (const filePath of filePaths) {
        const name = filePath.split(/[\\\/]/).pop() || 'document.docx';

        try {
          // Get actual file size from filesystem
          const stats = await window.electronAPI.getFileStats(filePath);

          // CRITICAL FIX: Create a custom object that implements the File interface
          // We can't use Object.assign on File because its properties are read-only getters
          // Instead, create a plain object with all required File properties plus our custom 'path'
          const fileWithPath = {
            path: filePath,
            name: name,
            size: stats.size,
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            lastModified: stats.mtimeMs || Date.now(),
            // File methods (not used in our code, but required by the interface)
            arrayBuffer: async () => new ArrayBuffer(0),
            slice: () => new Blob(),
            stream: () => new ReadableStream(),
            text: async () => '',
            webkitRelativePath: '',
          } as File & { path: string };

          validFiles.push(fileWithPath);
          logger.debug(`[File Select] Valid file: ${name} (${stats.size} bytes) at ${filePath}`);
        } catch (error) {
          logger.error(`[File Select] Failed to access file at "${filePath}":`, error);
          invalidFiles.push(name);
        }
      }

      // Add valid files to the session
      if (validFiles.length > 0) {
        await addDocuments(session.id, validFiles);
        toast({
          title: 'Files Added',
          description: `Successfully added ${validFiles.length} file(s) to the session.`,
          variant: 'success',
        });
      }

      // Show error toast if any files were invalid
      if (invalidFiles.length > 0) {
        logger.warn(`[File Select] Rejected ${invalidFiles.length} file(s):`, invalidFiles);
        toast({
          title: 'Some Files Could Not Be Added',
          description: `${invalidFiles.length} file(s) could not be accessed. Check file permissions.`,
          variant: 'destructive',
        });
      }

      // If no files were valid at all
      if (validFiles.length === 0 && filePaths.length > 0) {
        toast({
          title: 'No Files Added',
          description: 'None of the selected files could be accessed. Please check file permissions.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      logger.error('[File Select] Unexpected error:', error);
      toast({
        title: 'Error Selecting Files',
        description: error instanceof Error ? error.message : 'An unexpected error occurred.',
        variant: 'destructive',
      });
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files).filter((file) => file.name.endsWith('.docx'));

    if (files.length > 0) {
      // Safely check if electronAPI is available
      if (!window.electronAPI?.getPathsForFiles) {
        console.warn('CurrentSession: electronAPI.getPathsForFiles not available');
        return;
      }

      // Use webUtils.getPathForFile() via preload (Electron v32+ compatible)
      // This is the only way to get file paths from drag-dropped files in modern Electron
      const validFiles: (File & { path: string })[] = [];
      const invalidFiles: string[] = [];

      try {
        // Get absolute paths for all files using webUtils in preload context
        const filePaths = window.electronAPI.getPathsForFiles(files);

        // Validate and attach paths to File objects
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const path = filePaths[i];

          // Validate path exists and is absolute
          if (!path || path.trim() === '') {
            logger.error(`[Drag-Drop] File "${file.name}" has no accessible path`);
            invalidFiles.push(file.name);
            continue;
          }

          // Check if path is absolute (contains directory separators)
          const isAbsolutePath = path.includes('\\') || path.includes('/');
          if (!isAbsolutePath) {
            logger.error(`[Drag-Drop] File "${file.name}" has invalid path: "${path}"`);
            invalidFiles.push(file.name);
            continue;
          }

          // Validate path by getting file stats
          try {
            const stats = await window.electronAPI.getFileStats(path);
            // Create a new object with file properties + path (don't mutate File object)
            // File objects are immutable - their properties are read-only getters
            // TypeScript doesn't allow extending File directly, so we create a compatible object
            const fileWithPath: File & { path: string } = Object.assign(
              new File([], file.name, { type: file.type }),
              {
                path: path,
                size: stats.size,
                name: file.name,
                type: file.type
              }
            );
            validFiles.push(fileWithPath);
          } catch (error) {
            logger.error(`[Drag-Drop] Failed to access file "${file.name}" at path "${path}":`, error);
            invalidFiles.push(file.name);
          }
        }
      } catch (error) {
        logger.error('[Drag-Drop] Failed to get file paths:', error);
        return;
      }

      // Add valid files to the session
      if (validFiles.length > 0) {
        await addDocuments(session.id, validFiles);
      }

      // Log summary
      if (invalidFiles.length > 0) {
        logger.warn(`[Drag-Drop] Rejected ${invalidFiles.length} file(s) due to invalid paths:`, invalidFiles);

        // Show toast notification to user
        toast({
          title: 'Some files could not be added',
          description: `${invalidFiles.length} file(s) rejected: ${invalidFiles.slice(0, 3).join(', ')}${invalidFiles.length > 3 ? '...' : ''}`,
          variant: 'destructive',
        });
      }
      if (validFiles.length > 0) {
        logger.info(`[Drag-Drop] Successfully added ${validFiles.length} file(s)`);

        // Show success toast
        toast({
          title: 'Files added successfully',
          description: `${validFiles.length} file(s) added to session`,
          variant: 'success',
        });
      }
    }
  };

  const handleProcessDocument = async (documentId: string) => {
    setProcessingQueue((prev) => [...prev, documentId]);
    await processDocument(session.id, documentId);
    setProcessingQueue((prev) => prev.filter((id) => id !== documentId));

    // Show success toast after processing completes
    const doc = session.documents.find((d) => d.id === documentId);
    if (doc?.status === 'completed' && doc.path) {
      toast({
        title: '✅ Processing Complete',
        description: `${doc.name} is ready! Click the green button to open in Word.`,
        variant: 'success',
        duration: 6000,
      });
    } else if (doc?.status === 'error') {
      toast({
        title: 'Processing Failed',
        description: doc.errors?.[0] || 'An error occurred while processing the document.',
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
    const enabledOperations = options
      .filter(opt => opt.enabled)
      .map(opt => opt.id);

    // Update session processing options using the context method
    updateSessionOptions(session.id, {
      appendContentId: enabledOperations.includes('fix-content-ids'),
      contentIdToAppend: '#content',
      validateUrls: true,
      createBackup: true,
      processInternalLinks: enabledOperations.includes('fix-internal-hyperlinks'),
      processExternalLinks: true,
      enabledOperations: enabledOperations,
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

  // Convert session processing options to ProcessingOption[] format for initializing the component
  const getInitialProcessingOptions = (): ProcessingOption[] => {
    const enabledOps = session.processingOptions?.enabledOperations || [];
    return defaultOptions.map(opt => ({
      ...opt,
      enabled: enabledOps.includes(opt.id)
    }));
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
                <p className="text-xs text-muted-foreground">
                  101 seconds per hyperlink
                </p>
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
                      .filter(doc => doc.status === 'pending')
                      .forEach(doc => handleProcessDocument(doc.id));
                  }}
                  size="sm"
                  variant="default"
                  className="bg-green-600 hover:bg-green-700 text-white"
                  icon={<Play className="w-4 h-4" />}
                  disabled={!session.documents.some(doc => doc.status === 'pending')}
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
                                  title: 'Opening Document',
                                  description: 'Launching Microsoft Word...',
                                });
                              } catch (err) {
                                logger.error('Failed to open document:', err);
                                toast({
                                  title: 'Error',
                                  description: err instanceof Error ? err.message : 'Could not open document',
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

  // Header actions for each tab
  const headerActions: Record<string, React.ReactNode> = {
    styles: (
      <Button
        variant="default"
        size="sm"
        icon={<Save className="w-4 h-4" />}
        onClick={handleStylesSave}
        showSuccess={showStylesSaveSuccess}
        onSuccess={() => setShowStylesSaveSuccess(false)}
      >
        Save Styles
      </Button>
    ),
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
          initialOptions={getInitialProcessingOptions()}
          onOptionsChange={handleProcessingOptionsChange}
        />
      ),
    },
    {
      id: 'styles',
      label: 'Styles',
      content: (
        <StylesEditor
          initialStyles={session.styles}
          onStylesChange={(styles) => {
            updateSessionStyles(session.id, styles);
            // Automatically trigger the save success animation
            setShowStylesSaveSuccess(true);
          }}
          onListBulletSettingsChange={(settings) => {
            updateSessionListBulletSettings(session.id, settings);
          }}
          onTableUniformitySettingsChange={(settings) => {
            updateSessionTableUniformitySettings(session.id, settings);
          }}
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
      label: 'Tracked Changes',
      content: <TrackedChanges sessionId={session.id} />,
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
