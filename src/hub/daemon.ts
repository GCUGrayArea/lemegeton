/**
 * Daemon Process Manager
 *
 * Handles the daemonization of the Hub process, including:
 * - PID file management
 * - Process forking (Unix)
 * - Windows service wrapper (simplified)
 * - Single instance enforcement
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import type { Hub } from './index';

/**
 * Daemon configuration
 */
export interface DaemonConfig {
  pidFile?: string;
  logFile?: string;
  workDir?: string;
}

/**
 * Daemon manager for Hub process
 */
export class DaemonManager {
  private config: Required<DaemonConfig>;
  private pidFilePath: string;
  private logFilePath: string;

  constructor(config: DaemonConfig = {}) {
    this.config = {
      pidFile: config.pidFile || '.lemegeton/hub.pid',
      logFile: config.logFile || '.lemegeton/hub.log',
      workDir: config.workDir || process.cwd(),
    };

    this.pidFilePath = path.resolve(this.config.workDir, this.config.pidFile);
    this.logFilePath = path.resolve(this.config.workDir, this.config.logFile);
  }

  /**
   * Start hub as daemon
   */
  async start(hub: Hub): Promise<void> {
    // Check for existing instance
    if (await this.isRunning()) {
      const existingPid = await this.readPidFile();
      throw new Error(`Hub daemon already running (PID: ${existingPid})`);
    }

    // Ensure directories exist
    await this.ensureDirectories();

    // Daemonize if not in test mode
    if (process.env.NODE_ENV !== 'test' && !process.env.LEMEGETON_NO_DAEMON) {
      await this.daemonize();
    }

    // Write PID file
    await this.writePidFile();

    // Start the hub
    await hub.start();
  }

  /**
   * Stop daemon
   */
  async stop(): Promise<void> {
    if (!await this.isRunning()) {
      console.log('[Daemon] No running hub found');
      return;
    }

    const pid = await this.readPidFile();
    if (pid) {
      try {
        // Send SIGTERM to process
        process.kill(pid, 'SIGTERM');
        console.log(`[Daemon] Sent SIGTERM to PID ${pid}`);

        // Wait for process to exit (with timeout)
        await this.waitForProcessExit(pid, 30000);
        console.log('[Daemon] Hub stopped');
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code === 'ESRCH') {
          console.log('[Daemon] Process not found, cleaning up PID file');
        } else {
          throw error;
        }
      }
    }

    // Clean up PID file
    await this.cleanup();
  }

  /**
   * Check if daemon is running
   */
  async isRunning(): Promise<boolean> {
    try {
      const pid = await this.readPidFile();
      if (!pid) {
        return false;
      }

      // Check if process exists
      process.kill(pid, 0);
      return true;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT' || nodeError.code === 'ESRCH') {
        // PID file doesn't exist or process doesn't exist
        return false;
      }
      throw error;
    }
  }

  /**
   * Get daemon status
   */
  async status(): Promise<{ running: boolean; pid?: number }> {
    const running = await this.isRunning();
    if (running) {
      const pid = await this.readPidFile();
      return { running, pid: pid ?? undefined };
    }
    return { running: false };
  }

  /**
   * Daemonize the process
   */
  private async daemonize(): Promise<void> {
    if (process.platform === 'win32') {
      // Windows: simplified approach
      // In production, would use node-windows or similar
      await this.daemonizeWindows();
    } else {
      // Unix-like systems
      await this.daemonizeUnix();
    }
  }

  /**
   * Unix daemonization
   */
  private async daemonizeUnix(): Promise<void> {
    // If we're the parent process, fork and exit
    if (process.env.LEMEGETON_DAEMON_CHILD !== 'true') {
      const child = spawn(process.argv[0], process.argv.slice(1), {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        env: {
          ...process.env,
          LEMEGETON_DAEMON_CHILD: 'true',
        },
      });

      // Unref the child so parent can exit
      child.unref();

      // Log child PID
      console.log(`[Daemon] Started with PID ${child.pid}`);

      // Parent exits
      process.exit(0);
    }

    // We're the child - continue running
    // Redirect stdout/stderr to log file
    await this.redirectOutput();
  }

  /**
   * Windows daemonization (simplified)
   */
  private async daemonizeWindows(): Promise<void> {
    // On Windows, we can't truly daemonize without a service wrapper
    // This is a simplified approach that detaches from the console

    if (process.env.LEMEGETON_DAEMON_CHILD !== 'true') {
      // Use start command to launch in new window
      const child = spawn('cmd', [
        '/c',
        'start',
        '/min',
        '',
        process.argv[0],
        ...process.argv.slice(1),
      ], {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          LEMEGETON_DAEMON_CHILD: 'true',
        },
        shell: false,
        windowsHide: true,
      });

      child.unref();
      console.log('[Daemon] Started in background');
      process.exit(0);
    }

    // Redirect output on Windows too
    await this.redirectOutput();
  }

  /**
   * Redirect stdout/stderr to log file
   */
  private async redirectOutput(): Promise<void> {
    try {
      const logStream = await fs.open(this.logFilePath, 'a');
      const fd = logStream.fd;

      // Redirect stdout and stderr
      // Note: Intentionally overriding Node.js WriteStream.write for daemonization
      if (process.stdout.isTTY) {
        (process.stdout as NodeJS.WriteStream & { write: (chunk: string | Uint8Array) => boolean }).write = (chunk: string | Uint8Array) => {
          fs.appendFile(this.logFilePath, chunk);
          return true;
        };
      }

      if (process.stderr.isTTY) {
        (process.stderr as NodeJS.WriteStream & { write: (chunk: string | Uint8Array) => boolean }).write = (chunk: string | Uint8Array) => {
          fs.appendFile(this.logFilePath, chunk);
          return true;
        };
      }

      // Also redirect console
      const originalConsoleLog = console.log;
      const originalConsoleError = console.error;

      console.log = (...args) => {
        const message = args.map(arg =>
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');
        fs.appendFile(this.logFilePath, `[${new Date().toISOString()}] ${message}\n`);
      };

      console.error = (...args) => {
        const message = args.map(arg =>
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');
        fs.appendFile(this.logFilePath, `[${new Date().toISOString()}] ERROR: ${message}\n`);
      };
    } catch (error) {
      // If we can't redirect, continue anyway
      console.error('[Daemon] Failed to redirect output:', error);
    }
  }

  /**
   * Ensure required directories exist
   */
  private async ensureDirectories(): Promise<void> {
    const pidDir = path.dirname(this.pidFilePath);
    const logDir = path.dirname(this.logFilePath);

    await fs.mkdir(pidDir, { recursive: true });
    await fs.mkdir(logDir, { recursive: true });
  }

  /**
   * Write PID file
   */
  private async writePidFile(): Promise<void> {
    const pid = process.pid;
    await fs.writeFile(this.pidFilePath, String(pid), 'utf-8');

    // Set restrictive permissions on Unix
    if (process.platform !== 'win32') {
      try {
        await fs.chmod(this.pidFilePath, 0o600);
      } catch {
        // Ignore permission errors
      }
    }
  }

  /**
   * Read PID file
   */
  private async readPidFile(): Promise<number | null> {
    try {
      const content = await fs.readFile(this.pidFilePath, 'utf-8');
      const pid = parseInt(content.trim(), 10);
      return isNaN(pid) ? null : pid;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Wait for process to exit
   */
  private async waitForProcessExit(pid: number, timeout: number): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        process.kill(pid, 0);
        // Process still exists, wait a bit
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code === 'ESRCH') {
          // Process no longer exists
          return;
        }
        throw error;
      }
    }

    throw new Error(`Process ${pid} did not exit within ${timeout}ms`);
  }

  /**
   * Clean up PID file
   */
  async cleanup(): Promise<void> {
    try {
      await fs.unlink(this.pidFilePath);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error('[Daemon] Failed to remove PID file:', error);
      }
    }
  }

  /**
   * Get PID file path (for testing)
   */
  getPidFilePath(): string {
    return this.pidFilePath;
  }

  /**
   * Get log file path
   */
  getLogFilePath(): string {
    return this.logFilePath;
  }
}