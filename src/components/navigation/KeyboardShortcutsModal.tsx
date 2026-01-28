import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Keyboard } from 'lucide-react';
import { cn } from '@/utils/cn';

interface ShortcutItem {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  title: string;
  shortcuts: ShortcutItem[];
}

const shortcutGroups: ShortcutGroup[] = [
  {
    title: 'General',
    shortcuts: [
      { keys: ['Ctrl', 'K'], description: 'Open command palette' },
      { keys: ['Ctrl', 'Q'], description: 'Toggle sidebar' },
      { keys: ['?'], description: 'Show keyboard shortcuts' },
      { keys: ['Esc'], description: 'Close dialogs / Cancel' },
    ],
  },
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['Ctrl', '1'], description: 'Go to Dashboard' },
      { keys: ['Ctrl', '2'], description: 'Go to Sessions' },
      { keys: ['Ctrl', '3'], description: 'Go to Analytics' },
      { keys: ['Ctrl', '4'], description: 'Go to Documents' },
      { keys: ['Ctrl', ','], description: 'Open Settings' },
    ],
  },
  {
    title: 'Session Actions',
    shortcuts: [
      { keys: ['Ctrl', 'N'], description: 'New session' },
      { keys: ['Ctrl', 'O'], description: 'Add documents' },
      { keys: ['Ctrl', 'Enter'], description: 'Process all documents' },
      { keys: ['Ctrl', 'S'], description: 'Save session' },
    ],
  },
  {
    title: 'Document Actions',
    shortcuts: [
      { keys: ['Delete'], description: 'Remove selected document' },
      { keys: ['Ctrl', 'Click'], description: 'Multi-select documents' },
      { keys: ['Shift', 'Click'], description: 'Range select documents' },
    ],
  },
];

// For Mac, replace Ctrl with Cmd
const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;

function formatKey(key: string): string {
  if (isMac && key === 'Ctrl') return '\u2318';
  if (key === 'Shift') return '\u21E7';
  if (key === 'Alt') return isMac ? '\u2325' : 'Alt';
  if (key === 'Enter') return '\u23CE';
  if (key === 'Esc') return 'Esc';
  if (key === 'Delete') return isMac ? '\u232B' : 'Del';
  return key;
}

interface KeyboardShortcutsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KeyboardShortcutsModal({ open, onOpenChange }: KeyboardShortcutsModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
              />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ type: 'spring', duration: 0.3 }}
                className={cn(
                  'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
                  'w-full max-w-2xl max-h-[85vh] overflow-hidden',
                  'bg-background rounded-xl border border-border shadow-2xl',
                  'flex flex-col'
                )}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Keyboard className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <Dialog.Title className="text-lg font-semibold">
                        Keyboard Shortcuts
                      </Dialog.Title>
                      <Dialog.Description className="text-sm text-muted-foreground">
                        Quick reference for all available shortcuts
                      </Dialog.Description>
                    </div>
                  </div>
                  <Dialog.Close asChild>
                    <button
                      className="p-2 rounded-lg hover:bg-muted transition-colors"
                      aria-label="Close"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </Dialog.Close>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {shortcutGroups.map((group) => (
                      <div key={group.title}>
                        <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
                          {group.title}
                        </h3>
                        <div className="space-y-2">
                          {group.shortcuts.map((shortcut, index) => (
                            <div
                              key={index}
                              className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors"
                            >
                              <span className="text-sm">{shortcut.description}</span>
                              <div className="flex items-center gap-1">
                                {shortcut.keys.map((key, keyIndex) => (
                                  <span key={keyIndex} className="flex items-center gap-1">
                                    <kbd className="min-w-[24px] h-6 px-1.5 flex items-center justify-center text-xs font-mono bg-muted rounded border border-border shadow-sm">
                                      {formatKey(key)}
                                    </kbd>
                                    {keyIndex < shortcut.keys.length - 1 && (
                                      <span className="text-muted-foreground text-xs">+</span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-border bg-muted/30">
                  <p className="text-xs text-muted-foreground text-center">
                    Press <kbd className="px-1 py-0.5 text-[10px] font-mono bg-muted rounded border border-border">?</kbd> anytime to show this dialog
                  </p>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
