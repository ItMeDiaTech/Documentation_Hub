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

// User-friendly descriptions for the right panel
const optionDescriptions: Record<string, string> = {
  // Text Formatting
  'remove-italics': 'Removes all italic text formatting',
  'normalize-dashes': 'Converts special dashes (em-dash, en-dash) to regular hyphens',
  'preserve-red-font': 'Prevents changes to text that is colored red',
  'replace-outdated-titles': 'Updates a hyperlink\'s display text to match the title within theSource if different',
  'validate-document-styles': 'Applies your custom style settings from the Styles tab',

  // Links & Navigation
  'update-top-hyperlinks': 'Adds or updates links that jump to the document start',
  'update-toc-hyperlinks': 'Creates or updates clickable links in the table of contents',
  'force-remove-heading1-toc': 'Removes the main document title from the table of contents',
  'fix-internal-hyperlinks': 'Fixes broken links that point to other parts of the document',
  'fix-content-ids': 'Appends Content ID to the end of theSource Hyperlinks',

  // Document Structure
  'center-border-images': 'Centers and borders images if image is bigger than 100x100 pixels',
  'remove-whitespace': 'Removes unnecessary spaces, tabs, and blank areas',
  'remove-paragraph-lines': 'Makes spacing between paragraphs consistent',
  'remove-headers-footers': 'Removes text from document headers and footers',
  'add-document-warning': 'Adds a standard disclaimer notice if missing',
  'validate-header2-tables': 'Formats 1x1 Heading 2 tables to ensure standardization across document',

  // Lists & Tables
  'list-indentation': 'Corrects the indentation of bulleted and numbered lists',
  'bullet-uniformity': 'Makes bullet styles consistent throughout',
  'normalize-table-lists': 'Converts typed list prefixes (1., A., •) to proper Word formatting and fixes mixed lists',
  'smart-tables': 'Applies consistent styling to all tables',
  'adjust-table-padding': 'Adjusts the space inside table cells',
  'standardize-table-borders': 'Makes table border styles uniform',
  'set-landscape-margins': 'Sets document to landscape orientation with 1-inch margins',
};

export const defaultOptions: ProcessingOption[] = [
  // Text Formatting Group
  { id: 'remove-italics', label: 'Remove Italics', group: 'text', enabled: true },
  { id: 'normalize-dashes', label: 'Standardize Dashes', group: 'text', enabled: true },
  { id: 'preserve-red-font', label: 'Keep Red Text', group: 'text', enabled: false },
  { id: 'replace-outdated-titles', label: 'Update theSource Link Titles', group: 'hyperlinks', enabled: true },
  { id: 'validate-document-styles', label: 'Apply Custom Styles', group: 'text', enabled: true },

  // Links & Navigation Group
  { id: 'update-top-hyperlinks', label: '"Top of Document" Hyperlinks', group: 'hyperlinks', enabled: true },
  { id: 'update-toc-hyperlinks', label: 'Table of Contents Hyperlinks', group: 'hyperlinks', enabled: true },
  { id: 'force-remove-heading1-toc', label: 'Remove Title from TOC', group: 'hyperlinks', enabled: true },
  { id: 'fix-internal-hyperlinks', label: 'Internal Hyperlinks', group: 'hyperlinks', enabled: true },
  { id: 'fix-content-ids', label: 'Content ID References', group: 'hyperlinks', enabled: true },

  // Document Structure Group
  { id: 'center-border-images', label: 'Center and Border Images', group: 'structure', enabled: true },
  { id: 'remove-whitespace', label: 'Clean Up Spaces', group: 'structure', enabled: true },
  { id: 'remove-paragraph-lines', label: 'Standardize Blank Lines', group: 'structure', enabled: true },
  { id: 'remove-headers-footers', label: 'Clear Headers/Footers', group: 'structure', enabled: true },
  { id: 'add-document-warning', label: 'Add Missing Disclaimer', group: 'structure', enabled: true },
  { id: 'validate-header2-tables', label: 'Heading 2 Tables', group: 'structure', enabled: true },
  { id: 'set-landscape-margins', label: 'Landscape Layout', group: 'structure', enabled: true },

  // Lists & Tables Group
  { id: 'list-indentation', label: 'Fix List Spacing', group: 'lists', enabled: true },
  { id: 'bullet-uniformity', label: 'Standardize Bullets', group: 'lists', enabled: true },
  { id: 'normalize-table-lists', label: 'Fix Typed List Prefixes', group: 'lists', enabled: true },
  { id: 'smart-tables', label: 'Format Tables', group: 'lists', enabled: true },
  { id: 'adjust-table-padding', label: 'Table Cell Spacing', group: 'lists', enabled: true },
  { id: 'standardize-table-borders', label: 'Fix Table Borders', group: 'lists', enabled: true },
];

// User-friendly group labels
const groupLabels: Record<ProcessingGroup, string> = {
  text: 'Text Formatting',
  hyperlinks: 'Links & Navigation',
  structure: 'Document Structure',
  lists: 'Lists & Tables',
};

interface ProcessingOptionsProps {
  sessionId?: string;
  options: ProcessingOption[]; // Fully controlled - no "initial" prefix
  onOptionsChange: (options: ProcessingOption[]) => void; // Required, not optional
  // Revision handling options
  autoAcceptRevisions?: boolean;
  onAutoAcceptRevisionsChange?: (autoAccept: boolean) => void;
}

export function ProcessingOptions({
  options,
  onOptionsChange,
  autoAcceptRevisions = false,
  onAutoAcceptRevisionsChange,
}: ProcessingOptionsProps) {
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

  // Get enabled options grouped by category for the right panel
  const enabledByGroup = useMemo(() => {
    const result: Record<string, ProcessingOption[]> = {};
    for (const group of PROCESSING_GROUPS) {
      const enabledInGroup = options.filter((opt) => opt.group === group && opt.enabled);
      if (enabledInGroup.length > 0) {
        result[group] = enabledInGroup;
      }
    }
    return result;
  }, [options]);

  const hasEnabledOptions = Object.keys(enabledByGroup).length > 0;

  return (
    <div className="space-y-6">
      {/* Two-Column Layout: Options on Left, Descriptions on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Options */}
        <div className="space-y-4">
          {Object.entries(groupedOptions).map(([group, groupOptions]) => {
            const allEnabled = groupOptions.every((opt) => opt.enabled);
            const someEnabled = groupOptions.some((opt) => opt.enabled);

            return (
              <div key={group} className="space-y-2">
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
                      'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                      allEnabled
                        ? 'bg-primary border-primary checkbox-checked'
                        : someEnabled
                          ? 'bg-primary/50 border-primary'
                          : 'border-border hover:border-primary/50'
                    )}
                  >
                    {(allEnabled || someEnabled) && (
                      <Check className="w-3 h-3 text-primary-foreground checkbox-checkmark" />
                    )}
                  </div>
                  <span className="font-semibold text-sm">
                    {groupLabels[group as ProcessingGroup]}
                  </span>
                </button>

                <div className="pl-5 space-y-1">
                  {groupOptions.map((option) => (
                    <label key={option.id} className="flex items-center gap-2 cursor-pointer group">
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={option.enabled}
                          onChange={() => toggleOption(option.id)}
                          className="sr-only"
                        />
                        <div
                          className={cn(
                            'w-4 h-4 rounded border-2 flex items-center justify-center transition-all',
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
                              <Check className="w-2.5 h-2.5 text-primary-foreground checkbox-checkmark" />
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

        {/* Right Column: Enabled Processing Descriptions */}
        <div className="bg-muted/20 rounded-lg p-4 border border-border/50">
          <h4 className="font-medium text-sm mb-3 text-muted-foreground">Enabled processing:</h4>

          {hasEnabledOptions ? (
            <div className="space-y-4">
              {Object.entries(enabledByGroup).map(([group, groupOptions]) => (
                <div key={group}>
                  <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    {groupLabels[group as ProcessingGroup]}
                  </h5>
                  <ul className="space-y-1.5">
                    {groupOptions.map((option) => (
                      <motion.li
                        key={option.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        className="flex items-start gap-2 text-sm"
                      >
                        <span className="text-primary mt-0.5">•</span>
                        <span>{optionDescriptions[option.id]}</span>
                      </motion.li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No processing options enabled</p>
          )}
        </div>
      </div>

      {/* DO NOT REMOVE - May utilize this in the future.
      {onAutoAcceptRevisionsChange && (
        <div className="pt-4 border-t border-border">
          <RevisionHandlingOptions
            autoAccept={autoAcceptRevisions}
            onAutoAcceptChange={onAutoAcceptRevisionsChange}
          />
        </div>
      )}
      */}
    </div>
  );
}
