/**
 * Redis Operations for Hot State Management
 *
 * Handles hot state updates in Redis, cold state cache synchronization,
 * and state cleanup.
 */

import { RedisClient } from '../redis/client';
import { HotState, ColdState, PRState } from '../types/pr';
import { ParsedTaskList } from '../parser/types';
import { StateSyncError } from './types';

/**
 * Redis operations for state synchronization
 */
export class RedisOps {
  constructor(private redis: RedisClient) {}

  /**
   * Update hot state in Redis
   */
  async updateHotState(
    prId: string,
    state: HotState,
    agentId?: string
  ): Promise<void> {
    try {
      const client = this.redis.getClient();

      // Set hot state with TTL (5 minutes)
      await client.set(`pr:${prId}:hot_state`, state);
      await client.expire(`pr:${prId}:hot_state`, 300);

      // Update agent assignment if provided
      if (agentId) {
        await client.set(`pr:${prId}:agent`, agentId);
        await client.expire(`pr:${prId}:agent`, 300);
      }

      // Update timestamp
      await client.set(`pr:${prId}:hot_state_timestamp`, Date.now().toString());
      await client.expire(`pr:${prId}:hot_state_timestamp`, 300);

      console.log(`[RedisOps] Updated hot state: ${prId} → ${state}`);
    } catch (error) {
      throw new StateSyncError(
        `Failed to update hot state for ${prId}`,
        error as Error,
        { prId, state, agentId }
      );
    }
  }

  /**
   * Get hot state from Redis
   */
  async getHotState(prId: string): Promise<HotState | null> {
    try {
      const client = this.redis.getClient();
      const state = await client.get(`pr:${prId}:hot_state`);
      return state as HotState | null;
    } catch (error) {
      console.warn(`[RedisOps] Failed to get hot state for ${prId}:`, error);
      return null;
    }
  }

  /**
   * Get all hot states from Redis
   */
  async getAllHotStates(): Promise<Map<string, HotStateInfo>> {
    const states = new Map<string, HotStateInfo>();

    try {
      const client = this.redis.getClient();

      // Scan for all hot state keys
      const keys: string[] = [];
      for await (const key of client.scanIterator({
        MATCH: 'pr:*:hot_state',
        COUNT: 100
      })) {
        keys.push(key);
      }

      // Get state info for each PR
      for (const key of keys) {
        const prId = key.split(':')[1];
        const state = await client.get(key);
        const agent = await client.get(`pr:${prId}:agent`);
        const timestamp = await client.get(`pr:${prId}:hot_state_timestamp`);

        if (state) {
          states.set(prId, {
            state: state as HotState,
            agent_id: agent ?? undefined,
            timestamp: timestamp ? new Date(parseInt(timestamp)) : new Date()
          });
        }
      }
    } catch (error) {
      console.warn('[RedisOps] Failed to get all hot states:', error);
    }

    return states;
  }

  /**
   * Clear hot state from Redis
   */
  async clearHotState(prId: string): Promise<void> {
    try {
      const client = this.redis.getClient();

      await client.del(`pr:${prId}:hot_state`);
      await client.del(`pr:${prId}:agent`);
      await client.del(`pr:${prId}:hot_state_timestamp`);

      console.log(`[RedisOps] Cleared hot state for ${prId}`);
    } catch (error) {
      console.warn(`[RedisOps] Failed to clear hot state for ${prId}:`, error);
    }
  }

  /**
   * Update cold state cache in Redis
   */
  async updateColdStateCache(prId: string, state: ColdState): Promise<void> {
    try {
      const client = this.redis.getClient();

      // Set cold state (no TTL - reconstructible from git)
      await client.set(`pr:${prId}:cold_state`, state);

      console.log(`[RedisOps] Updated cold state cache: ${prId} → ${state}`);
    } catch (error) {
      // Non-critical - cache miss on next read
      console.warn(`[RedisOps] Failed to update cold state cache for ${prId}:`, error);
    }
  }

  /**
   * Get cold state from Redis cache
   */
  async getColdState(prId: string): Promise<ColdState | null> {
    try {
      const client = this.redis.getClient();
      const state = await client.get(`pr:${prId}:cold_state`);
      return state as ColdState | null;
    } catch (error) {
      console.warn(`[RedisOps] Failed to get cold state for ${prId}:`, error);
      return null;
    }
  }

  /**
   * Hydrate Redis from task list (on startup)
   */
  async hydrateFromTaskList(taskList: ParsedTaskList): Promise<void> {
    try {
      const client = this.redis.getClient();

      console.log(`[RedisOps] Hydrating Redis from task list (${taskList.prs.length} PRs)...`);

      for (const pr of taskList.prs) {
        // Set cold state
        await client.set(`pr:${pr.pr_id}:cold_state`, pr.cold_state);

        // Set dependencies
        if (pr.dependencies && pr.dependencies.length > 0) {
          await client.del(`pr:${pr.pr_id}:dependencies`);
          await client.sAdd(`pr:${pr.pr_id}:dependencies`, pr.dependencies);
        }
      }

      console.log('[RedisOps] Hydration complete');
    } catch (error) {
      throw new StateSyncError(
        'Failed to hydrate Redis from task list',
        error as Error
      );
    }
  }

  /**
   * Clear orphaned states (PRs that don't exist in git)
   */
  async clearOrphanedStates(validPRIds: Set<string>): Promise<void> {
    try {
      const client = this.redis.getClient();
      let cleared = 0;

      // Scan for all PR keys
      const keys: string[] = [];
      for await (const key of client.scanIterator({
        MATCH: 'pr:*',
        COUNT: 100
      })) {
        keys.push(key);
      }

      // Extract PR IDs from keys
      const foundPRIds = new Set<string>();
      for (const key of keys) {
        const parts = key.split(':');
        if (parts[0] === 'pr' && parts.length >= 2) {
          foundPRIds.add(parts[1]);
        }
      }

      // Clear keys for orphaned PRs
      for (const prId of foundPRIds) {
        if (!validPRIds.has(prId)) {
          await this.clearAllKeysForPR(prId);
          cleared++;
        }
      }

      if (cleared > 0) {
        console.log(`[RedisOps] Cleared ${cleared} orphaned PR states`);
      }
    } catch (error) {
      console.warn('[RedisOps] Failed to clear orphaned states:', error);
    }
  }

  /**
   * Clear expired heartbeats and associated hot states
   */
  async clearExpiredHeartbeats(): Promise<void> {
    try {
      const client = this.redis.getClient();
      const now = Date.now();
      const expirationThreshold = 5 * 60 * 1000; // 5 minutes
      let cleared = 0;

      // Scan for all heartbeat keys
      const keys: string[] = [];
      for await (const key of client.scanIterator({
        MATCH: 'agent:*:heartbeat',
        COUNT: 100
      })) {
        keys.push(key);
      }

      for (const key of keys) {
        const timestamp = await client.get(key);
        if (timestamp) {
          const heartbeatTime = parseInt(timestamp);
          if (now - heartbeatTime > expirationThreshold) {
            // Heartbeat expired - find associated PR
            const agentId = key.split(':')[1];
            const prId = await this.findPRForAgent(agentId);

            if (prId) {
              await this.clearHotState(prId);
              cleared++;
            }

            // Clear heartbeat key
            await client.del(key);
          }
        }
      }

      if (cleared > 0) {
        console.log(`[RedisOps] Cleared ${cleared} expired heartbeats`);
      }
    } catch (error) {
      console.warn('[RedisOps] Failed to clear expired heartbeats:', error);
    }
  }

  /**
   * Get current PR state (cold + hot)
   */
  async getCurrentState(prId: string): Promise<PRState | null> {
    try {
      const client = this.redis.getClient();

      const coldState = await client.get(`pr:${prId}:cold_state`);
      const hotState = await client.get(`pr:${prId}:hot_state`);
      const dependencies = await client.sMembers(`pr:${prId}:dependencies`);

      if (!coldState) {
        return null;
      }

      return {
        pr_id: prId,
        cold_state: coldState as ColdState,
        hot_state: hotState as HotState | undefined,
        dependencies: dependencies || [],
        files_locked: [], // Would need separate tracking
        last_transition: new Date().toISOString() // Would need separate tracking
      };
    } catch (error) {
      console.warn(`[RedisOps] Failed to get current state for ${prId}:`, error);
      return null;
    }
  }

  /**
   * Find PR being worked on by an agent
   */
  private async findPRForAgent(agentId: string): Promise<string | null> {
    try {
      const client = this.redis.getClient();

      // Scan for PR agent assignments
      for await (const key of client.scanIterator({
        MATCH: 'pr:*:agent',
        COUNT: 100
      })) {
        const assignedAgent = await client.get(key);
        if (assignedAgent === agentId) {
          return key.split(':')[1];
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Clear all keys for a PR
   */
  private async clearAllKeysForPR(prId: string): Promise<void> {
    const client = this.redis.getClient();

    await client.del(`pr:${prId}:cold_state`);
    await client.del(`pr:${prId}:hot_state`);
    await client.del(`pr:${prId}:agent`);
    await client.del(`pr:${prId}:hot_state_timestamp`);
    await client.del(`pr:${prId}:dependencies`);
  }
}

/**
 * Hot state information
 */
export interface HotStateInfo {
  state: HotState;
  agent_id?: string;
  timestamp: Date;
}
