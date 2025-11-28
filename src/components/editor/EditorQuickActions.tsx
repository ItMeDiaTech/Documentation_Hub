/**
 * EditorQuickActions - Sidebar panel with quick action buttons
 *
 * Contains categorized quick actions for:
 * - Text formatting (bold, italic, underline, etc.)
 * - Paragraph styles (Heading 1, Heading 2, Normal)
 * - Table shading (Header 2 shading, Other shading)
 * - Table operations (add/remove rows/columns, merge, etc.)
 * - Tracked changes (accept all, reject all)
 */

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  Bold,
  Italic,
  Underline,
  RemoveFormatting,
  Link2,
  Unlink,
  FileText,
  ListOrdered,
  Table2,
  Plus,
  Minus,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Merge,
  Split,
  Paintbrush,
  Grid3X3,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyEnd,
  Check,
  XCircle,
  Search,
  SeparatorHorizontal,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import type { QuickActionId, CellSelection } from '@/types/editor';

interface EditorQuickActionsProps {
  /** Handler for quick action clicks */
  onAction: (actionId: QuickActionId) => void;
  /** Whether a table is currently selected */
  hasTableSelection: boolean;
  /** Whether text is currently selected */
  hasTextSelection: boolean;
  /** Current cell selection (if any) */
  cellSelection?: CellSelection | null;
  /** Table shading settings from session */
  tableShadingSettings?: {
    header2Shading: string;
    otherShading: string;
  };
  /** Whether actions are disabled */
  disabled?: boolean;
}

interface ActionButton {
  id: QuickActionId;
  icon: React.ElementType;
  label: string;
  description?: string;
  requiresTable?: boolean;
  requiresSelection?: boolean;
}

interface ActionGroup {
  label: string;
  icon: React.ElementType;
  defaultOpen?: boolean;
  actions: ActionButton[];
}

/**
 * Single action button
 */
function QuickActionButton({
  action,
  onClick,
  disabled,
}: {
  action: ActionButton;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors',
        'hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed',
        'text-left'
      )}
      title={action.description || action.label}
    >
      <action.icon className="w-4 h-4 flex-shrink-0" />
      <span className="truncate">{action.label}</span>
    </button>
  );
}

/**
 * Collapsible action group
 */
function ActionGroupSection({
  group,
  isOpen,
  onToggle,
  onAction,
  disabled,
  hasTableSelection,
  hasTextSelection,
}: {
  group: ActionGroup;
  isOpen: boolean;
  onToggle: () => void;
  onAction: (actionId: QuickActionId) => void;
  disabled: boolean;
  hasTableSelection: boolean;
  hasTextSelection: boolean;
}) {
  return (
    <div className="border-b border-border/50 last:border-b-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium hover:bg-muted/50 transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        <group.icon className="w-4 h-4" />
        <span className="flex-1 text-left">{group.label}</span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="pb-2 px-2 space-y-0.5">
              {group.actions.map((action) => {
                const isDisabled =
                  disabled ||
                  (action.requiresTable === true && !hasTableSelection) ||
                  (action.requiresSelection === true && !hasTextSelection);

                return (
                  <QuickActionButton
                    key={action.id}
                    action={action}
                    onClick={() => onAction(action.id)}
                    disabled={isDisabled}
                  />
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Main EditorQuickActions component
 */
export function EditorQuickActions({
  onAction,
  hasTableSelection,
  hasTextSelection,
  cellSelection,
  tableShadingSettings,
  disabled = false,
}: EditorQuickActionsProps) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    new Set(['Text Formatting', 'Table Shading'])
  );

  const toggleGroup = useCallback((label: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  }, []);

  // Define action groups
  const actionGroups: ActionGroup[] = [
    {
      label: 'Table Shading',
      icon: Paintbrush,
      defaultOpen: true,
      actions: [
        {
          id: 'apply-h2-shading',
          icon: Paintbrush,
          label: 'Apply Header 2 Shading',
          description: `Apply ${tableShadingSettings?.header2Shading || '#BFBFBF'} shading`,
          requiresTable: true,
        },
        {
          id: 'apply-other-shading',
          icon: Paintbrush,
          label: 'Apply Other Shading',
          description: `Apply ${tableShadingSettings?.otherShading || '#DFDFDF'} shading`,
          requiresTable: true,
        },
      ],
    },
    {
      label: 'Text Formatting',
      icon: Bold,
      defaultOpen: true,
      actions: [
        {
          id: 'bold',
          icon: Bold,
          label: 'Bold',
          description: 'Toggle bold (Ctrl+B)',
          requiresSelection: true,
        },
        {
          id: 'italic',
          icon: Italic,
          label: 'Italic',
          description: 'Toggle italic (Ctrl+I)',
          requiresSelection: true,
        },
        {
          id: 'underline',
          icon: Underline,
          label: 'Underline',
          description: 'Toggle underline (Ctrl+U)',
          requiresSelection: true,
        },
        {
          id: 'clear-formatting',
          icon: RemoveFormatting,
          label: 'Clear Formatting',
          description: 'Remove all formatting',
          requiresSelection: true,
        },
      ],
    },
    {
      label: 'Hyperlinks',
      icon: Link2,
      actions: [
        {
          id: 'insert-hyperlink',
          icon: Link2,
          label: 'Insert Hyperlink',
          description: 'Add hyperlink to selection',
          requiresSelection: true,
        },
        {
          id: 'remove-hyperlink',
          icon: Unlink,
          label: 'Remove Hyperlink',
          description: 'Convert hyperlink to plain text',
          requiresSelection: true,
        },
      ],
    },
    {
      label: 'Paragraph Styles',
      icon: FileText,
      actions: [
        {
          id: 'style-heading1',
          icon: FileText,
          label: 'Heading 1',
          description: 'Apply Heading 1 style',
        },
        {
          id: 'style-heading2',
          icon: FileText,
          label: 'Heading 2',
          description: 'Apply Heading 2 style',
        },
        {
          id: 'style-normal',
          icon: FileText,
          label: 'Normal',
          description: 'Apply Normal style',
        },
        {
          id: 'style-list-paragraph',
          icon: ListOrdered,
          label: 'List Paragraph',
          description: 'Apply List Paragraph style',
        },
      ],
    },
    {
      label: 'Table Rows',
      icon: ArrowUp,
      actions: [
        {
          id: 'table-add-row-above',
          icon: ArrowUp,
          label: 'Add Row Above',
          description: 'Insert row above selection',
          requiresTable: true,
        },
        {
          id: 'table-add-row-below',
          icon: ArrowDown,
          label: 'Add Row Below',
          description: 'Insert row below selection',
          requiresTable: true,
        },
        {
          id: 'table-delete-row',
          icon: Minus,
          label: 'Delete Row',
          description: 'Delete selected row',
          requiresTable: true,
        },
      ],
    },
    {
      label: 'Table Columns',
      icon: ArrowLeft,
      actions: [
        {
          id: 'table-add-col-left',
          icon: ArrowLeft,
          label: 'Add Column Left',
          description: 'Insert column to the left',
          requiresTable: true,
        },
        {
          id: 'table-add-col-right',
          icon: ArrowRight,
          label: 'Add Column Right',
          description: 'Insert column to the right',
          requiresTable: true,
        },
        {
          id: 'table-delete-col',
          icon: Minus,
          label: 'Delete Column',
          description: 'Delete selected column',
          requiresTable: true,
        },
      ],
    },
    {
      label: 'Table Cells',
      icon: Grid3X3,
      actions: [
        {
          id: 'table-merge-cells',
          icon: Merge,
          label: 'Merge Cells',
          description: 'Merge selected cells',
          requiresTable: true,
        },
        {
          id: 'table-split-cell',
          icon: Split,
          label: 'Split Cell',
          description: 'Split merged cell',
          requiresTable: true,
        },
        {
          id: 'table-cell-shading',
          icon: Paintbrush,
          label: 'Cell Shading',
          description: 'Set cell background color',
          requiresTable: true,
        },
        {
          id: 'table-cell-borders',
          icon: Grid3X3,
          label: 'Cell Borders',
          description: 'Configure cell borders',
          requiresTable: true,
        },
        {
          id: 'table-vertical-align',
          icon: AlignVerticalJustifyCenter,
          label: 'Vertical Alignment',
          description: 'Set cell vertical alignment',
          requiresTable: true,
        },
      ],
    },
    {
      label: 'Structure',
      icon: SeparatorHorizontal,
      actions: [
        {
          id: 'page-break',
          icon: SeparatorHorizontal,
          label: 'Insert Page Break',
          description: 'Add page break before paragraph',
        },
        {
          id: 'find-replace',
          icon: Search,
          label: 'Find & Replace',
          description: 'Search and replace text',
        },
      ],
    },
    {
      label: 'Tracked Changes',
      icon: Check,
      actions: [
        {
          id: 'accept-all-changes',
          icon: Check,
          label: 'Accept All Changes',
          description: 'Accept all tracked changes',
        },
        {
          id: 'reject-all-changes',
          icon: XCircle,
          label: 'Reject All Changes',
          description: 'Reject all tracked changes',
        },
      ],
    },
  ];

  return (
    <div className="flex flex-col h-full bg-card border-l border-border">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <h3 className="font-medium">Quick Actions</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {hasTableSelection
            ? 'Table cell selected'
            : hasTextSelection
              ? 'Text selected'
              : 'Click to select content'}
        </p>
      </div>

      {/* Action groups */}
      <div className="flex-1 overflow-y-auto">
        {actionGroups.map((group) => (
          <ActionGroupSection
            key={group.label}
            group={group}
            isOpen={openGroups.has(group.label)}
            onToggle={() => toggleGroup(group.label)}
            onAction={onAction}
            disabled={disabled}
            hasTableSelection={hasTableSelection}
            hasTextSelection={hasTextSelection}
          />
        ))}
      </div>

      {/* Shading preview */}
      {tableShadingSettings && (
        <div className="px-4 py-3 border-t border-border">
          <p className="text-xs text-muted-foreground mb-2">Session Shading Colors</p>
          <div className="flex gap-2">
            <div className="flex items-center gap-1.5">
              <div
                className="w-4 h-4 rounded border border-border"
                style={{ backgroundColor: tableShadingSettings.header2Shading }}
              />
              <span className="text-xs">H2</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div
                className="w-4 h-4 rounded border border-border"
                style={{ backgroundColor: tableShadingSettings.otherShading }}
              />
              <span className="text-xs">Other</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default EditorQuickActions;
