/**
 * Redis health checking module
 *
 * This module implements health checks for Redis connectivity,
 * monitors latency, and provides automatic recovery mechanisms.
 */

import { EventEmitter } from 'events';
import { RedisClient, RedisConnectionState } from './client';

/**
 * Health check status
 */
export enum HealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
  CHECKING = 'checking',
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  status: HealthStatus;
  latency?: number;
  error?: Error;
  timestamp: number;
  consecutiveFailures: number;
}

/**
 * Health checker configuration
 */
export interface HealthCheckerConfig {
  /** Interval between health checks in ms (default: 5000) */
  interval?: number;

  /** Timeout for health check in ms (default: 2000) */
  timeout?: number;

  /** Number of consecutive failures before marking unhealthy (default: 3) */
  failureThreshold?: number;

  /** Latency threshold in ms for degraded status (default: 100) */
  degradedLatencyThreshold?: number;

  /** Enable automatic reconnection on failure (default: true) */
  autoReconnect?: boolean;

  /** Delay before reconnection attempt in ms (default: 1000) */
  reconnectDelay?: number;
}

/**
 * Health checker events
 */
export interface HealthCheckerEvents {
  'health-change': (result: HealthCheckResult) => void;
  'healthy': () => void;
  'degraded': (latency: number) => void;
  'unhealthy': (error: Error) => void;
  'recovering': () => void;
}

/**
 * Redis health checker
 */
export class RedisHealthChecker extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private status: HealthStatus = HealthStatus.CHECKING;
  private consecutiveFailures = 0;
  private isRunning = false;
  private lastCheck: HealthCheckResult | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  private readonly config: Required<HealthCheckerConfig>;

  constructor(
    private readonly client: RedisClient,
    config: HealthCheckerConfig = {}
  ) {
    super();

    this.config = {
      interval: config.interval ?? 5000,
      timeout: config.timeout ?? 2000,
      failureThreshold: config.failureThreshold ?? 3,
      degradedLatencyThreshold: config.degradedLatencyThreshold ?? 100,
      autoReconnect: config.autoReconnect ?? true,
      reconnectDelay: config.reconnectDelay ?? 1000,
    };

    // Listen to client state changes
    this.setupClientListeners();
  }

  /**
   * Sets up listeners for client state changes
   */
  private setupClientListeners(): void {
    this.client.on('state-change', (state: RedisConnectionState) => {
      if (state === RedisConnectionState.CONNECTED) {
        // Reset failure count on successful connection
        this.consecutiveFailures = 0;

        // Perform immediate health check
        if (this.isRunning) {
          this.performHealthCheck().catch((err) => {
            this.handleHealthCheckError(err);
          });
        }
      } else if (state === RedisConnectionState.ERROR || state === RedisConnectionState.DISCONNECTED) {
        // Update health status when client disconnects
        if (this.isRunning) {
          const result: HealthCheckResult = {
            status: HealthStatus.UNHEALTHY,
            error: new Error(`Redis ${state}`),
            timestamp: Date.now(),
            consecutiveFailures: ++this.consecutiveFailures,
          };
          this.updateHealthStatus(result);
        }
      }
    });
  }

  /**
   * Gets the current health status
   */
  public getStatus(): HealthStatus {
    return this.status;
  }

  /**
   * Gets the last health check result
   */
  public getLastCheck(): HealthCheckResult | null {
    return this.lastCheck;
  }

  /**
   * Checks if Redis is healthy
   */
  public isHealthy(): boolean {
    return this.status === HealthStatus.HEALTHY;
  }

  /**
   * Starts health checking
   */
  public start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.consecutiveFailures = 0;

    // Perform initial check
    this.performHealthCheck().catch((err) => {
      this.handleHealthCheckError(err);
    });

    // Schedule regular checks
    this.timer = setInterval(() => {
      if (this.isRunning) {
        this.performHealthCheck().catch((err) => {
          this.handleHealthCheckError(err);
        });
      }
    }, this.config.interval);
  }

  /**
   * Stops health checking
   */
  public stop(): void {
    this.isRunning = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Performs a single health check
   */
  public async performHealthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      // Check if client is connected first
      if (!this.client.isConnected()) {
        throw new Error('Redis client not connected');
      }

      // Perform ping with timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Health check timeout')), this.config.timeout);
      });

      const pingPromise = this.client.ping();
      const pong = await Promise.race([pingPromise, timeoutPromise]);

      if (pong !== 'PONG') {
        throw new Error(`Unexpected ping response: ${pong}`);
      }

      // Calculate latency
      const latency = Date.now() - startTime;

      // Determine status based on latency
      let status: HealthStatus;
      if (latency > this.config.degradedLatencyThreshold) {
        status = HealthStatus.DEGRADED;
      } else {
        status = HealthStatus.HEALTHY;
      }

      // Reset consecutive failures on success
      this.consecutiveFailures = 0;

      const result: HealthCheckResult = {
        status,
        latency,
        timestamp: Date.now(),
        consecutiveFailures: 0,
      };

      this.updateHealthStatus(result);
      return result;

    } catch (error) {
      // Increment failure count
      this.consecutiveFailures++;

      const result: HealthCheckResult = {
        status: HealthStatus.UNHEALTHY,
        error: error as Error,
        timestamp: Date.now(),
        consecutiveFailures: this.consecutiveFailures,
      };

      this.updateHealthStatus(result);

      // Trigger reconnection if needed
      if (this.config.autoReconnect && this.consecutiveFailures >= this.config.failureThreshold) {
        this.triggerReconnection();
      }

      return result;
    }
  }

  /**
   * Updates the health status and emits events
   */
  private updateHealthStatus(result: HealthCheckResult): void {
    const previousStatus = this.status;
    this.status = result.status;
    this.lastCheck = result;

    // Emit health change event
    this.emit('health-change', result);

    // Emit specific status events if status changed
    if (previousStatus !== result.status) {
      switch (result.status) {
        case HealthStatus.HEALTHY:
          this.emit('healthy');
          break;
        case HealthStatus.DEGRADED:
          if (result.latency !== undefined) {
            this.emit('degraded', result.latency);
          }
          break;
        case HealthStatus.UNHEALTHY:
          if (result.error) {
            this.emit('unhealthy', result.error);
          }
          break;
      }
    }
  }

  /**
   * Handles health check errors
   */
  private handleHealthCheckError(error: Error): void {
    console.error('Health check error:', error);
  }

  /**
   * Triggers automatic reconnection
   */
  private triggerReconnection(): void {
    // Clear any existing reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    // Don't reconnect if not running or already connected
    if (!this.isRunning || this.client.isConnected()) {
      return;
    }

    this.emit('recovering');

    // Schedule reconnection with delay
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.client.reconnect();
        // Connection successful, health check will be triggered by state change listener
      } catch (error) {
        // Reconnection failed, will be retried on next health check
        console.error('Reconnection failed:', error);
      }
    }, this.config.reconnectDelay);
  }

  /**
   * Performs a manual health check
   */
  public async check(): Promise<HealthCheckResult> {
    return this.performHealthCheck();
  }
}

/**
 * Creates a health checker with default configuration
 */
export function createHealthChecker(
  client: RedisClient,
  config?: HealthCheckerConfig
): RedisHealthChecker {
  return new RedisHealthChecker(client, config);
}