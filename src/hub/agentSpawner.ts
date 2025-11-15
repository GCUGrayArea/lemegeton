/**
 * Agent Spawner
 *
 * Spawns agent processes on demand with proper configuration.
 * Supports different agent types: Worker, QC, Planning, Review
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import { AgentType } from './agentRegistry';

/**
 * Agent spawn configuration
 */
export interface AgentSpawnConfig {
  agentType: AgentType;
  redisUrl?: string;
  workDir?: string;
  env?: Record<string, string>;
  agentId?: string; // Optional override for restart scenarios
  heartbeatInterval?: number;
  heartbeatTimeout?: number;
}

/**
 * Information about a spawned agent
 */
export interface SpawnedAgent {
  agentId: string;
  type: AgentType;
  process: ChildProcess;
  pid: number;
  spawnedAt: number;
}

/**
 * AgentSpawner spawns and configures agent processes
 */
export class AgentSpawner extends EventEmitter {
  private agentCounter: Map<AgentType, number> = new Map();
  private config: {
    redisUrl?: string;
    workDir?: string;
  };

  constructor(config: {
    redisUrl?: string;
    workDir?: string;
  } = {}) {
    super();
    this.config = {
      redisUrl: config.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379',
      workDir: config.workDir || process.cwd(),
    };
  }

  /**
   * Spawn an agent process
   */
  async spawnAgent(config: AgentSpawnConfig): Promise<SpawnedAgent> {
    // Generate unique agent ID if not provided
    const agentId = config.agentId || this.generateAgentId(config.agentType);

    // Determine agent entry point based on type
    const entryPoint = this.getAgentEntryPoint(config.agentType);

    // Prepare environment variables
    const env = this.prepareEnvironment(config, agentId);

    // Spawn the process
    const child = spawn(process.execPath, [entryPoint], {
      cwd: config.workDir || this.config.workDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout/stderr
      detached: false, // Keep attached for lifecycle management
    });

    // Verify process was spawned
    if (!child.pid) {
      throw new Error(`Failed to spawn ${config.agentType} agent`);
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

    // Setup error handling
    this.setupErrorHandling(child, agentId);

    // Emit spawn event
    this.emit('spawned', spawned);

    console.log(`[AgentSpawner] Spawned ${config.agentType} agent: ${agentId} (PID: ${child.pid})`);

    return spawned;
  }

  /**
   * Generate unique agent ID
   */
  private generateAgentId(type: AgentType): string {
    const count = this.agentCounter.get(type) || 0;
    this.agentCounter.set(type, count + 1);
    return `${type}-agent-${count + 1}`;
  }

  /**
   * Get agent entry point based on type
   */
  private getAgentEntryPoint(type: AgentType): string {
    const agentMap: Record<AgentType, string> = {
      worker: path.join(__dirname, '../agents/worker.js'),
      qc: path.join(__dirname, '../agents/qc.js'),
      planning: path.join(__dirname, '../agents/planning.js'),
      review: path.join(__dirname, '../agents/review.js'),
    };

    const entryPoint = agentMap[type];
    if (!entryPoint) {
      throw new Error(`Unknown agent type: ${type}`);
    }

    return entryPoint;
  }

  /**
   * Prepare environment variables for agent
   */
  private prepareEnvironment(
    config: AgentSpawnConfig,
    agentId: string
  ): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...config.env,
      AGENT_ID: agentId,
      AGENT_TYPE: config.agentType,
      REDIS_URL: config.redisUrl || this.config.redisUrl,
      HEARTBEAT_INTERVAL: String(config.heartbeatInterval || 30000),
      HEARTBEAT_TIMEOUT: String(config.heartbeatTimeout || 90000),
      NODE_ENV: process.env.NODE_ENV || 'production',
    };
  }

  /**
   * Setup output capture for agent process
   */
  private setupOutputCapture(child: ChildProcess, agentId: string): void {
    // Capture stdout
    child.stdout?.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        this.emit('stdout', { agentId, data: output });
        console.log(`[${agentId}] ${output}`);
      }
    });

    // Capture stderr
    child.stderr?.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        this.emit('stderr', { agentId, data: output });
        console.error(`[${agentId}] ERROR: ${output}`);
      }
    });
  }

  /**
   * Setup error handling for agent process
   */
  private setupErrorHandling(child: ChildProcess, agentId: string): void {
    child.on('error', (error) => {
      console.error(`[AgentSpawner] Process error for ${agentId}:`, error);
      this.emit('error', { agentId, error });
    });
  }

  /**
   * Get current agent counts
   */
  getAgentCounts(): Record<AgentType, number> {
    return {
      worker: this.agentCounter.get('worker') || 0,
      qc: this.agentCounter.get('qc') || 0,
      planning: this.agentCounter.get('planning') || 0,
      review: this.agentCounter.get('review') || 0,
    };
  }

  /**
   * Reset agent counter (for testing)
   */
  resetCounters(): void {
    this.agentCounter.clear();
  }
}
