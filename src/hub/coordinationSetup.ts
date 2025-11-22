/**
 * Coordination Setup Manager
 *
 * Manages coordination mode and health checking.
 * Extracted from Hub to follow Single Responsibility Principle.
 */

import { EventEmitter } from 'events';
import { RedisClient } from '../redis/client';
import { RedisHealthChecker } from '../redis/health';
import { CoordinationModeManager, CoordinationMode } from '../core/coordinationMode';

export interface CoordinationEvents {
  'modeChanged': (from: CoordinationMode, to: CoordinationMode) => void;
}

/**
 * Manages coordination mode and health checking
 */
export class CoordinationSetup extends EventEmitter {
  private healthChecker: RedisHealthChecker | null = null;
  private coordinationMode: CoordinationModeManager | null = null;

  /**
   * Initialize coordination mode and health checking
   */
  async initialize(redisClient: RedisClient): Promise<void> {
    // Create health checker
    this.healthChecker = new RedisHealthChecker(redisClient);
    this.healthChecker.start();

    // Create coordination mode manager
    this.coordinationMode = new CoordinationModeManager(
      redisClient,
      this.healthChecker
    );

    // Start coordination mode manager
    await this.coordinationMode.start();

    // Listen for mode changes and re-emit
    this.coordinationMode.on('modeChanged', (from, to) => {
      console.log(`[CoordinationSetup] Coordination mode changed: ${from} → ${to}`);
      this.emit('modeChanged', from, to);
    });
  }

  /**
   * Stop coordination mode and health checking
   */
  async stop(): Promise<void> {
    // Stop coordination mode manager
    if (this.coordinationMode) {
      await this.coordinationMode.stop();
      this.coordinationMode = null;
    }

    // Stop health checker
    if (this.healthChecker) {
      this.healthChecker.stop();
      this.healthChecker = null;
    }
  }

  /**
   * Get current coordination mode
   */
  getMode(): CoordinationMode | null {
    return this.coordinationMode?.getMode() ?? null;
  }

  /**
   * Get health checker (for testing or advanced usage)
   */
  getHealthChecker(): RedisHealthChecker | null {
    return this.healthChecker;
  }

  /**
   * Get coordination mode manager (for testing or advanced usage)
   */
  getCoordinationModeManager(): CoordinationModeManager | null {
    return this.coordinationMode;
  }
}
