/**
 * Hub Client
 *
 * Client for interacting with the Hub daemon from CLI commands.
 * Handles daemon lifecycle, status queries, and work execution.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { RedisClient } from '../redis/client';
import { Hub } from '../hub';
import { AgentInfo, AgentType } from '../hub/agentRegistry';
import { CoordinationMode } from '../core/coordinationMode';
import {
  HubNotRunningError,
  HubAlreadyRunningError,
  DaemonSpawnError,
  ShutdownTimeoutError
} from './errors';
import { HubStatus, TaskProgress, WorkResult } from './formatters';
import { ColdState } from '../types/pr';
import { PRNode, Priority } from '../scheduler/types';

/**
 * Hub start options
 */
export interface HubStartOptions {
  config?: string;
  foreground?: boolean;
  verbose?: boolean;
  detach?: boolean;
}

/**
 * Hub stop options
 */
export interface HubStopOptions {
  force?: boolean;
  timeout?: number;
}

/**
 * Run options
 */
export interface RunOptions {
  watch?: boolean;
  assignOnly?: boolean;
  agent?: string;
  model?: string;
  budget?: number;
  dryRun?: boolean;
}

/**
 * Hub start result
 */
export interface HubStartResult {
  pid: number;
  mode: 'foreground' | 'daemon';
}

/**
 * Hub client for daemon management
 */
export class HubClient {
  private pidFile: string;
  private redis: RedisClient | null = null;

  constructor(
    private workDir: string = process.cwd(),
    pidFile?: string
  ) {
    this.pidFile = pidFile || path.join(workDir, '.lemegeton', 'hub.pid');
  }

  /**
   * Start the hub daemon
   */
  async startHub(options: HubStartOptions = {}): Promise<HubStartResult> {
    // Check if already running
    const existingPid = await this.findDaemonPid();
    if (existingPid) {
      throw new HubAlreadyRunningError(existingPid);
    }

    // Create .lemegeton directory if it doesn't exist
    const lemegetonDir = path.join(this.workDir, '.lemegeton');
    if (!fs.existsSync(lemegetonDir)) {
      fs.mkdirSync(lemegetonDir, { recursive: true });
    }

    // Start in foreground or background
    if (options.foreground) {
      return this.startForeground(options);
    } else {
      return this.startDaemon(options);
    }
  }

  /**
   * Start hub in foreground mode
   */
  private async startForeground(options: HubStartOptions): Promise<HubStartResult> {
    console.log('[HubClient] Starting Hub in foreground mode...');

    const hub = new Hub({
      daemon: {
        pidFile: this.pidFile,
        logFile: path.join(this.workDir, '.lemegeton', 'hub.log'),
        workDir: this.workDir
      }
    });

    await hub.start();

    // Write PID file
    this.writePidFile(process.pid);

    return {
      pid: process.pid,
      mode: 'foreground'
    };
  }

  /**
   * Start hub as daemon
   */
  private async startDaemon(options: HubStartOptions): Promise<HubStartResult> {
    console.log('[HubClient] Starting Hub daemon...');

    const pid = await this.spawnDaemon(options);

    // Wait a bit and verify daemon started
    await new Promise(resolve => setTimeout(resolve, 1000));

    const runningPid = await this.findDaemonPid();
    if (!runningPid) {
      throw new DaemonSpawnError('Daemon process did not start');
    }

    return {
      pid: runningPid,
      mode: 'daemon'
    };
  }

  /**
   * Spawn daemon process
   */
  private async spawnDaemon(options: HubStartOptions): Promise<number> {
    const scriptPath = path.join(__dirname, '..', 'hub', 'daemonEntry.js');
    const logFile = path.join(this.workDir, '.lemegeton', 'hub.log');

    // Open log file
    const out = fs.openSync(logFile, 'a');
    const err = fs.openSync(logFile, 'a');

    try {
      // Spawn detached process
      const child: ChildProcess = spawn(
        process.execPath,
        [scriptPath],
        {
          detached: true,
          stdio: ['ignore', out, err],
          cwd: this.workDir,
          env: {
            ...process.env,
            LEMEGETON_DAEMON: 'true',
            LEMEGETON_PID_FILE: this.pidFile,
            LEMEGETON_WORK_DIR: this.workDir
          }
        }
      );

      if (!child.pid) {
        throw new DaemonSpawnError('Failed to get child process PID');
      }

      // Detach from parent
      child.unref();

      // Write PID file
      this.writePidFile(child.pid);

      return child.pid;
    } catch (error) {
      throw new DaemonSpawnError(
        error instanceof Error ? error.message : 'Unknown error'
      );
    } finally {
      fs.closeSync(out);
      fs.closeSync(err);
    }
  }

  /**
   * Stop the hub daemon
   */
  async stopHub(options: HubStopOptions = {}): Promise<void> {
    const pid = await this.findDaemonPid();

    if (!pid) {
      throw new HubNotRunningError();
    }

    console.log(`[HubClient] Stopping Hub daemon (PID: ${pid})...`);

    // Send SIGTERM for graceful shutdown
    const signal = options.force ? 'SIGKILL' : 'SIGTERM';
    const timeout = options.timeout || 30000;

    try {
      await this.killDaemon(pid, signal, timeout);
      console.log('[HubClient] Hub daemon stopped');
    } catch (error) {
      if (error instanceof ShutdownTimeoutError) {
        throw error;
      }
      throw new Error(`Failed to stop daemon: ${error}`);
    } finally {
      // Clean up PID file
      this.removePidFile();
    }
  }

  /**
   * Get hub status
   */
  async getStatus(): Promise<HubStatus> {
    const pid = await this.findDaemonPid();

    if (!pid) {
      return {
        running: false,
        agents: []
      };
    }

    // Connect to Redis to get status
    await this.ensureRedisConnection();

    const agents = await this.getAgents();
    const mode = await this.getCoordinationMode();
    const taskProgress = await this.getTaskProgress();

    return {
      running: true,
      pid,
      mode,
      agents,
      taskProgress
    };
  }

  /**
   * Run a specific PR
   */
  async runPR(prId: string, options: RunOptions = {}): Promise<WorkResult> {
    const pid = await this.findDaemonPid();

    if (pid) {
      // Daemon mode: Hub is running, use messaging (TODO: Phase 1B)
      throw new Error('Daemon mode not yet implemented. Please run without Hub daemon for testing.');
    } else {
      // In-process mode: No daemon, run Hub in current process
      return this.runInProcess(prId, options);
    }
  }

  /**
   * Run all available work
   */
  async runAll(options: RunOptions = {}): Promise<WorkResult[]> {
    const pid = await this.findDaemonPid();

    if (pid) {
      // Daemon mode: Hub is running, use messaging (TODO: Phase 1B)
      throw new Error('Daemon mode not yet implemented. Please run without Hub daemon for testing.');
    } else {
      // In-process mode: No daemon, run Hub in current process
      // TODO: Implement runAllInProcess
      throw new Error('runAll in-process mode not yet implemented. Use runPR for single PR testing.');
    }
  }

  /**
   * Run a PR in-process (no daemon)
   */
  private async runInProcess(prId: string, options: RunOptions): Promise<WorkResult> {
    console.log(`[HubClient] Running PR ${prId} in-process mode...`);

    const startTime = Date.now();
    let hub: Hub | null = null;

    try {
      // Create Hub in foreground mode
      hub = new Hub({
        daemon: {
          workDir: this.workDir,
          pidFile: this.pidFile,
          logFile: path.join(this.workDir, '.lemegeton', 'hub-inprocess.log'),
        },
        redis: {
          autoSpawn: true,
        },
      });

      // Start Hub
      await hub.start();

      // Get components
      const scheduler = hub.getScheduler();
      const processManager = hub.getProcessManager();
      const redisClient = hub.getRedisClient();

      if (!scheduler || !processManager || !redisClient) {
        throw new Error('Hub components not initialized');
      }

      // Get PR from Redis state
      const prNode = await this.getPRFromRedis(redisClient, prId);
      if (!prNode) {
        throw new Error(`PR not found: ${prId}`);
      }

      // Check if PR is in a workable state
      if (!this.isPRWorkable(prNode)) {
        throw new Error(`PR ${prId} is not in a workable state (current: ${prNode.state})`);
      }

      // Determine agent type needed for this PR
      const agentType = this.getAgentTypeForPR(prNode);

      console.log(`[HubClient] Spawning ${agentType} agent for ${prId}...`);

      // Spawn agent
      const agentId = await processManager.spawnAgent({
        agentType,
        workDir: this.workDir,
      });

      if (options.dryRun) {
        console.log(`[HubClient] Dry run: Would assign ${prId} to ${agentId}`);
        const duration = Date.now() - startTime;
        return {
          prId,
          success: true,
          duration,
        };
      }

      console.log(`[HubClient] Spawned agent ${agentId}`);
      console.log(`[HubClient] Assigning ${prId} to ${agentId}...`);

      // For --assign-only mode, return after assignment
      if (options.assignOnly) {
        // Give agent time to subscribe to its channel
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Send assignment to agent
        await this.sendAssignment(hub, agentId, prNode);

        const duration = Date.now() - startTime;
        return {
          prId,
          success: true,
          duration,
          output: `Assigned to agent ${agentId}`,
        };
      }

      // Give agent time to start and subscribe to its channel
      console.log(`[HubClient] Waiting for agent to initialize...`);
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Send assignment and wait for completion
      console.log(`[HubClient] Sending assignment to ${agentId}...`);
      const result = await this.sendAssignmentAndWait(hub, agentId, prNode, 120000);

      const duration = Date.now() - startTime;
      if (result) {
        return {
          prId,
          success: result.success,
          duration,
          output: result.output,
          error: result.error,
        };
      } else {
        return {
          prId,
          success: false,
          duration,
          error: 'Agent did not respond with completion',
        };
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[HubClient] Error running PR ${prId}:`, errorMessage);
      return {
        prId,
        success: false,
        duration,
        error: errorMessage,
      };
    } finally {
      // Clean up Hub
      if (hub) {
        console.log('[HubClient] Stopping Hub...');
        await hub.stop();
      }
    }
  }

  /**
   * Get PR data from Redis
   */
  private async getPRFromRedis(redisClient: RedisClient, prId: string): Promise<PRNode | null> {
    try {
      const client = redisClient.getClient();
      const prsData = await client.get('state:prs');
      if (!prsData) {
        return null;
      }

      const prs = JSON.parse(prsData);
      const prData = prs[prId];
      if (!prData) {
        return null;
      }

      // Convert to PRNode format
      return {
        id: prId,
        title: prData.title || 'Unknown',
        state: prData.cold_state,
        dependencies: new Set(prData.dependencies || []),
        dependents: new Set(), // Would need to compute from full PR list
        files: new Set(prData.files || []),
        priority: prData.priority || 'medium',
        complexity: prData.complexity || 5,
        estimatedMinutes: prData.estimatedMinutes || 60,
        suggestedModel: prData.suggestedModel,
      };
    } catch (error) {
      console.error(`[HubClient] Error fetching PR ${prId} from Redis:`, error);
      return null;
    }
  }

  /**
   * Check if PR is in a workable state
   */
  private isPRWorkable(pr: PRNode): boolean {
    const workableStates: ColdState[] = ['new', 'ready', 'planned', 'completed', 'broken'];
    return workableStates.includes(pr.state);
  }

  /**
   * Determine agent type needed for a PR
   */
  private getAgentTypeForPR(pr: PRNode): AgentType {
    // Map PR state to agent type
    switch (pr.state) {
      case 'new':
      case 'ready':
        return 'planning';
      case 'planned':
      case 'broken':
        return 'worker';
      case 'completed':
        return 'qc';
      default:
        return 'worker';
    }
  }

  /**
   * Send assignment to agent
   */
  private async sendAssignment(hub: Hub, agentId: string, prNode: PRNode): Promise<void> {
    const messageBus = hub.getMessageBus();
    if (!messageBus) {
      throw new Error('MessageBus not initialized');
    }

    const assignmentChannel = `agent:${agentId}:assignments`;
    const assignment = {
      prId: prNode.id,
      assignedAt: Date.now(),
      priority: prNode.priority,
      complexity: prNode.complexity,
      estimatedDuration: prNode.estimatedMinutes,
      files: Array.from(prNode.files),
    };

    console.log(`[HubClient] Publishing assignment to channel: ${assignmentChannel}`);
    await messageBus.publish(assignmentChannel, assignment);
  }

  /**
   * Send assignment and wait for completion
   */
  private async sendAssignmentAndWait(
    hub: Hub,
    agentId: string,
    prNode: PRNode,
    timeoutMs: number
  ): Promise<WorkResult | null> {
    const messageBus = hub.getMessageBus();
    if (!messageBus) {
      throw new Error('MessageBus not initialized');
    }

    // Subscribe to completion messages from Hub
    const hubChannel = 'hub:messages';
    let completionResult: WorkResult | null = null;

    const completionPromise = new Promise<WorkResult | null>((resolve) => {
      const handler = (message: any) => {
        if (message.type === 'complete' && message.agentId === agentId) {
          console.log(`[HubClient] Received completion from ${agentId}`);
          completionResult = message.result;
          resolve(message.result);
        } else if (message.type === 'failed' && message.agentId === agentId) {
          console.log(`[HubClient] Received failure from ${agentId}`);
          resolve({
            prId: prNode.id,
            success: false,
            error: message.error?.message || 'Agent failed',
          });
        }
      };

      messageBus.subscribe(hubChannel, handler);
    });

    // Send assignment
    await this.sendAssignment(hub, agentId, prNode);

    // Wait for completion or timeout
    const timeoutPromise = new Promise<WorkResult | null>((resolve) => {
      setTimeout(() => {
        console.log(`[HubClient] Timeout waiting for agent ${agentId}`);
        resolve(null);
      }, timeoutMs);
    });

    return Promise.race([completionPromise, timeoutPromise]);
  }

  /**
   * Get active agents
   */
  async getAgents(): Promise<AgentInfo[]> {
    await this.ensureRedisConnection();

    // TODO: Query agents from Redis
    // For now, return empty array
    return [];
  }

  /**
   * Get task progress
   */
  async getTaskProgress(): Promise<TaskProgress> {
    await this.ensureRedisConnection();

    try {
      // Query PRs from Redis
      const client = this.redis!.getClient();
      const prsData = await client.get('state:prs');
      if (!prsData) {
        return {
          total: 0,
          completed: 0,
          inProgress: 0,
          pending: 0,
          failed: 0
        };
      }

      const prs = JSON.parse(prsData);
      const prList = Object.values(prs) as any[];

      // Count PRs by state
      const progress = {
        total: prList.length,
        completed: 0,
        inProgress: 0,
        pending: 0,
        failed: 0
      };

      for (const pr of prList) {
        switch (pr.cold_state) {
          case 'completed':
            progress.completed++;
            break;
          case 'in_progress':
            progress.inProgress++;
            break;
          case 'new':
          case 'blocked':
          case 'deferred':
            progress.pending++;
            break;
          case 'failed':
            progress.failed++;
            break;
        }
      }

      return progress;
    } catch (error) {
      // Return zeros if can't query Redis
      return {
        total: 0,
        completed: 0,
        inProgress: 0,
        pending: 0,
        failed: 0
      };
    }
  }

  /**
   * Get coordination mode
   */
  async getCoordinationMode(): Promise<CoordinationMode> {
    await this.ensureRedisConnection();

    try {
      // Query coordination mode from Redis
      const client = this.redis!.getClient();
      const modeData = await client.get('coordination:mode');
      if (modeData) {
        return modeData as CoordinationMode;
      }
    } catch (error) {
      // Fall through to default
    }

    // Default to distributed mode
    return CoordinationMode.DISTRIBUTED;
  }

  /**
   * Find daemon PID
   */
  private async findDaemonPid(): Promise<number | null> {
    if (!fs.existsSync(this.pidFile)) {
      return null;
    }

    try {
      const pidString = fs.readFileSync(this.pidFile, 'utf8').trim();
      const pid = parseInt(pidString, 10);

      if (isNaN(pid)) {
        return null;
      }

      // Check if process is running
      if (this.isProcessRunning(pid)) {
        return pid;
      }

      // PID file exists but process is not running - clean up
      this.removePidFile();
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if process is running
   */
  private isProcessRunning(pid: number): boolean {
    try {
      // Send signal 0 to check if process exists
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Kill daemon process
   */
  private async killDaemon(
    pid: number,
    signal: NodeJS.Signals,
    timeout: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Set timeout
      const timer = setTimeout(() => {
        reject(new ShutdownTimeoutError(timeout));
      }, timeout);

      // Send kill signal
      try {
        process.kill(pid, signal);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
        return;
      }

      // Poll for process exit
      const pollInterval = setInterval(() => {
        if (!this.isProcessRunning(pid)) {
          clearTimeout(timer);
          clearInterval(pollInterval);
          resolve();
        }
      }, 100);
    });
  }

  /**
   * Write PID file
   */
  private writePidFile(pid: number): void {
    const dir = path.dirname(this.pidFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.pidFile, pid.toString(), 'utf8');
  }

  /**
   * Remove PID file
   */
  private removePidFile(): void {
    if (fs.existsSync(this.pidFile)) {
      fs.unlinkSync(this.pidFile);
    }
  }

  /**
   * Ensure Redis connection
   */
  private async ensureRedisConnection(): Promise<void> {
    if (!this.redis) {
      this.redis = new RedisClient();
      await this.redis.connect();
    }
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.disconnect();
      this.redis = null;
    }
  }
}
