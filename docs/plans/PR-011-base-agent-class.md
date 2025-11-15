# PR-011: Base Agent Class Implementation Plan

## Overview
Implement foundation agent class with lifecycle management, hub communication, heartbeat system, and error recovery that all specialized agent types (Planning, Worker, QC, Review) will extend.

## Dependencies
- **PR-007**: Hub Daemon Process ✅ (completed)

## Goals
1. Create extensible base class for all agent types
2. Implement robust lifecycle management (spawn → work → complete/fail → cleanup)
3. Establish Redis pub/sub communication with Hub
4. Implement 30-second heartbeat system
5. Graceful shutdown and error recovery
6. Integrate PR planning behaviors from prompts (PR-003a)

## Architecture

### Base Agent Class Design

```typescript
abstract class BaseAgent {
  // Identity
  protected agentId: string;
  protected agentType: AgentType;
  protected prId: string | null;

  // Infrastructure
  protected redis: RedisClient;
  protected coordinationMode: CoordinationMode;

  // Lifecycle
  protected state: AgentState;
  protected startTime: number;
  protected heartbeatInterval: NodeJS.Timeout | null;

  // Communication
  protected messageBus: MessageBus;
  protected eventEmitter: EventEmitter;

  // Abstract methods (must be implemented by subclasses)
  abstract async doWork(assignment: Assignment): Promise<WorkResult>;
  abstract async validateAssignment(assignment: Assignment): Promise<boolean>;

  // Lifecycle methods
  async start(): Promise<void>
  async stop(): Promise<void>
  async handleAssignment(assignment: Assignment): Promise<void>
  async reportProgress(progress: ProgressUpdate): Promise<void>

  // Communication
  async sendToHub(message: AgentMessage): Promise<void>
  async subscribe(channel: string, handler: MessageHandler): Promise<void>

  // Heartbeat
  private async startHeartbeat(): Promise<void>
  private async sendHeartbeat(): Promise<void>

  // Error handling
  protected async handleError(error: Error): Promise<void>
  protected async recover(): Promise<void>
}
```

### Component Breakdown

#### 1. Lifecycle Management (`src/agents/lifecycle.ts`)

**Agent States:**
```typescript
enum AgentState {
  INITIALIZING = 'initializing',
  IDLE = 'idle',
  WORKING = 'working',
  COMPLETING = 'completing',
  FAILED = 'failed',
  SHUTTING_DOWN = 'shutting_down',
  STOPPED = 'stopped'
}
```

**State Transitions:**
- `initializing → idle`: Successful startup
- `idle → working`: Assignment received
- `working → completing`: Work finished successfully
- `working → failed`: Work failed with error
- `completing → idle`: Cleanup complete
- `failed → idle`: Recovery complete
- `any → shutting_down → stopped`: Graceful shutdown

**Lifecycle Methods:**
```typescript
class LifecycleManager {
  async initialize(agent: BaseAgent): Promise<void>
  async shutdown(agent: BaseAgent, signal?: string): Promise<void>
  async transition(from: AgentState, to: AgentState): Promise<void>
  canTransition(from: AgentState, to: AgentState): boolean
}
```

#### 2. Hub Communication (`src/agents/communication.ts`)

**Message Types:**
```typescript
type AgentMessage =
  | AgentRegistration
  | AgentHeartbeat
  | AgentProgress
  | AgentComplete
  | AgentFailed
  | AgentRequest;

interface AgentRegistration {
  type: 'registration';
  agentId: string;
  agentType: AgentType;
  capabilities: AgentCapability;
  timestamp: number;
}

interface AgentHeartbeat {
  type: 'heartbeat';
  agentId: string;
  state: AgentState;
  prId: string | null;
  memoryUsage: number;
  timestamp: number;
}

interface AgentProgress {
  type: 'progress';
  agentId: string;
  prId: string;
  percentComplete: number;
  message: string;
  timestamp: number;
}

interface AgentComplete {
  type: 'complete';
  agentId: string;
  prId: string;
  result: WorkResult;
  timestamp: number;
}

interface AgentFailed {
  type: 'failed';
  agentId: string;
  prId: string;
  error: ErrorInfo;
  recoverable: boolean;
  timestamp: number;
}
```

**Communication Patterns:**
```typescript
class CommunicationManager {
  // Pub/Sub with Hub
  async publishToHub(message: AgentMessage): Promise<void>
  async subscribeToAssignments(handler: AssignmentHandler): Promise<void>
  async subscribeToCommands(handler: CommandHandler): Promise<void>

  // Direct messaging (when needed)
  async requestFromHub(request: AgentRequest): Promise<HubResponse>

  // Coordination mode aware
  async sendViaMode(message: AgentMessage): Promise<void>
}
```

#### 3. Heartbeat System (`src/agents/heartbeat.ts`)

**Heartbeat Configuration:**
```typescript
interface HeartbeatConfig {
  interval: number;        // 30000ms (30 seconds)
  timeout: number;         // 90000ms (3 missed = timeout)
  includeMetrics: boolean; // Memory, CPU usage
  includeProgress: boolean; // Current work progress
}
```

**Heartbeat Manager:**
```typescript
class HeartbeatManager {
  private interval: NodeJS.Timeout | null;
  private lastSent: number;
  private missedAcks: number;

  async start(): Promise<void>
  async stop(): Promise<void>
  async send(): Promise<void>
  async handleAck(ack: HeartbeatAck): Promise<void>
  isAlive(): boolean
}
```

**Heartbeat Payload:**
- Agent ID, type, state
- Current PR assignment
- Memory usage
- Work progress (if applicable)
- Timestamp

#### 4. Error Recovery (`src/agents/recovery.ts`)

**Error Categories:**
```typescript
enum ErrorCategory {
  TRANSIENT = 'transient',     // Network issues, temporary failures
  ASSIGNMENT = 'assignment',   // Invalid work assignment
  EXECUTION = 'execution',     // Work execution failure
  FATAL = 'fatal'             // Unrecoverable errors
}
```

**Recovery Strategies:**
```typescript
class RecoveryManager {
  async handleError(error: Error, category: ErrorCategory): Promise<RecoveryAction>
  async retry(action: () => Promise<void>, maxAttempts: number): Promise<void>
  async reportFailure(error: Error, recoverable: boolean): Promise<void>
  async recover(): Promise<void>
}

type RecoveryAction =
  | { action: 'retry', delay: number }
  | { action: 'report', escalate: boolean }
  | { action: 'fail', cleanup: boolean }
  | { action: 'shutdown' };
```

**Recovery Flow:**
1. Catch error during work
2. Categorize error
3. Determine recovery action
4. Execute recovery (retry, report, fail)
5. Update state accordingly
6. Notify Hub of outcome

#### 5. PR Planning Behaviors (from PR-003a prompts)

**Planning Agent Integration:**
```typescript
abstract class PlanningCapableAgent extends BaseAgent {
  // Planning workflow methods
  protected async analyzePR(pr: PRNode): Promise<PRAnalysis>
  protected async estimateComplexity(pr: PRNode): Promise<ComplexityScore>
  protected async identifyDependencies(pr: PRNode): Promise<string[]>
  protected async suggestImplementation(pr: PRNode): Promise<ImplementationPlan>

  // Commit policy integration
  protected async shouldCommit(state: ColdState): Promise<boolean>
  protected async createCommitMessage(pr: PRNode, changes: FileChange[]): Promise<string>

  // Cost awareness
  protected async estimateCost(pr: PRNode): Promise<CostEstimate>
  protected async selectModel(complexity: number): Promise<ModelTier>
}
```

**Worker Agent Integration:**
```typescript
abstract class WorkerAgent extends BaseAgent {
  // Implementation workflow
  protected async planImplementation(pr: PRNode): Promise<TaskBreakdown>
  protected async acquireFileLease(files: string[]): Promise<Lease>
  protected async implementTask(task: Task): Promise<TaskResult>
  protected async releaseFileLease(lease: Lease): Promise<void>

  // Testing integration
  protected async runTests(files: string[]): Promise<TestResult>
  protected async checkCoverage(): Promise<CoverageReport>

  // Code quality
  protected async followCodingStandards(): Promise<void> // 75 lines/function, 750/file
}
```

### Base Agent Workflow

```
┌─────────────────┐
│   Initialize    │
│  - Connect Redis│
│  - Register Hub │
│  - Start HB     │
└────────┬────────┘
         │
         ▼
    ┌────────┐
    │  IDLE  │◄──────┐
    └───┬────┘       │
        │            │
        │ Assignment │
        ▼            │
   ┌─────────┐       │
   │ WORKING │       │
   └────┬────┘       │
        │            │
        ├─Success────┤
        │            │
        └─Failure────┘
             │
             ▼
        ┌─────────┐
        │ Recovery│
        │  /Fail  │
        └────┬────┘
             │
             ▼
        ┌──────────┐
        │ Shutdown │
        └──────────┘
```

## Implementation Strategy

### Phase 1: Core Infrastructure
1. Set up base agent class structure
2. Implement agent identity and configuration
3. Add Redis client integration
4. Create basic lifecycle methods (start/stop)
5. Implement state management

### Phase 2: Communication
1. Integrate message bus from PR-013 (or stub for now)
2. Implement Hub registration
3. Add assignment subscription
4. Create message sending utilities
5. Handle coordination mode switching

### Phase 3: Heartbeat System
1. Implement heartbeat interval timer
2. Create heartbeat message format
3. Add metrics collection (memory, CPU)
4. Implement timeout detection
5. Add heartbeat acknowledgment handling

### Phase 4: Work Management
1. Define abstract work methods
2. Implement assignment validation
3. Add progress reporting
4. Create work result structures
5. Handle work completion/failure

### Phase 5: Error Handling & Recovery
1. Create error categorization
2. Implement retry logic with exponential backoff
3. Add recovery strategies
4. Implement graceful failure reporting
5. Add cleanup on failure

### Phase 6: Specialized Agent Hooks
1. Add planning agent abstract methods
2. Add worker agent abstract methods
3. Integrate prompt behaviors from PR-003a
4. Add QC agent hooks
5. Add review agent hooks

## Testing Strategy

### Unit Tests (`tests/baseAgent.test.ts`)

**Lifecycle Tests:**
- Agent initializes successfully
- State transitions work correctly
- Invalid transitions rejected
- Graceful shutdown completes
- Cleanup on shutdown

**Communication Tests:**
- Registration message sent on start
- Assignment subscription works
- Messages published to Hub correctly
- Coordination mode switching handled
- Message format validation

**Heartbeat Tests:**
- Heartbeats sent every 30 seconds
- Heartbeat includes correct data
- Missed heartbeats detected
- Heartbeat stops on shutdown
- Metrics collected correctly

**Error Handling Tests:**
- Transient errors trigger retry
- Fatal errors trigger shutdown
- Error reporting works
- Recovery attempts succeed
- Cleanup on failure

**Work Management Tests:**
- Assignment validation works
- Progress reporting functions
- Work completion reported
- Work failure reported
- Result structure correct

### Integration Tests
- Full lifecycle: start → work → complete → stop
- Error recovery flow
- Hub communication (mocked Hub)
- Heartbeat timeout detection
- Coordination mode transitions

### Mock Implementations
```typescript
class TestAgent extends BaseAgent {
  async doWork(assignment: Assignment): Promise<WorkResult> {
    // Simple test implementation
    return { success: true, output: 'test' };
  }

  async validateAssignment(assignment: Assignment): Promise<boolean> {
    return true;
  }
}
```

## Configuration

```typescript
interface AgentConfig {
  // Identity
  agentType: AgentType;

  // Infrastructure
  redisUrl?: string;

  // Heartbeat
  heartbeatInterval?: number;  // Default: 30000
  heartbeatTimeout?: number;   // Default: 90000

  // Error handling
  maxRetries?: number;         // Default: 3
  retryDelay?: number;        // Default: 1000

  // Lifecycle
  shutdownTimeout?: number;    // Default: 5000

  // Coordination
  coordinationMode?: CoordinationMode; // Default: DISTRIBUTED
}
```

## File Structure

```
src/agents/
├── index.ts              # Exports
├── base.ts               # BaseAgent class
├── lifecycle.ts          # LifecycleManager
├── communication.ts      # CommunicationManager
├── heartbeat.ts          # HeartbeatManager
├── recovery.ts           # RecoveryManager
└── types.ts              # Agent-specific types

tests/
├── baseAgent.test.ts     # Comprehensive test suite
├── mocks/
│   ├── mockHub.ts       # Hub mock
│   └── mockRedis.ts     # Redis mock
└── fixtures/
    └── testAssignments.ts
```

## Success Criteria

- ✅ Base agent starts and registers with Hub
- ✅ Heartbeat sent every 30 seconds with accurate data
- ✅ Assignments received and processed
- ✅ Progress updates sent to Hub
- ✅ Work completion/failure reported correctly
- ✅ Graceful shutdown completes within timeout
- ✅ Error recovery works for transient failures
- ✅ State transitions validated and enforced
- ✅ Test coverage >95%
- ✅ Ready for extension by specialized agents

## Integration with Prompts (PR-003a)

### Agent Defaults Integration
- Hot/cold state awareness built into base class
- Redis coordination as primary mode
- Commit policy checks before state transitions
- Coding standards enforcement hooks

### Planning Behaviors
- Abstract methods for PR analysis
- Complexity estimation hooks
- Dependency identification support
- Implementation planning structure

### Cost Control
- Model tier selection based on complexity
- Cost estimation before work starts
- Budget awareness in work execution

## Risk Mitigation

### Risk: Heartbeat Failures
**Mitigation:**
- Retry logic for heartbeat sends
- Exponential backoff on failures
- Hub timeout detection (3 missed)
- Graceful reconnection

### Risk: Message Loss
**Mitigation:**
- Acknowledgment system for critical messages
- Message persistence in Redis
- Replay capability for failed messages
- State reconciliation on reconnect

### Risk: Shutdown Hangs
**Mitigation:**
- Forced shutdown after timeout
- Resource cleanup even on forced shutdown
- Cleanup verification
- Signal handling (SIGTERM, SIGINT)

### Risk: Memory Leaks
**Mitigation:**
- Heartbeat monitors memory usage
- Automatic restart on high memory
- Cleanup after each work cycle
- Timer cleanup on shutdown

## Future Enhancements (Post-PR)
- Agent pools for scaling
- Work stealing for load balancing
- Priority-based work queuing
- Agent health scoring
- Automatic restart on failure
- Telemetry and metrics collection
