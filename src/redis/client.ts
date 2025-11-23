/**
 * Redis client wrapper for Lemegeton
 *
 * This module provides a wrapped Redis client with connection lifecycle
 * management, pub/sub capabilities, and automatic retry logic.
 */

import { createClient, RedisClientType, RedisFunctions, RedisModules, RedisScripts } from 'redis';
import { EventEmitter } from 'events';
import { getConfig, getRedisUrl } from '../config';

/**
 * Required retry configuration (all optionals resolved)
 */
interface RequiredRetryConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  factor: number;
}
import { RedisError, ErrorCode } from '../types';

/**
 * Type alias for the Redis client
 */
export type LemegetonRedisClient = RedisClientType<RedisModules, RedisFunctions, RedisScripts>;

/**
 * Redis connection states
 */
export enum RedisConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error',
  CLOSING = 'closing',
  CLOSED = 'closed',
}

/**
 * Redis client events
 */
export interface RedisClientEvents {
  'state-change': (state: RedisConnectionState) => void;
  'connected': () => void;
  'disconnected': () => void;
  'error': (error: Error) => void;
  'reconnecting': (attempt: number) => void;
  'ready': () => void;
}

/**
 * Enhanced Redis client with lifecycle management
 */
export class RedisClient extends EventEmitter {
  private client: LemegetonRedisClient | null = null;
  private pubClient: LemegetonRedisClient | null = null;
  private subClient: LemegetonRedisClient | null = null;
  private state: RedisConnectionState = RedisConnectionState.DISCONNECTED;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isClosing = false;
  private connectionPromise: Promise<void> | null = null;

  private readonly url: string;
  private readonly retryConfig: RequiredRetryConfig;

  constructor(url?: string) {
    super();
    this.url = url || getRedisUrl();

    // Resolve all retry config optionals at construction
    const config = getConfig();
    this.retryConfig = {
      maxAttempts: config.redis.retry?.maxAttempts ?? 10,
      initialDelay: config.redis.retry?.initialDelay ?? 1000,
      maxDelay: config.redis.retry?.maxDelay ?? 30000,
      factor: config.redis.retry?.factor ?? 2,
    };
  }

  /**
   * Gets the current connection state
   */
  public getState(): RedisConnectionState {
    return this.state;
  }

  /**
   * Checks if the client is connected
   */
  public isConnected(): boolean {
    return this.state === RedisConnectionState.CONNECTED;
  }

  /**
   * Gets the main Redis client
   */
  public getClient(): LemegetonRedisClient {
    if (!this.client || !this.isConnected()) {
      throw RedisError.connectionFailed(this.url, {
        state: this.state,
        operation: 'getClient',
      });
    }
    return this.client;
  }

  /**
   * Gets the pub client for publishing messages
   */
  public getPubClient(): LemegetonRedisClient {
    if (!this.pubClient || !this.isConnected()) {
      throw RedisError.connectionFailed(this.url, {
        state: this.state,
        operation: 'getPubClient',
      });
    }
    return this.pubClient;
  }

  /**
   * Gets the sub client for subscribing to channels
   */
  public getSubClient(): LemegetonRedisClient {
    if (!this.subClient || !this.isConnected()) {
      throw RedisError.connectionFailed(this.url, {
        state: this.state,
        operation: 'getSubClient',
      });
    }
    return this.subClient;
  }

  /**
   * Updates the connection state and emits events
   */
  private setState(newState: RedisConnectionState): void {
    if (this.state === newState) return;

    const oldState = this.state;
    this.state = newState;
    this.emit('state-change', newState);

    // Emit specific events
    if (newState === RedisConnectionState.CONNECTED) {
      this.emit('connected');
      this.emit('ready');
    } else if (newState === RedisConnectionState.DISCONNECTED) {
      this.emit('disconnected');
    }
  }

  /**
   * Creates a Redis client with retry configuration
   */
  private createRedisClient(): LemegetonRedisClient {
    const config = getConfig();

    const client = createClient({
      url: this.url,
      socket: {
        connectTimeout: config.redis.connectTimeout,
        reconnectStrategy: (retries: number) => {
          // Don't reconnect if we're closing
          if (this.isClosing) {
            return false;
          }

          // Check max attempts - now using fully-resolved config
          if (retries >= this.retryConfig.maxAttempts) {
            this.setState(RedisConnectionState.ERROR);
            this.emit('error', new Error(`Failed to connect after ${retries} attempts`));
            return false;
          }

          // Calculate delay with exponential backoff - no more non-null assertions
          const delay = Math.min(
            this.retryConfig.initialDelay * Math.pow(this.retryConfig.factor, retries),
            this.retryConfig.maxDelay
          );

          this.reconnectAttempt = retries + 1;
          this.setState(RedisConnectionState.RECONNECTING);
          this.emit('reconnecting', this.reconnectAttempt);

          return delay;
        },
      },
    });

    // Set up event handlers
    client.on('error', (err) => {
      if (!this.isClosing) {
        this.emit('error', err);
        if (this.state !== RedisConnectionState.RECONNECTING) {
          this.setState(RedisConnectionState.ERROR);
        }
      }
    });

    client.on('connect', () => {
      if (!this.isClosing) {
        this.reconnectAttempt = 0;
        this.setState(RedisConnectionState.CONNECTING);
      }
    });

    client.on('ready', () => {
      if (!this.isClosing) {
        this.reconnectAttempt = 0;
        this.setState(RedisConnectionState.CONNECTED);
      }
    });

    client.on('end', () => {
      if (!this.isClosing) {
        this.setState(RedisConnectionState.DISCONNECTED);
      }
    });

    return client;
  }

  /**
   * Connects to Redis
   */
  public async connect(): Promise<void> {
    if (this.isConnected()) {
      return;
    }

    // Return existing connection attempt to avoid race conditions
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    // Create new connection promise
    this.connectionPromise = this.performConnect()
      .finally(() => {
        this.connectionPromise = null;
      });

    return this.connectionPromise;
  }

  /**
   * Performs the actual connection
   */
  private async performConnect(): Promise<void> {
    this.isClosing = false;
    this.setState(RedisConnectionState.CONNECTING);

    try {
      // Create and connect main client
      this.client = this.createRedisClient();
      await this.client.connect();

      // Create and connect pub/sub clients
      this.pubClient = this.client.duplicate();
      await this.pubClient.connect();

      this.subClient = this.client.duplicate();
      await this.subClient.connect();

      this.setState(RedisConnectionState.CONNECTED);
    } catch (error) {
      this.setState(RedisConnectionState.ERROR);
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Disconnects from Redis
   */
  public async disconnect(): Promise<void> {
    if (this.state === RedisConnectionState.DISCONNECTED || this.state === RedisConnectionState.CLOSED) {
      return;
    }

    this.isClosing = true;
    this.setState(RedisConnectionState.CLOSING);

    // Clear any reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Disconnect clients
    const disconnectPromises: Promise<void>[] = [];

    if (this.subClient) {
      disconnectPromises.push(
        this.subClient.quit()
          .then(() => undefined)
          .catch(() => this.subClient?.disconnect())
      );
    }

    if (this.pubClient) {
      disconnectPromises.push(
        this.pubClient.quit()
          .then(() => undefined)
          .catch(() => this.pubClient?.disconnect())
      );
    }

    if (this.client) {
      disconnectPromises.push(
        this.client.quit()
          .then(() => undefined)
          .catch(() => this.client?.disconnect())
      );
    }

    await Promise.allSettled(disconnectPromises);

    this.client = null;
    this.pubClient = null;
    this.subClient = null;
    this.setState(RedisConnectionState.CLOSED);
  }

  /**
   * Attempts to reconnect with exponential backoff
   */
  public async reconnect(): Promise<void> {
    await this.disconnect();
    await this.connect();
  }

  /**
   * Executes a command on the Redis client
   */
  public async execute<T>(command: (client: LemegetonRedisClient) => Promise<T>): Promise<T> {
    const client = this.getClient();
    return command(client);
  }

  /**
   * Publishes a message to a channel
   */
  public async publish(channel: string, message: string): Promise<void> {
    const pubClient = this.getPubClient();
    await pubClient.publish(channel, message);
  }

  /**
   * Subscribes to a channel
   */
  public async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    const subClient = this.getSubClient();
    await subClient.subscribe(channel, handler);
  }

  /**
   * Unsubscribes from a channel
   */
  public async unsubscribe(channel: string): Promise<void> {
    const subClient = this.getSubClient();
    await subClient.unsubscribe(channel);
  }

  /**
   * Pattern subscribes to channels
   */
  public async pSubscribe(pattern: string, handler: (channel: string, message: string) => void): Promise<void> {
    const subClient = this.getSubClient();
    await subClient.pSubscribe(pattern, handler);
  }

  /**
   * Pattern unsubscribes from channels
   */
  public async pUnsubscribe(pattern: string): Promise<void> {
    const subClient = this.getSubClient();
    await subClient.pUnsubscribe(pattern);
  }

  /**
   * Performs a simple ping to check connectivity
   */
  public async ping(): Promise<string> {
    const client = this.getClient();
    return client.ping();
  }
}

// Singleton pattern removed - use dependency injection instead
// Create RedisClient instances explicitly and pass them to components that need them