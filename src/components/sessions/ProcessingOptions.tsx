import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface ProcessingOption {
  id: string;
  label: string;
  group: 'text' | 'hyperlinks' | 'structure' | 'lists';
  enabled: boolean;
}

export const defaultOptions: ProcessingOption[] = [
  // Text Formatting Group
  { id: 'remove-whitespace', label: 'Remove Extra Whitespace', group: 'text', enabled: true },
  {
    id: 'remove-paragraph-lines',
    label: 'Remove Extra Paragraph Lines',
    group: 'text',
    enabled: true,
  },
  { id: 'remove-italics', label: 'Remove Italics', group: 'text', enabled: true },
  {
    id: 'normalize-spacing',
    label: 'Smart Spacing Normalization (New)',
    group: 'text',
    enabled: true,
  },

  // Hyperlinks Group
  {
    id: 'update-top-hyperlinks',
    label: 'Update Top of Document Hyperlinks',
    group: 'hyperlinks',
    enabled: true,
  },
  {
    id: 'update-toc-hyperlinks',
    label: 'Generate/Update Table of Contents',
    group: 'hyperlinks',
    enabled: true,
  },
  {
    id: 'replace-outdated-titles',
    label: 'Replace Outdated Titles',
    group: 'hyperlinks',
    enabled: true,
  },
  {
    id: 'fix-internal-hyperlinks',
    label: 'Fix Internal Hyperlinks (Enhanced)',
    group: 'hyperlinks',
    enabled: true,
  },
  { id: 'fix-content-ids', label: 'Fix / Append Content IDs', group: 'hyperlinks', enabled: true },
  {
    id: 'standardize-hyperlink-color',
    label: 'Standardize Hyperlink Color (#0000FF)',
    group: 'hyperlinks',
    enabled: true,
  },
  {
    id: 'validate-hyperlinks',
    label: 'Validate & Auto-Fix All Links (New)',
    group: 'hyperlinks',
    enabled: true,
  },

  // Content Structure Group
  // Note: assign-styles and center-images are now applied automatically during processing
  {
    id: 'remove-headers-footers',
    label: 'Remove Headers / Footers',
    group: 'structure',
    enabled: true,
  },
  { id: 'add-document-warning', label: 'Add Document Warning', group: 'structure', enabled: true },
  {
    id: 'validate-header2-tables',
    label: 'Validate Header 2 Table Formatting',
    group: 'structure',
    enabled: true,
  },
  {
    id: 'validate-document-styles',
    label: 'Validate Document Styles',
    group: 'structure',
    enabled: true,
  },

  // Lists & Tables Group
  { id: 'list-indentation', label: 'List Indentation Uniformity', group: 'lists', enabled: true },
  { id: 'bullet-uniformity', label: 'Bullet Style Uniformity', group: 'lists', enabled: true },
  { id: 'table-uniformity', label: 'Table Uniformity (Enhanced)', group: 'lists', enabled: true },
  {
    id: 'smart-tables',
    label: 'Smart Table Detection & Formatting (New)',
    group: 'lists',
    enabled: true,
  },
];

const groupLabels = {
  text: 'Text Formatting',
  hyperlinks: 'Hyperlinks',
  structure: 'Content Structure',
  lists: 'Lists & Tables',
};

interface ProcessingOptionsProps {
  sessionId?: string;
  options: ProcessingOption[]; // Fully controlled - no "initial" prefix
  onOptionsChange: (options: ProcessingOption[]) => void; // Required, not optional
  // Note: Table shading colors moved to StylesEditor for better organization
}

export function ProcessingOptions({ options, onOptionsChange }: ProcessingOptionsProps) {
  // REFACTORED: Fully controlled component - no local state
  // All state lives in parent (SessionContext)
  // This eliminates race conditions and state synchronization issues

  // Calculate master toggle state from props (derived state, not stored)
  const masterToggle = useMemo(() => {
    return options.every((opt) => opt.enabled);
  }, [options]);

  const toggleOption = (optionId: string) => {
    const updatedOptions = options.map((opt) =>
      opt.id === optionId ? { ...opt, enabled: !opt.enabled } : opt
    );

    // DEBUG: Log option changes
    const changedOption = updatedOptions.find((opt) => opt.id === optionId);
    console.log(
      `[ProcessingOptions] Toggled "${optionId}":`,
      changedOption?.enabled ? 'ENABLED' : 'DISABLED'
    );
    console.log(
      '[ProcessingOptions] All enabled options:',
      updatedOptions.filter((opt) => opt.enabled).map((opt) => opt.id)
    );

    onOptionsChange(updatedOptions);
  };

  const toggleAll = () => {
    const newState = !masterToggle;
    const updatedOptions = options.map((opt) => ({ ...opt, enabled: newState }));
    onOptionsChange(updatedOptions);
  };

  const toggleGroup = (group: string) => {
    const groupOptions = options.filter((opt) => opt.group === group);
    const allEnabled = groupOptions.every((opt) => opt.enabled);

    const updatedOptions = options.map((opt) =>
      opt.group === group ? { ...opt, enabled: !allEnabled } : opt
    );
    onOptionsChange(updatedOptions);
  };

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
          className={cn(
            'relative w-12 h-6 rounded-full transition-colors',
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
              <div
                className="flex items-center gap-2 cursor-pointer"
                onClick={() => toggleGroup(group)}
              >
                <div
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
                <h4 className="font-semibold text-base">
                  {groupLabels[group as keyof typeof groupLabels]}
                </h4>
              </div>

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
    </div>
  );
}
