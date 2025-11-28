/**
 * EditorToolbar - Toolbar for the document editor modal
 *
 * Contains:
 * - Document title
 * - Undo/Redo buttons
 * - Quick formatting actions dropdown
 * - Save and Close buttons
 */

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Save,
  Undo2,
  Redo2,
  ChevronDown,
  Bold,
  Italic,
  Underline,
  RemoveFormatting,
  Link2,
  Unlink,
  FileText,
  ListOrdered,
  Table2,
  Search,
  Check,
  XCircle,
  Loader2,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import type { QuickActionId, EditorState } from '@/types/editor';

interface EditorToolbarProps {
  /** Document name/title */
  documentName: string;
  /** Whether there are unsaved changes */
  isDirty: boolean;
  /** Whether save is in progress */
  isSaving: boolean;
  /** Whether undo is available */
  canUndo: boolean;
  /** Whether redo is available */
  canRedo: boolean;
  /** Close handler */
  onClose: () => void;
  /** Save handler */
  onSave: () => void;
  /** Undo handler */
  onUndo: () => void;
  /** Redo handler */
  onRedo: () => void;
  /** Quick action handler */
  onQuickAction: (actionId: QuickActionId) => void;
}

/**
 * Dropdown menu for quick actions
 */
function QuickActionsDropdown({
  onAction,
  disabled,
}: {
  onAction: (actionId: QuickActionId) => void;
  disabled: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const actionGroups = [
    {
      label: 'Text Formatting',
      actions: [
        { id: 'bold' as QuickActionId, icon: Bold, label: 'Bold', shortcut: 'Ctrl+B' },
        { id: 'italic' as QuickActionId, icon: Italic, label: 'Italic', shortcut: 'Ctrl+I' },
        {
          id: 'underline' as QuickActionId,
          icon: Underline,
          label: 'Underline',
          shortcut: 'Ctrl+U',
        },
        {
          id: 'clear-formatting' as QuickActionId,
          icon: RemoveFormatting,
          label: 'Clear Formatting',
        },
      ],
    },
    {
      label: 'Hyperlinks',
      actions: [
        { id: 'insert-hyperlink' as QuickActionId, icon: Link2, label: 'Insert Hyperlink' },
        { id: 'remove-hyperlink' as QuickActionId, icon: Unlink, label: 'Remove Hyperlink' },
      ],
    },
    {
      label: 'Styles',
      actions: [
        { id: 'style-heading1' as QuickActionId, icon: FileText, label: 'Heading 1' },
        { id: 'style-heading2' as QuickActionId, icon: FileText, label: 'Heading 2' },
        { id: 'style-normal' as QuickActionId, icon: FileText, label: 'Normal' },
        { id: 'style-list' as QuickActionId, icon: ListOrdered, label: 'List Paragraph' },
      ],
    },
    {
      label: 'Tracked Changes',
      actions: [
        { id: 'accept-all' as QuickActionId, icon: Check, label: 'Accept All Changes' },
        { id: 'reject-all' as QuickActionId, icon: XCircle, label: 'Reject All Changes' },
      ],
    },
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors',
          'hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed'
        )}
      >
        Quick Actions
        <ChevronDown
          className={cn('w-4 h-4 transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
            />

            {/* Dropdown */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-1 z-50 w-64 bg-popover border border-border rounded-lg shadow-lg overflow-hidden"
            >
              {actionGroups.map((group, groupIdx) => (
                <div key={group.label}>
                  {groupIdx > 0 && <div className="h-px bg-border" />}
                  <div className="px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/30">
                    {group.label}
                  </div>
                  {group.actions.map((action) => (
                    <button
                      key={action.id}
                      onClick={() => {
                        onAction(action.id);
                        setIsOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
                    >
                      <action.icon className="w-4 h-4" />
                      <span className="flex-1 text-left">{action.label}</span>
                      {action.shortcut && (
                        <span className="text-xs text-muted-foreground">
                          {action.shortcut}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Main EditorToolbar component
 */
export function EditorToolbar({
  documentName,
  isDirty,
  isSaving,
  canUndo,
  canRedo,
  onClose,
  onSave,
  onUndo,
  onRedo,
  onQuickAction,
}: EditorToolbarProps) {
  const handleClose = useCallback(() => {
    if (isDirty) {
      // Show confirmation dialog
      const confirmed = window.confirm(
        'You have unsaved changes. Are you sure you want to close without saving?'
      );
      if (!confirmed) return;
    }
    onClose();
  }, [isDirty, onClose]);

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-card border-b border-border">
      {/* Left section - Close button and document name */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleClose}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          title="Close (discard changes)"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-muted-foreground" />
          <span className="font-medium">{documentName}</span>
          {isDirty && (
            <span className="px-1.5 py-0.5 text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded">
              Unsaved
            </span>
          )}
        </div>
      </div>

      {/* Center section - Undo/Redo and Quick Actions */}
      <div className="flex items-center gap-2">
        {/* Undo/Redo */}
        <div className="flex items-center gap-1 pr-2 border-r border-border">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Redo (Ctrl+Y)"
          >
            <Redo2 className="w-4 h-4" />
          </button>
        </div>

        {/* Quick formatting buttons */}
        <div className="flex items-center gap-1 pr-2 border-r border-border">
          <button
            onClick={() => onQuickAction('bold')}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            title="Bold (Ctrl+B)"
          >
            <Bold className="w-4 h-4" />
          </button>
          <button
            onClick={() => onQuickAction('italic')}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            title="Italic (Ctrl+I)"
          >
            <Italic className="w-4 h-4" />
          </button>
          <button
            onClick={() => onQuickAction('underline')}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            title="Underline (Ctrl+U)"
          >
            <Underline className="w-4 h-4" />
          </button>
        </div>

        {/* Quick Actions dropdown */}
        <QuickActionsDropdown onAction={onQuickAction} disabled={isSaving} />
      </div>

      {/* Right section - Save button */}
      <div className="flex items-center gap-2">
        <button
          onClick={onSave}
          disabled={isSaving || !isDirty}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors',
            isDirty
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground',
            (isSaving || !isDirty) && 'opacity-50 cursor-not-allowed'
          )}
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default EditorToolbar;
