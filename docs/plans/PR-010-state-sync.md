# PR-010: State Synchronization System

## Implementation Plan

**Status:** Planning Complete
**Estimated Complexity:** 6/10 (60 minutes)
**Dependencies:** PR-003 (State Machine), PR-004 (Redis Client), PR-009 (Task List Parser)

---

## Overview

Implement bidirectional state synchronization between Redis (hot state) and git (cold state) with proper reconciliation, crash recovery, and clean git history.

### Key Principles

1. **Cold state changes commit to git immediately (event-driven)**
2. **Hot state updates Redis only (no git commits)**
3. **30-second sync cycle for display updates** (not state changes)
4. **Crash recovery by reconstructing from git**
5. **Clean git history (only milestone commits)**

---

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Hub Daemon                              │
│                                                              │
│  ┌────────────────┐      ┌──────────────────┐              │
│  │  State Sync    │◄────►│  State Machine   │              │
│  │  Coordinator   │      │  (PR-003)        │              │
│  └────────┬───────┘      └──────────────────┘              │
│           │                                                  │
│           │                                                  │
│  ┌────────▼───────┐      ┌──────────────────┐              │
│  │   Git Ops      │      │   Redis Ops      │              │
│  │  (cold state)  │      │   (hot state)    │              │
│  └────────┬───────┘      └─────────┬────────┘              │
│           │                         │                        │
└───────────┼─────────────────────────┼────────────────────────┘
            │                         │
            │                         │
    ┌───────▼───────┐         ┌──────▼──────┐
    │  Git Repo     │         │   Redis     │
    │ (task-list.md)│         │   (cache)   │
    └───────────────┘         └─────────────┘
```

### Data Flow

**Cold State Transition (Event-Driven):**
```
Agent → StateMachine.transition()
    → GitOps.commitColdStateChange()
    → Git commit (task-list.md updated)
    → RedisOps.updateColdState() (sync cache)
```

**Hot State Transition (No Commit):**
```
Agent → StateMachine.transition()
    → RedisOps.updateHotState()
    → No git commit
```

**Display Sync (30-second cycle):**
```
StateSync.syncDisplayStates()
    → Read hot states from Redis
    → Update markdown display in task-list.md (NOT frontmatter)
    → Git commit with "Display sync" message
```

**Crash Recovery:**
```
Hub.start()
    → GitOps.loadFromGit()
    → Parse task-list.md
    → RedisOps.hydrateFromGit()
    → Clear orphaned hot states
```

---

## Component Breakdown

### 1. StateSync (Coordinator)

**File:** `src/sync/stateSync.ts`

**Responsibilities:**
- Coordinate between GitOps and RedisOps
- Run 30-second sync cycle for display updates
- Handle crash recovery on startup
- Trigger reconciliation when needed

**Key Methods:**
```typescript
class StateSync {
  // Initialization
  async initialize(): Promise<void>
  async hydrateRedisFromGit(): Promise<void>

  // Sync cycles
  async syncDisplayStates(): Promise<void>  // 30-second cycle
  async syncColdState(prId: string): Promise<void>  // Event-driven
  async syncHotState(prId: string): Promise<void>   // Event-driven

  // Recovery
  async recoverFromCrash(): Promise<void>
  async clearOrphanedStates(): Promise<void>

  // Reconciliation
  async reconcileConflict(prId: string): Promise<void>
}
```

**State Sync Cycle Logic:**
```typescript
async syncDisplayStates(): Promise<void> {
  // 1. Get all PRs with hot states from Redis
  const hotStates = await this.redisOps.getAllHotStates();

  // 2. Update display section in task-list.md (NOT frontmatter)
  //    This is purely for human visibility
  const displayUpdates = this.formatDisplayUpdates(hotStates);

  // 3. Commit with special marker (not a state change commit)
  if (displayUpdates.length > 0) {
    await this.gitOps.commitDisplaySync(displayUpdates);
  }
}
```

### 2. GitOps (Cold State Management)

**File:** `src/sync/gitOps.ts`

**Responsibilities:**
- Commit cold state changes to git immediately
- Load state from task-list.md
- Keep git history clean (only milestone commits)
- Atomic file operations

**Key Methods:**
```typescript
class GitOps {
  // Loading
  async loadTaskList(): Promise<ParsedTaskList>
  async reconstructState(): Promise<Map<string, PRState>>

  // Cold state updates (immediate commit)
  async commitColdStateChange(
    prId: string,
    newState: ColdState,
    metadata: CommitMetadata
  ): Promise<void>

  // Display updates (30-second cycle)
  async commitDisplaySync(updates: DisplayUpdate[]): Promise<void>

  // History management
  async getLastCommitForPR(prId: string): Promise<GitCommit>
  async isCleanHistory(): Promise<boolean>
}
```

**Git Commit Strategy:**

1. **Cold State Commits (immediate):**
   ```
   PR-005: ready → in-progress

   Agent agent-1 started work on PR-005.

   Metadata:
   - From: ready (cold)
   - To: in-progress (hot)
   - Agent: agent-1
   - Timestamp: 2025-11-14T10:30:00Z
   ```

2. **Display Sync Commits (30-second cycle):**
   ```
   [Display Sync] Update hot state visibility

   Updated display for:
   - PR-005: in-progress (agent-1)
   - PR-010: planning (agent-2)
   - PR-015: under-review (qc-agent-1)
   ```

3. **What NOT to commit:**
   - Hot state-to-hot state transitions (planning → in-progress)
   - Heartbeat updates
   - Agent assignment changes (unless cold state changes)

### 3. RedisOps (Hot State Management)

**File:** `src/sync/redisOps.ts`

**Responsibilities:**
- Update hot states in Redis
- Sync cold states to Redis cache
- Query current state
- Handle state cleanup

**Key Methods:**
```typescript
class RedisOps {
  // Hot state operations
  async updateHotState(prId: string, state: HotState): Promise<void>
  async getHotState(prId: string): Promise<HotState | null>
  async getAllHotStates(): Promise<Map<string, HotState>>
  async clearHotState(prId: string): Promise<void>

  // Cold state cache sync
  async updateColdStateCache(prId: string, state: ColdState): Promise<void>
  async getColdState(prId: string): Promise<ColdState>

  // Hydration (from git on startup)
  async hydrateFromTaskList(taskList: ParsedTaskList): Promise<void>

  // Cleanup
  async clearOrphanedStates(validPRIds: Set<string>): Promise<void>
  async clearExpiredHeartbeats(): Promise<void>
}
```

**Redis Keys:**
```typescript
// Hot state (ephemeral)
`pr:${prId}:hot_state`           // string: hot state value (TTL: 5 min)
`pr:${prId}:agent`               // string: agent_id
`pr:${prId}:heartbeat`           // timestamp: last heartbeat

// Cold state (cache, reconstructible from git)
`pr:${prId}:cold_state`          // string: cold state value (no TTL)
`pr:${prId}:dependencies`        // set: dependency PR IDs

// Sync metadata
`sync:last_display_update`       // timestamp
`sync:crash_recovery_needed`     // boolean flag
```

### 4. Reconciliation (Conflict Resolution)

**File:** `src/sync/reconciliation.ts`

**Responsibilities:**
- Detect conflicts between Redis and git
- Resolve conflicts with git as source of truth
- Handle edge cases (concurrent updates, crashes during commit)

**Key Methods:**
```typescript
class Reconciliation {
  // Detection
  async detectConflicts(): Promise<ConflictReport[]>
  async detectOrphanedStates(): Promise<string[]>

  // Resolution
  async resolveConflict(conflict: ConflictReport): Promise<void>
  async reconcileAfterCrash(): Promise<void>

  // Validation
  async validateConsistency(): Promise<ValidationResult>
}
```

**Conflict Types:**

1. **Redis has hot state, git shows different cold state:**
   - **Resolution:** Trust git, clear Redis hot state
   - **Reason:** Git is source of truth

2. **Redis missing cold state that exists in git:**
   - **Resolution:** Hydrate Redis from git
   - **Reason:** Redis cache miss

3. **Redis has orphaned hot state (PR doesn't exist in git):**
   - **Resolution:** Clear Redis state
   - **Reason:** Stale data from previous session

4. **Agent heartbeat expired but hot state remains:**
   - **Resolution:** Clear hot state, revert to cold state
   - **Reason:** Agent crash/timeout

---

## Integration with Existing Components

### StateMachine (PR-003)

**Integration Point:** IGitCommitter interface

```typescript
// StateMachine provides this interface:
interface IGitCommitter {
  commit(message: string, metadata: CommitMetadata): Promise<void>;
}

// GitOps implements it:
class GitOps implements IGitCommitter {
  async commit(message: string, metadata: CommitMetadata): Promise<void> {
    // Update task-list.md
    await this.updateTaskListFrontmatter(metadata);

    // Git commit
    await this.git.add('docs/task-list.md');
    await this.git.commit(message);
  }
}

// Wire up in Hub:
const gitOps = new GitOps(taskListParser);
const stateMachine = new StateMachine(gitOps, eventEmitter);
```

### RedisClient (PR-004)

**Integration Point:** Direct usage for state operations

```typescript
class RedisOps {
  constructor(private redis: RedisClient) {}

  async updateHotState(prId: string, state: HotState): Promise<void> {
    const client = this.redis.getClient();
    await client.set(`pr:${prId}:hot_state`, state);
    await client.expire(`pr:${prId}:hot_state`, 300); // 5 min TTL
  }
}
```

### TaskListParser (PR-009)

**Integration Point:** Update and parse task-list.md

```typescript
class GitOps {
  constructor(private parser: TaskListParser) {}

  async commitColdStateChange(
    prId: string,
    newState: ColdState
  ): Promise<void> {
    // Update using parser
    await this.parser.update('docs/task-list.md', prId, {
      cold_state: newState,
      last_transition: new Date().toISOString()
    });

    // Git commit
    await this.git.add('docs/task-list.md');
    await this.git.commit(this.generateCommitMessage(prId, newState));
  }
}
```

---

## Testing Strategy

### Unit Tests

**File:** `tests/sync.test.ts`

**Coverage Goals:** >90%

**Test Cases:**

1. **StateSync:**
   - Initialization and hydration
   - Display sync cycle
   - Crash recovery
   - Reconciliation triggering

2. **GitOps:**
   - Cold state commits
   - Display sync commits
   - Task list loading
   - Atomic operations
   - Git history validation

3. **RedisOps:**
   - Hot state updates
   - Cold state cache sync
   - Hydration from task list
   - Orphaned state cleanup
   - Heartbeat expiration

4. **Reconciliation:**
   - Conflict detection
   - Conflict resolution (git as source of truth)
   - Orphaned state cleanup
   - Consistency validation

### Integration Tests

**Test Scenarios:**

1. **Full sync cycle:**
   ```typescript
   it('synchronizes cold and hot states correctly', async () => {
     // 1. Start with clean state
     // 2. Transition to hot state (investigating)
     // 3. Verify Redis updated, git NOT committed
     // 4. Transition to cold state (planned)
     // 5. Verify git committed, Redis updated
     // 6. Run display sync
     // 7. Verify display updated in markdown
   });
   ```

2. **Crash recovery:**
   ```typescript
   it('recovers from crash correctly', async () => {
     // 1. Set up PRs with hot states in Redis
     // 2. Simulate crash (disconnect Redis, clear cache)
     // 3. Restart Hub
     // 4. Verify state reconstructed from git
     // 5. Verify orphaned hot states cleared
   });
   ```

3. **Conflict resolution:**
   ```typescript
   it('resolves conflicts with git as source of truth', async () => {
     // 1. Create conflict (Redis says investigating, git says completed)
     // 2. Run reconciliation
     // 3. Verify git state wins
     // 4. Verify Redis updated from git
   });
   ```

### Performance Tests

1. **Sync cycle performance:**
   - Target: <500ms for 100 PRs
   - Measure display sync time
   - Verify no blocking

2. **Hydration performance:**
   - Target: <2s for 1000 PRs
   - Measure startup reconstruction time

---

## Edge Cases & Error Handling

### Edge Cases

1. **Concurrent cold state transitions:**
   - **Prevention:** StateMachine serializes transitions per PR
   - **Fallback:** Last write wins, emit warning

2. **Git commit fails during cold transition:**
   - **Handling:** Transaction rollback, revert Redis update
   - **Recovery:** Retry with exponential backoff

3. **Redis disconnects during hot state update:**
   - **Handling:** Queue update, retry on reconnect
   - **Fallback:** If reconnect fails, switch to degraded mode

4. **Heartbeat expires during long-running task:**
   - **Prevention:** Agent heartbeat every 30s
   - **Recovery:** Agent re-acquires lease, resumes work

5. **Display sync conflicts with cold state commit:**
   - **Prevention:** Display sync checks for recent commits
   - **Handling:** Skip display sync if cold commit in last 5s

### Error Handling

```typescript
class StateSync {
  async syncColdState(prId: string): Promise<void> {
    try {
      // 1. Update git
      await this.gitOps.commitColdStateChange(prId, newState, metadata);
    } catch (gitError) {
      // Git commit failed - critical error
      this.emit('error', { type: 'git-commit-failed', prId, error: gitError });

      // Don't update Redis if git failed (consistency)
      throw new StateSyncError('Cold state commit failed', gitError);
    }

    try {
      // 2. Update Redis cache
      await this.redisOps.updateColdStateCache(prId, newState);
    } catch (redisError) {
      // Redis update failed - non-critical (cache miss on next read)
      this.emit('warning', { type: 'redis-cache-failed', prId, error: redisError });

      // Don't throw - git commit succeeded, that's what matters
    }
  }
}
```

---

## Acceptance Criteria Mapping

From task-list.md:

- [x] **Cold state changes commit to git**
  - Implemented in GitOps.commitColdStateChange()
  - Event-driven via StateMachine integration

- [x] **Hot state updates Redis only**
  - Implemented in RedisOps.updateHotState()
  - No git commits for hot transitions

- [x] **30-second sync cycle works**
  - Implemented in StateSync.syncDisplayStates()
  - Updates markdown display section

- [x] **Reconciliation handles conflicts**
  - Implemented in Reconciliation class
  - Git as source of truth

- [x] **Git history stays clean**
  - Only milestone commits (cold state changes)
  - Display syncs clearly marked
  - No hot state transition commits

- [x] **Crash recovery works**
  - Implemented in StateSync.recoverFromCrash()
  - Reconstructs from git, clears orphans

---

## Implementation Checklist

- [ ] Create `src/sync/` directory
- [ ] Implement `stateSync.ts` (coordinator)
- [ ] Implement `gitOps.ts` (git operations)
- [ ] Implement `redisOps.ts` (Redis operations)
- [ ] Implement `reconciliation.ts` (conflict resolution)
- [ ] Create comprehensive tests in `tests/sync.test.ts`
- [ ] Integration test with StateMachine
- [ ] Integration test with TaskListParser
- [ ] Integration test with RedisClient
- [ ] Performance test (sync cycle <500ms)
- [ ] Performance test (hydration <2s for 1000 PRs)
- [ ] Update docs/task-list.md with completion notes
- [ ] Create git commit

---

## Success Metrics

1. **Correctness:**
   - Zero data loss during normal operation
   - Zero conflicts after crash recovery
   - Git history contains only milestone commits

2. **Performance:**
   - Display sync cycle: <500ms for 100 PRs
   - Startup hydration: <2s for 1000 PRs
   - Cold state commit: <1s per transition

3. **Reliability:**
   - Crash recovery success rate: 100%
   - Conflict resolution accuracy: 100% (git wins)
   - Test coverage: >90%

---

## Next Steps After Implementation

1. **Integration with Hub Daemon (PR-007):**
   - Wire StateSync into Hub startup
   - Add 30-second sync timer
   - Hook into crash recovery

2. **Integration with Base Agent (PR-011):**
   - Agents use StateMachine for transitions
   - Automatic state sync on transitions
   - Heartbeat integration

3. **Monitoring & Observability:**
   - Emit metrics for sync performance
   - Log all state transitions
   - Alert on reconciliation conflicts

---

**Plan Complete - Ready for Implementation**
