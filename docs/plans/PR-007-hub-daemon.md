# PR-007: Hub Daemon Process - Implementation Plan

## Overview
PR-007 implements the central Hub daemon that coordinates all agents, manages state synchronization, and handles the overall system lifecycle. This is the orchestration core that brings together all the infrastructure we've built in Blocks 1 and 2.

## Core Responsibilities

### 1. Process Management
- Start as background daemon process
- Manage lifecycle (startup, shutdown, restart)
- Handle signals gracefully (SIGTERM, SIGINT, SIGHUP)
- PID file management for single instance enforcement
- Health monitoring and self-recovery

### 2. State Coordination
- Parse task-list.md on startup to understand work
- Hydrate Redis from git (cold state → hot state)
- Coordinate state transitions through StateMachine
- Maintain sync between Redis and git
- Handle mode transitions (distributed/degraded/isolated)

### 3. Agent Orchestration
- Track active agents and their status
- Monitor agent heartbeats (30-second intervals)
- Reclaim work from crashed agents
- Coordinate agent spawning (deferred to PR-012)
- Route messages between agents (via PR-013)

### 4. Work Assignment
- Interface with MIS scheduler (PR-008)
- Track work completion and dependencies
- Manage file leases through LeaseManager
- Prevent conflicts and race conditions

## Architecture

```
Hub (Main Process)
├── Daemon Manager (process lifecycle)
├── State Manager (Redis ↔ Git sync)
├── Agent Registry (tracks agents)
├── Work Coordinator (assigns tasks)
├── Mode Manager (coordination modes)
└── Event Bus (internal communication)
```

## Implementation Phases

### Phase 1: Core Daemon Infrastructure
```typescript
// src/hub/index.ts
export class Hub extends EventEmitter {
  private redis: RedisClient;
  private coordinationMode: CoordinationModeManager;
  private stateMachine: StateMachine;
  private agents: Map<string, AgentInfo>;
  private isRunning: boolean;
  private shutdownPromise: Promise<void> | null;

  constructor(config: HubConfig) {
    super();
    this.agents = new Map();
    this.isRunning = false;
    this.shutdownPromise = null;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Hub already running');
    }

    try {
      // Initialize Redis
      await this.initializeRedis();

      // Initialize coordination mode
      await this.initializeCoordination();

      // Parse task list
      await this.loadTaskList();

      // Hydrate state from git
      await this.hydrateState();

      // Start heartbeat monitoring
      this.startHeartbeatMonitor();

      // Set up shutdown handlers
      this.setupShutdownHandlers();

      this.isRunning = true;
      this.emit('started');

    } catch (error) {
      await this.cleanup();
      throw error;
    }
  }
}
```

### Phase 2: Daemon Process Management
```typescript
// src/hub/daemon.ts
export class DaemonManager {
  private pidFile: string;
  private logFile: string;

  async start(hub: Hub): Promise<void> {
    // Check for existing instance
    if (await this.isRunning()) {
      throw new Error('Hub daemon already running');
    }

    // Daemonize the process
    if (process.env.NODE_ENV !== 'test') {
      this.daemonize();
    }

    // Write PID file
    await this.writePidFile();

    // Set up signal handlers
    this.setupSignalHandlers(hub);

    // Start the hub
    await hub.start();
  }

  private daemonize(): void {
    // Fork and detach from parent
    if (process.platform !== 'win32') {
      // Unix-style daemonization
      const spawn = require('child_process').spawn;
      const child = spawn(process.argv[0], process.argv.slice(1), {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();

      // Parent exits
      if (child.pid) {
        process.exit(0);
      }
    } else {
      // Windows service wrapper (simplified)
      // Real implementation would use node-windows
      process.on('SIGINT', () => {});
      process.on('SIGTERM', () => {});
    }
  }
}
```

### Phase 3: State Hydration
```typescript
// src/hub/startup.ts
export class StartupSequence {
  constructor(
    private redis: RedisClient,
    private git: GitOperations
  ) {}

  async hydrateFromGit(): Promise<void> {
    // Read task-list.md
    const taskList = await this.git.readTaskList();

    // Populate Redis with cold state
    for (const pr of taskList.prs) {
      const key = `pr:${pr.id}`;

      // Only hydrate cold state fields
      await this.redis.execute(async (client) => {
        await client.hSet(key, {
          'cold_state': pr.cold_state,
          'complexity': pr.complexity.score,
          'dependencies': JSON.stringify(pr.dependencies),
          'estimated_files': JSON.stringify(pr.estimated_files)
        });
      });

      // Don't restore hot state - it's ephemeral
      // Hot state includes: assigned_to, started_at, progress
    }

    // Verify lease consistency
    await this.verifyLeases();

    // Clean up orphaned hot states
    await this.cleanOrphans();
  }

  private async verifyLeases(): Promise<void> {
    // Get all active leases
    const leases = await this.redis.execute(async (client) => {
      const keys = await client.keys('lease:*');
      return keys;
    });

    // Verify each lease has an active agent
    for (const leaseKey of leases) {
      const lease = await this.redis.execute(async (client) => {
        return await client.hGetAll(leaseKey);
      });

      if (!await this.isAgentActive(lease.agent_id)) {
        // Release orphaned lease
        await this.releaseOrphanedLease(leaseKey);
      }
    }
  }
}
```

### Phase 4: Graceful Shutdown
```typescript
// src/hub/shutdown.ts
export class ShutdownHandler {
  private shutdownTimeout = 30000; // 30 seconds

  async gracefulShutdown(hub: Hub): Promise<void> {
    console.log('Initiating graceful shutdown...');

    // Stop accepting new work
    hub.stopAcceptingWork();

    // Notify all agents
    await hub.notifyAgentsOfShutdown();

    // Wait for agents to finish current work (with timeout)
    await this.waitForAgents(hub, this.shutdownTimeout);

    // Sync final state to git
    await this.syncFinalState(hub);

    // Release all leases
    await this.releaseAllLeases(hub);

    // Disconnect from Redis
    await hub.disconnectRedis();

    // Remove PID file
    await this.removePidFile();

    console.log('Shutdown complete');
  }

  private async waitForAgents(hub: Hub, timeout: number): Promise<void> {
    const startTime = Date.now();

    while (hub.hasActiveAgents()) {
      if (Date.now() - startTime > timeout) {
        console.warn('Shutdown timeout - forcing termination');
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}
```

### Phase 5: Agent Registry and Heartbeat
```typescript
// src/hub/agentRegistry.ts
export interface AgentInfo {
  id: string;
  type: 'planning' | 'worker' | 'qc' | 'review';
  status: 'active' | 'idle' | 'working' | 'crashed';
  lastHeartbeat: number;
  assignedPR: string | null;
  pid: number;
  startedAt: number;
}

export class AgentRegistry {
  private agents: Map<string, AgentInfo> = new Map();
  private heartbeatInterval = 30000; // 30 seconds
  private heartbeatTimeout = 90000; // 90 seconds (3 missed)

  async registerAgent(agent: AgentInfo): Promise<void> {
    this.agents.set(agent.id, agent);

    // Store in Redis for persistence
    await this.redis.execute(async (client) => {
      await client.hSet(`agent:${agent.id}`, {
        type: agent.type,
        status: agent.status,
        lastHeartbeat: agent.lastHeartbeat,
        pid: agent.pid,
        startedAt: agent.startedAt
      });
    });
  }

  async handleHeartbeat(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    agent.lastHeartbeat = Date.now();
    agent.status = 'active';

    // Update Redis
    await this.redis.execute(async (client) => {
      await client.hSet(`agent:${agentId}`, {
        lastHeartbeat: agent.lastHeartbeat,
        status: agent.status
      });
    });
  }

  checkForCrashedAgents(): string[] {
    const crashed: string[] = [];
    const now = Date.now();

    for (const [id, agent] of this.agents) {
      if (now - agent.lastHeartbeat > this.heartbeatTimeout) {
        agent.status = 'crashed';
        crashed.push(id);
      }
    }

    return crashed;
  }
}
```

## Integration Points

### With Existing Components

1. **StateMachine (PR-003)**
   - Hub drives all state transitions
   - Ensures cold transitions trigger git commits
   - Validates transition rules

2. **RedisClient (PR-004)**
   - Uses singleton pattern for connection
   - Handles auto-spawn if needed
   - Monitors health for mode transitions

3. **LeaseManager (PR-005)**
   - Hub coordinates lease acquisition for agents
   - Monitors lease expiration
   - Handles lease cleanup on agent crash

4. **CoordinationModeManager (PR-006)**
   - Hub responds to mode changes
   - Adjusts behavior based on mode
   - Notifies agents of transitions

### With Future Components

1. **MIS Scheduler (PR-008)**
   - Hub will call scheduler to assign work
   - Passes dependency graph and agent availability

2. **Task Parser (PR-009)**
   - Hub uses parser to read task-list.md
   - Updates Redis with parsed data

3. **State Sync (PR-010)**
   - Hub triggers sync cycles
   - Manages bidirectional sync

4. **Base Agent (PR-011)**
   - Hub tracks all agent instances
   - Handles agent lifecycle events

5. **Agent Spawner (PR-012)**
   - Hub will use spawner to create agents
   - Manages agent pool sizing

## Testing Strategy

### Unit Tests
```typescript
// tests/hub.test.ts
describe('Hub', () => {
  describe('startup', () => {
    it('should initialize Redis connection');
    it('should parse task-list.md');
    it('should hydrate state from git');
    it('should start heartbeat monitoring');
    it('should reject duplicate starts');
  });

  describe('agent management', () => {
    it('should register new agents');
    it('should track heartbeats');
    it('should detect crashed agents');
    it('should reclaim work from crashed agents');
  });

  describe('shutdown', () => {
    it('should stop accepting new work');
    it('should wait for agents to finish');
    it('should sync state to git');
    it('should clean up resources');
  });
});
```

### Integration Tests
- Test with real Redis (Docker)
- Test daemon process management
- Test signal handling
- Test crash recovery

## Configuration

```typescript
interface HubConfig {
  redis?: RedisConfig;
  git?: GitConfig;
  daemon?: {
    pidFile?: string;       // default: '.lemegeton/hub.pid'
    logFile?: string;       // default: '.lemegeton/hub.log'
    workDir?: string;       // default: process.cwd()
  };
  heartbeat?: {
    interval?: number;      // default: 30000 (30 seconds)
    timeout?: number;       // default: 90000 (90 seconds)
  };
  shutdown?: {
    timeout?: number;       // default: 30000 (30 seconds)
    graceful?: boolean;     // default: true
  };
}
```

## Error Handling

1. **Startup Failures**
   - Redis connection failures → attempt auto-spawn
   - Task list parsing errors → clear error messages
   - Git access issues → helpful diagnostics

2. **Runtime Failures**
   - Agent crashes → reclaim work, restart if needed
   - Redis disconnection → switch to degraded mode
   - State corruption → recovery from git

3. **Shutdown Issues**
   - Hanging agents → force termination after timeout
   - Sync failures → log and continue shutdown
   - Signal storms → debounce and handle gracefully

## Performance Considerations

1. **Memory Management**
   - Don't load entire git history into memory
   - Stream large task lists
   - Paginate agent lists

2. **Redis Operations**
   - Use pipelining for bulk operations
   - Implement connection pooling
   - Cache frequently accessed data

3. **Process Management**
   - Limit concurrent agent spawns
   - Implement backpressure mechanisms
   - Monitor system resources

## Security Considerations

1. **PID File Security**
   - Secure permissions (600)
   - Atomic creation/deletion
   - Validate PID before trusting

2. **Signal Handling**
   - Validate signal source if possible
   - Rate limit signal processing
   - Log all signal events

3. **Agent Authentication**
   - Verify agent identity in heartbeats
   - Use secure tokens if needed
   - Prevent agent impersonation

## Success Criteria

1. ✅ Hub starts as daemon and writes PID file
2. ✅ Parses task-list.md and hydrates Redis
3. ✅ Monitors agent heartbeats correctly
4. ✅ Handles graceful shutdown with state preservation
5. ✅ Recovers from crashes without data loss
6. ✅ Integrates cleanly with all Block 1-2 components
7. ✅ Provides foundation for Block 3 components

## Notes

- This is the central nervous system of Lemegeton
- Must be extremely robust and well-tested
- Performance here affects entire system
- Good logging essential for debugging
- Consider adding admin API in future