/**
 * Reconciliation Logic for State Conflicts
 *
 * Detects and resolves conflicts between Redis and git, with git as
 * the source of truth.
 */

import { GitOps } from './gitOps';
import { RedisOps } from './redisOps';
import {
  ConflictReport,
  ConflictType,
  ConflictResolution,
  ConsistencyValidation,
  StateSyncError
} from './types';
import { ColdState, HotState } from '../types/pr';
import { isColdState, isHotState } from '../core/states';

/**
 * Reconciliation for state conflicts
 */
export class Reconciliation {
  constructor(
    private gitOps: GitOps,
    private redisOps: RedisOps
  ) {}

  /**
   * Detect all conflicts between Redis and git
   */
  async detectConflicts(): Promise<ConflictReport[]> {
    const conflicts: ConflictReport[] = [];

    try {
      // Load git state (source of truth)
      const gitStates = await this.gitOps.reconstructState();

      // Load Redis states
      const redisHotStates = await this.redisOps.getAllHotStates();

      // Check for conflicts
      for (const [prId, gitState] of gitStates) {
        const redisHotState = redisHotStates.get(prId);
        const redisColdState = await this.redisOps.getColdState(prId);

        // Conflict 1: Redis has hot state but git shows completed/approved
        if (redisHotState) {
          const terminalStates: ColdState[] = ['completed', 'approved'];
          if (terminalStates.includes(gitState.cold_state)) {
            conflicts.push({
              pr_id: prId,
              conflict_type: ConflictType.REDIS_HOT_GIT_DIFFERENT,
              redis_state: redisHotState.state,
              git_state: gitState.cold_state,
              resolution: ConflictResolution.CLEAR_REDIS,
              timestamp: new Date()
            });
          }
        }

        // Conflict 2: Redis cold state doesn't match git
        if (redisColdState && redisColdState !== gitState.cold_state) {
          conflicts.push({
            pr_id: prId,
            conflict_type: ConflictType.REDIS_HOT_GIT_DIFFERENT,
            redis_state: redisColdState,
            git_state: gitState.cold_state,
            resolution: ConflictResolution.TRUST_GIT,
            timestamp: new Date()
          });
        }

        // Conflict 3: Redis missing cold state
        if (!redisColdState) {
          conflicts.push({
            pr_id: prId,
            conflict_type: ConflictType.REDIS_MISSING,
            redis_state: null,
            git_state: gitState.cold_state,
            resolution: ConflictResolution.HYDRATE_REDIS,
            timestamp: new Date()
          });
        }
      }

      // Conflict 4: Orphaned Redis states (PR doesn't exist in git)
      const gitPRIds = new Set(gitStates.keys());
      const orphaned = await this.detectOrphanedStates(gitPRIds);

      for (const prId of orphaned) {
        const redisHotState = redisHotStates.get(prId);
        conflicts.push({
          pr_id: prId,
          conflict_type: ConflictType.REDIS_ORPHANED,
          redis_state: redisHotState?.state ?? null,
          git_state: null,
          resolution: ConflictResolution.CLEAR_REDIS,
          timestamp: new Date()
        });
      }
    } catch (error) {
      throw new StateSyncError(
        'Failed to detect conflicts',
        error as Error
      );
    }

    return conflicts;
  }

  /**
   * Detect orphaned states in Redis
   */
  async detectOrphanedStates(validPRIds: Set<string>): Promise<string[]> {
    const orphaned: string[] = [];

    try {
      const redisHotStates = await this.redisOps.getAllHotStates();

      for (const prId of redisHotStates.keys()) {
        if (!validPRIds.has(prId)) {
          orphaned.push(prId);
        }
      }
    } catch (error) {
      console.warn('[Reconciliation] Failed to detect orphaned states:', error);
    }

    return orphaned;
  }

  /**
   * Resolve a specific conflict
   */
  async resolveConflict(conflict: ConflictReport): Promise<void> {
    try {
      console.log(`[Reconciliation] Resolving conflict for ${conflict.pr_id}: ${conflict.conflict_type}`);

      switch (conflict.resolution) {
        case ConflictResolution.TRUST_GIT:
          // Update Redis to match git
          if (conflict.git_state) {
            await this.redisOps.updateColdStateCache(conflict.pr_id, conflict.git_state);
            await this.redisOps.clearHotState(conflict.pr_id);
          }
          break;

        case ConflictResolution.CLEAR_REDIS:
          // Clear Redis state
          await this.redisOps.clearHotState(conflict.pr_id);
          break;

        case ConflictResolution.HYDRATE_REDIS:
          // Hydrate Redis from git
          if (conflict.git_state) {
            await this.redisOps.updateColdStateCache(conflict.pr_id, conflict.git_state);
          }
          break;

        case ConflictResolution.RETRY:
          // Mark for retry (handled by caller)
          console.warn(`[Reconciliation] Retry needed for ${conflict.pr_id}`);
          break;
      }

      console.log(`[Reconciliation] Resolved conflict for ${conflict.pr_id}`);
    } catch (error) {
      throw new StateSyncError(
        `Failed to resolve conflict for ${conflict.pr_id}`,
        error as Error,
        { conflict }
      );
    }
  }

  /**
   * Reconcile all conflicts
   */
  async reconcileAll(): Promise<void> {
    const conflicts = await this.detectConflicts();

    if (conflicts.length === 0) {
      console.log('[Reconciliation] No conflicts detected');
      return;
    }

    console.log(`[Reconciliation] Resolving ${conflicts.length} conflicts...`);

    for (const conflict of conflicts) {
      try {
        await this.resolveConflict(conflict);
      } catch (error) {
        console.error(`[Reconciliation] Failed to resolve conflict for ${conflict.pr_id}:`, error);
      }
    }

    console.log('[Reconciliation] Reconciliation complete');
  }

  /**
   * Reconcile after crash (clear all hot states)
   */
  async reconcileAfterCrash(): Promise<void> {
    console.log('[Reconciliation] Performing crash recovery reconciliation...');

    try {
      // Load git state
      const gitStates = await this.gitOps.reconstructState();
      const validPRIds = new Set(gitStates.keys());

      // Clear all hot states (they're ephemeral, lost on crash)
      const redisHotStates = await this.redisOps.getAllHotStates();
      for (const prId of redisHotStates.keys()) {
        await this.redisOps.clearHotState(prId);
      }

      // Clear orphaned states
      await this.redisOps.clearOrphanedStates(validPRIds);

      // Ensure all PRs have cold state cached
      for (const [prId, state] of gitStates) {
        await this.redisOps.updateColdStateCache(prId, state.cold_state);
      }

      console.log('[Reconciliation] Crash recovery complete');
    } catch (error) {
      throw new StateSyncError(
        'Failed to reconcile after crash',
        error as Error
      );
    }
  }

  /**
   * Validate consistency between Redis and git
   */
  async validateConsistency(): Promise<ConsistencyValidation> {
    const warnings: string[] = [];
    const conflicts = await this.detectConflicts();

    // Check for serious inconsistencies
    const criticalConflicts = conflicts.filter(c =>
      c.conflict_type === ConflictType.CONCURRENT_UPDATE ||
      c.conflict_type === ConflictType.REDIS_HOT_GIT_DIFFERENT
    );

    // Check for warnings
    const gitStates = await this.gitOps.reconstructState();
    const redisHotStates = await this.redisOps.getAllHotStates();

    // Warn if too many hot states
    if (redisHotStates.size > gitStates.size * 0.5) {
      warnings.push(`High number of hot states: ${redisHotStates.size} / ${gitStates.size} PRs`);
    }

    // Warn if orphaned states exist
    const orphaned = conflicts.filter(c => c.conflict_type === ConflictType.REDIS_ORPHANED);
    if (orphaned.length > 0) {
      warnings.push(`Found ${orphaned.length} orphaned Redis states`);
    }

    return {
      valid: criticalConflicts.length === 0,
      conflicts: conflicts,
      warnings: warnings
    };
  }

  /**
   * Clear expired heartbeats and resolve associated conflicts
   */
  async clearExpiredHeartbeats(): Promise<void> {
    try {
      await this.redisOps.clearExpiredHeartbeats();

      // After clearing expired heartbeats, check for conflicts
      const conflicts = await this.detectConflicts();
      const heartbeatConflicts = conflicts.filter(c =>
        c.conflict_type === ConflictType.HEARTBEAT_EXPIRED
      );

      for (const conflict of heartbeatConflicts) {
        await this.resolveConflict(conflict);
      }
    } catch (error) {
      console.warn('[Reconciliation] Failed to clear expired heartbeats:', error);
    }
  }
}
