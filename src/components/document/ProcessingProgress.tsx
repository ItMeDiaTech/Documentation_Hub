import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  FileText,
  Link,
  CheckCircle,
  AlertCircle,
  Clock,
  Activity,
  Database,
  Shield,
} from 'lucide-react';
import { cn } from '@/utils/cn';

interface ProcessingStep {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'processing' | 'completed' | 'error' | 'skipped';
  progress?: number;
  duration?: number;
  error?: string;
  icon: React.ReactNode;
}

interface ProcessingProgressProps {
  documentName: string;
  currentStep?: string;
  progress: number;
  steps?: ProcessingStep[];
  statistics?: {
    totalElements: number;
    processedElements: number;
    modifiedElements: number;
    hyperlinksProcessed?: number;
    errors?: number;
    warnings?: number;
  };
  estimatedTimeRemaining?: number;
  onCancel?: () => void;
  className?: string;
}

const defaultSteps: ProcessingStep[] = [
  {
    id: 'backup',
    name: 'Creating Backup',
    description: 'Saving original document',
    status: 'pending',
    icon: <Database className="w-4 h-4" />,
  },
  {
    id: 'validation',
    name: 'Validating Document',
    description: 'Checking document structure',
    status: 'pending',
    icon: <Shield className="w-4 h-4" />,
  },
  {
    id: 'scanning',
    name: 'Scanning Hyperlinks',
    description: 'Finding all hyperlinks',
    status: 'pending',
    icon: <Activity className="w-4 h-4" />,
  },
  {
    id: 'processing',
    name: 'Processing Hyperlinks',
    description: 'Applying modifications',
    status: 'pending',
    icon: <Link className="w-4 h-4" />,
  },
  {
    id: 'saving',
    name: 'Saving Document',
    description: 'Writing changes to file',
    status: 'pending',
    icon: <FileText className="w-4 h-4" />,
  },
];

export function ProcessingProgress({
  documentName,
  currentStep,
  progress,
  steps = defaultSteps,
  statistics,
  estimatedTimeRemaining,
  onCancel,
  className,
}: ProcessingProgressProps) {
  const [animatedProgress, setAnimatedProgress] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    setAnimatedProgress(progress);
  }, [progress]);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const getStepStatus = (step: ProcessingStep) => {
    if (currentStep === step.id) return 'processing';
    const currentIndex = steps.findIndex((s) => s.id === currentStep);
    const stepIndex = steps.findIndex((s) => s.id === step.id);
    if (currentIndex > stepIndex) return 'completed';
    return step.status;
  };

  const getStepIcon = (status: ProcessingStep['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      case 'processing':
        return (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full"
          />
        );
      case 'skipped':
        return <div className="w-5 h-5 rounded-full bg-muted" />;
      default:
        return <Clock className="w-5 h-5 text-muted-foreground" />;
    }
  };

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-lg">Processing Document</h3>
            <p className="text-sm text-muted-foreground truncate max-w-md">{documentName}</p>
          </div>
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-3 py-1 text-sm border border-border rounded-lg hover:bg-destructive/10 hover:border-destructive transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Main Progress Bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Overall Progress</span>
          <span className="font-medium">{Math.round(animatedProgress)}%</span>
        </div>
        <div className="relative h-3 bg-muted rounded-full overflow-hidden">
          <motion.div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary via-primary to-primary/80"
            initial={{ width: '0%' }}
            animate={{ width: `${animatedProgress}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          >
            {/* Shimmer effect */}
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
              animate={{ x: ['0%', '200%'] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
            />
          </motion.div>
        </div>
      </div>

      {/* Processing Steps */}
      <div className="space-y-3">
        {steps.map((step, index) => {
          const status = getStepStatus(step);
          const isActive = currentStep === step.id;

          return (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              className={cn(
                'flex items-start gap-3 p-3 rounded-lg transition-all',
                isActive && 'bg-primary/5 border border-primary/20',
                status === 'completed' && 'opacity-70',
                status === 'error' && 'bg-destructive/5 border border-destructive/20'
              )}
            >
              <div className="mt-0.5">{getStepIcon(status)}</div>

              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{step.name}</span>
                  {isActive && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="text-xs text-primary px-2 py-0.5 bg-primary/10 rounded-full"
                    >
                      Processing...
                    </motion.span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{step.description}</p>
                {step.error && <p className="text-sm text-destructive">{step.error}</p>}
                {isActive && step.progress !== undefined && (
                  <div className="mt-2">
                    <div className="h-1 bg-muted rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-primary"
                        initial={{ width: '0%' }}
                        animate={{ width: `${step.progress}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 text-muted-foreground">
                {step.icon}
                {status === 'completed' && step.duration && (
                  <span className="text-xs">{formatTime(step.duration)}</span>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Statistics */}
      {statistics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <p className="text-lg font-bold">{statistics.totalElements}</p>
            <p className="text-xs text-muted-foreground">Total Elements</p>
          </div>
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <p className="text-lg font-bold text-primary">{statistics.processedElements}</p>
            <p className="text-xs text-muted-foreground">Processed</p>
          </div>
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <p className="text-lg font-bold text-green-500">{statistics.modifiedElements}</p>
            <p className="text-xs text-muted-foreground">Modified</p>
          </div>
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <p className="text-lg font-bold text-blue-500">{statistics.hyperlinksProcessed || 0}</p>
            <p className="text-xs text-muted-foreground">Hyperlinks</p>
          </div>
        </div>
      )}

      {/* Time Information */}
      <div className="flex justify-between items-center text-sm text-muted-foreground">
        <div className="flex items-center gap-4">
          <span>Elapsed: {formatTime(elapsedTime)}</span>
          {estimatedTimeRemaining !== undefined && (
            <span>Remaining: ~{formatTime(estimatedTimeRemaining)}</span>
          )}
        </div>
        {statistics?.warnings !== undefined && statistics.warnings > 0 && (
          <span className="text-yellow-500">
            {statistics.warnings} warning{statistics.warnings !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Animated background effect */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-lg">
        <motion.div
          className="absolute -inset-40 opacity-5"
          animate={{
            rotate: [0, 360],
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: 'linear',
          }}
        >
          <div className="w-full h-full bg-gradient-to-r from-primary to-transparent" />
        </motion.div>
      </div>
    </div>
  );
}
