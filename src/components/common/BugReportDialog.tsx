import { useUserSettings } from '@/contexts/UserSettingsContext';
import logger from '@/utils/logger';
import { AnimatePresence, motion } from 'framer-motion';
import { Bug, Send, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from './Button';

interface BugReportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BugReportDialog({ isOpen, onClose }: BugReportDialogProps) {
  const { settings } = useUserSettings();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) return;

    setIsSubmitting(true);

    const bugReport = {
      Type: 'Bug Report',
      Email: settings.profile.email,
      Title: title,
      Description: description,
    };

    const apiUrl = settings.apiConnections.bugReportUrl;

    // Check if using default URL - if so, fallback to mailto
    if (apiUrl === 'https://www.example.com' || !apiUrl) {
      const subject = encodeURIComponent(`Bug Report: ${title}`);
      const body = encodeURIComponent(`
Bug Report
----------
Email: ${settings.profile.email}
Title: ${title}

Description of Issue:
${description}

Submitted: ${new Date().toLocaleString()}
      `);

      window.location.href = `mailto:support@example.com?subject=${subject}&body=${body}`;

      // Clear fields and close dialog
      setTitle('');
      setDescription('');
      setIsSubmitting(false);
      onClose();

      // Show success notification
      alert('Your bug report has been sent to the Documentation Hub Admin');
      return;
    }

    // Use API if configured
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bugReport),
      });

      if (response.ok) {
        // Clear fields and close dialog on success
        setTitle('');
        setDescription('');
        onClose();

        // Show success notification
        alert('Your bug report has been sent to the Documentation Hub Admin');
      } else {
        alert('Failed to submit bug report. Please try again.');
      }
    } catch (error) {
      logger.error('Error submitting bug report:', error);
      alert('Failed to submit bug report. Please check your API configuration.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setTitle('');
    setDescription('');
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            onClick={handleCancel}
          />

          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg z-50"
          >
            <div className="bg-background border border-border rounded-lg shadow-xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-linear-to-br from-red-500 to-orange-600 flex items-center justify-center">
                    <Bug className="w-4 h-4 text-white" />
                  </div>
                  <h2 className="text-lg font-semibold">Report a Bug</h2>
                </div>
                <button
                  onClick={handleCancel}
                  className="p-1 rounded-md hover:bg-muted transition-colors"
                  aria-label="Close dialog"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="p-6 space-y-4">
                <div>
                  <label htmlFor="bug-title" className="block text-sm font-medium mb-2">
                    Title
                  </label>
                  <input
                    id="bug-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Brief description of the issue"
                    className="w-full px-3 py-2 rounded-md border border-input bg-background focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                    autoFocus
                  />
                </div>

                <div>
                  <label htmlFor="bug-description" className="block text-sm font-medium mb-2">
                    Description of Issue
                  </label>
                  <textarea
                    id="bug-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Please provide details about the bug, steps to reproduce, and any error messages..."
                    rows={6}
                    className="w-full px-3 py-2 rounded-md border border-input bg-background resize-none focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                  />
                </div>

                <div className="text-xs text-muted-foreground bg-muted/30 p-3 rounded-md">
                  <p>
                    <strong>Note:</strong> Your email ({settings.profile.email}) will be included
                    with this report so we can follow up if needed.
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 p-4 border-t border-border bg-muted/30">
                <Button variant="outline" onClick={handleCancel}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!title.trim() || !description.trim() || isSubmitting}
                  icon={<Send className="w-4 h-4" />}
                >
                  {isSubmitting ? 'Sending...' : 'Send Report'}
                </Button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
