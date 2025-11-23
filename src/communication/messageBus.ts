/**
 * Message Bus
 *
 * Unified message bus that seamlessly switches between Redis pub/sub (distributed/degraded)
 * and file-based messaging (isolated) based on coordination mode.
 */

import { EventEmitter } from 'events';
import { RedisClient } from '../redis/client';
import { CoordinationModeManager, CoordinationMode } from '../core/coordinationMode';
import { RedisPubSub } from './redisPubSub';
import { FileMessaging } from './fileMessaging';
import {
  Message,
  MessageHandler,
  IMessageBus,
  IMessageTransport,
  MessageBusStats,
  MessageBusConfig,
  QueuedMessage,
  ChannelNames,
  MessageIdGenerator,
  DEFAULT_MESSAGE_BUS_CONFIG,
} from './types';
import { mergeConfig } from '../utils/config';

/**
 * Message Bus implementation
 */
export class MessageBus extends EventEmitter implements IMessageBus {
  private mode: CoordinationMode;
  private redisPubSub: RedisPubSub | null = null;
  private fileMessaging: FileMessaging | null = null;
  private modeManager: CoordinationModeManager;
  private config: Required<MessageBusConfig>;

  // Message queue for transitions
  private isTransitioning = false;
  private pendingMessages: QueuedMessage[] = [];

  // Subscription management
  private subscriptions: Map<string, Set<MessageHandler>> = new Map();

  // Statistics
  private stats = {
    modeTransitions: 0,
    totalSent: 0,
    totalReceived: 0,
    totalFailed: 0,
    latencies: [] as number[],
  };

  constructor(
    redisClient: RedisClient | null,
    modeManager: CoordinationModeManager,
    config: MessageBusConfig = {}
  ) {
    super();
    this.modeManager = modeManager;
    this.mode = modeManager.getMode();
    this.config = mergeConfig(DEFAULT_MESSAGE_BUS_CONFIG, config);

    // Initialize both transports
    if (redisClient) {
      this.redisPubSub = new RedisPubSub(redisClient, this.config);
      this.setupTransportEventListeners(this.redisPubSub, 'redis');
    }

    this.fileMessaging = new FileMessaging(this.config);
    this.setupTransportEventListeners(this.fileMessaging, 'file');

    // Subscribe to mode changes
    this.modeManager.on('modeChanged', this.handleModeChange.bind(this));
  }

  /**
   * Start the message bus
   */
  async start(): Promise<void> {
    // Start appropriate transport based on current mode
    await this.switchTransport(this.mode);
    this.emit('started', { mode: this.mode });
  }

  /**
   * Stop the message bus
   */
  async stop(): Promise<void> {
    // Disconnect from active transport
    const transport = this.getActiveTransport();
    if (transport && transport.isConnected()) {
      await transport.disconnect();
    }

    // Clear pending messages
    this.pendingMessages = [];

    // Clear subscriptions
    this.subscriptions.clear();

    this.emit('stopped');
  }

  /**
   * Publish a message to a channel
   */
  async publish(channel: string, message: Message): Promise<void> {
    const startTime = Date.now();

    try {
      // Queue during transitions
      if (this.isTransitioning) {
        this.queueMessage(channel, message);
        return;
      }

      // Get active transport
      const transport = this.getActiveTransport();
      if (!transport || !transport.isConnected()) {
        throw new Error('No active transport available');
      }

      // Publish
      await transport.publish(channel, message);

      // Track statistics
      this.stats.totalSent++;
      const latency = Date.now() - startTime;
      this.trackLatency(latency);

      this.emit('published', { channel, message, latency });
    } catch (error) {
      this.stats.totalFailed++;
      this.emit('publishError', { channel, message, error });
      throw error;
    }
  }

  /**
   * Publish a message to a specific agent
   */
  async publishToAgent(agentId: string, message: Message): Promise<void> {
    const channel = ChannelNames.agent(agentId);
    message.to = agentId;
    await this.publish(channel, message);
  }

  /**
   * Broadcast a message to all agents
   */
  async broadcast(message: Message): Promise<void> {
    const channel = ChannelNames.broadcast();
    delete message.to;  // Ensure no specific recipient
    await this.publish(channel, message);
  }

  /**
   * Subscribe to a channel
   */
  async subscribe(channel: string, handler: MessageHandler): Promise<void> {
    // Add to subscription map
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());
    }
    this.subscriptions.get(channel)!.add(handler);

    // Subscribe with active transport
    const transport = this.getActiveTransport();
    if (transport && transport.isConnected()) {
      await transport.subscribe(channel, (message: Message) => {
        this.handleReceivedMessage(channel, message, handler);
      });
    }

    this.emit('subscribed', { channel });
  }

  /**
   * Unsubscribe from a channel
   */
  async unsubscribe(channel: string): Promise<void> {
    // Remove from subscription map
    this.subscriptions.delete(channel);

    // Unsubscribe from active transport
    const transport = this.getActiveTransport();
    if (transport && transport.isConnected()) {
      await transport.unsubscribe(channel);
    }

    this.emit('unsubscribed', { channel });
  }

  /**
   * Unsubscribe from all channels
   */
  async unsubscribeAll(): Promise<void> {
    const channels = Array.from(this.subscriptions.keys());

    for (const channel of channels) {
      await this.unsubscribe(channel);
    }

    this.subscriptions.clear();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    const transport = this.getActiveTransport();
    return transport ? transport.isConnected() : false;
  }

  /**
   * Get current coordination mode
   */
  getMode(): CoordinationMode {
    return this.mode;
  }

  /**
   * Get message bus statistics
   */
  getStats(): MessageBusStats {
    const transport = this.getActiveTransport();
    const transportStats = transport ? transport.getStats() : {
      messagesPublished: 0,
      messagesReceived: 0,
      activeSubscriptions: 0,
      connected: false,
      type: 'redis' as const,
    };

    return {
      mode: this.mode,
      isTransitioning: this.isTransitioning,
      pendingMessages: this.pendingMessages.length,
      modeTransitions: this.stats.modeTransitions,
      transport: transportStats,
      delivery: {
        totalSent: this.stats.totalSent,
        totalReceived: this.stats.totalReceived,
        totalFailed: this.stats.totalFailed,
        avgLatencyMs: this.calculateAverageLatency(),
      },
    };
  }

  /**
   * Handle mode change from CoordinationModeManager
   */
  private async handleModeChange(from: CoordinationMode, to: CoordinationMode): Promise<void> {
    this.emit('modeChanging', { from, to });

    // Start transition
    this.isTransitioning = true;

    try {
      // Switch to new transport
      await this.switchTransport(to);

      // Update mode
      this.mode = to;
      this.stats.modeTransitions++;

      // Flush pending messages
      await this.flushPendingMessages();

      // End transition
      this.isTransitioning = false;

      this.emit('modeChanged', { from, to });
    } catch (error) {
      this.isTransitioning = false;
      this.emit('modeChangeError', { from, to, error });
      throw error;
    }
  }

  /**
   * Switch to new transport based on mode
   */
  private async switchTransport(newMode: CoordinationMode): Promise<void> {
    const oldTransport = this.getActiveTransport();

    // Disconnect from old transport (if different)
    if (oldTransport && oldTransport.isConnected()) {
      const oldMode = this.mode;
      const needsSwitch =
        (oldMode === CoordinationMode.ISOLATED && newMode !== CoordinationMode.ISOLATED) ||
        (oldMode !== CoordinationMode.ISOLATED && newMode === CoordinationMode.ISOLATED);

      if (needsSwitch) {
        await oldTransport.disconnect();
      }
    }

    // Connect to new transport
    const newTransport = this.getTransportForMode(newMode);
    if (!newTransport) {
      throw new Error(`No transport available for mode: ${newMode}`);
    }

    if (!newTransport.isConnected()) {
      await newTransport.connect();
    }

    // Re-subscribe to all channels with new transport
    await this.resubscribeAll(newTransport);

    this.emit('transportSwitched', { mode: newMode });
  }

  /**
   * Re-subscribe to all channels with new transport
   */
  private async resubscribeAll(transport: IMessageTransport): Promise<void> {
    for (const [channel, handlers] of Array.from(this.subscriptions.entries())) {
      // Subscribe once for the channel
      await transport.subscribe(channel, (message: Message) => {
        // Call all handlers for this channel
        handlers.forEach((handler) => {
          this.handleReceivedMessage(channel, message, handler);
        });
      });
    }
  }

  /**
   * Get active transport based on current mode
   */
  private getActiveTransport(): IMessageTransport | null {
    return this.getTransportForMode(this.mode);
  }

  /**
   * Get transport for a specific mode
   */
  private getTransportForMode(mode: CoordinationMode): IMessageTransport | null {
    if (mode === CoordinationMode.ISOLATED) {
      return this.fileMessaging;
    }
    return this.redisPubSub;
  }

  /**
   * Queue a message during transitions
   */
  private queueMessage(channel: string, message: Message): void {
    // Check queue size limit
    if (this.pendingMessages.length >= this.config.maxPendingMessages) {
      // Remove oldest message
      this.pendingMessages.shift();
      this.emit('messageDropped', { reason: 'queue_full' });
    }

    this.pendingMessages.push({
      channel,
      message,
      timestamp: Date.now(),
      attempts: 0,
    });

    this.emit('messageQueued', { channel, message });
  }

  /**
   * Flush pending messages after transition
   */
  private async flushPendingMessages(): Promise<void> {
    const messages = [...this.pendingMessages];
    this.pendingMessages = [];

    const transport = this.getActiveTransport();
    if (!transport || !transport.isConnected()) {
      // Re-queue all messages
      this.pendingMessages = messages;
      return;
    }

    for (const queued of messages) {
      try {
        // Check if message expired
        const age = Date.now() - queued.timestamp;
        if (queued.message.ttl && age > queued.message.ttl) {
          this.emit('messageExpired', { message: queued.message, age });
          continue;
        }

        // Retry with exponential backoff
        const delay = this.config.retryDelay * Math.pow(2, queued.attempts);
        await new Promise((resolve) => setTimeout(resolve, delay));

        await transport.publish(queued.channel, queued.message);
        this.emit('messageFlushed', { message: queued.message });
      } catch (error) {
        queued.attempts++;

        // Re-queue if under retry limit
        if (queued.attempts < this.config.retryAttempts) {
          this.pendingMessages.push(queued);
        } else {
          this.stats.totalFailed++;
          this.emit('messageRetryFailed', { message: queued.message, error });
        }
      }
    }
  }

  /**
   * Handle received message
   */
  private async handleReceivedMessage(
    channel: string,
    message: Message,
    handler: MessageHandler
  ): Promise<void> {
    this.stats.totalReceived++;
    this.emit('received', { channel, message });

    // Call handler
    try {
      const result = handler(message);
      if (result instanceof Promise) {
        await result.catch((error) => {
          this.emit('handlerError', { channel, message, error });
          // Re-throw to ensure proper error propagation
          throw error;
        });
      }
    } catch (error) {
      this.emit('handlerError', { channel, message, error });
    }
  }

  /**
   * Setup event listeners for a transport
   */
  private setupTransportEventListeners(transport: IMessageTransport, type: string): void {
    // Transport implementations extend EventEmitter - verify at runtime
    if (!(transport instanceof EventEmitter)) {
      throw new Error(`Transport ${type} must extend EventEmitter`);
    }

    transport.on('error', (error: Error) => {
      this.emit('transportError', { type, error });
    });

    transport.on('published', (event: Record<string, unknown>) => {
      this.emit('transportPublished', { type, ...event });
    });

    transport.on('received', (event: Record<string, unknown>) => {
      this.emit('transportReceived', { type, ...event });
    });
  }

  /**
   * Track message latency
   */
  private trackLatency(latency: number): void {
    this.stats.latencies.push(latency);

    // Keep only recent latencies (last 1000)
    if (this.stats.latencies.length > 1000) {
      this.stats.latencies.shift();
    }
  }

  /**
   * Calculate average latency
   */
  private calculateAverageLatency(): number {
    if (this.stats.latencies.length === 0) {
      return 0;
    }

    const sum = this.stats.latencies.reduce((a, b) => a + b, 0);
    return sum / this.stats.latencies.length;
  }

  /**
   * Create a message with default values
   */
  static createMessage<T = unknown>(
    type: string,
    from: string,
    payload: T,
    options: Partial<Message> = {}
  ): Message {
    return {
      id: MessageIdGenerator.generate(),
      timestamp: Date.now(),
      type: type as Message['type'],
      from,
      payload,
      ...options,
    };
  }
}

// Export utility classes
export { ChannelNames, MessageIdGenerator };
