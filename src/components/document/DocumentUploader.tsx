import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, X, AlertCircle, CheckCircle, FileText } from 'lucide-react';
import { cn } from '@/utils/cn';
import { Button } from '@/components/common/Button';
import type { Document } from '@/types/session';

interface DocumentUploaderProps {
  onDocumentsAdded: (documents: File[]) => void;
  onDocumentRemove?: (documentId: string) => void;
  documents?: Document[];
  maxFiles?: number;
  accept?: string;
  className?: string;
}

export function DocumentUploader({
  onDocumentsAdded,
  onDocumentRemove,
  documents = [],
  maxFiles = 10,
  accept = '.docx,.doc',
  className,
}: DocumentUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    setUploadError(null);

    const files = Array.from(e.dataTransfer.files);
    processFiles(files);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    if (e.target.files) {
      const files = Array.from(e.target.files);
      processFiles(files);
    }
  }, []);

  const processFiles = (files: File[]) => {
    // Filter for valid document files
    const validFiles = files.filter((file) => {
      const extension = '.' + file.name.split('.').pop()?.toLowerCase();
      return accept.includes(extension);
    });

    if (validFiles.length === 0) {
      setUploadError('Please upload Word documents (.docx or .doc)');
      return;
    }

    if (documents.length + validFiles.length > maxFiles) {
      setUploadError(`Maximum ${maxFiles} files allowed`);
      return;
    }

    onDocumentsAdded(validFiles);
  };

  const handleRemoveDocument = (documentId: string) => {
    onDocumentRemove?.(documentId);
  };

  const getStatusIcon = (status: Document['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      case 'processing':
        return (
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        );
      default:
        return <FileText className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* Upload Area */}
      <div
        className={cn(
          'relative border-2 border-dashed rounded-xl p-8 transition-all duration-200',
          isDragging
            ? 'border-primary bg-primary/5 scale-[1.02]'
            : 'border-border hover:border-primary/50',
          'cursor-pointer'
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={accept}
          onChange={handleFileSelect}
          className="hidden"
        />

        <div className="flex flex-col items-center justify-center space-y-4">
          <motion.div
            animate={isDragging ? { scale: 1.1 } : { scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className={cn(
              'w-16 h-16 rounded-full flex items-center justify-center',
              'bg-primary/10'
            )}
          >
            <Upload className="w-8 h-8 text-primary" />
          </motion.div>

          <div className="text-center">
            <p className="font-medium text-lg">
              {isDragging ? 'Drop files here' : 'Click to upload or drag and drop'}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Word documents (.docx, .doc) up to {maxFiles} files
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
          >
            Browse Files
          </Button>
        </div>

        {/* Animated drop indicator */}
        <AnimatePresence>
          {isDragging && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 rounded-xl bg-primary/10 pointer-events-none"
            />
          )}
        </AnimatePresence>
      </div>

      {/* Error Message */}
      <AnimatePresence>
        {uploadError && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg"
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <p className="text-sm">{uploadError}</p>
            <button onClick={() => setUploadError(null)} className="ml-auto hover:opacity-70">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Document List */}
      {documents.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-medium text-sm text-muted-foreground">
            Uploaded Documents ({documents.length})
          </h3>

          <div className="space-y-2">
            <AnimatePresence>
              {documents.map((doc, index) => (
                <motion.div
                  key={doc.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ delay: index * 0.05 }}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-lg border',
                    'hover:bg-muted/50 transition-colors',
                    doc.status === 'error' && 'border-destructive/50 bg-destructive/5'
                  )}
                >
                  {getStatusIcon(doc.status)}

                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{doc.name}</p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{formatFileSize(doc.size)}</span>
                      {doc.status === 'completed' && doc.processingResult && (
                        <>
                          <span>•</span>
                          <span>{doc.processingResult.hyperlinksModified} links updated</span>
                        </>
                      )}
                      {doc.status === 'error' && doc.errors?.[0] && (
                        <>
                          <span>•</span>
                          <span className="text-destructive">{doc.errors[0]}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Progress bar for processing documents */}
                  {doc.status === 'processing' && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-muted rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-primary"
                        initial={{ width: '0%' }}
                        animate={{ width: '100%' }}
                        transition={{ duration: 3, ease: 'linear', repeat: Infinity }}
                      />
                    </div>
                  )}

                  {/* Remove button */}
                  {doc.status !== 'processing' && onDocumentRemove && (
                    <button
                      onClick={() => handleRemoveDocument(doc.id)}
                      className="p-1 hover:bg-destructive/10 rounded-md transition-colors"
                    >
                      <X className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                    </button>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Quick Stats */}
      {documents.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <p className="text-2xl font-bold text-primary">
              {documents.filter((d) => d.status === 'completed').length}
            </p>
            <p className="text-xs text-muted-foreground">Processed</p>
          </div>
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <p className="text-2xl font-bold text-yellow-500">
              {documents.filter((d) => d.status === 'processing').length}
            </p>
            <p className="text-xs text-muted-foreground">Processing</p>
          </div>
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <p className="text-2xl font-bold text-green-500">
              {documents.reduce((acc, d) => acc + (d.processingResult?.hyperlinksModified || 0), 0)}
            </p>
            <p className="text-xs text-muted-foreground">Links Fixed</p>
          </div>
        </div>
      )}
    </div>
  );
}
