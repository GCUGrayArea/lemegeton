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

### Adversarial Testing Pattern

**Philosophy**: Implementation and tests are written by DIFFERENT agents on SEPARATE PRs to prevent "tests written to pass" failure mode.

**Pattern Structure**:
```
Implementation PR (PR-015) → Test PR (PR-016) → Fix PR (PR-015 reopened)
   Worker Agent                Test Agent           Worker Agent

   Writes code        →    Tries to break it  →   Fixes bugs found
   (no tests)              (no impl changes)       (impl only)
```

**Core Rules**:

Implementation Agents (FORBIDDEN):
- Write, modify, or create ANY test files (`*.test.ts`, `*.spec.ts`, `tests/*`)
- Add test cases to existing test suites
- Fix failing tests by modifying test code
- Think about "making tests pass" during implementation

Implementation Agents (REQUIRED):
- Implement exactly to specification
- Handle edge cases in implementation logic
- For BROKEN PRs: Fix implementation to match test expectations

Test Agents (FORBIDDEN):
- Modify implementation code to make tests pass
- Skip edge cases because they're "hard to test"
- Write tests that just verify current behavior
- Make tests pass by lowering coverage requirements

Test Agents (REQUIRED):
- Study implementation critically - assume it has bugs
- Test edge cases implementation might have missed:
  - Boundary values (0, -1, MAX_INT, empty, null, undefined)
  - Invalid inputs (wrong types, malformed data)
  - Race conditions and timing issues
  - Resource exhaustion
  - Error scenarios (network failures, permissions, etc.)
- Write tests that SHOULD pass if implementation is correct
- Don't care if tests fail initially - that's the point
- Focus on whether test makes sense, not whether it passes
- Achieve >90% coverage for critical paths

**Success Metrics**:
- Finding bugs in implementation (tests fail initially) = GOOD
- All tests pass immediately = SUSPICIOUS (tests too weak?)
- High edge case coverage = EXCELLENT
- Tests find issues implementation author missed = IDEAL

**Workflow Example**:

1. **Implementation PR (PR-015)**:
   ```typescript
   // Worker agent implements feature
   // src/auth/AuthService.ts
   export class AuthService {
     login(email: string, password: string) {
       // Implementation without null check
       return this.validateCredentials(email.toLowerCase(), password);
     }
   }
   ```
   Status: Committed, marked `completed`

2. **Test PR (PR-016)** (depends on PR-015):
   ```typescript
   // Test agent tries to break it
   // tests/auth/AuthService.test.ts
   describe('AuthService.login', () => {
     it('should throw ValidationError when email is null', () => {
       expect(() => authService.login(null, 'password'))
         .toThrow(ValidationError);
     });

     it('should handle SQL injection attempt in username', () => {
       const malicious = "admin'; DROP TABLE users; --";
       expect(() => authService.login(malicious, 'pass'))
         .toThrow(ValidationError);
     });
   });
   ```
   Tests FAIL → discovers null pointer bug
   Status: Marks PR-015 as `broken`, documents bug

3. **Fix Implementation (PR-015 reopened)**:
   ```typescript
   // Worker agent (same or different) fixes bugs
   export class AuthService {
     login(email: string, password: string) {
       if (!email || !password) {
         throw new ValidationError('Email and password required');
       }
       // Added SQL injection protection
       if (this.containsSQLInjection(email)) {
         throw new ValidationError('Invalid email format');
       }
       return this.validateCredentials(email.toLowerCase(), password);
     }
   }
   ```
   Status: Tests now pass, PR-015 marked `completed` again

**Benefits**:
- Prevents confirmation bias (different agents, different goals)
- Finds more bugs (adversarial mindset)
- Better code quality (can't cheat with weak tests)
- Clear responsibilities (implementation vs test ownership)
- Realistic testing (tests reflect real-world usage including misuse)

**Test Failure Response**:
When tests fail:
1. **Implementation bug?** → Document and mark PR broken (GOOD!)
2. **Test config issue?** → Fix your mocks/imports/setup
3. **Spec ambiguity?** → Escalate for clarification

**Edge Case Categories**:
- Boundary values: Zero, negative, MAX_INT, empty, null, undefined
- Invalid inputs: Wrong types, malformed data, special characters
- Error scenarios: Network failures, file system errors, database errors
- Concurrency: Race conditions, deadlocks, state changes mid-operation
- Resource limits: Large inputs, memory pressure, deep recursion

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

### Lease Management (Implemented)
```typescript
// Atomic multi-file lease pattern with WATCH
await executeAtomic(client, watchKeys, async (multi) => {
  // Build transaction
  multi.set(leaseKey1, metadata, { NX: true, EX: ttl });
  multi.set(leaseKey2, metadata, { NX: true, EX: ttl });
  multi.sAdd(agentSetKey, [file1, file2]);
  multi.sAdd(prSetKey, [file1, file2]);
});
```

### Paired File Locking
```typescript
// Automatically detect and lock test files with source
const paired = await expandWithPairedFiles(files, patterns, checkExists);
// paired.all contains both source and test files
```

### Heartbeat Pattern
```typescript
// Background heartbeat for lease renewal
private startHeartbeat() {
  this.heartbeatTimer = setInterval(async () => {
    await this.renewAllLeases();
    this.emit('heartbeat', { files: this.activeLeases });
  }, HEARTBEAT_INTERVAL);
}
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

### Accessing Wrapped Clients
```typescript
// Pattern: execute() wrapper for Redis operations
await this.redisClient.execute(async (client) => {
  await client.set('key', 'value');
  await client.zAdd('sorted', [{ score: 1, value: 'item' }]);
  return await client.get('key');
});
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