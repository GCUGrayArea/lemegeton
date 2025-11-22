/**
 * Heartbeat Monitor
 *
 * Monitors agent heartbeats and detects crashed agents.
 * Extracted from Hub to follow Single Responsibility Principle.
 */

import { EventEmitter } from 'events';
import { AgentRegistry } from './agentRegistry';

export interface HeartbeatConfig {
  interval: number;
  timeout: number;
}

export interface HeartbeatEvents {
  'agentCrashed': (agentId: string) => void;
}

/**
 * Monitors agent heartbeats and detects crashes
 */
export class HeartbeatMonitor extends EventEmitter {
  private agentRegistry: AgentRegistry;
  private config: HeartbeatConfig;
  private timer: NodeJS.Timeout | null = null;

  constructor(agentRegistry: AgentRegistry, config: HeartbeatConfig) {
    super();
    this.agentRegistry = agentRegistry;
    this.config = config;
  }

  /**
   * Start heartbeat monitoring
   */
  start(): void {
    if (this.timer) {
      return; // Already started
    }

    this.timer = setInterval(async () => {
      try {
        // Check for crashed agents
        const crashed = await this.agentRegistry.checkForCrashedAgents();

        for (const agentId of crashed) {
          console.log(`[HeartbeatMonitor] Agent crashed: ${agentId}`);
          this.emit('agentCrashed', agentId);
        }
      } catch (error) {
        console.error('[HeartbeatMonitor] Monitoring error:', error);
        this.emit('error', error);
      }
    }, this.config.interval);
  }

  /**
   * Stop heartbeat monitoring
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Check if monitoring is active
   */
  isActive(): boolean {
    return this.timer !== null;
  }
}
