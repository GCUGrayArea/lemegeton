/**
 * State Synchronization Coordinator
 *
 * Orchestrates bidirectional sync between Redis (hot state) and git (cold state)
 * with 30-second display sync cycle, event-driven cold commits, and crash recovery.
 */

import { EventEmitter } from 'events';
import { GitOps } from './gitOps';
import { RedisOps } from './redisOps';
import { Reconciliation } from './reconciliation';
import { DisplayUpdate, SyncStats, StateSyncError } from './types';
import { HotState, ColdState } from '../types/pr';
import { CommitMetadata } from '../core/stateMachine';

/**
 * State synchronization events
 */
export interface StateSyncEvents {
  'display-sync': (updates: DisplayUpdate[]) => void;
  'cold-sync': (prId: string, state: ColdState) => void;
  'hot-sync': (prId: string, state: HotState) => void;
  'reconciliation': (conflictCount: number) => void;
  'error': (error: StateSyncError) => void;
  'warning': (message: string) => void;
}

/**
 * State synchronization coordinator
 */
export class StateSync extends EventEmitter {
  private displaySyncTimer: NodeJS.Timeout | null = null;
  private displaySyncInterval: number = 30000; // 30 seconds
  private stats: SyncStats = {
    last_display_sync: null,
    last_cold_sync: null,
    display_sync_count: 0,
    cold_sync_count: 0,
    reconciliation_count: 0,
    errors: 0
  };
  private isRunning = false;

  constructor(
    private gitOps: GitOps,
    private redisOps: RedisOps,
    private reconciliation: Reconciliation
  ) {
    super();
  }

  /**
   * Initialize state sync system
   */
  async initialize(): Promise<void> {
    try {
      console.log('[StateSync] Initializing state synchronization...');

      // Hydrate Redis from git
      await this.hydrateRedisFromGit();

      // Perform crash recovery reconciliation
      await this.recoverFromCrash();

      // Start display sync cycle
      this.startDisplaySyncCycle();

      this.isRunning = true;
      console.log('[StateSync] State synchronization initialized');
    } catch (error) {
      const syncError = new StateSyncError(
        'Failed to initialize state sync',
        error as Error
      );
      this.emit('error', syncError);
      throw syncError;
    }
  }

  /**
   * Shutdown state sync system
   */
  async shutdown(): Promise<void> {
    console.log('[StateSync] Shutting down state synchronization...');

    this.isRunning = false;

    // Stop display sync cycle
    if (this.displaySyncTimer) {
      clearInterval(this.displaySyncTimer);
      this.displaySyncTimer = null;
    }

    // Perform final display sync
    try {
      await this.syncDisplayStates();
    } catch (error) {
      console.warn('[StateSync] Final display sync failed:', error);
    }

    console.log('[StateSync] State synchronization shut down');
  }

  /**
   * Hydrate Redis from git on startup
   */
  async hydrateRedisFromGit(): Promise<void> {
    try {
      console.log('[StateSync] Hydrating Redis from git...');

      const taskList = await this.gitOps.loadTaskList();
      await this.redisOps.hydrateFromTaskList(taskList);

      console.log(`[StateSync] Hydrated ${taskList.prs.length} PRs from git`);
    } catch (error) {
      throw new StateSyncError(
        'Failed to hydrate Redis from git',
        error as Error
      );
    }
  }

  /**
   * Recover from crash (clear orphaned states, reconcile conflicts)
   */
  async recoverFromCrash(): Promise<void> {
    try {
      console.log('[StateSync] Performing crash recovery...');

      await this.reconciliation.reconcileAfterCrash();

      console.log('[StateSync] Crash recovery complete');
    } catch (error) {
      throw new StateSyncError(
        'Failed to recover from crash',
        error as Error
      );
    }
  }

  /**
   * Sync cold state change to git (event-driven, immediate)
   */
  async syncColdState(
    prId: string,
    newState: ColdState,
    metadata: CommitMetadata
  ): Promise<void> {
    try {
      // 1. Commit to git (source of truth)
      await this.gitOps.commitColdStateChange(prId, newState, metadata);

      // 2. Update Redis cache
      try {
        await this.redisOps.updateColdStateCache(prId, newState);
      } catch (redisError) {
        // Non-critical - cache miss on next read
        this.emit('warning', `Redis cache update failed for ${prId}`);
      }

      // 3. Clear hot state if transitioning to cold
      if (metadata.from_state && this.isHotState(metadata.from_state)) {
        await this.redisOps.clearHotState(prId);
      }

      // Update stats
      this.stats.last_cold_sync = new Date();
      this.stats.cold_sync_count++;

      this.emit('cold-sync', prId, newState);
    } catch (error) {
      this.stats.errors++;
      const syncError = new StateSyncError(
        `Failed to sync cold state for ${prId}`,
        error as Error,
        { prId, newState, metadata }
      );
      this.emit('error', syncError);
      throw syncError;
    }
  }

  /**
   * Sync hot state change to Redis (event-driven, no git commit)
   */
  async syncHotState(
    prId: string,
    newState: HotState,
    agentId?: string
  ): Promise<void> {
    try {
      // Update Redis only (no git commit for hot states)
      await this.redisOps.updateHotState(prId, newState, agentId);

      this.emit('hot-sync', prId, newState);
    } catch (error) {
      this.stats.errors++;
      const syncError = new StateSyncError(
        `Failed to sync hot state for ${prId}`,
        error as Error,
        { prId, newState, agentId }
      );
      this.emit('error', syncError);
      throw syncError;
    }
  }

  /**
   * Sync display states to markdown (30-second cycle)
   */
  async syncDisplayStates(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      // Get all hot states from Redis
      const hotStates = await this.redisOps.getAllHotStates();

      // Convert to display updates
      const updates: DisplayUpdate[] = [];
      for (const [prId, info] of hotStates) {
        updates.push({
          pr_id: prId,
          hot_state: info.state,
          agent_id: info.agent_id,
          timestamp: info.timestamp
        });
      }

      // Commit display sync to git
      if (updates.length > 0) {
        await this.gitOps.commitDisplaySync(updates);

        // Update stats
        this.stats.last_display_sync = new Date();
        this.stats.display_sync_count++;

        this.emit('display-sync', updates);
      }
    } catch (error) {
      // Display sync failures are non-critical
      console.warn('[StateSync] Display sync failed:', error);
      this.emit('warning', 'Display sync cycle failed');
    }
  }

  /**
   * Clear orphaned states
   */
  async clearOrphanedStates(): Promise<void> {
    try {
      const gitStates = await this.gitOps.reconstructState();
      const validPRIds = new Set(gitStates.keys());

      await this.redisOps.clearOrphanedStates(validPRIds);
    } catch (error) {
      console.warn('[StateSync] Failed to clear orphaned states:', error);
    }
  }

  /**
   * Reconcile conflicts between Redis and git
   */
  async reconcileConflicts(): Promise<void> {
    try {
      console.log('[StateSync] Running conflict reconciliation...');

      await this.reconciliation.reconcileAll();

      // Update stats
      this.stats.reconciliation_count++;

      const conflicts = await this.reconciliation.detectConflicts();
      this.emit('reconciliation', conflicts.length);

      console.log('[StateSync] Reconciliation complete');
    } catch (error) {
      this.stats.errors++;
      const syncError = new StateSyncError(
        'Failed to reconcile conflicts',
        error as Error
      );
      this.emit('error', syncError);
      throw syncError;
    }
  }

  /**
   * Validate consistency between Redis and git
   */
  async validateConsistency(): Promise<boolean> {
    try {
      const validation = await this.reconciliation.validateConsistency();

      for (const warning of validation.warnings) {
        this.emit('warning', warning);
      }

      if (!validation.valid) {
        console.warn(`[StateSync] Consistency validation failed: ${validation.conflicts.length} conflicts`);
      }

      return validation.valid;
    } catch (error) {
      console.warn('[StateSync] Consistency validation error:', error);
      return false;
    }
  }

  /**
   * Get sync statistics
   */
  getStats(): SyncStats {
    return { ...this.stats };
  }

  /**
   * Start display sync cycle (30 seconds)
   */
  private startDisplaySyncCycle(): void {
    if (this.displaySyncTimer) {
      clearInterval(this.displaySyncTimer);
    }

    // Run initial sync
    this.syncDisplayStates().catch(error => {
      console.warn('[StateSync] Initial display sync failed:', error);
    });

    // Start periodic sync
    this.displaySyncTimer = setInterval(() => {
      this.syncDisplayStates().catch(error => {
        console.warn('[StateSync] Periodic display sync failed:', error);
      });
    }, this.displaySyncInterval);

    console.log(`[StateSync] Display sync cycle started (${this.displaySyncInterval}ms interval)`);
  }

  /**
   * Check if a state is a hot state
   */
  private isHotState(state: string): boolean {
    const hotStates: HotState[] = ['investigating', 'planning', 'in-progress', 'under-review'];
    return hotStates.includes(state as HotState);
  }

  /**
   * Set display sync interval (for testing)
   */
  setDisplaySyncInterval(intervalMs: number): void {
    this.displaySyncInterval = intervalMs;
    if (this.isRunning) {
      this.startDisplaySyncCycle();
    }
  }
}
