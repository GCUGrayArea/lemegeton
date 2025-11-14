/**
 * Redis auto-spawn module
 *
 * This module handles automatic spawning of Redis in Docker when no
 * external Redis is configured or when the configured Redis is unavailable.
 * It includes intelligent fallback logic and cleanup on shutdown.
 */

import { EventEmitter } from 'events';
import * as docker from '../utils/docker';
import { getConfig, shouldAutoSpawnRedis } from '../config';
import { RedisClient } from './client';
import { RedisHealthChecker, HealthStatus } from './health';

/**
 * Auto-spawn status
 */
export enum AutoSpawnStatus {
  IDLE = 'idle',
  CHECKING = 'checking',
  SPAWNING = 'spawning',
  RUNNING = 'running',
  FAILED = 'failed',
  DISABLED = 'disabled',
}

/**
 * Auto-spawn result
 */
export interface AutoSpawnResult {
  success: boolean;
  status: AutoSpawnStatus;
  containerId?: string;
  containerName?: string;
  port?: number;
  error?: string;
  fallbackReason?: string;
}

/**
 * Auto-spawner events
 */
export interface AutoSpawnerEvents {
  'status-change': (status: AutoSpawnStatus) => void;
  'spawn-started': () => void;
  'spawn-success': (result: AutoSpawnResult) => void;
  'spawn-failed': (error: string) => void;
  'cleanup': (containerId: string) => void;
}

/**
 * Redis auto-spawner
 */
export class RedisAutoSpawner extends EventEmitter {
  private status: AutoSpawnStatus = AutoSpawnStatus.IDLE;
  private containerId: string | null = null;
  private containerName: string | null = null;
  private healthChecker: RedisHealthChecker | null = null;
  private cleanupRegistered = false;

  constructor(private readonly client?: RedisClient) {
    super();
  }

  /**
   * Gets the current status
   */
  public getStatus(): AutoSpawnStatus {
    return this.status;
  }

  /**
   * Gets the spawned container ID
   */
  public getContainerId(): string | null {
    return this.containerId;
  }

  /**
   * Updates the status and emits events
   */
  private setStatus(newStatus: AutoSpawnStatus): void {
    if (this.status === newStatus) return;
    this.status = newStatus;
    this.emit('status-change', newStatus);
  }

  /**
   * Checks if auto-spawn should be attempted
   */
  public shouldAttemptSpawn(): boolean {
    const config = getConfig();

    // Check if auto-spawn is enabled
    if (!shouldAutoSpawnRedis(config)) {
      return false;
    }

    // Don't spawn if already running or spawning
    if (this.status === AutoSpawnStatus.RUNNING || this.status === AutoSpawnStatus.SPAWNING) {
      return false;
    }

    return true;
  }

  /**
   * Attempts to auto-spawn Redis
   */
  public async spawn(): Promise<AutoSpawnResult> {
    // Check if we should attempt spawn
    if (!this.shouldAttemptSpawn()) {
      return {
        success: false,
        status: AutoSpawnStatus.DISABLED,
        error: 'Auto-spawn is disabled or not needed',
      };
    }

    this.setStatus(AutoSpawnStatus.CHECKING);
    this.emit('spawn-started');

    // First, check if Redis is already available
    if (this.client) {
      try {
        await this.client.connect();
        await this.client.ping();

        // Redis is already available
        this.setStatus(AutoSpawnStatus.IDLE);
        return {
          success: true,
          status: AutoSpawnStatus.IDLE,
        };
      } catch (error) {
        // Redis not available, continue with spawn
        console.log('Redis not available, attempting auto-spawn...');
      }
    }

    // Check Docker availability
    const dockerAvailability = await docker.checkDockerAvailability();
    if (!dockerAvailability.available) {
      this.setStatus(AutoSpawnStatus.FAILED);
      const error = `Docker not available: ${dockerAvailability.error}`;
      this.emit('spawn-failed', error);
      return {
        success: false,
        status: AutoSpawnStatus.FAILED,
        error,
        fallbackReason: 'Docker not available',
      };
    }

    this.setStatus(AutoSpawnStatus.SPAWNING);

    try {
      const config = getConfig();
      const redisPort = config.redis.port || 6379;

      // Check if port is available
      const portAvailable = await docker.isPortAvailable(redisPort);
      let targetPort = redisPort;

      if (!portAvailable) {
        // Try to find an alternative port
        const alternativePort = await docker.findAvailablePort(redisPort + 1);
        if (!alternativePort) {
          throw new Error(`Port ${redisPort} is already in use and no alternative found`);
        }
        targetPort = alternativePort;
        console.log(`Port ${redisPort} in use, using port ${targetPort} instead`);
      }

      // Generate container name
      const timestamp = Date.now();
      this.containerName = `${config.docker.containerPrefix}-${timestamp}`;

      // Check if Redis image exists locally, pull if needed
      const image = config.docker.redisImage!;
      if (!(await docker.imageExists(image))) {
        console.log(`Pulling Redis image: ${image}`);
        const pulled = await docker.pullImage(image);
        if (!pulled) {
          throw new Error(`Failed to pull Redis image: ${image}`);
        }
      }

      // Run Redis container
      const runResult = await docker.runContainer({
        image,
        name: this.containerName,
        ports: [{ host: targetPort, container: 6379 }],
        detached: true,
        remove: false, // We'll clean up manually
      });

      if (!runResult.success) {
        throw new Error(runResult.error || 'Failed to run Redis container');
      }

      this.containerId = runResult.containerId;
      console.log(`Redis container started: ${this.containerName} (${this.containerId})`);

      // Wait for Redis to be ready
      const isReady = await this.waitForRedis(targetPort);
      if (!isReady) {
        throw new Error('Redis container started but not responding');
      }

      // Register cleanup handler
      if (!this.cleanupRegistered) {
        this.registerCleanupHandler();
      }

      this.setStatus(AutoSpawnStatus.RUNNING);

      const result: AutoSpawnResult = {
        success: true,
        status: AutoSpawnStatus.RUNNING,
        containerId: this.containerId,
        containerName: this.containerName,
        port: targetPort,
      };

      this.emit('spawn-success', result);
      return result;

    } catch (error: any) {
      this.setStatus(AutoSpawnStatus.FAILED);
      const errorMessage = error.message || 'Unknown error during spawn';
      this.emit('spawn-failed', errorMessage);

      // Clean up if we created a container
      if (this.containerId) {
        await this.cleanup();
      }

      return {
        success: false,
        status: AutoSpawnStatus.FAILED,
        error: errorMessage,
      };
    }
  }

  /**
   * Waits for Redis to be ready
   */
  private async waitForRedis(port: number, timeout: number = 30000): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 1000;

    // Create a temporary client for checking
    const tempClient = new RedisClient(`redis://localhost:${port}`);

    while (Date.now() - startTime < timeout) {
      try {
        await tempClient.connect();
        const pong = await tempClient.ping();
        await tempClient.disconnect();

        if (pong === 'PONG') {
          return true;
        }
      } catch (error) {
        // Not ready yet
      }

      // Check if container is still running
      if (this.containerId) {
        const isRunning = await docker.isContainerRunning(this.containerId);
        if (!isRunning) {
          // Container stopped unexpectedly
          const logs = await docker.getContainerLogs(this.containerId, 50);
          console.error('Redis container stopped unexpectedly:');
          console.error(logs.stdout);
          console.error(logs.stderr);
          return false;
        }
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    return false;
  }

  /**
   * Registers cleanup handler for graceful shutdown
   */
  private registerCleanupHandler(): void {
    if (this.cleanupRegistered) return;

    const cleanupHandler = async () => {
      await this.cleanup();
      process.exit(0);
    };

    process.on('SIGINT', cleanupHandler);
    process.on('SIGTERM', cleanupHandler);
    process.on('exit', () => {
      // Synchronous cleanup attempt on exit
      if (this.containerId) {
        try {
          const { execSync } = require('child_process');
          execSync(`docker stop ${this.containerId}`, { stdio: 'ignore' });
          execSync(`docker rm ${this.containerId}`, { stdio: 'ignore' });
        } catch (error) {
          // Ignore errors during sync cleanup
        }
      }
    });

    this.cleanupRegistered = true;
  }

  /**
   * Cleans up the spawned container
   */
  public async cleanup(): Promise<void> {
    if (!this.containerId) return;

    const config = getConfig();
    if (!config.docker.cleanupOnExit) {
      console.log(`Leaving Redis container ${this.containerName} running (cleanup disabled)`);
      return;
    }

    console.log(`Cleaning up Redis container: ${this.containerName}`);
    this.emit('cleanup', this.containerId);

    try {
      // Stop the container
      await docker.stopContainer(this.containerId, 5);

      // Remove the container
      await docker.removeContainer(this.containerId);

      console.log(`Redis container cleaned up: ${this.containerName}`);
    } catch (error) {
      console.error(`Failed to cleanup Redis container: ${error}`);
    } finally {
      this.containerId = null;
      this.containerName = null;
      this.setStatus(AutoSpawnStatus.IDLE);
    }
  }

  /**
   * Attempts to connect with auto-spawn fallback
   */
  public async connectWithFallback(client: RedisClient): Promise<boolean> {
    try {
      // First try to connect normally
      await client.connect();
      return true;
    } catch (error) {
      console.log('Failed to connect to Redis, attempting auto-spawn...');

      // Try auto-spawn
      const spawnResult = await this.spawn();
      if (!spawnResult.success) {
        throw new Error(`Auto-spawn failed: ${spawnResult.error}`);
      }

      // Update client URL if we spawned on a different port
      if (spawnResult.port && spawnResult.port !== 6379) {
        // This would require updating the client's URL, which might need a reconnect
        // For now, we'll assume the client can handle the new port
        console.log(`Redis spawned on port ${spawnResult.port}`);
      }

      // Try to connect again
      await client.connect();
      return true;
    }
  }
}

/**
 * Singleton auto-spawner instance
 */
let defaultSpawner: RedisAutoSpawner | null = null;

/**
 * Gets or creates the default auto-spawner
 */
export function getDefaultAutoSpawner(client?: RedisClient): RedisAutoSpawner {
  if (!defaultSpawner) {
    defaultSpawner = new RedisAutoSpawner(client);
  }
  return defaultSpawner;
}

/**
 * Resets the default spawner (mainly for testing)
 */
export async function resetDefaultAutoSpawner(): Promise<void> {
  if (defaultSpawner) {
    await defaultSpawner.cleanup();
    defaultSpawner = null;
  }
}