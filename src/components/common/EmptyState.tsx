import { cn } from '@/utils/cn';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { Button } from './Button';

interface EmptyStateAction {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'outline' | 'ghost';
  icon?: LucideIcon;
}

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  className,
  size = 'md',
}: EmptyStateProps) {
  const sizeStyles = {
    sm: {
      container: 'py-8 px-4',
      icon: 'w-10 h-10',
      iconWrapper: 'w-16 h-16',
      title: 'text-base',
      description: 'text-sm',
    },
    md: {
      container: 'py-12 px-6',
      icon: 'w-12 h-12',
      iconWrapper: 'w-20 h-20',
      title: 'text-lg',
      description: 'text-sm',
    },
    lg: {
      container: 'py-16 px-8',
      icon: 'w-14 h-14',
      iconWrapper: 'w-24 h-24',
      title: 'text-xl',
      description: 'text-base',
    },
  };

  const styles = sizeStyles[size];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        'flex flex-col items-center justify-center text-center',
        styles.container,
        className
      )}
    >
      {Icon && (
        <motion.div
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
          className={cn(
            'rounded-full bg-muted/50 flex items-center justify-center mb-4',
            styles.iconWrapper
          )}
        >
          <Icon className={cn('text-muted-foreground', styles.icon)} />
        </motion.div>
      )}

      <motion.h3
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
        className={cn('font-semibold text-foreground mb-1', styles.title)}
      >
        {title}
      </motion.h3>

      {description && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className={cn(
            'text-muted-foreground max-w-sm mb-6',
            styles.description
          )}
        >
          {description}
        </motion.p>
      )}

      {(primaryAction || secondaryAction) && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="flex items-center gap-3"
        >
          {primaryAction && (
            <Button
              onClick={primaryAction.onClick}
              variant={primaryAction.variant || 'default'}
              icon={primaryAction.icon && <primaryAction.icon className="w-4 h-4" />}
            >
              {primaryAction.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              onClick={secondaryAction.onClick}
              variant={secondaryAction.variant || 'ghost'}
              icon={secondaryAction.icon && <secondaryAction.icon className="w-4 h-4" />}
            >
              {secondaryAction.label}
            </Button>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

// Preset empty states for common use cases
export function NoSessionsEmptyState({ onCreateSession }: { onCreateSession: () => void }) {
  return (
    <EmptyState
      title="No sessions yet"
      description="Create your first session to start processing documents"
      primaryAction={{
        label: 'Create Session',
        onClick: onCreateSession,
      }}
      size="lg"
    />
  );
}

export function NoDocumentsEmptyState({ onAddDocuments }: { onAddDocuments: () => void }) {
  return (
    <EmptyState
      title="No documents"
      description="Drop files here or click to add documents to this session"
      primaryAction={{
        label: 'Add Documents',
        onClick: onAddDocuments,
      }}
    />
  );
}

export function NoSearchResultsEmptyState({ query }: { query: string }) {
  return (
    <EmptyState
      title="No results found"
      description={`No documents or sessions match "${query}". Try a different search term.`}
      size="sm"
    />
  );
}

export function NoChangesEmptyState() {
  return (
    <EmptyState
      title="No changes detected"
      description="Process a document to see tracked changes here"
      size="sm"
    />
  );
}
