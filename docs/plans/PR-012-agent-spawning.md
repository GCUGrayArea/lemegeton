# PR-012: Agent Process Spawning - Implementation Plan

**Status:** In Progress
**PR ID:** PR-012
**Dependencies:** PR-007 (Hub Daemon), PR-011 (BaseAgent)
**Estimated Complexity:** 6/10
**Estimated Time:** 60 minutes

---

## Overview

This PR implements the agent process spawning system that allows the Hub to spawn, manage, and monitor agent processes on demand. It integrates with the existing Hub daemon (PR-007) and BaseAgent class (PR-011) to provide reliable process lifecycle management.

## Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────────────┐
│                         Hub Process                          │
│  ┌────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ AgentSpawner   │──│ ProcessManager  │──│ AgentRegistry│ │
│  │ - spawn()      │  │ - track PIDs    │  │ - heartbeats │ │
│  │ - configure()  │  │ - monitor health│  │ - status     │ │
│  └────────────────┘  └─────────────────┘  └──────────────┘ │
│         │                     │                    │         │
│         └─────────────────────┴────────────────────┘         │
└─────────────────────────────────────────────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
    ┌────────────┐     ┌────────────┐    ┌────────────┐
    │ Worker     │     │ QC Agent   │    │ Planning   │
    │ Agent      │     │ Process    │    │ Agent      │
    │ (BaseAgent)│     │ (BaseAgent)│    │ (BaseAgent)│
    └────────────┘     └────────────┘    └────────────┘
```

### Component Responsibilities

#### 1. AgentSpawner (`src/hub/agentSpawner.ts`)
- **Purpose:** Spawn new agent processes with proper configuration
- **Responsibilities:**
  - Spawn child processes for different agent types
  - Configure agent environment (Redis URL, agent ID, type)
  - Handle spawning errors
  - Support different agent types (Worker, QC, Planning, Review)
  - Generate unique agent IDs
  - Pass configuration to child processes

#### 2. ProcessManager (`src/hub/processManager.ts`)
- **Purpose:** Manage the lifecycle of spawned processes
- **Responsibilities:**
  - Track process PIDs and metadata
  - Monitor process health via exit events
  - Detect crashed processes
  - Clean shutdown of all processes
  - Reclaim crashed agent resources
  - Handle SIGTERM/SIGINT for graceful shutdown
  - Restart crashed agents (configurable)

#### 3. AgentRegistry (MODIFY `src/hub/agentRegistry.ts`)
- **Purpose:** Track running agents and their state
- **Enhancements needed:**
  - Add PID tracking (already exists)
  - Track process spawn time
  - Monitor heartbeats (already exists)
  - Detect crashed agents (already exists)
  - Clean up crashed agent resources
  - Query available agents by type

**Note:** AgentRegistry already has most of the needed functionality from PR-007. We'll extend it minimally to integrate with ProcessManager.

## Implementation Strategy

### Phase 1: Core Process Spawning

#### File: `src/hub/agentSpawner.ts`

```typescript
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { AgentType } from './agentRegistry';

export interface AgentSpawnConfig {
  agentType: AgentType;
  redisUrl?: string;
  workDir?: string;
  env?: Record<string, string>;
  agentId?: string; // Optional override
}

export interface SpawnedAgent {
  agentId: string;
  type: AgentType;
  process: ChildProcess;
  pid: number;
  spawnedAt: number;
}

export class AgentSpawner extends EventEmitter {
  private agentCounter: Map<AgentType, number> = new Map();

  constructor(private config: {
    redisUrl?: string;
    workDir?: string;
  }) {
    super();
  }

  async spawnAgent(config: AgentSpawnConfig): Promise<SpawnedAgent> {
    // Generate unique agent ID
    const agentId = config.agentId || this.generateAgentId(config.agentType);

    // Prepare environment
    const env = {
      ...process.env,
      ...config.env,
      AGENT_ID: agentId,
      AGENT_TYPE: config.agentType,
      REDIS_URL: config.redisUrl || this.config.redisUrl,
      NODE_ENV: process.env.NODE_ENV || 'production',
    };

    // Spawn process
    const child = spawn(process.execPath, [
      // Path to agent entry point
      require.resolve('../agents/worker'), // Will be different per type
    ], {
      cwd: config.workDir || this.config.workDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout/stderr
      detached: false, // Keep attached for lifecycle management
    });

    if (!child.pid) {
      throw new Error('Failed to spawn agent process');
    }

    const spawned: SpawnedAgent = {
      agentId,
      type: config.agentType,
      process: child,
      pid: child.pid,
      spawnedAt: Date.now(),
    };

    // Setup output capture
    this.setupOutputCapture(child, agentId);

    // Emit spawn event
    this.emit('spawned', spawned);

    return spawned;
  }

  private generateAgentId(type: AgentType): string {
    const count = this.agentCounter.get(type) || 0;
    this.agentCounter.set(type, count + 1);
    return `${type}-agent-${count + 1}`;
  }

  private setupOutputCapture(child: ChildProcess, agentId: string): void {
    // Capture stdout
    child.stdout?.on('data', (data) => {
      this.emit('stdout', { agentId, data: data.toString() });
    });

    // Capture stderr
    child.stderr?.on('data', (data) => {
      this.emit('stderr', { agentId, data: data.toString() });
    });
  }
}
```

#### File: `src/hub/processManager.ts`

```typescript
import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';
import { AgentSpawner, SpawnedAgent, AgentSpawnConfig } from './agentSpawner';
import { AgentRegistry, AgentType, AgentInfo } from './agentRegistry';

export interface ProcessManagerConfig {
  maxAgents?: number;
  autoRestart?: boolean;
  restartDelay?: number;
  shutdownTimeout?: number;
}

export class ProcessManager extends EventEmitter {
  private spawner: AgentSpawner;
  private registry: AgentRegistry;
  private processes: Map<string, SpawnedAgent> = new Map();
  private config: Required<ProcessManagerConfig>;
  private shuttingDown: boolean = false;

  constructor(
    spawner: AgentSpawner,
    registry: AgentRegistry,
    config: ProcessManagerConfig = {}
  ) {
    super();
    this.spawner = spawner;
    this.registry = registry;
    this.config = {
      maxAgents: config.maxAgents || 10,
      autoRestart: config.autoRestart ?? true,
      restartDelay: config.restartDelay || 5000,
      shutdownTimeout: config.shutdownTimeout || 30000,
    };

    this.setupListeners();
  }

  async spawnAgent(config: AgentSpawnConfig): Promise<string> {
    // Check limits
    if (this.processes.size >= this.config.maxAgents) {
      throw new Error(`Maximum agent limit reached (${this.config.maxAgents})`);
    }

    // Spawn the agent process
    const spawned = await this.spawner.spawnAgent(config);

    // Track the process
    this.processes.set(spawned.agentId, spawned);

    // Register with registry
    const agentInfo: AgentInfo = {
      id: spawned.agentId,
      type: spawned.type,
      status: 'active',
      lastHeartbeat: Date.now(),
      assignedPR: null,
      pid: spawned.pid,
      startedAt: spawned.spawnedAt,
    };

    await this.registry.registerAgent(agentInfo);

    // Setup process monitoring
    this.monitorProcess(spawned);

    console.log(`[ProcessManager] Spawned ${spawned.type} agent: ${spawned.agentId} (PID: ${spawned.pid})`);

    return spawned.agentId;
  }

  async terminateAgent(agentId: string): Promise<void> {
    const spawned = this.processes.get(agentId);
    if (!spawned) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    console.log(`[ProcessManager] Terminating agent ${agentId}...`);

    // Send SIGTERM
    spawned.process.kill('SIGTERM');

    // Wait for graceful shutdown
    await this.waitForExit(spawned.process, 5000);

    // Force kill if still running
    if (!spawned.process.killed) {
      console.log(`[ProcessManager] Force killing agent ${agentId}`);
      spawned.process.kill('SIGKILL');
    }

    // Cleanup
    await this.cleanup(agentId);
  }

  async shutdownAll(): Promise<void> {
    this.shuttingDown = true;

    console.log(`[ProcessManager] Shutting down ${this.processes.size} agents...`);

    const agentIds = Array.from(this.processes.keys());

    // Terminate all agents in parallel
    await Promise.all(
      agentIds.map(id => this.terminateAgent(id).catch(err => {
        console.error(`[ProcessManager] Error terminating ${id}:`, err);
      }))
    );

    console.log('[ProcessManager] All agents shut down');
  }

  getRunningAgents(): string[] {
    return Array.from(this.processes.keys());
  }

  getAgentCount(): number {
    return this.processes.size;
  }

  private monitorProcess(spawned: SpawnedAgent): void {
    spawned.process.on('exit', async (code, signal) => {
      console.log(`[ProcessManager] Agent ${spawned.agentId} exited (code: ${code}, signal: ${signal})`);

      // Cleanup
      await this.cleanup(spawned.agentId);

      // Auto-restart if configured and not shutting down
      if (this.config.autoRestart && !this.shuttingDown && code !== 0) {
        console.log(`[ProcessManager] Restarting agent ${spawned.agentId} in ${this.config.restartDelay}ms...`);

        setTimeout(async () => {
          try {
            await this.spawnAgent({
              agentType: spawned.type,
              agentId: spawned.agentId, // Reuse same ID
            });
          } catch (error) {
            console.error(`[ProcessManager] Failed to restart agent ${spawned.agentId}:`, error);
          }
        }, this.config.restartDelay);
      }

      this.emit('agentExit', {
        agentId: spawned.agentId,
        code,
        signal,
      });
    });

    spawned.process.on('error', (error) => {
      console.error(`[ProcessManager] Process error for ${spawned.agentId}:`, error);
      this.emit('processError', {
        agentId: spawned.agentId,
        error,
      });
    });
  }

  private async cleanup(agentId: string): Promise<void> {
    // Remove from process map
    this.processes.delete(agentId);

    // Remove from registry
    await this.registry.removeAgent(agentId);
  }

  private async waitForExit(process: ChildProcess, timeout: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeout);

      process.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private setupListeners(): void {
    // Handle process signals
    process.on('SIGTERM', async () => {
      console.log('[ProcessManager] Received SIGTERM, shutting down agents...');
      await this.shutdownAll();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      console.log('[ProcessManager] Received SIGINT, shutting down agents...');
      await this.shutdownAll();
      process.exit(0);
    });

    // Forward spawner events
    this.spawner.on('stdout', (data) => this.emit('stdout', data));
    this.spawner.on('stderr', (data) => this.emit('stderr', data));
  }
}
```

### Phase 2: Registry Integration

Minimal changes needed to `src/hub/agentRegistry.ts`:
- Already has PID tracking
- Already has heartbeat monitoring
- Already has crash detection
- Just need to ensure integration works with ProcessManager

### Phase 3: Agent Entry Points

Need to create entry points for different agent types:

#### File: `src/agents/worker.ts`
```typescript
import { BaseAgent } from './base';
import { Assignment, WorkResult } from './types';

// Worker agent implementation
class WorkerAgent extends BaseAgent {
  async doWork(assignment: Assignment): Promise<WorkResult> {
    // Stub implementation
    return {
      success: true,
      prId: assignment.prId,
    };
  }

  async validateAssignment(assignment: Assignment): Promise<boolean> {
    return true;
  }
}

// Start agent when run as standalone process
if (require.main === module) {
  const agent = new WorkerAgent(
    process.env.AGENT_ID || 'worker-1',
    {
      agentType: process.env.AGENT_TYPE || 'worker',
      redisUrl: process.env.REDIS_URL,
    }
  );

  agent.start().catch(error => {
    console.error('Failed to start agent:', error);
    process.exit(1);
  });
}

export { WorkerAgent };
```

## Testing Strategy

### Unit Tests (`tests/agentSpawning.test.ts`)

1. **AgentSpawner Tests:**
   - Spawns agent process with correct configuration
   - Generates unique agent IDs
   - Captures stdout/stderr
   - Emits spawn events
   - Handles spawn errors

2. **ProcessManager Tests:**
   - Spawns multiple agents
   - Enforces max agent limit
   - Monitors process exit
   - Handles graceful shutdown
   - Auto-restarts crashed agents
   - Cleans up resources
   - Integrates with AgentRegistry

3. **Integration Tests:**
   - End-to-end agent lifecycle
   - Hub spawns and monitors agents
   - Agents send heartbeats
   - Crashed agents are reclaimed
   - Clean shutdown of all components

### Coverage Goals
- Target: >90% coverage
- Focus on error paths
- Test edge cases (max agents, crashes, shutdown)

## Integration Points

### With Hub Daemon (PR-007)
- Hub creates ProcessManager on startup
- Hub uses ProcessManager to spawn agents on demand
- Hub shutdown triggers agent shutdown

### With BaseAgent (PR-011)
- Agents use BaseAgent lifecycle
- Agents send heartbeats via BaseAgent
- Agents communicate state via BaseAgent

### With MIS Scheduler (PR-008)
- Scheduler requests agent spawning
- ProcessManager provides agent availability
- Agents receive work assignments

## Success Criteria

- [ ] AgentSpawner spawns processes with correct config
- [ ] ProcessManager tracks all spawned agents
- [ ] Heartbeat monitoring works end-to-end
- [ ] Crashed agents are detected and reclaimed
- [ ] Clean shutdown terminates all agents
- [ ] Different agent types supported (Worker, QC, Planning, Review)
- [ ] Tests pass with >90% coverage
- [ ] Integration with Hub verified
- [ ] No resource leaks (processes, file handles)

## Future Enhancements (Out of Scope)

- **Heterogeneous Agent Pools** (PR-TBD): Different model tiers (Haiku, Sonnet, Opus)
- **Dynamic Scaling** (PR-TBD): Auto-spawn agents based on workload
- **Agent Health Checks** (PR-TBD): Beyond heartbeats, check resource usage
- **Process Supervision** (PR-TBD): Advanced restart strategies, backoff

## Implementation Order

1. Create `src/hub/agentSpawner.ts`
2. Create `src/hub/processManager.ts`
3. Create agent entry points (`src/agents/worker.ts`, etc.)
4. Extend `src/hub/agentRegistry.ts` (minimal)
5. Create comprehensive tests
6. Integration testing
7. Documentation updates

## Dependencies

### Existing Code (Leverage)
- `src/hub/agentRegistry.ts` - Already has tracking and heartbeat logic
- `src/agents/base.ts` - BaseAgent class with lifecycle management
- `src/hub/daemon.ts` - Hub daemon for hosting ProcessManager

### New Dependencies (npm)
None - use Node.js built-in `child_process`

## Risk Mitigation

### Risk: Zombie Processes
**Mitigation:**
- Track all PIDs
- Clean shutdown on SIGTERM/SIGINT
- Force kill after timeout
- Monitor process exit events

### Risk: Resource Exhaustion
**Mitigation:**
- Max agent limit enforcement
- Process cleanup on exit
- Memory monitoring (future)

### Risk: Agent Crashes
**Mitigation:**
- Auto-restart with delay
- Crash detection via heartbeat
- Resource reclamation
- Graceful degradation

## Timeline

- **Phase 1 (30 min):** Core spawning and process management
- **Phase 2 (15 min):** Registry integration and agent entry points
- **Phase 3 (15 min):** Testing and verification

**Total Estimated Time:** 60 minutes

---

**Plan Created:** 2025-11-14
**Implementer:** Claude (Sonnet 4.5)
