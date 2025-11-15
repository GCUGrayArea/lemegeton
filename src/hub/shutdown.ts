/**
 * Shutdown Handler
 *
 * Manages graceful shutdown of the Hub, including:
 * - Stopping acceptance of new work
 * - Notifying agents of shutdown
 * - Waiting for agents to complete work
 * - Syncing final state to git
 * - Releasing all leases
 * - Cleaning up resources
 */

import type { Hub } from './index';

/**
 * Shutdown configuration
 */
export interface ShutdownConfig {
  timeout?: number;
  graceful?: boolean;
}

/**
 * Graceful shutdown handler
 */
export class ShutdownHandler {
  private config: Required<ShutdownConfig>;

  constructor(config: ShutdownConfig = {}) {
    this.config = {
      timeout: config.timeout || 30000,  // 30 seconds default
      graceful: config.graceful !== false, // true by default
    };
  }

  /**
   * Perform graceful shutdown
   */
  async gracefulShutdown(hub: Hub): Promise<void> {
    console.log('[Shutdown] Initiating graceful shutdown...');
    const startTime = Date.now();

    try {
      // Step 1: Stop accepting new work
      hub.stopAcceptingWork();
      console.log('[Shutdown] Stopped accepting new work');

      // Step 2: Notify all agents of shutdown
      await this.notifyAgents(hub);

      // Step 3: Wait for agents to finish current work
      if (this.config.graceful) {
        await this.waitForAgents(hub, this.config.timeout);
      }

      // Step 4: Sync final state to git
      await this.syncFinalState(hub);

      // Step 5: Release all leases
      await this.releaseAllLeases(hub);

      const elapsed = Date.now() - startTime;
      console.log(`[Shutdown] Graceful shutdown completed in ${elapsed}ms`);
    } catch (error) {
      console.error('[Shutdown] Error during graceful shutdown:', error);
      // Continue with shutdown even if there are errors
    }
  }

  /**
   * Notify agents of shutdown
   */
  private async notifyAgents(hub: Hub): Promise<void> {
    console.log('[Shutdown] Notifying agents of shutdown...');

    try {
      await hub.notifyAgentsOfShutdown();

      // Give agents a moment to receive the notification
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error('[Shutdown] Failed to notify agents:', error);
    }
  }

  /**
   * Wait for agents to complete work
   */
  private async waitForAgents(hub: Hub, timeout: number): Promise<void> {
    console.log(`[Shutdown] Waiting up to ${timeout}ms for agents to complete work...`);
    const startTime = Date.now();

    while (await hub.hasActiveAgents()) {
      const elapsed = Date.now() - startTime;

      if (elapsed >= timeout) {
        const agents = await hub.getActiveAgents();
        console.warn(`[Shutdown] Timeout reached with ${agents.length} agents still active`);

        // Log which agents are still active
        for (const agent of agents) {
          console.warn(`[Shutdown]   - Agent ${agent.id} (${agent.status})`);
        }

        break;
      }

      // Check every second
      await new Promise(resolve => setTimeout(resolve, 1000));

      const remaining = Math.ceil((timeout - elapsed) / 1000);
      if (remaining % 5 === 0) {
        const agents = await hub.getActiveAgents();
        console.log(`[Shutdown] Waiting for ${agents.length} agents... (${remaining}s remaining)`);
      }
    }

    const finalAgents = await hub.getActiveAgents();
    if (finalAgents.length === 0) {
      console.log('[Shutdown] All agents completed work');
    } else {
      console.log(`[Shutdown] Proceeding with ${finalAgents.length} agents still active`);
    }
  }

  /**
   * Sync final state to git
   */
  private async syncFinalState(hub: Hub): Promise<void> {
    console.log('[Shutdown] Syncing final state to git...');

    try {
      await hub.syncFinalState();
      console.log('[Shutdown] State synced successfully');
    } catch (error) {
      console.error('[Shutdown] Failed to sync state:', error);
      // Continue shutdown even if sync fails
    }
  }

  /**
   * Release all leases
   */
  private async releaseAllLeases(hub: Hub): Promise<void> {
    console.log('[Shutdown] Releasing all file leases...');

    try {
      await hub.releaseAllLeases();
      console.log('[Shutdown] All leases released');
    } catch (error) {
      console.error('[Shutdown] Failed to release leases:', error);
      // Continue shutdown even if lease release fails
    }
  }

  /**
   * Force shutdown (non-graceful)
   */
  async forceShutdown(hub: Hub): Promise<void> {
    console.log('[Shutdown] Forcing immediate shutdown...');

    // Skip all graceful steps and just clean up
    hub.stopAcceptingWork();

    // Try to release leases quickly
    try {
      await Promise.race([
        hub.releaseAllLeases(),
        new Promise(resolve => setTimeout(resolve, 5000)), // 5 second timeout
      ]);
    } catch {
      // Ignore errors during force shutdown
    }

    console.log('[Shutdown] Force shutdown complete');
  }

  /**
   * Get configuration
   */
  getConfig(): Required<ShutdownConfig> {
    return { ...this.config };
  }
}