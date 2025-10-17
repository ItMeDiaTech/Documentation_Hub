import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Plus, FolderOpen, Clock, FileText, Grid, List, Calendar, Trash2 } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useSession } from '@/contexts/SessionContext';
import { SessionManager } from '@/components/sessions/SessionManager';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
    },
  },
};

export function Sessions() {
  const navigate = useNavigate();
  const { sessions, loadSession, deleteSession } = useSession();
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showSessionManager, setShowSessionManager] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  const filteredSessions = sessions.filter((session) =>
    session.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSessionClick = (sessionId: string) => {
    loadSession(sessionId);
    navigate(`/session/${sessionId}`);
  };

  const handleDeleteSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(sessionId);
  };

  const confirmDelete = (sessionId: string) => {
    deleteSession(sessionId);
    setShowDeleteConfirm(null);
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  };

  const handleNewSession = () => {
    setShowSessionManager(true);
  };

  const handleSessionCreated = (sessionId: string) => {
    navigate(`/session/${sessionId}`);
  };

  return (
    <motion.div
      className="p-6 space-y-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.div
        className="flex flex-col sm:flex-row gap-4 justify-between"
        variants={itemVariants}
      >
        <Input
          type="search"
          placeholder="Search sessions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onClear={() => setSearchQuery('')}
          className="max-w-md"
        />

        <div className="flex gap-2">
          <div className="flex rounded-md border border-border">
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                'p-2 rounded-l-md transition-colors',
                viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              )}
              aria-label="Grid view"
            >
              <Grid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                'p-2 rounded-r-md transition-colors',
                viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              )}
              aria-label="List view"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
          <Button icon={<Plus className="w-4 h-4" />} onClick={handleNewSession}>
            New Session
          </Button>
        </div>
      </motion.div>

      <motion.div
        className={cn(
          'grid gap-4',
          viewMode === 'grid' ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1'
        )}
        variants={containerVariants}
      >
        {filteredSessions.map((session) => (
          <motion.div key={session.id} variants={itemVariants}>
            <Card
              interactive
              variant="bordered"
              className="cursor-pointer relative group"
              onClick={() => handleSessionClick(session.id)}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <FolderOpen className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-xl font-semibold">{session.name}</CardTitle>
                      <span
                        className={cn(
                          'text-xs px-2 py-1 rounded-full mt-1 inline-block',
                          session.status === 'active'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'
                        )}
                      >
                        {session.status}
                      </span>
                    </div>
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => handleDeleteSession(session.id, e)}
                      className="p-1 hover:bg-muted rounded"
                    >
                      <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-base">
                    <div className="flex items-center gap-1 text-foreground">
                      <FileText className="w-3 h-3" />
                      <span>{session.documents.length} documents</span>
                    </div>
                    <div className="flex items-center gap-1 text-foreground">
                      <Clock className="w-3 h-3" />
                      <span>{session.stats.timeSaved}m saved</span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-border">
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        <span>Created {formatDate(session.createdAt)}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-sm text-muted-foreground mt-1">
                      <span>Last modified {formatDate(session.lastModified)}</span>
                    </div>
                  </div>

                  {viewMode === 'list' && (
                    <div className="pt-2 grid grid-cols-4 gap-2 text-sm">
                      <div>
                        <p className="text-muted-foreground">Processed</p>
                        <p className="font-medium">{session.stats.documentsProcessed}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Links</p>
                        <p className="font-medium">{session.stats.hyperlinksChecked}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Feedback</p>
                        <p className="font-medium">{session.stats.feedbackImported}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Time</p>
                        <p className="font-medium">{session.stats.timeSaved}m</p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Delete Confirmation Dialog */}
            {showDeleteConfirm === session.id && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="fixed inset-0 bg-background/80 backdrop-blur-xs z-50 flex items-center justify-center p-4"
                onClick={() => setShowDeleteConfirm(null)}
              >
                <motion.div
                  initial={{ scale: 0.95 }}
                  animate={{ scale: 1 }}
                  className="bg-card rounded-lg shadow-xl border border-border p-6 max-w-sm"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 className="text-lg font-semibold mb-2">Delete Session</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Are you sure you want to delete "{session.name}"? This action cannot be undone.
                  </p>
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(null)}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => confirmDelete(session.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </motion.div>
        ))}
      </motion.div>

      {filteredSessions.length === 0 && (
        <motion.div variants={itemVariants} className="text-center py-12">
          <FolderOpen className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">
            {searchQuery ? 'No sessions found' : 'No sessions yet'}
          </h3>
          <p className="text-muted-foreground mb-4">
            {searchQuery
              ? 'Try adjusting your search query'
              : 'Create your first session to start processing documents'}
          </p>
          {!searchQuery && (
            <Button onClick={handleNewSession} icon={<Plus className="w-4 h-4" />}>
              Create First Session
            </Button>
          )}
        </motion.div>
      )}

      {showSessionManager && (
        <SessionManager
          mode="new"
          onClose={() => setShowSessionManager(false)}
          onSessionCreated={handleSessionCreated}
          onSessionLoaded={handleSessionCreated}
        />
      )}
    </motion.div>
  );
}
