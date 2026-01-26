import { cn } from '@/utils/cn';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { RevisionHandlingOptions } from './RevisionHandlingOptions';

/**
 * TYPE SAFETY: Define processing groups as const tuple for runtime validation
 * This allows us to derive the type from the value, ensuring consistency
 * between runtime checks and TypeScript types.
 */
export const PROCESSING_GROUPS = ['text', 'hyperlinks', 'structure', 'lists'] as const;
export type ProcessingGroup = (typeof PROCESSING_GROUPS)[number];

export interface ProcessingOption {
  id: string;
  label: string;
  group: ProcessingGroup;
  enabled: boolean;
}

export const defaultOptions: ProcessingOption[] = [
  // Text Formatting Fixes Group
  { id: 'remove-italics', label: 'Remove All Italics', group: 'text', enabled: true },
  { id: 'normalize-dashes', label: 'Normalize Dashes to Hyphens', group: 'text', enabled: true },
  { id: 'preserve-red-font', label: 'Preserve Red (#FF0000) Font', group: 'text', enabled: false },
  {
    id: 'replace-outdated-titles',
    label: 'Update Outdated Hyperlink Titles',
    group: 'hyperlinks',
    enabled: true,
  },
  {
    id: 'validate-document-styles',
    label: 'Apply User Defined Styles',
    group: 'text',
    enabled: true,
  },

  // Hyperlink Fixes Group
  {
    id: 'update-top-hyperlinks',
    label: 'Top of the Document',
    group: 'hyperlinks',
    enabled: true,
  },
  {
    id: 'update-toc-hyperlinks',
    label: 'Table of Contents',
    group: 'hyperlinks',
    enabled: true,
  },
  {
    id: 'force-remove-heading1-toc',
    label: 'Force Remove Heading 1 from TOC',
    group: 'hyperlinks',
    enabled: true,
  },
  {
    id: 'fix-internal-hyperlinks',
    label: 'theSource Hyperlinks',
    group: 'hyperlinks',
    enabled: true,
  },
  { id: 'fix-content-ids', label: 'theSource Content IDs', group: 'hyperlinks', enabled: true },

  // Content Structure Fixes Group
  // Note: assign-styles and center-images are now applied automatically during processing
  {
    id: 'center-border-images',
    label: 'Center and Border Images',
    group: 'structure',
    enabled: true,
  },
  { id: 'remove-whitespace', label: 'Remove Extra Whitespace', group: 'structure', enabled: true },
  {
    id: 'remove-paragraph-lines',
    label: 'Remove Extra Blank Lines',
    group: 'structure',
    enabled: true,
  },
  {
    id: 'preserve-user-blank-structures',
    label: 'Preserve Previous User Set Blank Lines',
    group: 'structure',
    enabled: false,
  },
  {
    id: 'remove-headers-footers',
    label: 'Remove All Headers / Footers',
    group: 'structure',
    enabled: true,
  },
  { id: 'add-document-warning', label: 'Add Document Disclaimer', group: 'structure', enabled: true },
  {
    id: 'validate-header2-tables',
    label: 'Header 2 Section Tables',
    group: 'structure',
    enabled: true,
  },

  // List & Table Fixes Group
  { id: 'list-indentation', label: 'List Indentation', group: 'lists', enabled: true },
  { id: 'bullet-uniformity', label: 'List Styles', group: 'lists', enabled: true },
  {
    id: 'smart-tables',
    label: 'Table Formatting',
    group: 'lists',
    enabled: true,
  },
  {
    id: 'adjust-table-padding',
    label: 'Adjust Table Padding',
    group: 'lists',
    enabled: true,
  },
];

// TYPE SAFETY: Use Record with ProcessingGroup to ensure all groups have labels
const groupLabels: Record<ProcessingGroup, string> = {
  text: 'Text Formatting Fixes',
  hyperlinks: 'Hyperlink Fixes',
  structure: 'Content Structure Fixes',
  lists: 'List & Table Fixes',
};

interface ProcessingOptionsProps {
  sessionId?: string;
  options: ProcessingOption[]; // Fully controlled - no "initial" prefix
  onOptionsChange: (options: ProcessingOption[]) => void; // Required, not optional
  // Revision handling options
  autoAcceptRevisions?: boolean;
  onAutoAcceptRevisionsChange?: (autoAccept: boolean) => void;
  // Note: Table shading colors moved to StylesEditor for better organization
}

export function ProcessingOptions({
  options,
  onOptionsChange,
  autoAcceptRevisions = false,
  onAutoAcceptRevisionsChange,
}: ProcessingOptionsProps) {
  // REFACTORED: Fully controlled component - no local state
  // All state lives in parent (SessionContext)
  // This eliminates race conditions and state synchronization issues

  // Calculate master toggle state from props (derived state, not stored)
  const masterToggle = useMemo(() => {
    return options.every((opt) => opt.enabled);
  }, [options]);

  const toggleOption = useCallback(
    (optionId: string) => {
      const updatedOptions = options.map((opt) =>
        opt.id === optionId ? { ...opt, enabled: !opt.enabled } : opt
      );
      onOptionsChange(updatedOptions);
    },
    [options, onOptionsChange]
  );

  const toggleAll = useCallback(() => {
    const newState = !masterToggle;
    const updatedOptions = options.map((opt) => ({ ...opt, enabled: newState }));
    onOptionsChange(updatedOptions);
  }, [masterToggle, options, onOptionsChange]);

  const toggleGroup = useCallback(
    (group: string) => {
      const groupOptions = options.filter((opt) => opt.group === group);
      const allEnabled = groupOptions.every((opt) => opt.enabled);

      const updatedOptions = options.map((opt) =>
        opt.group === group ? { ...opt, enabled: !allEnabled } : opt
      );
      onOptionsChange(updatedOptions);
    },
    [options, onOptionsChange]
  );

  const groupedOptions = options.reduce(
    (acc, option) => {
      if (!acc[option.group]) {
        acc[option.group] = [];
      }
      acc[option.group].push(option);
      return acc;
    },
    {} as Record<string, ProcessingOption[]>
  );

  return (
    <div className="space-y-6">
      {/* Master Toggle */}
      <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
        <div>
          <h3 className="font-medium">Autonomous Processing</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Enable all processing options when documents are added
          </p>
        </div>
        <button
          onClick={toggleAll}
          role="switch"
          aria-checked={masterToggle}
          aria-label="Toggle all processing options"
          className={cn(
            'relative w-12 h-6 rounded-full transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            masterToggle ? 'bg-primary' : 'bg-muted'
          )}
        >
          <motion.div
            className="absolute w-5 h-5 bg-background rounded-full shadow-xs"
            animate={{ x: masterToggle ? 26 : 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            style={{ top: '0.5px' }}
          />
        </button>
      </div>

      {/* Grouped Options */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {Object.entries(groupedOptions).map(([group, groupOptions]) => {
          const allEnabled = groupOptions.every((opt) => opt.enabled);
          const someEnabled = groupOptions.some((opt) => opt.enabled);

          return (
            <div key={group} className="space-y-3">
              <button
                type="button"
                className="flex items-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
                onClick={() => toggleGroup(group)}
                role="checkbox"
                aria-checked={allEnabled ? true : someEnabled ? 'mixed' : false}
                aria-label={`Toggle ${groupLabels[group as ProcessingGroup]}`}
              >
                <div
                  aria-hidden="true"
                  className={cn(
                    'w-6 h-6 rounded border-2 flex items-center justify-center transition-all',
                    allEnabled
                      ? 'bg-primary border-primary checkbox-checked'
                      : someEnabled
                        ? 'bg-primary/50 border-primary'
                        : 'border-border hover:border-primary/50'
                  )}
                >
                  {(allEnabled || someEnabled) && (
                    <Check className="w-4 h-4 text-primary-foreground checkbox-checkmark" />
                  )}
                </div>
                <span className="font-semibold text-base">
                  {groupLabels[group as ProcessingGroup]}
                </span>
              </button>

              <div className="pl-6 space-y-2">
                {groupOptions.map((option) => (
                  <label key={option.id} className="flex items-center gap-3 cursor-pointer group">
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={option.enabled}
                        onChange={() => toggleOption(option.id)}
                        className="sr-only"
                      />
                      <div
                        className={cn(
                          'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                          option.enabled
                            ? 'bg-primary border-primary checkbox-checked'
                            : 'border-border group-hover:border-primary/50'
                        )}
                      >
                        {option.enabled && (
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                          >
                            <Check className="w-3 h-3 text-primary-foreground checkbox-checkmark" />
                          </motion.div>
                        )}
                      </div>
                    </div>
                    <span className="text-sm">{option.label}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Note: Table shading colors moved to StylesEditor for better organization */}

      {/* Word Tracked Changes Handling */}
      {onAutoAcceptRevisionsChange && (
        <div className="pt-4 border-t border-border">
          <RevisionHandlingOptions
            autoAccept={autoAcceptRevisions}
            onAutoAcceptChange={onAutoAcceptRevisionsChange}
          />
        </div>
      )}
    </div>
  );
}
