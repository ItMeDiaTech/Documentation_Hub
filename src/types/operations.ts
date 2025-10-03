/**
 * Operation-related type definitions
 * Defines types for document operations, tracking, and undo/redo functionality
 */

import type {
  DocumentOperation,
  ProcessingError,
  ProcessingWarning
} from './document-processing';
import type { HyperlinkChange } from './hyperlink';

// Operation status
export enum OperationStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  ROLLED_BACK = 'rolled_back'
}

// Operation priority levels
export enum OperationPriority {
  CRITICAL = 1,
  HIGH = 2,
  NORMAL = 3,
  LOW = 4,
  DEFERRED = 5
}

// Base operation tracking
export interface TrackedOperation {
  id: string;
  sessionId: string;
  documentPath: string;
  operation: DocumentOperation;
  status: OperationStatus;
  priority: OperationPriority;
  startTime?: Date;
  endTime?: Date;
  duration?: number; // milliseconds
  retryCount: number;
  maxRetries: number;
  error?: ProcessingError;
  warnings: ProcessingWarning[];
  result?: OperationResult;
  metadata?: Record<string, unknown>;
}

// Operation result
export interface OperationResult {
  success: boolean;
  changesApplied: number;
  elementsProcessed: number;
  elementsSkipped: number;
  details?: Record<string, unknown>;
  rollbackData?: RollbackData;
}

// Rollback data for undo functionality
export interface RollbackData {
  operationId: string;
  documentSnapshot?: ArrayBuffer;
  changes: ReversibleChange[];
  metadata: Record<string, unknown>;
}

// Reversible change for undo/redo
export interface ReversibleChange {
  id: string;
  type: 'hyperlink' | 'text' | 'style' | 'structure';
  elementPath: string;
  originalValue: unknown;
  newValue: unknown;
  timestamp: Date;
  reversible: boolean;
}

// Operation queue for batch processing
export interface OperationQueue {
  id: string;
  name: string;
  operations: QueuedOperation[];
  status: QueueStatus;
  concurrency: number;
  continueOnError: boolean;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  progress: QueueProgress;
}

export interface QueuedOperation extends TrackedOperation {
  queuePosition: number;
  dependencies?: string[]; // IDs of operations that must complete first
  skipCondition?: () => boolean;
  onComplete?: (result: OperationResult) => void;
  onError?: (error: ProcessingError) => void;
}

export enum QueueStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export interface QueueProgress {
  totalOperations: number;
  completedOperations: number;
  failedOperations: number;
  skippedOperations: number;
  currentOperation?: string;
  percentComplete: number;
  estimatedTimeRemaining?: number; // milliseconds
}

// Operation history for undo/redo
export interface OperationHistory {
  sessionId: string;
  documentPath: string;
  operations: HistoryEntry[];
  currentIndex: number;
  maxHistorySize: number;
}

export interface HistoryEntry {
  id: string;
  operation: TrackedOperation;
  timestamp: Date;
  canUndo: boolean;
  canRedo: boolean;
  description: string;
  changes: HyperlinkChange[];
  snapshot?: DocumentSnapshot;
}

export interface DocumentSnapshot {
  id: string;
  timestamp: Date;
  data: ArrayBuffer;
  checksum: string;
  size: number;
}

// Operation scheduling
export interface ScheduledOperation {
  id: string;
  operation: DocumentOperation;
  schedule: OperationSchedule;
  lastRun?: Date;
  nextRun: Date;
  runCount: number;
  maxRuns?: number;
  enabled: boolean;
}

export interface OperationSchedule {
  type: 'once' | 'recurring' | 'cron';
  interval?: number; // milliseconds for recurring
  cronExpression?: string; // for cron type
  startDate?: Date;
  endDate?: Date;
  timezone?: string;
}

// Operation dependencies and conditions
export interface OperationDependency {
  operationId: string;
  type: 'requires' | 'blocks' | 'optional';
  condition?: DependencyCondition;
}

export interface DependencyCondition {
  type: 'success' | 'failure' | 'completion' | 'custom';
  customCondition?: (result: OperationResult) => boolean;
}

// Operation templates for reuse
export interface OperationTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  operations: DocumentOperation[];
  parameters?: TemplateParameter[];
  defaults?: Record<string, unknown>;
  tags: string[];
  createdBy?: string;
  createdAt: Date;
  modifiedAt?: Date;
}

export interface TemplateParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  default?: unknown;
  description?: string;
  validation?: (value: unknown) => boolean;
}

// Operation metrics and analytics
export interface OperationMetrics {
  operationId: string;
  documentPath: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  cpuUsage?: number;
  memoryUsage?: number;
  elementsProcessed: number;
  throughput: number; // elements per second
  errors: number;
  warnings: number;
  successRate: number; // percentage
}

export interface OperationAnalytics {
  sessionId: string;
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageDuration: number;
  totalDuration: number;
  operationsByType: Record<string, number>;
  errorsByType: Record<string, number>;
  performanceTrend: PerformanceTrend[];
}

export interface PerformanceTrend {
  timestamp: Date;
  throughput: number;
  successRate: number;
  averageLatency: number;
}

// Operation validation
export interface OperationValidation {
  operationId: string;
  rules: ValidationRule[];
  results: ValidationResult[];
  passed: boolean;
}

export interface ValidationRule {
  id: string;
  name: string;
  description: string;
  condition: (operation: DocumentOperation) => boolean;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface ValidationResult {
  ruleId: string;
  passed: boolean;
  message?: string;
  details?: Record<string, unknown>;
}

// Operation permissions and security
export interface OperationPermissions {
  canExecute: boolean;
  canModify: boolean;
  canDelete: boolean;
  canSchedule: boolean;
  restrictions?: PermissionRestriction[];
}

export interface PermissionRestriction {
  type: 'time' | 'user' | 'document' | 'operation';
  condition: string;
  message?: string;
}

// Operation events
export interface OperationEvent {
  id: string;
  operationId: string;
  type: OperationEventType;
  timestamp: Date;
  data?: Record<string, unknown>;
  source?: string;
}

export enum OperationEventType {
  STARTED = 'started',
  PROGRESS = 'progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  RETRYING = 'retrying',
  ROLLED_BACK = 'rolled_back',
  QUEUED = 'queued',
  DEQUEUED = 'dequeued'
}

// Operation context for execution
export interface OperationContext {
  sessionId: string;
  documentPath: string;
  operation: DocumentOperation;
  options: OperationOptions;
  state: OperationState;
  logger: OperationLogger;
  cache: Map<string, unknown>;
  cancellationToken?: CancellationToken;
}

export interface OperationOptions {
  timeout?: number;
  retryPolicy?: RetryPolicy;
  parallelism?: number;
  progressReporting?: boolean;
  validateBeforeExecute?: boolean;
  createSnapshot?: boolean;
}

export interface OperationState {
  phase: string;
  progress: number;
  message?: string;
  data: Record<string, unknown>;
}

export interface OperationLogger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warning(message: string, data?: unknown): void;
  error(message: string, error?: Error): void;
}

export interface RetryPolicy {
  maxAttempts: number;
  delay: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  retryableErrors?: string[];
}

export interface CancellationToken {
  isCancellationRequested: boolean;
  register(callback: () => void): void;
  unregister(callback: () => void): void;
  cancel(): void;
}

// Export all operation-related types
export type AnyOperation =
  | TrackedOperation
  | QueuedOperation
  | ScheduledOperation;

export type OperationCallback = (
  operation: TrackedOperation,
  result: OperationResult
) => void | Promise<void>;