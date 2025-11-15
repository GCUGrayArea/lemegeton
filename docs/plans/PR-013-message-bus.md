# PR-013: Message Bus Implementation - Detailed Plan

**Status:** In Progress
**Priority:** High
**Complexity:** 5/10
**Estimated Time:** 50 minutes
**Dependencies:** PR-004 (Redis Client), PR-006 (Coordination Mode Manager), PR-011 (Base Agent)

---

## Overview

Implement a dual-mode message bus system for hub-agent communication that seamlessly switches between Redis pub/sub (distributed/degraded modes) and file-based messaging (isolated mode). The message bus must integrate with CoordinationModeManager and support both unicast (agent-specific) and broadcast messaging patterns.

---

## Architecture

### Component Structure

```
src/communication/
├── messageBus.ts         - Message bus abstraction layer
├── redisPubSub.ts        - Redis pub/sub implementation
├── fileMessaging.ts      - File-based messaging fallback
└── types.ts              - Message types and interfaces

tests/
└── messageBus.test.ts    - Comprehensive tests
```

### Message Flow

```
┌─────────────────────────────────────────────────────────────┐
│                      Message Bus                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Mode Detection (from CoordinationModeManager)        │   │
│  └──────────────────────────────────────────────────────┘   │
│                            │                                 │
│         ┌──────────────────┴──────────────────┐             │
│         ▼                                      ▼             │
│  ┌─────────────┐                      ┌─────────────┐       │
│  │ RedisPubSub │                      │FileMessaging│       │
│  │ (DIST/DEG)  │                      │ (ISOLATED)  │       │
│  └─────────────┘                      └─────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### Channel Naming Convention

- **Unicast (agent-specific):** `agent-{agentId}`
  - Example: `agent-alice-agent-1`
- **Broadcast (all agents):** `hub-broadcast`
- **Coordination events:** `coordination:mode_change`
- **System events:** `system:*`

---

## Data Models

### Message Types

```typescript
// Base message interface
interface Message {
  id: string;              // Unique message ID
  timestamp: number;       // Unix timestamp
  type: MessageType;       // Message type
  from: string;            // Sender ID (hub or agent ID)
  to?: string;             // Recipient (agent ID for unicast, undefined for broadcast)
  payload: any;            // Message payload
  priority?: MessagePriority;
  ttl?: number;            // Time-to-live in milliseconds
}

// Message types
enum MessageType {
  ASSIGNMENT = 'assignment',
  PROGRESS = 'progress',
  COMPLETE = 'complete',
  FAILED = 'failed',
  HEARTBEAT = 'heartbeat',
  MODE_CHANGE = 'mode_change',
  SHUTDOWN = 'shutdown',
  CUSTOM = 'custom',
}

// Message priority
enum MessagePriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
}

// Subscription callback
type MessageHandler = (message: Message) => void | Promise<void>;
```

### Message Bus Interface

```typescript
interface IMessageBus {
  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;

  // Publishing
  publish(channel: string, message: Message): Promise<void>;
  publishToAgent(agentId: string, message: Message): Promise<void>;
  broadcast(message: Message): Promise<void>;

  // Subscribing
  subscribe(channel: string, handler: MessageHandler): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  unsubscribeAll(): Promise<void>;

  // State
  isConnected(): boolean;
  getMode(): CoordinationMode;
  getStats(): MessageBusStats;
}
```

---

## Implementation Details

### 1. Message Bus Abstraction (`messageBus.ts`)

**Purpose:** Unified interface that delegates to Redis or file-based messaging based on coordination mode.

**Key Features:**
- Integrates with `CoordinationModeManager` to detect mode changes
- Automatically switches transport layer (Redis ↔ File) on mode transitions
- Message queuing during mode transitions
- Message persistence for recovery
- Retry logic for failed deliveries

**Implementation Strategy:**
```typescript
export class MessageBus extends EventEmitter implements IMessageBus {
  private mode: CoordinationMode;
  private redisPubSub: RedisPubSub | null = null;
  private fileMessaging: FileMessaging | null = null;
  private modeManager: CoordinationModeManager;
  private pendingMessages: Message[] = [];
  private subscriptions: Map<string, Set<MessageHandler>> = new Map();

  constructor(
    redisClient: RedisClient | null,
    modeManager: CoordinationModeManager,
    config: MessageBusConfig
  ) {
    super();
    this.modeManager = modeManager;
    this.mode = modeManager.getMode();

    // Initialize both transports
    if (redisClient) {
      this.redisPubSub = new RedisPubSub(redisClient, config);
    }
    this.fileMessaging = new FileMessaging(config);

    // Subscribe to mode changes
    this.modeManager.on('modeChanged', this.handleModeChange.bind(this));
  }

  async start(): Promise<void> {
    // Start appropriate transport based on current mode
    await this.switchTransport(this.mode);
  }

  async publish(channel: string, message: Message): Promise<void> {
    // Add to pending queue during transitions
    if (this.isTransitioning) {
      this.pendingMessages.push({ channel, message });
      return;
    }

    // Delegate to active transport
    const transport = this.getActiveTransport();
    await transport.publish(channel, message);
  }

  private async handleModeChange(from: CoordinationMode, to: CoordinationMode): Promise<void> {
    // Pause publishing during transition
    this.isTransitioning = true;

    // Switch transport
    await this.switchTransport(to);

    // Flush pending messages
    await this.flushPendingMessages();

    this.isTransitioning = false;
  }

  private getActiveTransport(): IMessageTransport {
    if (this.mode === CoordinationMode.ISOLATED) {
      return this.fileMessaging!;
    }
    return this.redisPubSub!;
  }
}
```

---

### 2. Redis Pub/Sub Implementation (`redisPubSub.ts`)

**Purpose:** Redis-based messaging for distributed and degraded coordination modes.

**Key Features:**
- Uses Redis pub/sub for real-time message delivery
- Separate clients for publishing and subscribing (Redis requirement)
- Pattern-based subscriptions for routing
- Connection health monitoring
- Message persistence using Redis streams for recovery

**Implementation Strategy:**
```typescript
export class RedisPubSub extends EventEmitter implements IMessageTransport {
  private redisClient: RedisClient;
  private pubClient: LemegetonRedisClient;
  private subClient: LemegetonRedisClient;
  private subscriptions: Map<string, Set<MessageHandler>> = new Map();
  private messageHistory: Message[] = [];  // For recovery

  constructor(redisClient: RedisClient, config: MessageBusConfig) {
    super();
    this.redisClient = redisClient;
    this.config = config;
  }

  async connect(): Promise<void> {
    // Get dedicated pub/sub clients from RedisClient
    this.pubClient = this.redisClient.getPubClient();
    this.subClient = this.redisClient.getSubClient();

    // Setup error handlers
    this.setupErrorHandlers();
  }

  async publish(channel: string, message: Message): Promise<void> {
    // Serialize message
    const payload = JSON.stringify(message);

    // Publish to Redis
    await this.pubClient.publish(channel, payload);

    // Persist to stream for recovery
    if (this.config.persistMessages) {
      await this.persistMessage(channel, message);
    }

    // Track in history
    this.addToHistory(message);
  }

  async subscribe(channel: string, handler: MessageHandler): Promise<void> {
    // Add handler to subscription map
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());

      // Subscribe to Redis channel
      await this.subClient.subscribe(channel, (rawMessage: string) => {
        this.handleMessage(channel, rawMessage);
      });
    }

    this.subscriptions.get(channel)!.add(handler);
  }

  private handleMessage(channel: string, rawMessage: string): void {
    try {
      const message: Message = JSON.parse(rawMessage);

      // Call all handlers for this channel
      const handlers = this.subscriptions.get(channel);
      if (handlers) {
        handlers.forEach(handler => {
          try {
            handler(message);
          } catch (error) {
            this.emit('handlerError', { channel, message, error });
          }
        });
      }
    } catch (error) {
      this.emit('parseError', { channel, rawMessage, error });
    }
  }

  private async persistMessage(channel: string, message: Message): Promise<void> {
    // Use Redis streams for message persistence
    await this.pubClient.xAdd(
      `message-stream:${channel}`,
      '*',
      {
        id: message.id,
        timestamp: message.timestamp.toString(),
        type: message.type,
        from: message.from,
        to: message.to || '',
        payload: JSON.stringify(message.payload),
      },
      {
        TRIM: {
          strategy: 'MAXLEN',
          threshold: this.config.maxStreamLength || 1000,
          strategyModifier: '~',
        }
      }
    );
  }

  async getMessageHistory(channel: string, count: number = 100): Promise<Message[]> {
    // Retrieve from stream
    const entries = await this.pubClient.xRevRange(
      `message-stream:${channel}`,
      '+',
      '-',
      { COUNT: count }
    );

    return entries.map(entry => this.parseStreamEntry(entry));
  }
}
```

---

### 3. File-Based Messaging (`fileMessaging.ts`)

**Purpose:** File-based messaging fallback for isolated coordination mode when Redis is unavailable.

**Key Features:**
- Uses file system for message passing between processes
- Polling-based message delivery
- Directory-based channel organization
- Message cleanup and rotation
- Works without any network infrastructure

**Implementation Strategy:**
```typescript
export class FileMessaging extends EventEmitter implements IMessageTransport {
  private baseDir: string;
  private pollingInterval: number;
  private subscriptions: Map<string, Set<MessageHandler>> = new Map();
  private pollers: Map<string, NodeJS.Timeout> = new Map();
  private processedMessageIds: Set<string> = new Set();

  constructor(config: MessageBusConfig) {
    super();
    this.baseDir = config.fileMessagingDir || '.lemegeton/messages';
    this.pollingInterval = config.pollingInterval || 1000;  // 1 second
  }

  async connect(): Promise<void> {
    // Ensure message directories exist
    await fs.mkdir(this.baseDir, { recursive: true });

    // Create channel directories
    await this.createChannelDirs();
  }

  async publish(channel: string, message: Message): Promise<void> {
    const channelDir = path.join(this.baseDir, this.sanitizeChannel(channel));
    await fs.mkdir(channelDir, { recursive: true });

    // Write message to file
    const filename = `${message.timestamp}-${message.id}.json`;
    const filepath = path.join(channelDir, filename);

    await fs.writeFile(filepath, JSON.stringify(message, null, 2), 'utf-8');

    // Cleanup old messages
    await this.cleanupOldMessages(channelDir);
  }

  async subscribe(channel: string, handler: MessageHandler): Promise<void> {
    // Add handler to subscription map
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());

      // Start polling this channel
      this.startPolling(channel);
    }

    this.subscriptions.get(channel)!.add(handler);
  }

  private startPolling(channel: string): void {
    const poller = setInterval(async () => {
      await this.pollChannel(channel);
    }, this.pollingInterval);

    this.pollers.set(channel, poller);
  }

  private async pollChannel(channel: string): Promise<void> {
    const channelDir = path.join(this.baseDir, this.sanitizeChannel(channel));

    try {
      // Read all message files
      const files = await fs.readdir(channelDir);

      // Sort by timestamp (filename format: timestamp-id.json)
      files.sort();

      // Process each message
      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filepath = path.join(channelDir, file);
        const content = await fs.readFile(filepath, 'utf-8');
        const message: Message = JSON.parse(content);

        // Skip if already processed
        if (this.processedMessageIds.has(message.id)) {
          continue;
        }

        // Mark as processed
        this.processedMessageIds.add(message.id);

        // Call handlers
        const handlers = this.subscriptions.get(channel);
        if (handlers) {
          handlers.forEach(handler => {
            try {
              handler(message);
            } catch (error) {
              this.emit('handlerError', { channel, message, error });
            }
          });
        }

        // Delete processed message (optional - based on config)
        if (this.config.deleteProcessedMessages) {
          await fs.unlink(filepath);
        }
      }
    } catch (error) {
      // Channel directory might not exist yet
      if ((error as any).code !== 'ENOENT') {
        this.emit('pollError', { channel, error });
      }
    }
  }

  private async cleanupOldMessages(channelDir: string): Promise<void> {
    const maxAge = this.config.messageMaxAge || 3600000; // 1 hour default
    const now = Date.now();

    const files = await fs.readdir(channelDir);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filepath = path.join(channelDir, file);
      const stats = await fs.stat(filepath);

      // Delete if older than maxAge
      if (now - stats.mtimeMs > maxAge) {
        await fs.unlink(filepath);
      }
    }
  }

  private sanitizeChannel(channel: string): string {
    // Convert channel name to safe directory name
    return channel.replace(/[^a-zA-Z0-9-_]/g, '_');
  }

  async disconnect(): Promise<void> {
    // Stop all pollers
    this.pollers.forEach(poller => clearInterval(poller));
    this.pollers.clear();
    this.subscriptions.clear();
  }
}
```

---

## Integration Points

### 1. With CoordinationModeManager (PR-006)

```typescript
// In MessageBus constructor
this.modeManager.on('modeChanged', async (from, to) => {
  await this.switchTransport(to);
  this.emit('transportSwitched', { from, to });
});
```

### 2. With RedisClient (PR-004)

```typescript
// MessageBus uses existing RedisClient for pub/sub
const redisClient = getDefaultRedisClient();
await redisClient.connect();

const messageBus = new MessageBus(
  redisClient,
  coordinationModeManager,
  config
);
```

### 3. With BaseAgent (PR-011)

```typescript
// Update BaseAgent to use MessageBus
export class BaseAgent extends EventEmitter {
  private messageBus: MessageBus;

  async start(): Promise<void> {
    // Subscribe to agent-specific channel
    await this.messageBus.subscribe(
      `agent-${this.agentId}`,
      this.handleMessage.bind(this)
    );

    // Subscribe to broadcast channel
    await this.messageBus.subscribe(
      'hub-broadcast',
      this.handleBroadcast.bind(this)
    );
  }

  async sendToHub(message: AgentMessage): Promise<void> {
    await this.messageBus.publish('hub', {
      id: generateId(),
      timestamp: Date.now(),
      type: MessageType.CUSTOM,
      from: this.agentId,
      to: 'hub',
      payload: message,
    });
  }
}
```

---

## Testing Strategy

### Unit Tests

1. **Message Bus Core**
   - Mode switching (distributed → degraded → isolated)
   - Message queuing during transitions
   - Subscription management
   - Error handling

2. **Redis Pub/Sub**
   - Publishing to channels
   - Subscribing to channels
   - Pattern subscriptions
   - Message persistence
   - Connection recovery

3. **File Messaging**
   - File creation and reading
   - Polling mechanism
   - Message cleanup
   - Channel isolation
   - Concurrent access

### Integration Tests

1. **Mode Transitions**
   - Seamless switch from Redis to file-based
   - Message delivery during transitions
   - No message loss
   - Subscription preservation

2. **End-to-End Message Flow**
   - Hub → Agent unicast
   - Hub → All Agents broadcast
   - Agent → Hub responses
   - Coordination events

3. **Performance Tests**
   - Latency in Redis mode (< 10ms target)
   - Throughput in Redis mode (> 1000 msg/sec target)
   - File-based polling overhead (< 100ms latency)
   - Memory usage under load

### Test Coverage Target

- **Overall:** > 90%
- **Critical paths:** 100% (mode switching, message delivery)
- **Error scenarios:** Full coverage

---

## Configuration

```typescript
interface MessageBusConfig {
  // Redis pub/sub settings
  persistMessages?: boolean;        // Persist to streams
  maxStreamLength?: number;         // Stream trim threshold

  // File messaging settings
  fileMessagingDir?: string;        // Base directory
  pollingInterval?: number;         // Poll frequency (ms)
  deleteProcessedMessages?: boolean; // Cleanup after processing
  messageMaxAge?: number;           // Max age before cleanup (ms)

  // General settings
  maxPendingMessages?: number;      // Queue size during transitions
  messageTimeout?: number;          // Message TTL (ms)
  retryAttempts?: number;           // Retry count
  retryDelay?: number;              // Retry backoff (ms)
}
```

---

## Performance Targets

### Redis Pub/Sub Mode (Distributed/Degraded)

- **Latency:** < 10ms for message delivery
- **Throughput:** > 1000 messages/second
- **Memory:** < 100MB for 10,000 messages in history

### File-Based Mode (Isolated)

- **Latency:** < 100ms for message delivery (polling overhead)
- **Throughput:** > 100 messages/second
- **Disk Usage:** Auto-cleanup keeps usage < 10MB

---

## Migration Strategy

### Phase 1: Basic Implementation (This PR)
- Message bus abstraction
- Redis pub/sub transport
- File-based transport
- Basic mode switching
- Core tests

### Phase 2: Optimization (PR-014+)
- Message compression
- Batching for file-based mode
- Advanced retry logic
- Performance monitoring
- Metrics collection

### Phase 3: Advanced Features (v1.0+)
- Message encryption
- Priority queues
- Dead letter queues
- Message tracing
- Admin dashboard

---

## Acceptance Criteria Checklist

- [ ] Redis pub/sub works in distributed mode
- [ ] Redis pub/sub works in degraded mode
- [ ] File-based messaging works in isolated mode
- [ ] Message routing correct (unicast and broadcast)
- [ ] Broadcast capabilities work
- [ ] Message persistence for recovery
- [ ] Performance acceptable (< 10ms latency in Redis mode)
- [ ] Seamless mode switching
- [ ] No message loss during transitions
- [ ] Integration with CoordinationModeManager verified
- [ ] Integration with BaseAgent verified
- [ ] Tests passing with > 90% coverage
- [ ] Documentation complete

---

## Implementation Order

1. **Types and Interfaces** (`types.ts`)
   - Define Message, MessageType, MessageHandler interfaces
   - Define IMessageBus and IMessageTransport interfaces
   - Define configuration types

2. **Redis Pub/Sub** (`redisPubSub.ts`)
   - Implement publish/subscribe using existing RedisClient
   - Add message persistence with streams
   - Add error handling and recovery

3. **File Messaging** (`fileMessaging.ts`)
   - Implement file-based publish
   - Implement polling-based subscribe
   - Add cleanup logic

4. **Message Bus** (`messageBus.ts`)
   - Implement transport abstraction
   - Implement mode switching logic
   - Implement message queuing during transitions
   - Integrate with CoordinationModeManager

5. **Tests** (`messageBus.test.ts`)
   - Unit tests for each component
   - Integration tests for mode switching
   - Performance tests
   - Edge case coverage

6. **Integration** (Update existing files)
   - Update BaseAgent to use MessageBus
   - Update CommunicationManager stub
   - Update Hub to use MessageBus

---

## Risk Assessment

### High Risk
- **Mode transition message loss:** Mitigated by message queuing
- **Redis pub/sub client management:** Use existing RedisClient abstraction

### Medium Risk
- **File-based polling performance:** Mitigated by configurable intervals
- **Concurrent file access:** Use atomic file operations

### Low Risk
- **Message serialization errors:** JSON with schema validation
- **Channel naming conflicts:** Strict naming convention

---

## Success Metrics

1. **Functional:** All acceptance criteria met
2. **Performance:** Redis mode < 10ms latency, file mode < 100ms
3. **Reliability:** Zero message loss in mode transitions
4. **Test Coverage:** > 90% overall, 100% critical paths
5. **Integration:** Works seamlessly with PR-004, PR-006, PR-011

---

## Notes

- **Redis streams** used for message persistence (better than lists)
- **Pattern subscriptions** allow flexible routing (e.g., `agent-*`)
- **File polling** is acceptable for isolated mode (rare edge case)
- **Message IDs** ensure deduplication across transports
- **TTL support** prevents message accumulation

---

**Plan Status:** Ready for implementation
**Next Step:** Begin implementation with types.ts
