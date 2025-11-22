/**
 * Connection Manager
 *
 * Manages Redis connection lifecycle including auto-spawn functionality.
 * Extracted from Hub to follow Single Responsibility Principle.
 */

import { RedisClient, RedisConnectionState } from '../redis/client';
import { RedisAutoSpawner } from '../redis/autoSpawn';
import { loadConfig } from '../config';

export interface ConnectionConfig {
  url: string;
  autoSpawn: boolean;
}

/**
 * Manages Redis connection with auto-spawn support
 */
export class ConnectionManager {
  private redisClient: RedisClient | null = null;
  private autoSpawner: RedisAutoSpawner | null = null;
  private config: ConnectionConfig;

  constructor(config: ConnectionConfig) {
    this.config = config;
  }

  /**
   * Initialize and connect to Redis
   */
  async connect(): Promise<RedisClient> {
    if (this.redisClient) {
      return this.redisClient;
    }

    const appConfig = loadConfig();

    // Create Redis client
    this.redisClient = new RedisClient(
      appConfig.redis?.url || this.config.url
    );

    // If autoSpawn is enabled, try to spawn Redis Docker container if needed
    if (this.config.autoSpawn) {
      this.autoSpawner = new RedisAutoSpawner(this.redisClient);

      try {
        console.log('[ConnectionManager] Attempting to connect to Redis (with auto-spawn if needed)...');
        await this.autoSpawner.connectWithFallback(this.redisClient);
        console.log('[ConnectionManager] Redis connection established');
      } catch (error) {
        console.error('[ConnectionManager] Failed to connect to Redis even with auto-spawn:', error);
        throw error;
      }
    } else {
      // Connect normally without auto-spawn
      if (this.redisClient.getState() !== RedisConnectionState.CONNECTED) {
        await this.redisClient.connect();
      }
    }

    return this.redisClient;
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    // Disconnect Redis
    if (this.redisClient) {
      await this.redisClient.disconnect();
      this.redisClient = null;
    }

    // Clean up auto-spawned Redis container
    if (this.autoSpawner) {
      await this.autoSpawner.cleanup();
      this.autoSpawner = null;
    }
  }

  /**
   * Get the Redis client (may be null if not connected)
   */
  getClient(): RedisClient | null {
    return this.redisClient;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.redisClient?.getState() === RedisConnectionState.CONNECTED;
  }
}
