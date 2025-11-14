/**
 * Coordination Mode Types
 *
 * Defines the three coordination modes and related types for graceful degradation.
 * Ensures productivity continues even during infrastructure failures.
 */

/**
 * Coordination modes for graceful degradation.
 *
 * - DISTRIBUTED: Normal operation with shared Redis for coordination
 * - DEGRADED: Local Redis with git branches when shared Redis unavailable
 * - ISOLATED: Pure local work without any Redis when Docker unavailable
 */
export enum CoordinationMode {
  /** Normal mode: Shared Redis, pessimistic file locking */
  DISTRIBUTED = 'distributed',

  /** Degraded mode: Local Redis + git branches, accepts conflicts */
  DEGRADED = 'degraded',

  /** Isolated mode: No Redis, file-based state, single agent */
  ISOLATED = 'isolated'
}

/**
 * Current coordination state of the system.
 * Tracked by Hub to manage mode transitions.
 */
export interface CoordinationState {
  /** Current coordination mode */
  mode: CoordinationMode;

  /** Whether Redis is available and healthy */
  redis_available: boolean;

  /** Whether Docker is available for auto-spawn */
  docker_available: boolean;

  /** Whether agents are working on separate git branches */
  agents_on_branches: boolean;

  /** Timestamp of last mode change */
  last_mode_change: Date;

  /** Reason for entering current mode */
  degradation_reason?: string;

  /** Redis connection URL (if available) */
  redis_url?: string;

  /** Number of active agents */
  active_agents: number;
}

/**
 * File lease information.
 * Used to prevent merge conflicts through pessimistic locking.
 */
export interface FileLease {
  /** File path being leased */
  file_path: string;

  /** Agent holding the lease */
  agent_id: string;

  /** PR this lease is for */
  pr_id: string;

  /** When lease was acquired */
  acquired_at: Date;

  /** When lease expires (TTL) */
  expires_at: Date;

  /** Whether this is a paired test file lease */
  is_test_file: boolean;

  /** Parent file if this is a test file */
  parent_file?: string;
}

/**
 * Result of attempting to acquire file leases.
 */
export interface LeaseResult {
  /** Whether all requested leases were acquired */
  success: boolean;

  /** Files successfully leased */
  leased_files: string[];

  /** Conflicting leases that prevented acquisition */
  conflicts?: LeaseConflict[];

  /** Lease expiry time (if successful) */
  expires_at?: Date;
}

/**
 * Information about a lease conflict.
 */
export interface LeaseConflict {
  /** File that couldn't be leased */
  file_path: string;

  /** Agent holding the conflicting lease */
  held_by_agent: string;

  /** PR holding the conflicting lease */
  held_by_pr: string;

  /** When the conflicting lease expires */
  expires_at: Date;
}

/**
 * Redis health check result.
 */
export interface RedisHealth {
  /** Whether Redis is healthy */
  healthy: boolean;

  /** Response time in milliseconds */
  response_time_ms?: number;

  /** Error message if unhealthy */
  error?: string;

  /** Redis version */
  version?: string;

  /** Memory usage information */
  memory?: {
    used_mb: number;
    max_mb: number;
    percentage: number;
  };
}

/**
 * Docker availability check result.
 */
export interface DockerAvailability {
  /** Whether Docker is available */
  available: boolean;

  /** Docker version if available */
  version?: string;

  /** Error message if unavailable */
  error?: string;

  /** Whether Docker daemon is running */
  daemon_running: boolean;
}

/**
 * Mode transition event.
 * Logged when coordination mode changes.
 */
export interface ModeTransition {
  /** Previous mode */
  from: CoordinationMode;

  /** New mode */
  to: CoordinationMode;

  /** When transition occurred */
  timestamp: Date;

  /** Reason for transition */
  reason: string;

  /** Whether transition was automatic */
  automatic: boolean;

  /** Agent IDs that need notification */
  affected_agents: string[];
}

/**
 * Degraded mode branch information.
 * Tracks git branches used during degraded operation.
 */
export interface DegradedBranch {
  /** Branch name (e.g., "pr-005-agent-1") */
  branch_name: string;

  /** PR this branch is for */
  pr_id: string;

  /** Agent working on this branch */
  agent_id: string;

  /** When branch was created */
  created_at: Date;

  /** Whether branch has been pushed to remote */
  pushed: boolean;

  /** Whether branch has been merged */
  merged: boolean;

  /** Merge conflict status */
  has_conflicts?: boolean;
}

/**
 * Isolated mode state file.
 * When Redis is unavailable, state is persisted to files.
 */
export interface IsolatedStateFile {
  /** File path for state storage */
  file_path: string;

  /** PR states stored in this file */
  pr_states: Record<string, any>;

  /** Agent states */
  agent_states: Record<string, any>;

  /** Last update timestamp */
  last_updated: Date;

  /** Format version for compatibility */
  version: string;
}
