import { useState, useEffect } from 'react';
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
  { id: 'remove-whitespace', label: 'Remove Extra Whitespace', group: 'text', enabled: false },
  { id: 'remove-paragraph-lines', label: 'Remove Extra Paragraph Lines', group: 'text', enabled: false },
  { id: 'remove-italics', label: 'Remove Italics', group: 'text', enabled: false },

  // Hyperlinks Group
  { id: 'update-top-hyperlinks', label: 'Update Top of Document Hyperlinks', group: 'hyperlinks', enabled: false },
  { id: 'update-toc-hyperlinks', label: 'Update Table of Contents Hyperlinks', group: 'hyperlinks', enabled: false },
  { id: 'replace-outdated-titles', label: 'Replace Outdated Titles', group: 'hyperlinks', enabled: false },
  { id: 'fix-internal-hyperlinks', label: 'Attempt Fix for Internal Hyperlinks', group: 'hyperlinks', enabled: false },
  { id: 'fix-content-ids', label: 'Fix / Append Content IDs', group: 'hyperlinks', enabled: false },
  { id: 'standardize-hyperlink-color', label: 'Standardize Hyperlink Color', group: 'hyperlinks', enabled: false },

  // Content Structure Group
  { id: 'assign-styles', label: 'Assign Styles', group: 'structure', enabled: false },
  { id: 'center-images', label: 'Center Images', group: 'structure', enabled: false },
  { id: 'fix-keywords', label: 'Fix Key Words', group: 'structure', enabled: false },

  // Lists & Tables Group
  { id: 'list-indentation', label: 'List Indentation Uniformity', group: 'lists', enabled: false },
  { id: 'bullet-uniformity', label: 'Bullet Style Uniformity', group: 'lists', enabled: false },
  { id: 'table-uniformity', label: 'Table Uniformity', group: 'lists', enabled: false },
];

const groupLabels = {
  text: 'Text Formatting',
  hyperlinks: 'Hyperlinks',
  structure: 'Content Structure',
  lists: 'Lists & Tables'
};

interface ProcessingOptionsProps {
  sessionId?: string;
  initialOptions?: ProcessingOption[];
  onOptionsChange?: (options: ProcessingOption[]) => void;
}

export function ProcessingOptions({ initialOptions, onOptionsChange }: ProcessingOptionsProps) {
  const [options, setOptions] = useState<ProcessingOption[]>(initialOptions ?? defaultOptions);
  const [masterToggle, setMasterToggle] = useState(false);

  // Sync with prop changes (when switching sessions or loading saved options)
  useEffect(() => {
    if (initialOptions) {
      setOptions(initialOptions);
      // Update master toggle based on whether all options are enabled
      setMasterToggle(initialOptions.every(opt => opt.enabled));
    }
  }, [initialOptions]);

  const toggleOption = (optionId: string) => {
    const updatedOptions = options.map(opt =>
      opt.id === optionId ? { ...opt, enabled: !opt.enabled } : opt
    );
    setOptions(updatedOptions);
    onOptionsChange?.(updatedOptions);
  };

  const toggleAll = () => {
    const newState = !masterToggle;
    setMasterToggle(newState);
    const updatedOptions = options.map(opt => ({ ...opt, enabled: newState }));
    setOptions(updatedOptions);
    onOptionsChange?.(updatedOptions);
  };

  const toggleGroup = (group: string) => {
    const groupOptions = options.filter(opt => opt.group === group);
    const allEnabled = groupOptions.every(opt => opt.enabled);

    const updatedOptions = options.map(opt =>
      opt.group === group ? { ...opt, enabled: !allEnabled } : opt
    );
    setOptions(updatedOptions);
    onOptionsChange?.(updatedOptions);
  };

  const groupedOptions = options.reduce((acc, option) => {
    if (!acc[option.group]) {
      acc[option.group] = [];
    }
    acc[option.group].push(option);
    return acc;
  }, {} as Record<string, ProcessingOption[]>);

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
            className="absolute w-5 h-5 bg-background rounded-full shadow-sm"
            animate={{ x: masterToggle ? 26 : 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            style={{ top: '0.5px' }}
          />
        </button>
      </div>

      {/* Grouped Options */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {Object.entries(groupedOptions).map(([group, groupOptions]) => {
          const allEnabled = groupOptions.every(opt => opt.enabled);
          const someEnabled = groupOptions.some(opt => opt.enabled);

          return (
            <div key={group} className="space-y-3">
              <div
                className="flex items-center gap-2 cursor-pointer"
                onClick={() => toggleGroup(group)}
              >
                <div className={cn(
                  'w-6 h-6 rounded border-2 flex items-center justify-center transition-all',
                  allEnabled
                    ? 'bg-primary border-primary checkbox-checked'
                    : someEnabled
                    ? 'bg-primary/50 border-primary'
                    : 'border-border hover:border-primary/50'
                )}>
                  {(allEnabled || someEnabled) && (
                    <Check className="w-4 h-4 text-primary-foreground checkbox-checkmark" />
                  )}
                </div>
                <h4 className="font-semibold text-base">{groupLabels[group as keyof typeof groupLabels]}</h4>
              </div>

              <div className="pl-6 space-y-2">
                {groupOptions.map((option) => (
                  <label
                    key={option.id}
                    className="flex items-center gap-3 cursor-pointer group"
                  >
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={option.enabled}
                        onChange={() => toggleOption(option.id)}
                        className="sr-only"
                      />
                      <div className={cn(
                        'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                        option.enabled
                          ? 'bg-primary border-primary checkbox-checked'
                          : 'border-border group-hover:border-primary/50'
                      )}>
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
    </div>
  );
}