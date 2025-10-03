import { useState, useEffect } from 'react';
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
  Link,
  MessageSquare,
  Timer,
  Edit2,
  Check,
  Play,
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
import { ProcessingOptions } from '@/components/sessions/ProcessingOptions';
import { StylesEditor } from '@/components/sessions/StylesEditor';
import { ReplacementsTab } from '@/components/sessions/ReplacementsTab';
import { TrackedChanges } from '@/components/sessions/TrackedChanges';

export function CurrentSession() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
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
  } = useSession();

  const [isDragging, setIsDragging] = useState(false);
  const [processingQueue, setProcessingQueue] = useState<string[]>([]);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');

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
    // Use Electron's native file dialog
    const filePaths = await window.electronAPI.selectFiles();
    if (filePaths && filePaths.length > 0) {
      // Convert file paths to File-like objects with path property
      const files = filePaths.map(filePath => {
        const name = filePath.split(/[\\\/]/).pop() || 'document.docx';
        return {
          name,
          path: filePath,
          size: 0, // Size will be determined by the backend
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        } as File & { path: string };
      });
      await addDocuments(session.id, files);
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
      // Add file paths to the File objects for Electron processing
      const filesWithPaths = files.map(file => Object.assign(file, { path: (file as any).path }));
      await addDocuments(session.id, filesWithPaths);
    }
  };

  const handleProcessDocument = async (documentId: string) => {
    setProcessingQueue((prev) => [...prev, documentId]);
    await processDocument(session.id, documentId);
    setProcessingQueue((prev) => prev.filter((id) => id !== documentId));
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

  const handleProcessingOptionsChange = (options: any[]) => {
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
      content: <ProcessingOptions sessionId={session.id} onOptionsChange={handleProcessingOptionsChange} />,
    },
    {
      id: 'styles',
      label: 'Styles',
      content: <StylesEditor />,
    },
    {
      id: 'replacements',
      label: 'Replacements',
      content: <ReplacementsTab />,
    },
    {
      id: 'tracked-changes',
      label: 'Tracked Changes',
      content: <TrackedChanges sessionId={session.id} />,
    },
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header with Title Edit */}
      <div className="flex items-center gap-2">
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

      {/* Tabbed Interface */}
      <Card>
        <TabContainer tabs={tabs} defaultTab="session" />
      </Card>
    </div>
  );
}
