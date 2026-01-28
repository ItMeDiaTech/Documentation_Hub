import { cn } from '@/utils/cn';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'circle' | 'text' | 'card';
}

export function Skeleton({ className, variant = 'default', ...props }: SkeletonProps) {
  const variants = {
    default: '',
    circle: 'rounded-full',
    text: 'h-4 rounded',
    card: 'h-32 rounded-lg',
  };

  return (
    <div
      className={cn('skeleton', 'bg-muted animate-pulse', variants[variant], className)}
      {...props}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border p-6 space-y-4">
      <div className="space-y-2">
        <Skeleton variant="text" className="w-3/4" />
        <Skeleton variant="text" className="w-1/2" />
      </div>
      <Skeleton className="h-20" />
      <div className="flex gap-2">
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-9 w-20" />
      </div>
    </div>
  );
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton variant="circle" className="w-10 h-10" />
          <div className="space-y-2 flex-1">
            <Skeleton variant="text" className="w-1/3" />
            <Skeleton variant="text" className="w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Document row skeleton for document lists
export function SkeletonDocumentRow() {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg border border-border">
      <div className="flex items-center gap-3">
        <Skeleton className="w-8 h-8 rounded" />
        <div className="space-y-1.5">
          <Skeleton variant="text" className="w-40" />
          <Skeleton variant="text" className="w-24 h-3" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="w-16 h-6 rounded-full" />
        <Skeleton className="w-8 h-8 rounded" />
      </div>
    </div>
  );
}

// Session card skeleton
export function SkeletonSessionCard() {
  return (
    <div className="rounded-xl border border-border p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div className="space-y-2 flex-1">
          <Skeleton variant="text" className="w-2/3 h-5" />
          <Skeleton variant="text" className="w-1/3 h-3" />
        </div>
        <Skeleton className="w-20 h-6 rounded-full" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-16 rounded-lg" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 flex-1 rounded-lg" />
        <Skeleton className="h-9 w-9 rounded-lg" />
      </div>
    </div>
  );
}

// Chart skeleton for analytics
export function SkeletonChart({ height = 200 }: { height?: number }) {
  return (
    <div className="rounded-xl border border-border p-5 space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton variant="text" className="w-32 h-5" />
        <Skeleton className="w-24 h-8 rounded-lg" />
      </div>
      <div
        className="relative bg-muted/30 rounded-lg overflow-hidden"
        style={{ height }}
      >
        {/* Fake bar chart skeleton */}
        <div className="absolute bottom-0 left-0 right-0 flex items-end justify-around gap-2 p-4">
          {[60, 80, 45, 90, 70, 55, 85].map((h, i) => (
            <Skeleton
              key={i}
              className="flex-1 rounded-t"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// Settings section skeleton
export function SkeletonSettingsSection() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-6">
        <Skeleton className="w-10 h-10 rounded-lg" />
        <div className="space-y-1.5">
          <Skeleton variant="text" className="w-32 h-5" />
          <Skeleton variant="text" className="w-48 h-3" />
        </div>
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <Skeleton className="w-8 h-8 rounded-lg" />
              <div className="space-y-1.5">
                <Skeleton variant="text" className="w-28" />
                <Skeleton variant="text" className="w-40 h-3" />
              </div>
            </div>
            <Skeleton className="w-10 h-5 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Table skeleton
export function SkeletonTable({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="bg-muted/50 px-4 py-3 flex gap-4">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} variant="text" className="flex-1 h-4" />
        ))}
      </div>
      {/* Rows */}
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="px-4 py-3 flex gap-4 items-center">
            {Array.from({ length: columns }).map((_, colIndex) => (
              <Skeleton
                key={colIndex}
                variant="text"
                className={cn(
                  'flex-1',
                  colIndex === 0 && 'w-1/4',
                  colIndex === columns - 1 && 'w-20'
                )}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
