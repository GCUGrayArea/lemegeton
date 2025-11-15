/**
 * Process Manager
 *
 * Manages the lifecycle of agent processes:
 * - Process spawning via AgentSpawner
 * - Process monitoring and health checks
 * - Crash detection and auto-restart
 * - Clean shutdown
 */

import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';
import { AgentSpawner, SpawnedAgent, AgentSpawnConfig } from './agentSpawner';
import { AgentRegistry, AgentType, AgentInfo } from './agentRegistry';

/**
 * Process manager configuration
 */
export interface ProcessManagerConfig {
  maxAgents?: number;
  autoRestart?: boolean;
  restartDelay?: number;
  shutdownTimeout?: number;
  maxRestartAttempts?: number;
}

/**
 * Process exit information
 */
export interface ProcessExit {
  agentId: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  timestamp: number;
}

/**
 * Process error information
 */
export interface ProcessError {
  agentId: string;
  error: Error;
  timestamp: number;
}

/**
 * ProcessManager handles agent process lifecycle
 */
export class ProcessManager extends EventEmitter {
  private spawner: AgentSpawner;
  private registry: AgentRegistry;
  private processes: Map<string, SpawnedAgent> = new Map();
  private restartAttempts: Map<string, number> = new Map();
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
      maxRestartAttempts: config.maxRestartAttempts || 3,
    };

    this.setupListeners();
  }

  /**
   * Spawn a new agent process
   */
  async spawnAgent(config: AgentSpawnConfig): Promise<string> {
    // Check limits
    if (this.processes.size >= this.config.maxAgents) {
      throw new Error(
        `Maximum agent limit reached (${this.config.maxAgents})`
      );
    }

    try {
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

      // Reset restart attempts on successful spawn
      this.restartAttempts.delete(spawned.agentId);

      console.log(
        `[ProcessManager] Spawned ${spawned.type} agent: ${spawned.agentId} (PID: ${spawned.pid})`
      );

      this.emit('agentSpawned', {
        agentId: spawned.agentId,
        type: spawned.type,
        pid: spawned.pid,
      });

      return spawned.agentId;
    } catch (error) {
      console.error('[ProcessManager] Failed to spawn agent:', error);
      throw error;
    }
  }

  /**
   * Terminate an agent gracefully
   */
  async terminateAgent(agentId: string, force: boolean = false): Promise<void> {
    const spawned = this.processes.get(agentId);
    if (!spawned) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    console.log(`[ProcessManager] Terminating agent ${agentId}...`);

    if (force) {
      // Force kill immediately
      spawned.process.kill('SIGKILL');
    } else {
      // Send SIGTERM for graceful shutdown
      spawned.process.kill('SIGTERM');

      // Wait for graceful shutdown
      await this.waitForExit(spawned.process, 5000);

      // Force kill if still running
      if (!spawned.process.killed) {
        console.log(`[ProcessManager] Force killing agent ${agentId}`);
        spawned.process.kill('SIGKILL');
      }
    }

    // Cleanup will be handled by exit event
  }

  /**
   * Shutdown all agents
   */
  async shutdownAll(): Promise<void> {
    this.shuttingDown = true;

    console.log(
      `[ProcessManager] Shutting down ${this.processes.size} agents...`
    );

    const agentIds = Array.from(this.processes.keys());

    // Terminate all agents in parallel
    const shutdownPromises = agentIds.map((id) =>
      this.terminateAgent(id).catch((err) => {
        console.error(`[ProcessManager] Error terminating ${id}:`, err);
      })
    );

    // Wait for all shutdowns with timeout
    await Promise.race([
      Promise.all(shutdownPromises),
      new Promise((resolve) =>
        setTimeout(resolve, this.config.shutdownTimeout)
      ),
    ]);

    console.log('[ProcessManager] All agents shut down');

    this.emit('allAgentsShutdown');
  }

  /**
   * Get list of running agent IDs
   */
  getRunningAgents(): string[] {
    return Array.from(this.processes.keys());
  }

  /**
   * Get running agent count
   */
  getAgentCount(): number {
    return this.processes.size;
  }

  /**
   * Get agents by type
   */
  getAgentsByType(type: AgentType): string[] {
    return Array.from(this.processes.values())
      .filter((spawned) => spawned.type === type)
      .map((spawned) => spawned.agentId);
  }

  /**
   * Get agent process info
   */
  getAgentProcess(agentId: string): SpawnedAgent | undefined {
    return this.processes.get(agentId);
  }

  /**
   * Check if agent is running
   */
  isAgentRunning(agentId: string): boolean {
    return this.processes.has(agentId);
  }

  /**
   * Monitor a spawned process
   */
  private monitorProcess(spawned: SpawnedAgent): void {
    // Handle process exit
    spawned.process.on('exit', async (code, signal) => {
      const exitInfo: ProcessExit = {
        agentId: spawned.agentId,
        code,
        signal,
        timestamp: Date.now(),
      };

      console.log(
        `[ProcessManager] Agent ${spawned.agentId} exited (code: ${code}, signal: ${signal})`
      );

      // Cleanup
      await this.cleanup(spawned.agentId);

      // Emit exit event
      this.emit('agentExit', exitInfo);

      // Auto-restart if configured and not shutting down
      if (this.shouldRestart(spawned, code)) {
        await this.scheduleRestart(spawned);
      }
    });

    // Handle process errors
    spawned.process.on('error', (error) => {
      const errorInfo: ProcessError = {
        agentId: spawned.agentId,
        error,
        timestamp: Date.now(),
      };

      console.error(
        `[ProcessManager] Process error for ${spawned.agentId}:`,
        error
      );

      this.emit('processError', errorInfo);
    });
  }

  /**
   * Determine if agent should be restarted
   */
  private shouldRestart(spawned: SpawnedAgent, exitCode: number | null): boolean {
    // Don't restart if shutting down
    if (this.shuttingDown) {
      return false;
    }

    // Don't restart if auto-restart disabled
    if (!this.config.autoRestart) {
      return false;
    }

    // Don't restart if exited cleanly
    if (exitCode === 0) {
      return false;
    }

    // Check restart attempt limit
    const attempts = this.restartAttempts.get(spawned.agentId) || 0;
    if (attempts >= this.config.maxRestartAttempts) {
      console.log(
        `[ProcessManager] Agent ${spawned.agentId} exceeded max restart attempts (${this.config.maxRestartAttempts})`
      );
      return false;
    }

    return true;
  }

  /**
   * Schedule agent restart
   */
  private async scheduleRestart(spawned: SpawnedAgent): Promise<void> {
    const attempts = this.restartAttempts.get(spawned.agentId) || 0;
    this.restartAttempts.set(spawned.agentId, attempts + 1);

    console.log(
      `[ProcessManager] Restarting agent ${spawned.agentId} in ${this.config.restartDelay}ms (attempt ${attempts + 1}/${this.config.maxRestartAttempts})...`
    );

    setTimeout(async () => {
      try {
        await this.spawnAgent({
          agentType: spawned.type,
          agentId: spawned.agentId, // Reuse same ID
        });

        console.log(`[ProcessManager] Successfully restarted ${spawned.agentId}`);

        this.emit('agentRestarted', {
          agentId: spawned.agentId,
          attempt: attempts + 1,
        });
      } catch (error) {
        console.error(
          `[ProcessManager] Failed to restart agent ${spawned.agentId}:`,
          error
        );

        this.emit('restartFailed', {
          agentId: spawned.agentId,
          attempt: attempts + 1,
          error,
        });
      }
    }, this.config.restartDelay);
  }

  /**
   * Cleanup agent resources
   */
  private async cleanup(agentId: string): Promise<void> {
    // Remove from process map
    this.processes.delete(agentId);

    // Remove from registry
    try {
      await this.registry.removeAgent(agentId);
    } catch (error) {
      console.error(
        `[ProcessManager] Error removing agent ${agentId} from registry:`,
        error
      );
    }

    console.log(`[ProcessManager] Cleaned up agent ${agentId}`);
  }

  /**
   * Wait for process to exit
   */
  private async waitForExit(
    process: ChildProcess,
    timeout: number
  ): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeout);

      process.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Setup event listeners
   */
  private setupListeners(): void {
    // Handle process signals for graceful shutdown
    const shutdownHandler = async () => {
      console.log(
        '[ProcessManager] Received shutdown signal, shutting down agents...'
      );
      await this.shutdownAll();
    };

    process.on('SIGTERM', shutdownHandler);
    process.on('SIGINT', shutdownHandler);

    // Forward spawner events
    this.spawner.on('spawned', (spawned) => {
      this.emit('spawnerEvent', { type: 'spawned', data: spawned });
    });

    this.spawner.on('stdout', (data) => {
      this.emit('stdout', data);
    });

    this.spawner.on('stderr', (data) => {
      this.emit('stderr', data);
    });

    this.spawner.on('error', (data) => {
      this.emit('spawnerError', data);
    });
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    total: number;
    byType: Record<AgentType, number>;
    restartAttempts: Record<string, number>;
  } {
    const byType: Record<AgentType, number> = {
      worker: 0,
      qc: 0,
      planning: 0,
      review: 0,
    };

    for (const spawned of this.processes.values()) {
      byType[spawned.type]++;
    }

    const restartAttempts: Record<string, number> = {};
    for (const [agentId, attempts] of this.restartAttempts.entries()) {
      restartAttempts[agentId] = attempts;
    }

    return {
      total: this.processes.size,
      byType,
      restartAttempts,
    };
  }

  /**
   * Cleanup (for testing)
   */
  async destroy(): Promise<void> {
    await this.shutdownAll();
    this.removeAllListeners();
    this.processes.clear();
    this.restartAttempts.clear();
  }
}
