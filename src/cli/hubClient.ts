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
import { AgentInfo } from '../hub/agentRegistry';
import { CoordinationMode } from '../core/coordinationMode';
import {
  HubNotRunningError,
  HubAlreadyRunningError,
  DaemonSpawnError,
  ShutdownTimeoutError
} from './errors';
import { HubStatus, TaskProgress, WorkResult } from './formatters';

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

    if (!pid) {
      throw new HubNotRunningError();
    }

    // TODO: Implement work execution via message bus (PR-013)
    // For now, just return a stub
    console.log(`[HubClient] Running PR ${prId}...`);

    if (options.dryRun) {
      return {
        prId,
        success: true,
        duration: 0
      };
    }

    // Stub implementation
    return {
      prId,
      success: true,
      duration: 0,
      error: 'Work execution not yet implemented'
    };
  }

  /**
   * Run all available work
   */
  async runAll(options: RunOptions = {}): Promise<WorkResult[]> {
    const pid = await this.findDaemonPid();

    if (!pid) {
      throw new HubNotRunningError();
    }

    // TODO: Implement work execution via message bus (PR-013)
    console.log('[HubClient] Running all available work...');

    // Stub implementation
    return [];
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

    // TODO: Query task progress from Redis
    // For now, return stub data
    return {
      total: 0,
      completed: 0,
      inProgress: 0,
      pending: 0,
      failed: 0
    };
  }

  /**
   * Get coordination mode
   */
  async getCoordinationMode(): Promise<CoordinationMode> {
    await this.ensureRedisConnection();

    // TODO: Query coordination mode from Redis
    // For now, return default
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
