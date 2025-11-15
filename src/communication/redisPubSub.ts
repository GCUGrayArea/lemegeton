/**
 * Redis Pub/Sub Transport
 *
 * Implements message transport using Redis pub/sub for distributed and degraded modes.
 * Features message persistence, pattern subscriptions, and automatic recovery.
 */

import { EventEmitter } from 'events';
import { RedisClient, LemegetonRedisClient } from '../redis/client';
import {
  Message,
  MessageHandler,
  IMessageTransport,
  TransportStats,
  MessageBusConfig,
  DEFAULT_MESSAGE_BUS_CONFIG,
} from './types';

/**
 * Redis pub/sub transport implementation
 */
export class RedisPubSub extends EventEmitter implements IMessageTransport {
  private redisClient: RedisClient;
  private pubClient: LemegetonRedisClient | null = null;
  private subClient: LemegetonRedisClient | null = null;
  private config: Required<MessageBusConfig>;
  private subscriptions: Map<string, Set<MessageHandler>> = new Map();
  private connected = false;

  // Statistics
  private stats = {
    messagesPublished: 0,
    messagesReceived: 0,
    publishErrors: 0,
    parseErrors: 0,
    handlerErrors: 0,
  };

  constructor(redisClient: RedisClient, config: MessageBusConfig = {}) {
    super();
    this.redisClient = redisClient;
    this.config = { ...DEFAULT_MESSAGE_BUS_CONFIG, ...config };
  }

  /**
   * Connect to Redis pub/sub
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    try {
      // Ensure Redis client is connected
      if (!this.redisClient.isConnected()) {
        await this.redisClient.connect();
      }

      // Get dedicated pub/sub clients
      this.pubClient = this.redisClient.getPubClient();
      this.subClient = this.redisClient.getSubClient();

      this.connected = true;
      this.emit('connected');
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to connect to Redis pub/sub: ${(error as Error).message}`);
    }
  }

  /**
   * Disconnect from Redis pub/sub
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    try {
      // Unsubscribe from all channels
      for (const channel of Array.from(this.subscriptions.keys())) {
        try {
          await this.subClient?.unsubscribe(channel);
        } catch (error) {
          // Ignore unsubscribe errors during disconnect
        }
      }

      this.subscriptions.clear();
      this.connected = false;
      this.pubClient = null;
      this.subClient = null;

      this.emit('disconnected');
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to disconnect from Redis pub/sub: ${(error as Error).message}`);
    }
  }

  /**
   * Publish a message to a channel
   */
  async publish(channel: string, message: Message): Promise<void> {
    if (!this.connected || !this.pubClient) {
      throw new Error('Redis pub/sub not connected');
    }

    try {
      // Serialize message
      const payload = JSON.stringify(message);

      // Publish to Redis
      const subscriberCount = await this.pubClient.publish(channel, payload);

      // Persist to stream if configured
      if (this.config.persistMessages) {
        await this.persistMessage(channel, message);
      }

      this.stats.messagesPublished++;
      this.emit('published', { channel, message, subscriberCount });
    } catch (error) {
      this.stats.publishErrors++;
      this.emit('publishError', { channel, message, error });
      throw new Error(`Failed to publish message to ${channel}: ${(error as Error).message}`);
    }
  }

  /**
   * Subscribe to a channel
   */
  async subscribe(channel: string, handler: MessageHandler): Promise<void> {
    if (!this.connected || !this.subClient) {
      throw new Error('Redis pub/sub not connected');
    }

    try {
      // Add handler to subscription map
      if (!this.subscriptions.has(channel)) {
        this.subscriptions.set(channel, new Set());

        // Subscribe to Redis channel
        await this.subClient.subscribe(channel, (rawMessage: string) => {
          this.handleMessage(channel, rawMessage);
        });

        this.emit('subscribed', { channel });
      }

      this.subscriptions.get(channel)!.add(handler);
    } catch (error) {
      this.emit('subscribeError', { channel, error });
      throw new Error(`Failed to subscribe to ${channel}: ${(error as Error).message}`);
    }
  }

  /**
   * Unsubscribe from a channel
   */
  async unsubscribe(channel: string): Promise<void> {
    if (!this.connected || !this.subClient) {
      return;
    }

    try {
      // Remove from subscriptions
      const removed = this.subscriptions.delete(channel);

      if (removed) {
        // Unsubscribe from Redis
        await this.subClient.unsubscribe(channel);
        this.emit('unsubscribed', { channel });
      }
    } catch (error) {
      this.emit('unsubscribeError', { channel, error });
      throw new Error(`Failed to unsubscribe from ${channel}: ${(error as Error).message}`);
    }
  }

  /**
   * Pattern subscribe to channels
   */
  async pSubscribe(pattern: string, handler: MessageHandler): Promise<void> {
    if (!this.connected || !this.subClient) {
      throw new Error('Redis pub/sub not connected');
    }

    try {
      // Add handler to subscription map
      if (!this.subscriptions.has(pattern)) {
        this.subscriptions.set(pattern, new Set());

        // Subscribe with pattern
        await this.subClient.pSubscribe(pattern, (rawMessage: string, channel: string) => {
          this.handleMessage(channel, rawMessage);
        });

        this.emit('pSubscribed', { pattern });
      }

      this.subscriptions.get(pattern)!.add(handler);
    } catch (error) {
      this.emit('pSubscribeError', { pattern, error });
      throw new Error(`Failed to pattern subscribe to ${pattern}: ${(error as Error).message}`);
    }
  }

  /**
   * Pattern unsubscribe from channels
   */
  async pUnsubscribe(pattern: string): Promise<void> {
    if (!this.connected || !this.subClient) {
      return;
    }

    try {
      // Remove from subscriptions
      const removed = this.subscriptions.delete(pattern);

      if (removed) {
        // Unsubscribe from Redis
        await this.subClient.pUnsubscribe(pattern);
        this.emit('pUnsubscribed', { pattern });
      }
    } catch (error) {
      this.emit('pUnsubscribeError', { pattern, error });
      throw new Error(`Failed to pattern unsubscribe from ${pattern}: ${(error as Error).message}`);
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get transport statistics
   */
  getStats(): TransportStats {
    return {
      messagesPublished: this.stats.messagesPublished,
      messagesReceived: this.stats.messagesReceived,
      activeSubscriptions: this.subscriptions.size,
      connected: this.connected,
      type: 'redis',
      custom: {
        publishErrors: this.stats.publishErrors,
        parseErrors: this.stats.parseErrors,
        handlerErrors: this.stats.handlerErrors,
      },
    };
  }

  /**
   * Get message history from stream
   */
  async getMessageHistory(channel: string, count: number = 100): Promise<Message[]> {
    if (!this.connected || !this.pubClient) {
      throw new Error('Redis pub/sub not connected');
    }

    try {
      const streamKey = this.getStreamKey(channel);

      // Read from stream in reverse order
      const entries = await this.pubClient.xRevRange(streamKey, '+', '-', {
        COUNT: count,
      });

      return entries.map((entry: any) => this.parseStreamEntry(entry));
    } catch (error) {
      this.emit('error', error);
      return [];
    }
  }

  /**
   * Handle incoming message
   */
  private handleMessage(channel: string, rawMessage: string): void {
    try {
      const message: Message = JSON.parse(rawMessage);

      this.stats.messagesReceived++;
      this.emit('received', { channel, message });

      // Call all handlers for this channel
      const handlers = this.subscriptions.get(channel);
      if (handlers) {
        handlers.forEach((handler) => {
          try {
            const result = handler(message);
            // Handle async handlers
            if (result instanceof Promise) {
              result.catch((error) => {
                this.stats.handlerErrors++;
                this.emit('handlerError', { channel, message, error });
              });
            }
          } catch (error) {
            this.stats.handlerErrors++;
            this.emit('handlerError', { channel, message, error });
          }
        });
      }
    } catch (error) {
      this.stats.parseErrors++;
      this.emit('parseError', { channel, rawMessage, error });
    }
  }

  /**
   * Persist message to Redis stream
   */
  private async persistMessage(channel: string, message: Message): Promise<void> {
    if (!this.pubClient) return;

    try {
      const streamKey = this.getStreamKey(channel);

      // Add to stream with trimming
      await this.pubClient.xAdd(
        streamKey,
        '*',  // Auto-generate ID
        {
          id: message.id,
          timestamp: message.timestamp.toString(),
          type: message.type,
          from: message.from,
          to: message.to || '',
          payload: JSON.stringify(message.payload),
          priority: (message.priority || 0).toString(),
          ttl: (message.ttl || 0).toString(),
          correlationId: message.correlationId || '',
        },
        {
          TRIM: {
            strategy: 'MAXLEN',
            strategyModifier: '~',  // Approximate trimming for performance
            threshold: this.config.maxStreamLength,
          },
        }
      );
    } catch (error) {
      // Non-fatal error - message still published
      this.emit('persistError', { channel, message, error });
    }
  }

  /**
   * Parse stream entry back to message
   */
  private parseStreamEntry(entry: any): Message {
    const data = entry.message;

    return {
      id: data.id,
      timestamp: parseInt(data.timestamp, 10),
      type: data.type,
      from: data.from,
      to: data.to || undefined,
      payload: JSON.parse(data.payload),
      priority: data.priority ? parseInt(data.priority, 10) : undefined,
      ttl: data.ttl ? parseInt(data.ttl, 10) : undefined,
      correlationId: data.correlationId || undefined,
    };
  }

  /**
   * Get stream key for channel
   */
  private getStreamKey(channel: string): string {
    return `message-stream:${channel}`;
  }

  /**
   * Clear message history for a channel
   */
  async clearHistory(channel: string): Promise<void> {
    if (!this.connected || !this.pubClient) {
      throw new Error('Redis pub/sub not connected');
    }

    const streamKey = this.getStreamKey(channel);
    await this.pubClient.del(streamKey);
  }

  /**
   * Clear all statistics
   */
  clearStats(): void {
    this.stats = {
      messagesPublished: 0,
      messagesReceived: 0,
      publishErrors: 0,
      parseErrors: 0,
      handlerErrors: 0,
    };
  }
}
