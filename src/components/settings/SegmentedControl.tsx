import { motion } from 'framer-motion';
import { cn } from '@/utils/cn';
import type { LucideIcon } from 'lucide-react';

interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentedControlOption<T>[];
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  className,
  size = 'md',
}: SegmentedControlProps<T>) {
  const sizeStyles = {
    sm: 'p-0.5 text-xs',
    md: 'p-1 text-sm',
    lg: 'p-1.5 text-base',
  };

  const buttonSizeStyles = {
    sm: 'px-2.5 py-1',
    md: 'px-4 py-2',
    lg: 'px-5 py-2.5',
  };

  const iconSizeStyles = {
    sm: 'w-3.5 h-3.5',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  return (
    <div
      role="radiogroup"
      className={cn(
        'inline-flex items-center rounded-lg bg-muted/50 border border-border',
        sizeStyles[size],
        className
      )}
    >
      {options.map((option) => {
        const isSelected = value === option.value;
        const Icon = option.icon;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onValueChange(option.value)}
            className={cn(
              'relative flex items-center justify-center gap-2 rounded-md font-medium transition-colors',
              buttonSizeStyles[size],
              isSelected
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {isSelected && (
              <motion.div
                layoutId="segmented-indicator"
                className="absolute inset-0 bg-background rounded-md shadow-sm border border-border/50"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <span className="relative flex items-center gap-2">
              {Icon && <Icon className={iconSizeStyles[size]} />}
              <span>{option.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
