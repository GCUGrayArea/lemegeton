/**
 * Coordination Mode Manager
 *
 * Manages transitions between three coordination modes:
 * - DISTRIBUTED: Normal operation with shared Redis and pessimistic locking
 * - DEGRADED: Local Redis with branch-based work isolation
 * - ISOLATED: No Redis, file-based state persistence
 *
 * Automatically detects and switches modes based on Redis availability and health.
 */

import { EventEmitter } from 'events';
import { RedisClient, RedisConnectionState } from '../redis/client';
import { RedisHealthChecker, HealthStatus } from '../redis/health';
import { DegradedModeHandler } from './degradedMode';
import { IsolatedModeHandler } from './isolatedMode';

/**
 * Coordination modes
 */
export enum CoordinationMode {
  DISTRIBUTED = 'distributed',  // Normal: shared Redis, file leases
  DEGRADED = 'degraded',        // Fallback: local Redis + git branches
  ISOLATED = 'isolated',        // Emergency: pure local work
}

/**
 * Mode transition record
 */
export interface ModeTransition {
  from: CoordinationMode;
  to: CoordinationMode;
  timestamp: number;
  reason: string;
}

/**
 * Coordination state
 */
export interface CoordinationState {
  mode: CoordinationMode;
  lastTransition: ModeTransition | null;
  history: ModeTransition[];
}

/**
 * Configuration for coordination mode manager
 */
export interface CoordinationConfig {
  /** Mode detection interval (ms) */
  modeCheckInterval?: number;
  /** Minimum time between mode transitions (ms) */
  transitionCooldown?: number;
  /** Directory for isolated mode state */
  isolatedStateDir?: string;
  /** Whether to auto-reconcile branches in degraded mode */
  autoReconcile?: boolean;
  /** Health threshold for mode degradation */
  healthDegradationThreshold?: number;
}

/**
 * Default coordination configuration
 */
export const DEFAULT_COORDINATION_CONFIG: Required<CoordinationConfig> = {
  modeCheckInterval: 30000,      // 30 seconds
  transitionCooldown: 5000,      // 5 seconds
  isolatedStateDir: '.lemegeton/isolated',
  autoReconcile: true,
  healthDegradationThreshold: 3,  // 3 consecutive failures
};

/**
 * Coordination Mode Manager
 *
 * Events:
 * - 'modeChanged': (from: CoordinationMode, to: CoordinationMode) => void
 * - 'transitionStarted': (from: CoordinationMode, to: CoordinationMode) => void
 * - 'transitionComplete': (mode: CoordinationMode) => void
 * - 'transitionFailed': (error: Error) => void
 */
export class CoordinationModeManager extends EventEmitter {
  private currentMode: CoordinationMode = CoordinationMode.DISTRIBUTED;
  private redisClient: RedisClient | null = null;
  private healthChecker: RedisHealthChecker | null = null;
  private degradedHandler: DegradedModeHandler;
  private isolatedHandler: IsolatedModeHandler;
  private config: Required<CoordinationConfig>;
  private transitionHistory: ModeTransition[] = [];
  private lastTransitionTime: number = 0;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private consecutiveHealthFailures: number = 0;

  constructor(
    redisClient: RedisClient | null,
    healthChecker: RedisHealthChecker | null,
    config: CoordinationConfig = {}
  ) {
    super();
    this.redisClient = redisClient;
    this.healthChecker = healthChecker;
    this.config = { ...DEFAULT_COORDINATION_CONFIG, ...config };
    this.degradedHandler = new DegradedModeHandler(this.config);
    this.isolatedHandler = new IsolatedModeHandler(this.config);

    // Subscribe to health checker events if available
    if (this.healthChecker) {
      this.healthChecker.on('healthChanged', this.handleHealthChange.bind(this));
    }
  }

  /**
   * Start the coordination mode manager
   */
  async start(): Promise<void> {
    // Detect initial mode
    const initialMode = await this.detectMode();
    this.currentMode = initialMode;

    // Store initial state in Redis if available
    await this.saveState();

    // Start periodic health monitoring
    this.startHealthMonitoring();

    this.emit('modeChanged', null, initialMode);
  }

  /**
   * Stop the coordination mode manager
   */
  async stop(): Promise<void> {
    this.stopHealthMonitoring();
    await this.saveState();
  }

  /**
   * Detect the best available coordination mode
   */
  async detectMode(): Promise<CoordinationMode> {
    // Try shared Redis first
    if (await this.canReachSharedRedis()) {
      return CoordinationMode.DISTRIBUTED;
    }

    // Try local Redis with Docker
    if (await this.canUseLocalRedis()) {
      return CoordinationMode.DEGRADED;
    }

    // Fallback to isolated mode
    return CoordinationMode.ISOLATED;
  }

  /**
   * Check if shared Redis is available
   */
  private async canReachSharedRedis(): Promise<boolean> {
    if (!this.redisClient) {
      return false;
    }

    try {
      // Check if connected
      if (this.redisClient.getState() !== RedisConnectionState.CONNECTED) {
        return false;
      }

      // Check if healthy
      if (this.healthChecker) {
        const result = await this.healthChecker.check();
        return result.status === HealthStatus.HEALTHY;
      }

      // No health checker, just check connection
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if local Redis via Docker is available
   */
  private async canUseLocalRedis(): Promise<boolean> {
    if (!this.redisClient) {
      return false;
    }

    try {
      // Check if we have a connection (could be local Docker)
      const state = this.redisClient.getState();
      return state === RedisConnectionState.CONNECTED || state === RedisConnectionState.CONNECTING;
    } catch (error) {
      return false;
    }
  }

  /**
   * Switch to a new coordination mode
   */
  async switchMode(newMode: CoordinationMode, reason: string = 'Manual switch'): Promise<void> {
    if (newMode === this.currentMode) {
      return; // Already in target mode
    }

    // Check cooldown period
    const now = Date.now();
    if (now - this.lastTransitionTime < this.config.transitionCooldown) {
      this.emit('transitionFailed', new Error('Transition cooldown active'));
      return;
    }

    const from = this.currentMode;
    this.emit('transitionStarted', from, newMode);

    try {
      // Execute transition
      await this.transitionFromTo(from, newMode, reason);

      // Update state
      this.currentMode = newMode;
      this.lastTransitionTime = now;

      // Record transition
      const transition: ModeTransition = {
        from,
        to: newMode,
        timestamp: now,
        reason,
      };
      this.transitionHistory.push(transition);

      // Store state
      await this.saveState();

      // Notify
      this.emit('modeChanged', from, newMode);
      this.emit('transitionComplete', newMode);

      console.log(`[CoordinationMode] Switched from ${from} to ${newMode}: ${reason}`);
    } catch (error: any) {
      this.emit('transitionFailed', error);
      console.error(`[CoordinationMode] Failed to switch from ${from} to ${newMode}:`, error);
      throw error;
    }
  }

  /**
   * Execute a mode transition
   */
  private async transitionFromTo(
    from: CoordinationMode,
    to: CoordinationMode,
    reason: string
  ): Promise<void> {
    // DISTRIBUTED → DEGRADED
    if (from === CoordinationMode.DISTRIBUTED && to === CoordinationMode.DEGRADED) {
      await this.notifyAgents('SWITCH_TO_BRANCHES', to);
      // State already in Redis, just notify agents
      return;
    }

    // DEGRADED → DISTRIBUTED
    if (from === CoordinationMode.DEGRADED && to === CoordinationMode.DISTRIBUTED) {
      await this.notifyAgents('MERGE_TO_MAIN', to);
      // Optionally auto-reconcile branches
      if (this.config.autoReconcile) {
        await this.degradedHandler.reconcileBranches();
      }
      return;
    }

    // DEGRADED → ISOLATED
    if (from === CoordinationMode.DEGRADED && to === CoordinationMode.ISOLATED) {
      // Save current state to files before losing Redis
      const state = await this.loadStateFromRedis();
      if (state) {
        await this.isolatedHandler.saveState(state);
      }
      await this.notifyAgents('WORK_ISOLATED', to);
      return;
    }

    // ISOLATED → DEGRADED
    if (from === CoordinationMode.ISOLATED && to === CoordinationMode.DEGRADED) {
      // Restore state from files to Redis
      const state = await this.isolatedHandler.loadState();
      if (state) {
        await this.saveStateToRedis(state);
      }
      await this.notifyAgents('RESUME_COORDINATION', to);
      return;
    }

    // DISTRIBUTED → ISOLATED (rare)
    if (from === CoordinationMode.DISTRIBUTED && to === CoordinationMode.ISOLATED) {
      const state = await this.loadStateFromRedis();
      if (state) {
        await this.isolatedHandler.saveState(state);
      }
      await this.notifyAgents('WORK_ISOLATED', to);
      return;
    }

    // ISOLATED → DISTRIBUTED (rare)
    if (from === CoordinationMode.ISOLATED && to === CoordinationMode.DISTRIBUTED) {
      const state = await this.isolatedHandler.loadState();
      if (state) {
        await this.saveStateToRedis(state);
      }
      await this.notifyAgents('RESUME_COORDINATION', to);
      return;
    }
  }

  /**
   * Notify agents of mode change
   */
  private async notifyAgents(action: string, newMode: CoordinationMode): Promise<void> {
    const notification = {
      action,
      newMode,
      timestamp: Date.now(),
    };

    try {
      // Try Redis pub/sub first (works in DISTRIBUTED and DEGRADED)
      if (this.redisClient && this.currentMode !== CoordinationMode.ISOLATED) {
        await this.redisClient.publish(
          'coordination:mode_change',
          JSON.stringify(notification)
        );
        return;
      }

      // Fallback to file-based notifications in ISOLATED mode
      await this.isolatedHandler.writeNotification(notification);
    } catch (error) {
      console.warn('[CoordinationMode] Failed to notify agents:', error);
      // Non-fatal, agents will detect mode change via other means
    }
  }

  /**
   * Handle health checker events
   */
  private async handleHealthChange(status: HealthStatus): Promise<void> {
    if (status === HealthStatus.HEALTHY) {
      // Reset failure counter
      this.consecutiveHealthFailures = 0;

      // Try to upgrade mode if we were degraded
      if (this.currentMode === CoordinationMode.DEGRADED) {
        await this.switchMode(CoordinationMode.DISTRIBUTED, 'Redis health recovered');
      } else if (this.currentMode === CoordinationMode.ISOLATED) {
        // Check if we can at least get to degraded mode
        if (await this.canUseLocalRedis()) {
          await this.switchMode(CoordinationMode.DEGRADED, 'Local Redis available');
        }
      }
    } else if (status === HealthStatus.DEGRADED || status === HealthStatus.UNHEALTHY) {
      this.consecutiveHealthFailures++;

      // Degrade mode if threshold exceeded
      if (this.consecutiveHealthFailures >= this.config.healthDegradationThreshold) {
        if (this.currentMode === CoordinationMode.DISTRIBUTED) {
          // Try to use local Redis
          if (await this.canUseLocalRedis()) {
            await this.switchMode(CoordinationMode.DEGRADED, 'Redis health degraded');
          } else {
            await this.switchMode(CoordinationMode.ISOLATED, 'Redis unavailable');
          }
        } else if (this.currentMode === CoordinationMode.DEGRADED && status === HealthStatus.UNHEALTHY) {
          // Lost local Redis too
          await this.switchMode(CoordinationMode.ISOLATED, 'Local Redis unhealthy');
        }
      }
    }
  }

  /**
   * Start periodic health monitoring
   */
  private startHealthMonitoring(): void {
    if (this.healthCheckTimer) {
      return; // Already monitoring
    }

    this.healthCheckTimer = setInterval(async () => {
      // Periodic mode detection
      const detectedMode = await this.detectMode();
      if (detectedMode !== this.currentMode) {
        await this.switchMode(detectedMode, 'Periodic health check detected change');
      }
    }, this.config.modeCheckInterval);
  }

  /**
   * Stop periodic health monitoring
   */
  private stopHealthMonitoring(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Save current state to Redis or files
   */
  private async saveState(): Promise<void> {
    const state: CoordinationState = {
      mode: this.currentMode,
      lastTransition: this.transitionHistory[this.transitionHistory.length - 1] || null,
      history: this.transitionHistory,
    };

    try {
      if (this.redisClient && this.currentMode !== CoordinationMode.ISOLATED) {
        await this.saveStateToRedis(state);
      } else {
        await this.isolatedHandler.saveState(state);
      }
    } catch (error) {
      console.warn('[CoordinationMode] Failed to save state:', error);
    }
  }

  /**
   * Save state to Redis
   */
  private async saveStateToRedis(state: CoordinationState): Promise<void> {
    if (!this.redisClient) return;

    try {
      await this.redisClient.execute(async (client) => {
        // Store current mode
        await client.set('coordination:mode', state.mode);

        // Store transition history
        if (state.history.length > 0) {
          // Use sorted set for history (score = timestamp)
          const members = state.history.map((t: ModeTransition) => ({
            score: t.timestamp,
            value: JSON.stringify(t),
          }));

          // Clear old history
          await client.del(['coordination:history']);

          // Add new history
          for (const member of members) {
            await client.zAdd('coordination:history', [member]);
          }
        }
      });
    } catch (error) {
      console.warn('[CoordinationMode] Failed to save state to Redis:', error);
    }
  }

  /**
   * Load state from Redis
   */
  private async loadStateFromRedis(): Promise<CoordinationState | null> {
    if (!this.redisClient) return null;

    try {
      return await this.redisClient.execute(async (client) => {
        const mode = await client.get('coordination:mode');
        const historyData = await client.zRange('coordination:history', 0, -1);

        const history: ModeTransition[] = historyData
          .map((item: string) => {
            try {
              return JSON.parse(item);
            } catch {
              return null;
            }
          })
          .filter((t: any): t is ModeTransition => t !== null);

        return {
          mode: (mode as CoordinationMode) || CoordinationMode.DISTRIBUTED,
          lastTransition: history[history.length - 1] || null,
          history,
        };
      });
    } catch (error) {
      console.warn('[CoordinationMode] Failed to load state from Redis:', error);
      return null;
    }
  }

  /**
   * Get current coordination mode
   */
  getMode(): CoordinationMode {
    return this.currentMode;
  }

  /**
   * Get mode transition history
   */
  getModeHistory(): ModeTransition[] {
    return [...this.transitionHistory];
  }

  /**
   * Get degraded mode handler
   */
  getDegradedHandler(): DegradedModeHandler {
    return this.degradedHandler;
  }

  /**
   * Get isolated mode handler
   */
  getIsolatedHandler(): IsolatedModeHandler {
    return this.isolatedHandler;
  }
}
