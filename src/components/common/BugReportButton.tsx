import { motion } from 'framer-motion';
import { Bug } from 'lucide-react';
import { cn } from '@/utils/cn';

export function BugReportButton() {
  const handleBugReport = () => {
    const subject = encodeURIComponent('Bug Report - Template UI');
    const body = encodeURIComponent(`
Bug Report
----------
Date: ${new Date().toISOString()}
User Agent: ${navigator.userAgent}

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

    window.location.href = `mailto:dummy@email.com?subject=${subject}&body=${body}`;
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