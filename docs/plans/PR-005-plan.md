# PR-005: File Lease System

## Overview
PR-005 implements atomic file lease acquisition using Redis MULTI/EXEC transactions. This is also a complexity 8 (Opus-level) PR due to the critical need for atomicity, race condition handling, and complex edge cases around paired locking for test files.

## Key Implementation Details

### 1. Lease Manager Core (`src/core/leaseManager.ts`)
- Main interface for lease acquisition and release
- Track leases by agent ID and PR ID
- Implement lease renewal (heartbeat every 2 minutes for 5-minute TTL)
- Handle bulk lease operations (multiple files atomically)
- Provide conflict information when lease acquisition fails

### 2. Atomic Operations (`src/core/atomicOps.ts`)
- Use Redis MULTI/EXEC for atomic transactions
- Implement optimistic locking with WATCH
- Retry logic for transaction conflicts
- Key structure: `lease:file:{filepath}` → `{agentId, prId, timestamp, ttl}`
- Use Redis SET with NX (only if not exists) and EX (expiration)

### 3. Paired Locking Logic (`src/core/pairedLocking.ts`)
- Automatically detect test files for source files
- Common patterns:
  - `src/foo.ts` → `tests/foo.test.ts`
  - `src/foo.ts` → `src/foo.spec.ts`
  - `lib/bar.js` → `test/bar.test.js`
- Lock both source and test files atomically
- Configuration for project-specific test patterns
- Handle missing test files gracefully (no error if test doesn't exist)

### 4. Lease Operations Flow
```typescript
// Acquisition pattern
async function acquireLease(files: string[], agentId: string, prId: string): Promise<LeaseResult> {
  // 1. Expand files to include paired test files
  const allFiles = expandWithTestFiles(files);

  // 2. Start Redis transaction
  const multi = redis.multi();

  // 3. WATCH all files for changes
  await redis.watch(allFiles.map(f => `lease:file:${f}`));

  // 4. Check current lease holders
  const currentLeases = await checkCurrentLeases(allFiles);
  if (hasConflicts(currentLeases)) {
    return { success: false, conflicts: currentLeases };
  }

  // 5. Set all leases atomically
  for (const file of allFiles) {
    multi.set(`lease:file:${file}`, JSON.stringify({
      agentId,
      prId,
      timestamp: Date.now(),
      ttl: 300000 // 5 minutes
    }), 'NX', 'EX', 300);
  }

  // 6. Execute transaction
  const result = await multi.exec();
  return result ? { success: true } : { success: false, reason: 'transaction_conflict' };
}
```

### 5. Heartbeat System
- Background timer every 2 minutes
- Batch renewal of all held leases
- Graceful handling if Redis unavailable
- Emit events on lease expiration

### 6. Edge Cases to Handle
- Agent crashes (leases expire after 5 minutes)
- Redis restarts (re-acquire leases on reconnection)
- Clock skew between agents
- Concurrent acquisition attempts
- Lease transfer between agents (for handoffs)

## Testing Strategy
- Test concurrent acquisition scenarios
- Verify atomic behavior with conflicting requests
- Test paired file locking logic
- Verify TTL and heartbeat behavior
- Test failure recovery scenarios

## Redis Key Schema
```
lease:file:{filepath} = {
  agentId: string,
  prId: string,
  timestamp: number,
  ttl: number
}

lease:agent:{agentId} = Set<filepath>  // Track all leases per agent
lease:pr:{prId} = Set<filepath>        // Track all leases per PR
```

## Implementation Order
1. Design Redis key schema
2. Implement atomic operations wrapper
3. Build lease manager core
4. Add paired file detection logic
5. Implement heartbeat system
6. Add comprehensive error handling
7. Write stress tests for concurrent access

## Critical Success Factors
- Must guarantee atomicity - no partial lease acquisitions ever
- Paired file locking must be reliable
- Heartbeat system must be resilient to temporary Redis outages