import { useState, useMemo, memo } from 'react';
import { motion } from 'framer-motion';
import {
  Mail,
  Send,
  Loader2,
  Check,
  CheckCircle,
  AlertCircle,
  FileText,
  Bug,
  ThumbsUp,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { useSession } from '@/contexts/SessionContext';
import { useToast } from '@/hooks/useToast';
import { Toaster } from '@/components/common/Toast';
import { cn } from '@/utils/cn';
import logger from '@/utils/logger';
import type { Document } from '@/types/session';

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

interface DocumentWithSession extends Document {
  sessionName: string;
  sessionId: string;
  backupPath?: string;
}

export const Reporting = memo(function Reporting() {
  const { sessions } = useSession();
  const { toasts, toast, dismiss } = useToast();
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [reportType, setReportType] = useState<'bug' | 'kudos'>('bug');
  const [noDocument, setNoDocument] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);

  // Get last 10 processed docs (completed or error) sorted by processedAt
  const recentDocs = useMemo(() => {
    const docs: DocumentWithSession[] = [];
    sessions.forEach((session) => {
      session.documents.forEach((doc) => {
        if (doc.status === 'completed' || doc.status === 'error') {
          docs.push({
            ...doc,
            sessionName: session.name,
            sessionId: session.id,
            backupPath: doc.processingResult?.backupPath,
          });
        }
      });
    });
    return docs
      .sort((a, b) => {
        const aTime = a.processedAt ? new Date(a.processedAt).getTime() : 0;
        const bTime = b.processedAt ? new Date(b.processedAt).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 10);
  }, [sessions]);

  const canGenerate = noDocument || selectedDocs.size > 0;

  const toggleDoc = (docId: string) => {
    if (noDocument) return; // Don't allow selecting docs when "no document" is checked
    const newSet = new Set(selectedDocs);
    if (newSet.has(docId)) {
      newSet.delete(docId);
    } else if (newSet.size < 3) {
      newSet.add(docId);
    }
    setSelectedDocs(newSet);
  };

  const handleNoDocumentToggle = () => {
    if (!noDocument) {
      // Clearing document selection when enabling "no document"
      setSelectedDocs(new Set());
    }
    setNoDocument(!noDocument);
  };

  const handleGenerateEmail = async () => {
    setIsGenerating(true);
    setProgress(0);
    try {
      const timestamp = Date.now();
      const folderName = `DocHub_Report_${timestamp}`;
      const downloadsPath = await window.electronAPI.getDownloadsPath();
      const folderPath = `${downloadsPath}\\${folderName}`;

      // Create folder
      await window.electronAPI.createFolder(folderPath);
      setProgress(10);

      let zipPath = '';

      if (!noDocument && selectedDocs.size > 0) {
        // Copy files
        const selectedDocsList = Array.from(selectedDocs);
        for (let i = 0; i < selectedDocsList.length; i++) {
          const doc = recentDocs.find((d) => d.id === selectedDocsList[i]);
          if (doc?.path) {
            // Copy processed file
            await window.electronAPI.copyFileToFolder(doc.path, folderPath);
            // Copy backup if exists
            if (doc.backupPath) {
              await window.electronAPI.copyFileToFolder(doc.backupPath, folderPath);
            }
          }
          setProgress(10 + ((i + 1) * 60) / selectedDocsList.length);
        }

        // Create ZIP
        zipPath = await window.electronAPI.createReportZip(folderPath, `${folderName}.zip`);
        setProgress(85);
      } else {
        // No documents selected, just create an empty placeholder
        setProgress(85);
      }

      // Open Outlook
      const subject =
        reportType === 'bug' ? 'Bug Report: Documentation Hub' : 'Kudos: Documentation Hub';

      await window.electronAPI.openOutlookEmail(subject, zipPath);
      setProgress(100);

      toast({ title: 'Email draft opened', variant: 'success' });
    } catch (error) {
      logger.error('Failed to generate email:', error);
      toast({ title: 'Failed to generate email', variant: 'destructive' });
    } finally {
      setIsGenerating(false);
      // Clear selections after completion
      setSelectedDocs(new Set());
      setNoDocument(false);
    }
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="p-6 max-w-[1000px] mx-auto space-y-6"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
            <Mail className="w-8 h-8" />
            Reporting
          </h1>
          <p className="text-muted-foreground">Generate bug reports or kudos emails</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Button
            onClick={handleGenerateEmail}
            disabled={!canGenerate || isGenerating}
            className={cn('gap-2', canGenerate && 'bg-primary hover:bg-primary/90')}
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                Generate Email
              </>
            )}
          </Button>
          {isGenerating && (
            <div className="h-2 w-40 bg-muted rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-primary"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          )}
        </div>
      </motion.div>

      {/* Report Type Selection */}
      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Report Type
            </CardTitle>
            <CardDescription>Select the type of report you want to generate</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-4">
            <label
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-colors flex-1',
                reportType === 'bug'
                  ? 'bg-primary/10 border-2 border-primary'
                  : 'bg-muted/30 border-2 border-transparent hover:bg-muted/50'
              )}
            >
              <input
                type="radio"
                name="reportType"
                checked={reportType === 'bug'}
                onChange={() => setReportType('bug')}
                className="sr-only"
              />
              <div
                className={cn(
                  'w-5 h-5 rounded-full border-2 flex items-center justify-center',
                  reportType === 'bug' ? 'border-primary' : 'border-muted-foreground'
                )}
              >
                {reportType === 'bug' && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
              </div>
              <Bug className={cn('w-5 h-5', reportType === 'bug' ? 'text-primary' : 'text-muted-foreground')} />
              <span className={cn('font-medium', reportType === 'bug' ? 'text-foreground' : 'text-muted-foreground')}>
                Bug Report
              </span>
            </label>
            <label
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-colors flex-1',
                reportType === 'kudos'
                  ? 'bg-primary/10 border-2 border-primary'
                  : 'bg-muted/30 border-2 border-transparent hover:bg-muted/50'
              )}
            >
              <input
                type="radio"
                name="reportType"
                checked={reportType === 'kudos'}
                onChange={() => setReportType('kudos')}
                className="sr-only"
              />
              <div
                className={cn(
                  'w-5 h-5 rounded-full border-2 flex items-center justify-center',
                  reportType === 'kudos' ? 'border-primary' : 'border-muted-foreground'
                )}
              >
                {reportType === 'kudos' && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
              </div>
              <ThumbsUp className={cn('w-5 h-5', reportType === 'kudos' ? 'text-primary' : 'text-muted-foreground')} />
              <span className={cn('font-medium', reportType === 'kudos' ? 'text-foreground' : 'text-muted-foreground')}>
                Kudos
              </span>
            </label>
          </CardContent>
        </Card>
      </motion.div>

      {/* Description */}
      <motion.div variants={itemVariants}>
        <p className="text-muted-foreground text-sm">
          This section will help you send documents quickly for troubleshooting or reviewing purposes. Select up to three documents in the list below. Only processed or errored documents are shown. Ensure the correct "Report Type" is selected: "Bug Report" or "Kudos". Then click on the "Generate Email" button. This application will make a copy of both the backup file and the processed file, create a new folder within your Downloads folder starting with "DocHub_Report_". It will then zip it up, bring up a blank email, and automatically attach this zip file. Thanks for the report or feedback!
        </p>
      </motion.div>

      {/* Document Selection */}
      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Select Documents
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentDocs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No recently processed documents</p>
                <p className="text-sm">Process some documents first to include them in reports</p>
              </div>
            ) : (
              <>
                {recentDocs.map((doc) => (
                  <div
                    key={doc.id}
                    onClick={() => toggleDoc(doc.id)}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors',
                      selectedDocs.has(doc.id)
                        ? 'bg-primary/10 border border-primary'
                        : 'bg-muted/30 hover:bg-muted/50 border border-transparent',
                      noDocument && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    <div
                      className={cn(
                        'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0',
                        selectedDocs.has(doc.id) ? 'bg-primary border-primary' : 'border-muted-foreground'
                      )}
                    >
                      {selectedDocs.has(doc.id) && <Check className="w-3 h-3 text-primary-foreground" />}
                    </div>
                    {doc.status === 'completed' ? (
                      <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="truncate block">{doc.name}</span>
                      <span className="text-xs text-muted-foreground truncate block">{doc.sessionName}</span>
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* No Document option */}
            <div className="pt-4 border-t border-border mt-4">
              <div
                onClick={handleNoDocumentToggle}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors',
                  noDocument
                    ? 'bg-primary/10 border border-primary'
                    : 'bg-muted/30 hover:bg-muted/50 border border-transparent'
                )}
              >
                <div
                  className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0',
                    noDocument ? 'bg-primary border-primary' : 'border-muted-foreground'
                  )}
                >
                  {noDocument && <Check className="w-3 h-3 text-primary-foreground" />}
                </div>
                <span className="font-medium">No Document (text-only report)</span>
              </div>
            </div>

            {/* Selection info */}
            {selectedDocs.size > 0 && (
              <p className="text-sm text-muted-foreground pt-2">
                {selectedDocs.size} of 3 documents selected
              </p>
            )}
          </CardContent>
        </Card>
      </motion.div>


      {/* Toast Notifications */}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </motion.div>
  );
});
