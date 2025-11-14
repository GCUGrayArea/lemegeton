# System Patterns

## Architecture Patterns

### Singleton Pattern
- Used for default Redis client and auto-spawner
- Ensures single connection and prevents resource leaks
- Reset functions provided for testing

### Adapter Pattern
- Memory bank uses adapter pattern for future vector DB migration
- FileMemoryAdapter for Phase 0.1a, VectorMemoryAdapter stub for Phase 1.0+

### Event-Driven Architecture
- State machine emits events for all transitions
- Redis client emits connection state changes
- Health checker emits health status changes
- Loose coupling between components

## Configuration Patterns

### Hierarchical Configuration
```typescript
// Pattern: Environment > .env file > Defaults
const config = loadConfig({
  skipEnvFile?: boolean,
  overrides?: LemegetonConfig
});
```

### Configuration Validation
- Validate at load time, not runtime
- Comprehensive error messages
- Type-safe configuration with TypeScript

## Error Handling Patterns

### Graceful Degradation Chain
```typescript
// Pattern used in auto-spawn
try {
  // Try primary approach
} catch {
  try {
    // Try fallback
  } catch {
    // Final fallback or error
  }
}
```

### Promise Error Handling
```typescript
// Pattern for quit operations returning non-void
promise.quit()
  .then(() => undefined)  // Convert to void
  .catch(() => fallback?.disconnect())
```

## Testing Patterns

### Docker-Based Integration Testing
```typescript
// Pattern: Real infrastructure over mocks
(dockerAvailable ? it : it.skip)('test with Docker', async () => {
  // Test with real Redis container
});
```

### Port Management in Tests
```typescript
// Pattern: Find available port for each test
const port = await docker.findAvailablePort(16379);
const container = await docker.runContainer({
  ports: [{ host: port, container: 6379 }]
});
```

## Redis Patterns

### Connection Lifecycle
1. Create client with retry strategy
2. Connect main client
3. Duplicate for pub/sub clients
4. Graceful disconnect in reverse order

### Health Check Pattern
- Ping/pong for basic health
- Latency measurement for degraded detection
- Consecutive failure tracking before action
- Automatic recovery attempts

### Lease Management (Planned)
```typescript
// Atomic multi-file lease pattern
WATCH files
CHECK conflicts
MULTI
  SET lease:file1
  SET lease:file2
EXEC
```

## Docker Patterns

### Container Management
```typescript
// Pattern: Check, pull if needed, run, wait, verify
if (!imageExists(image)) {
  await pullImage(image);
}
const container = await runContainer(options);
await waitForContainer(container.id, { healthCheck });
```

### Cross-Platform Compatibility
- Detect platform-specific Docker socket
- Handle WSL2 vs native Windows
- Use `windowsHide: true` for exec commands

## TypeScript Patterns

### Non-Null Assertions
```typescript
// When defaults guarantee presence
config.redis.retry!.maxAttempts!
```

### Type Guards
```typescript
// State checking pattern
if (this.state === RedisConnectionState.CONNECTED) {
  // Safe to use client
}
```

### Required Type Pattern
```typescript
// Force all optional properties to be defined
type Required<T> = { [K in keyof T]-?: T[K] }
```

## Async Patterns

### Background Task Management
```typescript
// Pattern: Track timer for cleanup
private timer: NodeJS.Timeout | null = null;

start() {
  this.timer = setInterval(...);
}

stop() {
  if (this.timer) {
    clearInterval(this.timer);
    this.timer = null;
  }
}
```

### Connection State Machine
```
DISCONNECTED -> CONNECTING -> CONNECTED
     ^              |            |
     |              v            v
     +--------  RECONNECTING <- ERROR
```

## File System Patterns

### Atomic Write
```typescript
// Pattern: Write to temp, then rename
await fs.writeFile(`${path}.tmp`, content);
await fs.rename(`${path}.tmp`, path);
```

### Directory Creation
```typescript
// Pattern: Recursive mkdir with exist check
await fs.mkdir(dir, { recursive: true });
```