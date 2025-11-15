/**
 * Message Bus Tests
 *
 * Comprehensive tests for message bus system including:
 * - Redis pub/sub transport
 * - File-based transport
 * - Mode switching
 * - Message delivery
 * - Error handling
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { MessageBus, RedisPubSub, FileMessaging, ChannelNames, MessageIdGenerator } from '../src/communication';
import {
  Message,
  MessageType,
  MessagePriority,
  MessageHandler,
  MessageBusConfig,
} from '../src/communication/types';
import { RedisClient, RedisConnectionState } from '../src/redis/client';
import { CoordinationModeManager, CoordinationMode } from '../src/core/coordinationMode';
import { RedisHealthChecker } from '../src/redis/health';

// Mock Redis client
class MockRedisClient extends EventEmitter {
  private state = RedisConnectionState.DISCONNECTED;
  private mockPubClient: any;
  private mockSubClient: any;
  private messages: Map<string, string[]> = new Map();
  private subscribers: Map<string, Set<(message: string) => void>> = new Map();

  constructor() {
    super();
    this.mockPubClient = this.createMockClient();
    this.mockSubClient = this.createMockClient();
  }

  private createMockClient() {
    return {
      publish: jest.fn(async (channel: string, message: string) => {
        // Store message
        if (!this.messages.has(channel)) {
          this.messages.set(channel, []);
        }
        this.messages.get(channel)!.push(message);

        // Deliver to subscribers
        const handlers = this.subscribers.get(channel);
        if (handlers) {
          handlers.forEach((handler) => handler(message));
        }

        return handlers ? handlers.size : 0;
      }),

      subscribe: jest.fn(async (channel: string, handler: (message: string) => void) => {
        if (!this.subscribers.has(channel)) {
          this.subscribers.set(channel, new Set());
        }
        this.subscribers.get(channel)!.add(handler);
      }),

      unsubscribe: jest.fn(async (channel: string) => {
        this.subscribers.delete(channel);
      }),

      xAdd: jest.fn(async () => '0-0'),
      xRevRange: jest.fn(async () => []),
      del: jest.fn(async () => 1),
    };
  }

  async connect() {
    this.state = RedisConnectionState.CONNECTED;
    this.emit('connected');
  }

  async disconnect() {
    this.state = RedisConnectionState.DISCONNECTED;
    this.emit('disconnected');
  }

  getState() {
    return this.state;
  }

  isConnected() {
    return this.state === RedisConnectionState.CONNECTED;
  }

  getPubClient() {
    return this.mockPubClient;
  }

  getSubClient() {
    return this.mockSubClient;
  }

  async execute(fn: any) {
    return fn(this.mockPubClient);
  }

  async publish(channel: string, message: string) {
    return this.mockPubClient.publish(channel, message);
  }

  async subscribe(channel: string, handler: (message: string) => void) {
    return this.mockSubClient.subscribe(channel, handler);
  }

  async unsubscribe(channel: string) {
    return this.mockSubClient.unsubscribe(channel);
  }

  // Test helpers
  getMessages(channel: string): string[] {
    return this.messages.get(channel) || [];
  }

  clearMessages() {
    this.messages.clear();
  }
}

// Mock CoordinationModeManager
class MockCoordinationModeManager extends EventEmitter {
  private currentMode = CoordinationMode.DISTRIBUTED;

  getMode() {
    return this.currentMode;
  }

  setMode(mode: CoordinationMode) {
    const from = this.currentMode;
    this.currentMode = mode;
    this.emit('modeChanged', from, mode);
  }

  getDegradedHandler() {
    return {};
  }

  getIsolatedHandler() {
    return {};
  }
}

describe('MessageBus', () => {
  let redisClient: MockRedisClient;
  let modeManager: MockCoordinationModeManager;
  let messageBus: MessageBus;
  const testDir = path.join(__dirname, 'fixtures', 'message-test');

  beforeEach(async () => {
    redisClient = new MockRedisClient();
    await redisClient.connect();

    modeManager = new MockCoordinationModeManager();

    const config: MessageBusConfig = {
      fileMessagingDir: testDir,
      pollingInterval: 100,
      deleteProcessedMessages: true,
      messageMaxAge: 5000,
    };

    messageBus = new MessageBus(redisClient as any, modeManager as any, config);
  });

  afterEach(async () => {
    await messageBus.stop();
    await redisClient.disconnect();

    // Cleanup test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Initialization', () => {
    it('should start in distributed mode with Redis', async () => {
      await messageBus.start();

      expect(messageBus.isConnected()).toBe(true);
      expect(messageBus.getMode()).toBe(CoordinationMode.DISTRIBUTED);
    });

    it('should emit started event', async () => {
      const startedHandler = jest.fn();
      messageBus.on('started', startedHandler);

      await messageBus.start();

      expect(startedHandler).toHaveBeenCalledWith({ mode: CoordinationMode.DISTRIBUTED });
    });
  });

  describe('Redis Pub/Sub Mode', () => {
    beforeEach(async () => {
      await messageBus.start();
    });

    it('should publish message to channel', async () => {
      const message = MessageBus.createMessage(MessageType.HEARTBEAT, 'agent-1', {
        status: 'alive',
      });

      await messageBus.publish('test-channel', message);

      const messages = redisClient.getMessages('test-channel');
      expect(messages).toHaveLength(1);

      const published = JSON.parse(messages[0]);
      expect(published.id).toBe(message.id);
      expect(published.type).toBe(MessageType.HEARTBEAT);
    });

    it('should publish message to specific agent', async () => {
      const message = MessageBus.createMessage(MessageType.ASSIGNMENT, 'hub', {
        prId: 'PR-001',
      });

      await messageBus.publishToAgent('agent-1', message);

      const messages = redisClient.getMessages('agent-agent-1');
      expect(messages).toHaveLength(1);

      const published = JSON.parse(messages[0]);
      expect(published.to).toBe('agent-1');
    });

    it('should broadcast message to all agents', async () => {
      const message = MessageBus.createMessage(MessageType.MODE_CHANGE, 'hub', {
        newMode: 'degraded',
      });

      await messageBus.broadcast(message);

      const messages = redisClient.getMessages('hub-broadcast');
      expect(messages).toHaveLength(1);

      const published = JSON.parse(messages[0]);
      expect(published.to).toBeUndefined();
    });

    it('should receive messages on subscribed channel', async () => {
      const receivedMessages: Message[] = [];
      const handler: MessageHandler = (message) => {
        receivedMessages.push(message);
      };

      await messageBus.subscribe('test-channel', handler);

      const message = MessageBus.createMessage(MessageType.HEARTBEAT, 'agent-1', {
        status: 'alive',
      });

      await messageBus.publish('test-channel', message);

      // Wait for message delivery
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].id).toBe(message.id);
    });

    it('should unsubscribe from channel', async () => {
      const handler = jest.fn();

      await messageBus.subscribe('test-channel', handler);
      await messageBus.unsubscribe('test-channel');

      const message = MessageBus.createMessage(MessageType.HEARTBEAT, 'agent-1', {
        status: 'alive',
      });

      await messageBus.publish('test-channel', message);

      // Wait to ensure no delivery
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('File-Based Messaging Mode', () => {
    beforeEach(async () => {
      // Switch to isolated mode
      modeManager.setMode(CoordinationMode.ISOLATED);
      await messageBus.start();
    });

    it('should publish message to file', async () => {
      const message = MessageBus.createMessage(MessageType.HEARTBEAT, 'agent-1', {
        status: 'alive',
      });

      await messageBus.publish('test-channel', message);

      // Check file was created
      const channelDir = path.join(testDir, 'test-channel');
      const files = await fs.readdir(channelDir);
      expect(files.length).toBeGreaterThan(0);

      const messageFile = files.find((f) => f.endsWith('.json'));
      expect(messageFile).toBeDefined();

      // Verify message content
      const content = await fs.readFile(path.join(channelDir, messageFile!), 'utf-8');
      const published = JSON.parse(content);
      expect(published.id).toBe(message.id);
    });

    it('should receive messages from file polling', async () => {
      const receivedMessages: Message[] = [];
      const handler: MessageHandler = (message) => {
        receivedMessages.push(message);
      };

      await messageBus.subscribe('test-channel', handler);

      const message = MessageBus.createMessage(MessageType.HEARTBEAT, 'agent-1', {
        status: 'alive',
      });

      await messageBus.publish('test-channel', message);

      // Wait for polling to pick up message
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].id).toBe(message.id);
    });
  });

  describe('Mode Switching', () => {
    beforeEach(async () => {
      await messageBus.start();
    });

    it('should switch from distributed to isolated mode', async () => {
      const modeChangedHandler = jest.fn();
      messageBus.on('modeChanged', modeChangedHandler);

      // Switch mode
      modeManager.setMode(CoordinationMode.ISOLATED);

      // Wait for transition
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(messageBus.getMode()).toBe(CoordinationMode.ISOLATED);
      expect(modeChangedHandler).toHaveBeenCalled();
    });

    it('should queue messages during transition', async () => {
      let transitionStarted = false;
      let transitionEnded = false;

      messageBus.on('modeChanging', () => {
        transitionStarted = true;
      });

      messageBus.on('modeChanged', () => {
        transitionEnded = true;
      });

      // Trigger mode change
      const modeChangePromise = new Promise<void>((resolve) => {
        modeManager.setMode(CoordinationMode.ISOLATED);

        // Publish messages during transition
        setTimeout(async () => {
          if (transitionStarted && !transitionEnded) {
            const message = MessageBus.createMessage(MessageType.HEARTBEAT, 'agent-1', {
              status: 'alive',
            });

            await messageBus.publish('test-channel', message);

            // Check if queued
            const stats = messageBus.getStats();
            expect(stats.pendingMessages).toBeGreaterThan(0);
          }
          resolve();
        }, 10);
      });

      await modeChangePromise;

      // Wait for flush
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify message was delivered
      const stats = messageBus.getStats();
      expect(stats.pendingMessages).toBe(0);
    });

    it('should preserve subscriptions across mode transitions', async () => {
      const receivedMessages: Message[] = [];
      const handler: MessageHandler = (message) => {
        receivedMessages.push(message);
      };

      // Subscribe in distributed mode
      await messageBus.subscribe('test-channel', handler);

      // Switch to isolated mode
      modeManager.setMode(CoordinationMode.ISOLATED);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Publish in isolated mode
      const message = MessageBus.createMessage(MessageType.HEARTBEAT, 'agent-1', {
        status: 'alive',
      });

      await messageBus.publish('test-channel', message);

      // Wait for delivery
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(receivedMessages).toHaveLength(1);
    });
  });

  describe('Message Utilities', () => {
    it('should generate unique message IDs', () => {
      const id1 = MessageIdGenerator.generate();
      const id2 = MessageIdGenerator.generate();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^\d+-[a-z0-9]+-[a-z0-9]+$/);
    });

    it('should create message with defaults', () => {
      const message = MessageBus.createMessage(MessageType.HEARTBEAT, 'agent-1', {
        status: 'alive',
      });

      expect(message.id).toBeDefined();
      expect(message.timestamp).toBeGreaterThan(0);
      expect(message.type).toBe(MessageType.HEARTBEAT);
      expect(message.from).toBe('agent-1');
      expect(message.payload).toEqual({ status: 'alive' });
    });

    it('should generate correct channel names', () => {
      expect(ChannelNames.agent('agent-1')).toBe('agent-agent-1');
      expect(ChannelNames.broadcast()).toBe('hub-broadcast');
      expect(ChannelNames.hub()).toBe('hub');
      expect(ChannelNames.coordination('mode_change')).toBe('coordination:mode_change');
      expect(ChannelNames.system('shutdown')).toBe('system:shutdown');
    });

    it('should detect agent channels', () => {
      expect(ChannelNames.isAgentChannel('agent-agent-1')).toBe(true);
      expect(ChannelNames.isAgentChannel('hub-broadcast')).toBe(false);
    });

    it('should extract agent ID from channel', () => {
      expect(ChannelNames.extractAgentId('agent-agent-1')).toBe('agent-1');
      expect(ChannelNames.extractAgentId('hub-broadcast')).toBe(null);
    });
  });

  describe('Statistics', () => {
    beforeEach(async () => {
      await messageBus.start();
    });

    it('should track sent messages', async () => {
      const message = MessageBus.createMessage(MessageType.HEARTBEAT, 'agent-1', {
        status: 'alive',
      });

      await messageBus.publish('test-channel', message);

      const stats = messageBus.getStats();
      expect(stats.delivery.totalSent).toBe(1);
    });

    it('should track received messages', async () => {
      const handler = jest.fn();

      await messageBus.subscribe('test-channel', handler);

      const message = MessageBus.createMessage(MessageType.HEARTBEAT, 'agent-1', {
        status: 'alive',
      });

      await messageBus.publish('test-channel', message);

      // Wait for delivery
      await new Promise((resolve) => setTimeout(resolve, 50));

      const stats = messageBus.getStats();
      expect(stats.delivery.totalReceived).toBeGreaterThan(0);
    });

    it('should track mode transitions', async () => {
      modeManager.setMode(CoordinationMode.ISOLATED);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const stats = messageBus.getStats();
      expect(stats.modeTransitions).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should emit error on publish failure', async () => {
      await messageBus.start();

      const errorHandler = jest.fn();
      messageBus.on('publishError', errorHandler);

      // Force error by disconnecting Redis
      await redisClient.disconnect();

      const message = MessageBus.createMessage(MessageType.HEARTBEAT, 'agent-1', {
        status: 'alive',
      });

      await expect(messageBus.publish('test-channel', message)).rejects.toThrow();
      expect(errorHandler).toHaveBeenCalled();
    });

    it('should handle handler errors gracefully', async () => {
      await messageBus.start();

      const errorHandler = jest.fn();
      messageBus.on('handlerError', errorHandler);

      const faultyHandler: MessageHandler = () => {
        throw new Error('Handler error');
      };

      await messageBus.subscribe('test-channel', faultyHandler);

      const message = MessageBus.createMessage(MessageType.HEARTBEAT, 'agent-1', {
        status: 'alive',
      });

      await messageBus.publish('test-channel', message);

      // Wait for delivery
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('Performance', () => {
    beforeEach(async () => {
      await messageBus.start();
    });

    it('should deliver messages with low latency in Redis mode', async () => {
      const message = MessageBus.createMessage(MessageType.HEARTBEAT, 'agent-1', {
        status: 'alive',
      });

      const startTime = Date.now();
      await messageBus.publish('test-channel', message);
      const latency = Date.now() - startTime;

      expect(latency).toBeLessThan(100);  // Should be much less, but allow for test overhead
    });

    it('should handle multiple concurrent publishes', async () => {
      const messages = Array.from({ length: 10 }, (_, i) =>
        MessageBus.createMessage(MessageType.HEARTBEAT, 'agent-1', { index: i })
      );

      await Promise.all(messages.map((msg) => messageBus.publish('test-channel', msg)));

      const channelMessages = redisClient.getMessages('test-channel');
      expect(channelMessages).toHaveLength(10);
    });
  });
});
