import { useState, useMemo } from 'react';
import { useSession } from '@/contexts/SessionContext';
import { motion } from 'framer-motion';
import {
  FileText,
  FolderOpen,
  CheckCircle,
  AlertCircle,
  Clock,
  Search,
  Filter,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/common/Card';
import { Input } from '@/components/common/Input';
import { Button } from '@/components/common/Button';
import { cn } from '@/utils/cn';
import logger from '@/utils/logger';
import type { Document } from '@/types/session';

interface DocumentWithSession extends Document {
  sessionName: string;
  sessionId: string;
}

export function Documents() {
  const { sessions } = useSession();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'pending' | 'error'>(
    'all'
  );

  // Collect all documents from all sessions
  const allDocuments = useMemo(() => {
    const docs: DocumentWithSession[] = [];
    sessions.forEach((session) => {
      session.documents.forEach((doc) => {
        docs.push({
          ...doc,
          sessionName: session.name,
          sessionId: session.id,
        });
      });
    });
    return docs;
  }, [sessions]);

  // Filter documents
  const filteredDocuments = useMemo(() => {
    return allDocuments.filter((doc) => {
      // Filter by search query
      const matchesSearch =
        searchQuery === '' ||
        doc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        doc.sessionName.toLowerCase().includes(searchQuery.toLowerCase());

      // Filter by status
      const matchesStatus = statusFilter === 'all' || doc.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [allDocuments, searchQuery, statusFilter]);

  const handleOpenLocation = async (path?: string) => {
    if (!path) {
      logger.warn('No path available for document');
      return;
    }

    try {
      await window.electronAPI.showInFolder(path);
    } catch (err) {
      logger.error('Failed to open file location:', err);
    }
  };

  const handleOpenDocument = async (path?: string) => {
    if (!path) {
      logger.warn('No path available for document');
      return;
    }

    try {
      await window.electronAPI.openDocument(path);
      logger.info('Document opened successfully');
    } catch (err) {
      logger.error('Failed to open document:', err);
    }
  };

  const getStatusIcon = (status: Document['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-muted-foreground" />;
      default:
        return <FileText className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: Document['status']) => {
    const styles = {
      completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
      error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
      processing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    };

    return (
      <span className={cn('px-2 py-1 text-xs rounded-full font-medium', styles[status])}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const formatDate = (date?: Date) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleString();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold mb-2">Documents</h1>
        <p className="text-muted-foreground">
          View and manage all processed documents across all sessions
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <FileText className="w-8 h-8 text-blue-500" />
              <div>
                <p className="text-sm text-foreground">Total</p>
                <p className="text-2xl font-bold">{allDocuments.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-8 h-8 text-green-500" />
              <div>
                <p className="text-sm text-foreground">Completed</p>
                <p className="text-2xl font-bold">
                  {allDocuments.filter((d) => d.status === 'completed').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Clock className="w-8 h-8 text-yellow-500" />
              <div>
                <p className="text-sm text-foreground">Pending</p>
                <p className="text-2xl font-bold">
                  {allDocuments.filter((d) => d.status === 'pending').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-8 h-8 text-red-500" />
              <div>
                <p className="text-sm text-foreground">Errors</p>
                <p className="text-2xl font-bold">
                  {allDocuments.filter((d) => d.status === 'error').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <Input
                type="search"
                placeholder="Search documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                leftIcon={<Search className="w-4 h-4" />}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant={statusFilter === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('all')}
              >
                All
              </Button>
              <Button
                variant={statusFilter === 'completed' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('completed')}
              >
                Completed
              </Button>
              <Button
                variant={statusFilter === 'pending' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('pending')}
              >
                Pending
              </Button>
              <Button
                variant={statusFilter === 'error' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('error')}
              >
                Errors
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Documents List */}
      <Card>
        <CardHeader>
          <CardTitle>
            {filteredDocuments.length} Document{filteredDocuments.length !== 1 ? 's' : ''}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredDocuments.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No documents found</h3>
              <p className="text-muted-foreground">
                {searchQuery || statusFilter !== 'all'
                  ? 'Try adjusting your filters'
                  : 'Start by creating a session and adding documents'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredDocuments.map((doc) => (
                <motion.div
                  key={`${doc.sessionId}-${doc.id}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-muted/50 transition-all group"
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    {getStatusIcon(doc.status)}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{doc.name}</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className="truncate">{doc.sessionName}</span>
                        {doc.processedAt && (
                          <>
                            <span>•</span>
                            <span>{formatDate(doc.processedAt)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {getStatusBadge(doc.status)}
                    {doc.status === 'completed' && doc.path && (
                      <Button
                        variant="ghost"
                        size="xs"
                        icon={<FileText className="w-4 h-4" />}
                        onClick={() => handleOpenDocument(doc.path)}
                        title="Open document in Word"
                        className="text-green-600 hover:text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950"
                      >
                        Open Document
                      </Button>
                    )}
                    {doc.path && (
                      <Button
                        variant="ghost"
                        size="xs"
                        icon={<FolderOpen className="w-4 h-4" />}
                        onClick={() => handleOpenLocation(doc.path)}
                        title="Open file location"
                      >
                        Open Location
                      </Button>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
