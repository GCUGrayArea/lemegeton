/**
 * Communication Types
 *
 * Defines message types, interfaces, and configuration for the message bus system.
 * Supports both Redis pub/sub and file-based messaging.
 */

import { CoordinationMode } from '../types/coordination';

/**
 * Message types for different communication patterns
 */
export enum MessageType {
  // Agent lifecycle
  REGISTRATION = 'registration',
  HEARTBEAT = 'heartbeat',
  SHUTDOWN = 'shutdown',

  // Work assignment
  ASSIGNMENT = 'assignment',
  PROGRESS = 'progress',
  COMPLETE = 'complete',
  FAILED = 'failed',

  // Coordination
  MODE_CHANGE = 'mode_change',
  LEASE_ACQUIRED = 'lease_acquired',
  LEASE_RELEASED = 'lease_released',

  // Custom
  CUSTOM = 'custom',
}

/**
 * Message priority levels
 */
export enum MessagePriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
}

/**
 * Base message interface
 */
export interface Message {
  /** Unique message ID */
  id: string;

  /** Unix timestamp (milliseconds) */
  timestamp: number;

  /** Message type */
  type: MessageType;

  /** Sender ID (hub or agent ID) */
  from: string;

  /** Recipient (agent ID for unicast, undefined for broadcast) */
  to?: string;

  /** Message payload */
  payload: any;

  /** Message priority (default: NORMAL) */
  priority?: MessagePriority;

  /** Time-to-live in milliseconds */
  ttl?: number;

  /** Correlation ID for request/response tracking */
  correlationId?: string;
}

/**
 * Message handler callback type
 */
export type MessageHandler = (message: Message) => void | Promise<void>;

/**
 * Message transport interface
 *
 * Abstraction for different messaging implementations (Redis, file-based, etc.)
 */
export interface IMessageTransport {
  /**
   * Connect to the transport
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the transport
   */
  disconnect(): Promise<void>;

  /**
   * Publish a message to a channel
   */
  publish(channel: string, message: Message): Promise<void>;

  /**
   * Subscribe to a channel
   */
  subscribe(channel: string, handler: MessageHandler): Promise<void>;

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(channel: string): Promise<void>;

  /**
   * Check if connected
   */
  isConnected(): boolean;

  /**
   * Get transport statistics
   */
  getStats(): TransportStats;
}

/**
 * Message bus interface
 */
export interface IMessageBus {
  /**
   * Start the message bus
   */
  start(): Promise<void>;

  /**
   * Stop the message bus
   */
  stop(): Promise<void>;

  /**
   * Publish a message to a channel
   */
  publish(channel: string, message: Message): Promise<void>;

  /**
   * Publish a message to a specific agent
   */
  publishToAgent(agentId: string, message: Message): Promise<void>;

  /**
   * Broadcast a message to all agents
   */
  broadcast(message: Message): Promise<void>;

  /**
   * Subscribe to a channel
   */
  subscribe(channel: string, handler: MessageHandler): Promise<void>;

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(channel: string): Promise<void>;

  /**
   * Unsubscribe from all channels
   */
  unsubscribeAll(): Promise<void>;

  /**
   * Check if connected
   */
  isConnected(): boolean;

  /**
   * Get current coordination mode
   */
  getMode(): CoordinationMode;

  /**
   * Get message bus statistics
   */
  getStats(): MessageBusStats;
}

/**
 * Transport statistics
 */
export interface TransportStats {
  /** Total messages published */
  messagesPublished: number;

  /** Total messages received */
  messagesReceived: number;

  /** Active subscriptions */
  activeSubscriptions: number;

  /** Connection state */
  connected: boolean;

  /** Transport type */
  type: 'redis' | 'file';

  /** Additional transport-specific stats */
  custom?: Record<string, any>;
}

/**
 * Message bus statistics
 */
export interface MessageBusStats {
  /** Current coordination mode */
  mode: CoordinationMode;

  /** Is currently transitioning between modes */
  isTransitioning: boolean;

  /** Pending messages during transition */
  pendingMessages: number;

  /** Total mode transitions */
  modeTransitions: number;

  /** Active transport stats */
  transport: TransportStats;

  /** Message delivery metrics */
  delivery: {
    totalSent: number;
    totalReceived: number;
    totalFailed: number;
    avgLatencyMs: number;
  };
}

/**
 * Message bus configuration
 */
export interface MessageBusConfig {
  // Redis pub/sub settings
  /** Persist messages to Redis streams for recovery */
  persistMessages?: boolean;

  /** Maximum number of messages in stream before trimming */
  maxStreamLength?: number;

  // File messaging settings
  /** Base directory for file-based messaging */
  fileMessagingDir?: string;

  /** Polling interval for file-based messaging (ms) */
  pollingInterval?: number;

  /** Delete message files after processing */
  deleteProcessedMessages?: boolean;

  /** Maximum age of messages before cleanup (ms) */
  messageMaxAge?: number;

  // General settings
  /** Maximum pending messages during mode transitions */
  maxPendingMessages?: number;

  /** Message TTL (ms) */
  messageTimeout?: number;

  /** Number of retry attempts for failed deliveries */
  retryAttempts?: number;

  /** Retry delay with exponential backoff (ms) */
  retryDelay?: number;
}

/**
 * Default message bus configuration
 */
export const DEFAULT_MESSAGE_BUS_CONFIG: Required<MessageBusConfig> = {
  // Redis settings
  persistMessages: true,
  maxStreamLength: 1000,

  // File messaging settings
  fileMessagingDir: '.lemegeton/messages',
  pollingInterval: 1000,  // 1 second
  deleteProcessedMessages: false,  // Keep for debugging
  messageMaxAge: 3600000,  // 1 hour

  // General settings
  maxPendingMessages: 100,
  messageTimeout: 60000,  // 1 minute
  retryAttempts: 3,
  retryDelay: 1000,  // 1 second
};

/**
 * Channel naming utilities
 */
export class ChannelNames {
  /**
   * Get agent-specific channel name
   */
  static agent(agentId: string): string {
    return `agent-${agentId}`;
  }

  /**
   * Get broadcast channel name
   */
  static broadcast(): string {
    return 'hub-broadcast';
  }

  /**
   * Get hub channel name
   */
  static hub(): string {
    return 'hub';
  }

  /**
   * Get coordination channel name
   */
  static coordination(event: string): string {
    return `coordination:${event}`;
  }

  /**
   * Get system channel name
   */
  static system(event: string): string {
    return `system:${event}`;
  }

  /**
   * Check if channel is agent-specific
   */
  static isAgentChannel(channel: string): boolean {
    return channel.startsWith('agent-');
  }

  /**
   * Extract agent ID from channel name
   */
  static extractAgentId(channel: string): string | null {
    if (!this.isAgentChannel(channel)) {
      return null;
    }
    return channel.substring(6);  // Remove 'agent-' prefix
  }
}

/**
 * Message ID generator
 */
export class MessageIdGenerator {
  private static counter = 0;

  /**
   * Generate a unique message ID
   */
  static generate(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9);
    const counter = (++this.counter).toString(36);
    return `${timestamp}-${counter}-${random}`;
  }
}

/**
 * Queued message during mode transitions
 */
export interface QueuedMessage {
  channel: string;
  message: Message;
  timestamp: number;
  attempts: number;
}

/**
 * Message delivery result
 */
export interface MessageDeliveryResult {
  success: boolean;
  messageId: string;
  error?: Error;
  latencyMs?: number;
}
