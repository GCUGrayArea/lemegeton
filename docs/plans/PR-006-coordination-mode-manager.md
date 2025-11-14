# PR-006: Coordination Mode Manager - Implementation Plan

## Overview
Implement the coordination mode detection and transition system that allows Lemegeton to operate in three distinct modes (distributed, degraded, isolated) with seamless switching based on Redis availability and health.

## Dependencies
- ✅ PR-004: Redis Client with Configuration and Auto-spawn
- ✅ PR-005: File Lease System

## Complexity Assessment
- **Score**: 7/10 (Sonnet-level)
- **Estimated Time**: 70 minutes
- **Rationale**: Complex state management and transition logic, but well-defined patterns

## Architecture Context

### Three Coordination Modes

1. **DISTRIBUTED Mode** (Normal Operation)
   - Shared Redis available and healthy
   - Pessimistic file locking via Redis
   - Multiple agents coordinate via Redis pub/sub
   - Full lease management active
   - Best performance and coordination

2. **DEGRADED Mode** (Local Redis Fallback)
   - Shared Redis unavailable, local Docker Redis available
   - Branch-based work isolation (agent-{id}-{prId})
   - Optimistic concurrency (accept conflicts, resolve later)
   - Local coordination only
   - Continue working despite network issues

3. **ISOLATED Mode** (Pure Local)
   - No Redis available at all
   - File-based state persistence
   - Single-agent operation
   - No coordination possible
   - Emergency fallback to keep working

### Mode Detection Logic

```
1. Try shared Redis connection
   → Success? DISTRIBUTED mode

2. Try auto-spawn local Docker Redis
   → Success? DEGRADED mode

3. Neither available
   → ISOLATED mode
```

### Mode Transitions

All transitions must be handled gracefully:

```
DISTRIBUTED ↔ DEGRADED:
  - Save/restore state via Redis
  - Switch between main branch and agent branches
  - Notify agents of coordination change

DEGRADED ↔ ISOLATED:
  - Serialize state to/from files
  - Disable/enable coordination features
  - Notify agents of capability change

DISTRIBUTED ↔ ISOLATED:
  - Rare direct transition
  - Combination of above transitions
```

## Implementation Plan

### Phase 1: Core Mode Manager (`src/core/coordinationMode.ts`)

**Purpose**: Central coordinator for mode detection and transitions

**Key Components**:

1. **CoordinationMode Enum**
   ```typescript
   export enum CoordinationMode {
     DISTRIBUTED = 'distributed',
     DEGRADED = 'degraded',
     ISOLATED = 'isolated',
   }
   ```

2. **CoordinationModeManager Class**
   - Extends EventEmitter for transition events
   - Tracks current mode and transition history
   - Coordinates with Redis client and health checker
   - Emits events: 'modeChanged', 'transitionStarted', 'transitionComplete'

**Core Methods**:

```typescript
class CoordinationModeManager extends EventEmitter {
  private currentMode: CoordinationMode = CoordinationMode.DISTRIBUTED;
  private redisClient: RedisClient | null = null;
  private healthChecker: HealthChecker | null = null;

  // Detection
  async detectMode(): Promise<CoordinationMode>
  async canReachSharedRedis(): Promise<boolean>
  async canUseLocalRedis(): Promise<boolean>

  // Transitions
  async switchMode(newMode: CoordinationMode): Promise<void>
  private async transitionFromTo(from: CoordinationMode, to: CoordinationMode): Promise<void>

  // Health monitoring
  startHealthMonitoring(interval: number): void
  stopHealthMonitoring(): void

  // State
  getMode(): CoordinationMode
  getModeHistory(): ModeTransition[]
}
```

**State Tracking**:
- Store mode in Redis key `coordination:mode` (when available)
- Store mode transitions in `coordination:history` sorted set
- Store health status in `coordination:redis_health` key
- Fallback to in-memory tracking when Redis unavailable
- Use file-based persistence in isolated mode

**Redis Key Schema** (from ARCHITECTURE.md):
```
coordination:mode                # string: 'distributed' | 'degraded' | 'isolated'
coordination:redis_health        # string: 'healthy' | 'degraded' | 'failed'
coordination:history             # sorted set: mode transitions with timestamps
```

**Health Integration**:
- Subscribe to health checker events
- Auto-transition on degradation/recovery
- Configurable thresholds for mode switching

### Phase 2: Degraded Mode Handler (`src/core/degradedMode.ts`)

**Purpose**: Manages branch-based work isolation for degraded mode

**Key Responsibilities**:
1. Generate agent-specific branch names
2. Handle branch creation and switching
3. Track branch-based work progress
4. Coordinate reconciliation when returning to distributed mode

**Core Functionality**:

```typescript
class DegradedModeHandler {
  // Branch management
  generateBranchName(agentId: string, prId: string): string
  async createAgentBranch(agentId: string, prId: string): Promise<string>
  async switchToAgentBranch(branch: string): Promise<void>
  async switchToMainBranch(): Promise<void>

  // State persistence (via local Redis)
  async saveWorkState(agentId: string, state: any): Promise<void>
  async loadWorkState(agentId: string): Promise<any>

  // Reconciliation
  async reconcileBranches(): Promise<ReconciliationResult>
  async attemptAutoMerge(branch: string): Promise<boolean>
  async createConflictReport(branches: string[]): Promise<ConflictReport>
}
```

**Branch Naming Convention**:
- Format: `agent-{agentId}-{prId}`
- Example: `agent-a1b2c3d4-PR-007`
- Allows easy identification and cleanup

**Reconciliation Strategy**:
1. List all agent branches
2. For each branch, attempt automatic merge to main
3. If conflicts, create conflict report
4. Manual resolution required for conflicts
5. Clean up merged branches

### Phase 3: Isolated Mode Handler (`src/core/isolatedMode.ts`)

**Purpose**: File-based state persistence for pure local operation

**Key Responsibilities**:
1. Serialize coordination state to files
2. Restore state from files
3. Track work progress without Redis
4. Provide degraded lease checking (advisory only)

**Core Functionality**:

```typescript
class IsolatedModeHandler {
  private stateDir: string = '.lemegeton/isolated';

  // File-based state
  async saveState(state: CoordinationState): Promise<void>
  async loadState(): Promise<CoordinationState | null>
  async clearState(): Promise<void>

  // Advisory locking (no enforcement)
  async recordFileLock(agentId: string, files: string[]): Promise<void>
  async releaseFileLock(agentId: string, files: string[]): Promise<void>
  async checkFileLocks(files: string[]): Promise<LockStatus[]>

  // Work tracking
  async recordWorkItem(agentId: string, prId: string, status: string): Promise<void>
  async getWorkItems(agentId?: string): Promise<WorkItem[]>
}
```

**State File Structure**:
```
.lemegeton/isolated/
  state.json              # Overall coordination state
  locks/                  # Advisory file locks
    {agentId}.json        # Files locked by agent
  work/                   # Work tracking
    {agentId}-{prId}.json # Work item status
```

**Advisory Locking**:
- No enforcement (no Redis)
- Records locks in JSON files
- Warns about conflicts but doesn't prevent
- Best-effort coordination for single machine

### Phase 4: Agent Notification System

**Purpose**: Notify agents of mode changes so they can adapt behavior

**Notification Methods** (based on current mode):

1. **DISTRIBUTED Mode** - Use Redis pub/sub
   ```typescript
   await this.redis.publish('coordination:mode_change', JSON.stringify({
     action: 'SWITCH_TO_DEGRADED',
     newMode: CoordinationMode.DEGRADED,
     timestamp: Date.now(),
   }));
   ```

2. **DEGRADED Mode** - Use local Redis pub/sub
   ```typescript
   // Same mechanism, but local Redis only
   await this.localRedis.publish('coordination:mode_change', ...);
   ```

3. **ISOLATED Mode** - Use file-based notifications
   ```typescript
   // Write notification to shared file location
   await fs.writeFile('.lemegeton/isolated/notifications.jsonl',
     JSON.stringify({ action, mode, timestamp }) + '\n',
     { flag: 'a' }
   );
   ```

**Notification Actions** (from ARCHITECTURE.md):
- `SWITCH_TO_BRANCHES` - Degraded mode, create agent branches
- `WORK_ISOLATED` - Isolated mode, disable coordination
- `RESUME_COORDINATION` - Recovery to degraded mode
- `MERGE_TO_MAIN` - Recovery to distributed mode
- `MODE_CHANGE` - General mode change notification

**Agent Response Handling**:
- Agents subscribe to notifications
- Adapt behavior based on current mode
- Acknowledge mode changes
- Handle transitions gracefully (finish current operation, then switch)

### Phase 5: Integration and Testing

**Testing Strategy**:

1. **Unit Tests** (`tests/coordinationMode.test.ts`):
   - Mode detection logic
   - Transition state machines
   - Event emissions
   - Error handling

2. **Integration Tests**:
   - With Docker: Test all three modes
   - Without Docker: Test ISOLATED mode fallback
   - Simulate Redis failures and recovery
   - Test mode transitions under load

3. **Edge Cases**:
   - Redis dies mid-operation
   - Docker becomes unavailable
   - Network partition scenarios
   - Rapid mode transitions

**Test Coverage Requirements**:
```typescript
describe('Coordination Mode Manager', () => {
  describe('Mode Detection', () => {
    it('should detect DISTRIBUTED mode with healthy Redis')
    it('should detect DEGRADED mode with local Redis only')
    it('should detect ISOLATED mode with no Redis')
    it('should re-detect mode after Redis recovery')
  });

  describe('Mode Transitions', () => {
    it('should transition DISTRIBUTED → DEGRADED on Redis failure')
    it('should transition DEGRADED → ISOLATED on Docker failure')
    it('should transition DEGRADED → DISTRIBUTED on Redis recovery')
    it('should emit events during transitions')
    it('should handle rapid consecutive transitions')
  });

  describe('Degraded Mode', () => {
    it('should create unique agent branches')
    it('should persist state to local Redis')
    it('should reconcile branches on recovery')
    it('should detect merge conflicts')
  });

  describe('Isolated Mode', () => {
    it('should save state to files')
    it('should restore state from files')
    it('should provide advisory locking')
    it('should track work without Redis')
  });

  describe('Health Monitoring', () => {
    it('should auto-transition on health degradation')
    it('should auto-transition on health recovery')
    it('should respect transition cooldown')
  });
});
```

## File Structure

```
src/core/
  coordinationMode.ts      # Main mode manager (300 lines)
  degradedMode.ts          # Branch-based degraded mode (250 lines)
  isolatedMode.ts          # File-based isolated mode (200 lines)

tests/
  coordinationMode.test.ts # Comprehensive mode tests (500 lines)
```

## Configuration

Add to `LemegetonConfig`:

```typescript
export interface CoordinationConfig {
  /** Mode detection interval (ms) */
  modeCheckInterval?: number;

  /** Minimum time between mode transitions (ms) */
  transitionCooldown?: number;

  /** Directory for isolated mode state */
  isolatedStateDir?: string;

  /** Whether to auto-reconcile branches in degraded mode */
  autoReconcile?: boolean;

  /** Health threshold for mode degradation */
  healthDegradationThreshold?: number;
}

export const DEFAULT_COORDINATION_CONFIG: Required<CoordinationConfig> = {
  modeCheckInterval: 30000,      // 30 seconds
  transitionCooldown: 5000,       // 5 seconds
  isolatedStateDir: '.lemegeton/isolated',
  autoReconcile: true,
  healthDegradationThreshold: 3,  // 3 consecutive failures
};
```

## Implementation Order

1. **coordinationMode.ts** - Core mode manager
   - Enum and types
   - Basic mode detection
   - Transition framework
   - Event emission

2. **degradedMode.ts** - Branch-based handler
   - Branch naming and creation
   - Local Redis state persistence
   - Reconciliation logic

3. **isolatedMode.ts** - File-based handler
   - State serialization
   - Advisory locking
   - Work tracking

4. **coordinationMode.test.ts** - Comprehensive tests
   - Mode detection tests
   - Transition tests
   - Integration with Redis/health

5. **Integration** - Connect to existing systems
   - Wire up health checker events
   - Update Redis client integration
   - Add configuration schema

## Key Design Decisions

### 1. Pessimistic Locking with Optimistic Fallback (PRD Core Principle)
- **DISTRIBUTED mode**: Pessimistic locking prevents ALL conflicts via Redis
- **DEGRADED mode**: Optimistic branch-based work accepts merge conflicts
- **Philosophy**: "Best of both worlds - safety when possible, productivity always"
- **Key Insight**: Degraded productivity better than no productivity

### 2. Redis as Cache, Not Database (PRD Core Principle)
- All state reconstructible from git
- Mode transitions never lose work
- Redis unavailability is inconvenient, not catastrophic
- File-based fallback preserves all critical state

### 3. Health-Based Auto-Transitions
- Monitor Redis health continuously via existing HealthChecker
- Auto-degrade when health fails consistently (use configurable threshold)
- Auto-upgrade when health recovers
- Prevents manual intervention for common infrastructure issues
- **Integration**: Subscribe to HealthChecker 'healthChanged' events from PR-004

### 4. Branch-Based Degraded Mode
- Each agent works on isolated branch: `agent-{agentId}-{prId}`
- Reduces conflicts during degraded operation
- Simplifies reconciliation when returning to distributed
- Clear git history of degraded-mode work
- **Accepts conflicts**: Prioritizes work preservation over perfect coordination

### 5. Advisory Locking in Isolated Mode
- No enforcement possible without Redis
- Record locks in files for awareness
- Warn about conflicts but don't prevent
- Better than no coordination at all
- **Pure local work**: Single-agent operation expected

### 6. Event-Driven Architecture
- Mode changes emit events for Hub/agents to react
- Allows loose coupling with other components
- Enables monitoring and logging via pub/sub (when available)
- Facilitates testing without mocks

### 7. Graceful Degradation Chain (PRD: "Fail Gracefully")
- Always try to provide best available mode
- Never fail completely if any mode is possible
- Automatic recovery when capabilities return
- User awareness of current mode via status display
- **Hidden Complexity**: User sees simple status, system handles transitions

### 8. Work Preservation Priority
- Mode transitions never discard in-progress work
- Degraded mode continues work on branches
- Isolated mode saves state to files
- Recovery merges/reconciles work back to main
- **Critical**: No data loss during any transition

## Success Criteria

1. **Mode Detection**: Correctly identifies best available mode
2. **Seamless Transitions**: Smooth mode switching without data loss
3. **State Preservation**: State maintained across transitions
4. **Health Integration**: Auto-responds to Redis health changes
5. **Event Emissions**: All transitions properly logged and emitted
6. **Test Coverage**: >90% coverage with integration tests
7. **Documentation**: Clear examples of each mode

## Notes

- This is a critical resilience component
- Must handle all failure scenarios gracefully
- Should never lose work due to mode transitions
- Keep degraded and isolated modes simple and reliable
- Prioritize data safety over feature completeness in degraded modes

## References

- ARCHITECTURE.md: Coordination Modes section (lines 663-780)
- PR-004: Redis client with health checking
- PR-005: Lease management (only works in DISTRIBUTED/DEGRADED modes)
