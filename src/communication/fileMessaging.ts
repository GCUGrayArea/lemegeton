/**
 * File-Based Messaging Transport
 *
 * Implements message transport using file system for isolated coordination mode.
 * Features polling-based delivery, automatic cleanup, and works without network infrastructure.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  Message,
  MessageHandler,
  IMessageTransport,
  TransportStats,
  MessageBusConfig,
  DEFAULT_MESSAGE_BUS_CONFIG,
} from './types';
import { mergeConfig } from '../utils/config';

/**
 * File-based messaging transport implementation
 */
export class FileMessaging extends EventEmitter implements IMessageTransport {
  private baseDir: string;
  private pollingInterval: number;
  private config: Required<MessageBusConfig>;
  private subscriptions: Map<string, Set<MessageHandler>> = new Map();
  private pollers: Map<string, NodeJS.Timeout> = new Map();
  private processedMessageIds: Set<string> = new Set();
  private connected = false;
  private cleanupTimer: NodeJS.Timeout | null = null;

  // Statistics
  private stats = {
    messagesPublished: 0,
    messagesReceived: 0,
    publishErrors: 0,
    pollErrors: 0,
    handlerErrors: 0,
  };

  constructor(config: MessageBusConfig = {}) {
    super();
    this.config = mergeConfig(DEFAULT_MESSAGE_BUS_CONFIG, config);
    this.baseDir = this.config.fileMessagingDir;
    this.pollingInterval = this.config.pollingInterval;
  }

  /**
   * Connect to file-based messaging
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    try {
      // Ensure base directory exists
      await fs.mkdir(this.baseDir, { recursive: true });

      // Create standard channel directories
      await this.createChannelDir(this.sanitizeChannel('hub'));
      await this.createChannelDir(this.sanitizeChannel('hub-broadcast'));

      // Start cleanup timer
      this.startCleanupTimer();

      this.connected = true;
      this.emit('connected');
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to connect to file messaging: ${(error as Error).message}`);
    }
  }

  /**
   * Disconnect from file-based messaging
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    try {
      // Stop all pollers
      Array.from(this.pollers.values()).forEach((poller) => {
        clearInterval(poller);
      });
      this.pollers.clear();

      // Stop cleanup timer
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
      }

      // Clear subscriptions
      this.subscriptions.clear();
      this.processedMessageIds.clear();

      this.connected = false;
      this.emit('disconnected');
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to disconnect from file messaging: ${(error as Error).message}`);
    }
  }

  /**
   * Publish a message to a channel
   */
  async publish(channel: string, message: Message): Promise<void> {
    if (!this.connected) {
      throw new Error('File messaging not connected');
    }

    try {
      const sanitizedChannel = this.sanitizeChannel(channel);
      const channelDir = path.join(this.baseDir, sanitizedChannel);

      // Ensure channel directory exists
      await this.createChannelDir(sanitizedChannel);

      // Create filename with timestamp and message ID
      const filename = `${message.timestamp}-${message.id}.json`;
      const filepath = path.join(channelDir, filename);

      // Write message to file atomically
      await this.writeMessageFile(filepath, message);

      this.stats.messagesPublished++;
      this.emit('published', { channel, message });
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
    if (!this.connected) {
      throw new Error('File messaging not connected');
    }

    try {
      const sanitizedChannel = this.sanitizeChannel(channel);

      // Add handler to subscription map
      if (!this.subscriptions.has(channel)) {
        this.subscriptions.set(channel, new Set());

        // Ensure channel directory exists
        await this.createChannelDir(sanitizedChannel);

        // Start polling this channel
        this.startPolling(channel, sanitizedChannel);

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
    if (!this.connected) {
      return;
    }

    try {
      // Stop polling
      const poller = this.pollers.get(channel);
      if (poller) {
        clearInterval(poller);
        this.pollers.delete(channel);
      }

      // Remove subscriptions
      const removed = this.subscriptions.delete(channel);

      if (removed) {
        this.emit('unsubscribed', { channel });
      }
    } catch (error) {
      this.emit('unsubscribeError', { channel, error });
      throw new Error(`Failed to unsubscribe from ${channel}: ${(error as Error).message}`);
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
      type: 'file',
      custom: {
        publishErrors: this.stats.publishErrors,
        pollErrors: this.stats.pollErrors,
        handlerErrors: this.stats.handlerErrors,
        activePollers: this.pollers.size,
        processedMessages: this.processedMessageIds.size,
      },
    };
  }

  /**
   * Start polling a channel for messages
   */
  private startPolling(channel: string, sanitizedChannel: string): void {
    const poller = setInterval(async () => {
      await this.pollChannel(channel, sanitizedChannel);
    }, this.pollingInterval);

    this.pollers.set(channel, poller);
  }

  /**
   * Poll a channel for new messages
   */
  private async pollChannel(channel: string, sanitizedChannel: string): Promise<void> {
    const channelDir = path.join(this.baseDir, sanitizedChannel);

    try {
      // Read all message files
      const files = await fs.readdir(channelDir);

      // Filter JSON files and sort by timestamp (filename format: timestamp-id.json)
      const messageFiles = files
        .filter((f) => f.endsWith('.json'))
        .sort();

      // Process each message
      for (const file of messageFiles) {
        try {
          await this.processMessageFile(channel, channelDir, file);
        } catch (error) {
          // Continue processing other messages even if one fails
          this.emit('processError', { channel, file, error });
        }
      }
    } catch (error: any) {
      // Channel directory might not exist yet
      if (error.code !== 'ENOENT') {
        this.stats.pollErrors++;
        this.emit('pollError', { channel, error });
      }
    }
  }

  /**
   * Process a single message file
   */
  private async processMessageFile(
    channel: string,
    channelDir: string,
    filename: string
  ): Promise<void> {
    const filepath = path.join(channelDir, filename);

    try {
      // Read message file
      const content = await fs.readFile(filepath, 'utf-8');
      const message: Message = JSON.parse(content);

      // Skip if already processed
      if (this.processedMessageIds.has(message.id)) {
        return;
      }

      // Check TTL
      if (message.ttl) {
        const age = Date.now() - message.timestamp;
        if (age > message.ttl) {
          // Message expired, delete it
          await this.deleteMessageFile(filepath);
          return;
        }
      }

      // Mark as processed
      this.processedMessageIds.add(message.id);

      this.stats.messagesReceived++;
      this.emit('received', { channel, message });

      // Call handlers
      const handlers = this.subscriptions.get(channel);
      if (handlers) {
        for (const handler of Array.from(handlers)) {
          try {
            const result = handler(message);
            // Handle async handlers
            if (result instanceof Promise) {
              await result;
            }
          } catch (error) {
            this.stats.handlerErrors++;
            this.emit('handlerError', { channel, message, error });
          }
        }
      }

      // Delete processed message if configured
      if (this.config.deleteProcessedMessages) {
        await this.deleteMessageFile(filepath);
      }
    } catch (error) {
      // Don't throw - just log and continue
      this.emit('processError', { channel, filename, error });
    }
  }

  /**
   * Write message file atomically
   */
  private async writeMessageFile(filepath: string, message: Message): Promise<void> {
    // Write to temp file first
    const tempPath = `${filepath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(message, null, 2), 'utf-8');

    // Rename to final path (atomic operation)
    await fs.rename(tempPath, filepath);
  }

  /**
   * Delete message file
   */
  private async deleteMessageFile(filepath: string): Promise<void> {
    try {
      await fs.unlink(filepath);
    } catch (error: any) {
      // Ignore if file already deleted
      if (error.code !== 'ENOENT') {
        this.emit('deleteError', { filepath, error });
      }
    }
  }

  /**
   * Create channel directory
   */
  private async createChannelDir(sanitizedChannel: string): Promise<void> {
    const channelDir = path.join(this.baseDir, sanitizedChannel);
    await fs.mkdir(channelDir, { recursive: true });
  }

  /**
   * Sanitize channel name for use as directory name
   */
  private sanitizeChannel(channel: string): string {
    // Replace non-alphanumeric characters (except dash and underscore) with underscore
    return channel.replace(/[^a-zA-Z0-9-_]/g, '_');
  }

  /**
   * Start cleanup timer
   */
  private startCleanupTimer(): void {
    const cleanupInterval = 60000; // 1 minute

    this.cleanupTimer = setInterval(async () => {
      await this.cleanupOldMessages();
    }, cleanupInterval);
  }

  /**
   * Cleanup old messages across all channels
   */
  private async cleanupOldMessages(): Promise<void> {
    try {
      const maxAge = this.config.messageMaxAge;
      const now = Date.now();

      // Get all channel directories
      const channels = await fs.readdir(this.baseDir);

      for (const channel of channels) {
        const channelDir = path.join(this.baseDir, channel);

        // Check if it's a directory
        const stat = await fs.stat(channelDir);
        if (!stat.isDirectory()) {
          continue;
        }

        // Read message files
        const files = await fs.readdir(channelDir);

        for (const file of files) {
          if (!file.endsWith('.json')) {
            continue;
          }

          const filepath = path.join(channelDir, file);
          const fileStat = await fs.stat(filepath);

          // Delete if older than maxAge
          const age = now - fileStat.mtimeMs;
          if (age > maxAge) {
            await this.deleteMessageFile(filepath);
            this.emit('cleaned', { file, age });
          }
        }
      }
    } catch (error) {
      this.emit('cleanupError', { error });
    }
  }

  /**
   * Get message history from a channel
   */
  async getMessageHistory(channel: string, count: number = 100): Promise<Message[]> {
    if (!this.connected) {
      throw new Error('File messaging not connected');
    }

    const sanitizedChannel = this.sanitizeChannel(channel);
    const channelDir = path.join(this.baseDir, sanitizedChannel);

    try {
      const files = await fs.readdir(channelDir);

      // Filter and sort message files (newest first)
      const messageFiles = files
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, count);

      const messages: Message[] = [];

      for (const file of messageFiles) {
        const filepath = path.join(channelDir, file);
        const content = await fs.readFile(filepath, 'utf-8');
        const message: Message = JSON.parse(content);
        messages.push(message);
      }

      return messages;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Clear all messages from a channel
   */
  async clearChannel(channel: string): Promise<void> {
    if (!this.connected) {
      throw new Error('File messaging not connected');
    }

    const sanitizedChannel = this.sanitizeChannel(channel);
    const channelDir = path.join(this.baseDir, sanitizedChannel);

    try {
      const files = await fs.readdir(channelDir);

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filepath = path.join(channelDir, file);
          await fs.unlink(filepath);
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Clear all statistics
   */
  clearStats(): void {
    this.stats = {
      messagesPublished: 0,
      messagesReceived: 0,
      publishErrors: 0,
      pollErrors: 0,
      handlerErrors: 0,
    };
    this.processedMessageIds.clear();
  }
}
