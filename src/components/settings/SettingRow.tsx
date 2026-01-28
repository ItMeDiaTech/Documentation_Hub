import { cn } from '@/utils/cn';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface SettingRowProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  badge?: string;
  children: ReactNode;
  className?: string;
}

export function SettingRow({
  icon: Icon,
  title,
  description,
  badge,
  children,
  className,
}: SettingRowProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 py-3',
        className
      )}
    >
      <div className="flex items-start gap-3 flex-1 min-w-0">
        {Icon && (
          <div className="p-2 rounded-lg bg-muted shrink-0 mt-0.5">
            <Icon className="w-4 h-4 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{title}</span>
            {badge && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-muted text-muted-foreground uppercase tracking-wide">
                {badge}
              </span>
            )}
          </div>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
