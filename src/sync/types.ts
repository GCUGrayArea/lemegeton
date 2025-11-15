/**
 * Types for State Synchronization System
 */

import { HotState, ColdState, PRState } from '../types/pr';
import { CommitMetadata } from '../core/stateMachine';

/**
 * Display update for hot state visibility in task-list.md
 */
export interface DisplayUpdate {
  pr_id: string;
  hot_state: HotState;
  agent_id?: string;
  timestamp: Date;
}

/**
 * Conflict report from reconciliation
 */
export interface ConflictReport {
  pr_id: string;
  conflict_type: ConflictType;
  redis_state: HotState | ColdState | null;
  git_state: ColdState | null;
  resolution: ConflictResolution;
  timestamp: Date;
}

/**
 * Types of state conflicts
 */
export enum ConflictType {
  REDIS_HOT_GIT_DIFFERENT = 'redis_hot_git_different',
  REDIS_MISSING = 'redis_missing',
  REDIS_ORPHANED = 'redis_orphaned',
  HEARTBEAT_EXPIRED = 'heartbeat_expired',
  CONCURRENT_UPDATE = 'concurrent_update'
}

/**
 * Resolution strategy for conflicts
 */
export enum ConflictResolution {
  TRUST_GIT = 'trust_git',
  HYDRATE_REDIS = 'hydrate_redis',
  CLEAR_REDIS = 'clear_redis',
  RETRY = 'retry'
}

/**
 * Validation result for consistency checks
 */
export interface ConsistencyValidation {
  valid: boolean;
  conflicts: ConflictReport[];
  warnings: string[];
}

/**
 * Git commit information
 */
export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  timestamp: Date;
  files: string[];
}

/**
 * Sync statistics for monitoring
 */
export interface SyncStats {
  last_display_sync: Date | null;
  last_cold_sync: Date | null;
  display_sync_count: number;
  cold_sync_count: number;
  reconciliation_count: number;
  errors: number;
}

/**
 * State sync error
 */
export class StateSyncError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'StateSyncError';
  }
}
