/**
 * PR State Management Types
 *
 * Defines the state machine for PR lifecycle management with hot/cold state separation:
 * - Hot states: Ephemeral work-in-progress stored in Redis
 * - Cold states: Durable checkpoints committed to git
 */

/**
 * Hot States - Ephemeral work-in-progress states stored only in Redis.
 * These states represent active work and are lost if Redis crashes.
 * No git commits are made during hot state transitions.
 */
export type HotState =
  | 'investigating'  // Agent is analyzing requirements
  | 'planning'       // Agent is creating implementation plan
  | 'in-progress'    // Agent is actively implementing
  | 'under-review';  // Code review agent is examining

/**
 * Cold States - Durable checkpoint states committed to git.
 * These states survive crashes and represent stable milestones.
 * Git commits are made during cold state transitions.
 */
export type ColdState =
  | 'new'        // PR just created, not yet started
  | 'ready'      // Dependencies met, ready for assignment
  | 'blocked'    // Dependencies not met, cannot proceed
  | 'planned'    // Implementation plan complete
  | 'completed'  // Implementation done, awaiting QC
  | 'approved'   // QC passed, ready to merge
  | 'broken';    // QC failed, needs fix

/**
 * State transition types for the state machine.
 * Used to validate and track state changes.
 */
export type PRTransition = {
  from: ColdState | HotState;
  to: ColdState | HotState;
  timestamp: Date;
  agent_id?: string;
  reason?: string;
};

/**
 * Complete PR state including both hot and cold states.
 * This is the primary interface for tracking PR lifecycle.
 */
export interface PRState {
  /** Unique PR identifier (e.g., "PR-001") */
  pr_id: string;

  /** Current cold state - durable, committed to git */
  cold_state: ColdState;

  /** Current hot state - ephemeral, only in Redis */
  hot_state?: HotState;

  /** ID of agent currently assigned to this PR */
  agent_id?: string;

  /** List of PR IDs that must complete before this PR can start */
  dependencies: string[];

  /** Files currently locked by this PR's agent */
  files_locked: string[];

  /** Timestamp of last state transition */
  last_transition: string;

  /** Complexity analysis for intelligent model routing */
  complexity?: PRComplexity;

  /** Git branch name for degraded mode operation */
  branch?: string;

  /** Total tokens consumed working on this PR */
  token_usage?: number;

  /** Estimated cost so far (in USD) */
  estimated_cost?: number;
}

/**
 * PR Complexity Analysis
 * Used for intelligent model routing (Haiku/Sonnet/Opus) and resource estimation.
 */
export interface PRComplexity {
  /** Complexity score from 1-10 (1=trivial, 10=architectural) */
  score: number;

  /** Estimated implementation time in minutes */
  estimated_minutes: number;

  /** Estimated number of files to create/modify */
  file_count: number;

  /** Number of dependency PRs */
  dependency_count: number;

  /** Suggested model tier for cost optimization */
  suggested_model: 'haiku' | 'sonnet' | 'opus';

  /** Explanation of complexity assessment */
  rationale: string;

  /** Breakdown of individual scoring factors */
  factors?: {
    fileScore: number;
    dependencyScore: number;
    keywordScore: number;
    descriptionScore: number;
  };

  /** Predicted file conflicts from speculative execution */
  likely_conflicts?: string[];

  /** Documentation that should be pre-fetched */
  prefetch_docs?: string[];
}

/**
 * Priority level for PR scheduling
 */
export type Priority = 'critical' | 'high' | 'medium' | 'low';

/**
 * PR metadata parsed from task-list.md frontmatter.
 * Extends PRState with additional planning information.
 */
export interface PRMetadata extends PRState {
  /** Human-readable PR title */
  title: string;

  /** Priority level for scheduling */
  priority: Priority;

  /** Detailed description of the PR */
  description: string;

  /** Acceptance criteria checklist */
  acceptance_criteria: string[];

  /** Additional notes or context */
  notes?: string;

  /** Files expected to be created or modified */
  estimated_files: Array<{
    path: string;
    action: 'create' | 'modify' | 'delete';
    description: string;
  }>;
}
