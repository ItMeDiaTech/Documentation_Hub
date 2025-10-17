import { motion } from 'framer-motion';
import { Bug } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useUserSettings } from '@/contexts/UserSettingsContext';
import logger from '@/utils/logger';

export function BugReportButton() {
  const { settings } = useUserSettings();

  const handleBugReport = async () => {
    const bugReport = {
      title: 'Bug Report - Documentation Hub',
      date: new Date().toISOString(),
      userAgent: navigator.userAgent,
      version: await window.electronAPI.getCurrentVersion().catch(() => 'Unknown'),
      description: '',
      stepsToReproduce: ['', '', ''],
      expectedBehavior: '',
      actualBehavior: '',
      additionalContext: '',
    };

    const apiUrl = settings.apiConnections.bugReportUrl;

    // Check if using default URL (example.com) - if so, fallback to mailto
    if (apiUrl === 'https://www.example.com' || !apiUrl) {
      const subject = encodeURIComponent('Bug Report - Documentation Hub');
      const body = encodeURIComponent(`
Bug Report
----------
Date: ${bugReport.date}
Version: ${bugReport.version}
User Agent: ${bugReport.userAgent}

Description of the issue:
[Please describe the bug you encountered]

Steps to reproduce:
1.
2.
3.

Expected behavior:
[What should have happened?]

Actual behavior:
[What actually happened?]

Additional context:
[Any other information that might be helpful]
      `);

      window.location.href = `mailto:support@example.com?subject=${subject}&body=${body}`;
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
        alert('Bug report submitted successfully!');
      } else {
        alert('Failed to submit bug report. Please try again.');
      }
    } catch (error) {
      logger.error('Error submitting bug report:', error);
      alert('Failed to submit bug report. Please check your API configuration.');
    }
  };

  return (
    <motion.button
      onClick={handleBugReport}
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      whileHover={{ scale: 1.1, rotate: 10 }}
      whileTap={{ scale: 0.9 }}
      className={cn(
        'fixed bottom-4 right-4 z-50',
        'w-10 h-10 rounded-full',
        'bg-gradient-to-br from-red-500 to-orange-600',
        'shadow-lg hover:shadow-xl',
        'flex items-center justify-center',
        'group transition-all duration-200',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      )}
      aria-label="Report a bug"
      title="Report a bug"
    >
      <Bug className="w-5 h-5 text-white" />

      <motion.div
        className="absolute -top-8 right-0 px-2 py-1 bg-popover text-popover-foreground text-xs rounded shadow-md pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
        initial={{ y: 10, opacity: 0 }}
        whileHover={{ y: 0, opacity: 1 }}
      >
        Report a Bug
      </motion.div>
    </motion.button>
  );
}