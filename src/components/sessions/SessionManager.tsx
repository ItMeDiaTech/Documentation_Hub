import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, FolderOpen, Plus, Calendar, FileText } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { cn } from '@/utils/cn';
import { useSession } from '@/contexts/SessionContext';

interface SessionManagerProps {
  mode: 'new' | 'load';
  onClose: () => void;
  onSessionCreated: (sessionId: string) => void;
  onSessionLoaded: (sessionId: string) => void;
}

export function SessionManager({
  mode,
  onClose,
  onSessionCreated,
  onSessionLoaded,
}: SessionManagerProps) {
  const { sessions, createSession, loadSession } = useSession();
  const [sessionName, setSessionName] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const handleCreateSession = () => {
    if (sessionName.trim()) {
      const newSession = createSession(sessionName.trim());
      onSessionCreated(newSession.id);
      onClose();
    }
  };

  const handleLoadSession = () => {
    if (selectedSessionId) {
      loadSession(selectedSessionId);
      onSessionLoaded(selectedSessionId);
      onClose();
    }
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-background/80 backdrop-blur-xs z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-card rounded-xl shadow-2xl border border-border max-w-md w-full max-h-[80vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-6 border-b border-border">
            <div>
              <h2 className="text-xl font-semibold">
                {mode === 'new' ? 'New Session' : 'Load Session'}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {mode === 'new'
                  ? 'Create a new document processing session'
                  : 'Select a session to continue working'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6">
            {mode === 'new' ? (
              <div className="space-y-4">
                <Input
                  label="Session Name"
                  placeholder="Enter session name"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCreateSession();
                    }
                  }}
                  autoFocus
                />
                <Button
                  onClick={handleCreateSession}
                  className="w-full"
                  disabled={!sessionName.trim()}
                  icon={<Plus className="w-4 h-4" />}
                >
                  Create Session
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {sessions.length === 0 ? (
                  <div className="text-center py-8">
                    <FolderOpen className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                    <p className="text-muted-foreground">No sessions available</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Create a new session to get started
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {sessions.map((session) => (
                        <motion.div
                          key={session.id}
                          className={cn(
                            'p-4 rounded-lg border cursor-pointer transition-all',
                            selectedSessionId === session.id
                              ? 'border-primary bg-primary/5'
                              : 'border-border hover:bg-muted/50'
                          )}
                          onClick={() => setSelectedSessionId(session.id)}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="font-medium">{session.name}</p>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
                                <span className="flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  {formatDate(session.createdAt)}
                                </span>
                                <span className="flex items-center gap-1">
                                  <FileText className="w-3 h-3" />
                                  {session.documents.length} documents
                                </span>
                              </div>
                            </div>
                            <span className={cn(
                              'text-xs px-2 py-1 rounded-full',
                              session.status === 'active'
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                : 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'
                            )}>
                              {session.status}
                            </span>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                    <Button
                      onClick={handleLoadSession}
                      className="w-full"
                      disabled={!selectedSessionId}
                      icon={<FolderOpen className="w-4 h-4" />}
                    >
                      Load Session
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}