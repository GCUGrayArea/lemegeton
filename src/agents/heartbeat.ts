/**
 * Agent Heartbeat System
 */

import { AgentState, AgentHeartbeat, HeartbeatAck } from './types';
import { EventEmitter } from 'events';

export interface HeartbeatConfig {
  interval: number;        // Heartbeat interval in ms (default: 30000)
  timeout: number;         // Timeout after missed heartbeats in ms (default: 90000)
  includeMetrics: boolean; // Include memory/CPU metrics
  includeProgress: boolean; // Include work progress
}

const DEFAULT_CONFIG: HeartbeatConfig = {
  interval: 30000,  // 30 seconds
  timeout: 90000,   // 90 seconds (3 missed heartbeats)
  includeMetrics: true,
  includeProgress: true,
};

export class HeartbeatManager extends EventEmitter {
  private config: HeartbeatConfig;
  private interval: NodeJS.Timeout | null = null;
  private lastSent: number = 0;
  private lastAck: number = 0;
  private missedAcks: number = 0;
  private running: boolean = false;

  constructor(
    private agentId: string,
    private getState: () => AgentState,
    private getPrId: () => string | null,
    private sendMessage: (message: AgentHeartbeat) => Promise<void>,
    config: Partial<HeartbeatConfig> = {}
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start sending heartbeats
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    this.lastAck = Date.now();

    // Send initial heartbeat
    await this.send();

    // Start interval
    this.interval = setInterval(async () => {
      await this.send();
    }, this.config.interval);
  }

  /**
   * Stop sending heartbeats
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Send a heartbeat
   */
  async send(): Promise<void> {
    if (!this.running) {
      return;
    }

    const heartbeat: AgentHeartbeat = {
      type: 'heartbeat',
      agentId: this.agentId,
      state: this.getState(),
      prId: this.getPrId(),
      memoryUsage: this.config.includeMetrics ? this.getMemoryUsage() : 0,
      timestamp: Date.now(),
    };

    try {
      await this.sendMessage(heartbeat);
      this.lastSent = Date.now();
      this.emit('sent', heartbeat);
    } catch (error) {
      this.emit('error', error);
      this.missedAcks++;

      // Check for timeout
      const timeSinceLastAck = Date.now() - this.lastAck;
      if (timeSinceLastAck > this.config.timeout) {
        this.emit('timeout', { missedAcks: this.missedAcks, lastAck: this.lastAck });
      }
    }
  }

  /**
   * Handle heartbeat acknowledgment
   */
  async handleAck(ack: HeartbeatAck): Promise<void> {
    this.lastAck = ack.timestamp;
    this.missedAcks = 0;
    this.emit('ack', ack);
  }

  /**
   * Check if heartbeat is alive
   */
  isAlive(): boolean {
    const timeSinceLastAck = Date.now() - this.lastAck;
    return timeSinceLastAck < this.config.timeout;
  }

  /**
   * Get memory usage in MB
   */
  private getMemoryUsage(): number {
    const usage = process.memoryUsage();
    return Math.round(usage.heapUsed / 1024 / 1024);
  }

  /**
   * Get heartbeat statistics
   */
  getStats(): {
    lastSent: number;
    lastAck: number;
    missedAcks: number;
    isAlive: boolean;
    timeSinceLastAck: number;
  } {
    return {
      lastSent: this.lastSent,
      lastAck: this.lastAck,
      missedAcks: this.missedAcks,
      isAlive: this.isAlive(),
      timeSinceLastAck: Date.now() - this.lastAck,
    };
  }
}
