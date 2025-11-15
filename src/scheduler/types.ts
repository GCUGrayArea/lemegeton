/**
 * Type definitions for the MIS Scheduler
 */

import { ColdState } from '../types/pr';

/**
 * Priority levels for PR scheduling
 */
export enum Priority {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

/**
 * Type of work to be scheduled
 */
export enum WorkType {
  /** Planning work - create implementation plan */
  PLANNING = 'planning',
  /** Implementation work - write the code */
  IMPLEMENTATION = 'implementation',
  /** QC work - review and validate */
  QC = 'qc',
  /** Review work - code review */
  REVIEW = 'review',
}

/**
 * PR node in the dependency graph
 */
export interface PRNode {
  /** Unique PR identifier */
  id: string;

  /** PR title */
  title: string;

  /** Current state of the PR */
  state: ColdState;

  /** Set of PR IDs this PR depends on */
  dependencies: Set<string>;

  /** Set of PR IDs that depend on this PR */
  dependents: Set<string>;

  /** Set of file paths this PR will modify */
  files: Set<string>;

  /** Priority level */
  priority: Priority;

  /** Complexity score (1-10) */
  complexity: number;

  /** Estimated time in minutes */
  estimatedMinutes: number;

  /** Suggested model for implementation */
  suggestedModel?: string;
}

/**
 * Work assignment from scheduler
 */
export interface Assignment {
  /** PR to be worked on */
  prId: string;

  /** Agent assigned to the PR */
  agentId?: string;

  /** Timestamp when assigned */
  assignedAt: number;

  /** Estimated duration in minutes */
  estimatedDuration: number;

  /** Priority of this assignment */
  priority: Priority;

  /** Complexity score */
  complexity: number;
}

/**
 * Scheduler result containing the maximum independent set
 */
export interface SchedulerResult {
  /** Set of PRs that can be worked on in parallel */
  selectedPRs: PRNode[];

  /** PRs that were available but not selected due to conflicts */
  blockedPRs: PRNode[];

  /** Reason for each blocked PR */
  blockReasons: Map<string, string>;

  /** Timestamp of scheduling decision */
  timestamp: number;

  /** Scheduling duration in ms */
  schedulingTimeMs: number;
}

/**
 * Configuration for the scheduler
 */
export interface SchedulerConfig {
  /** Maximum time for scheduling decision (ms) */
  maxSchedulingTime?: number;

  /** Whether to cache scheduling results */
  enableCaching?: boolean;

  /** Cache TTL in seconds */
  cacheTTL?: number;

  /** Whether to use priority ordering */
  usePriority?: boolean;

  /** Whether to consider complexity in ordering */
  useComplexity?: boolean;

  /** Maximum number of PRs to schedule at once */
  maxParallelPRs?: number;
}

/**
 * Statistics about the scheduler's performance
 */
export interface SchedulerStats {
  /** Total PRs in the system */
  totalPRs: number;

  /** PRs currently available for work */
  availablePRs: number;

  /** PRs currently being worked on */
  inProgressPRs: number;

  /** Completed PRs */
  completedPRs: number;

  /** Average scheduling time in ms */
  avgSchedulingTimeMs: number;

  /** Maximum achieved parallelism */
  maxParallelism: number;

  /** Current parallelism level */
  currentParallelism: number;

  /** Number of scheduling decisions made */
  schedulingDecisions: number;

  /** Cache hit rate (if caching enabled) */
  cacheHitRate?: number;
}

/**
 * Conflict information between PRs
 */
export interface ConflictInfo {
  /** First PR in the conflict */
  pr1: string;

  /** Second PR in the conflict */
  pr2: string;

  /** Files causing the conflict */
  conflictingFiles: Set<string>;
}

/**
 * Graph traversal options
 */
export interface TraversalOptions {
  /** Include completed PRs in traversal */
  includeCompleted?: boolean;

  /** Include in-progress PRs in traversal */
  includeInProgress?: boolean;

  /** Maximum depth to traverse */
  maxDepth?: number;
}