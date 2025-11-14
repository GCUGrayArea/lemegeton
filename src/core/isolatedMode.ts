/**
 * Isolated Mode Handler
 *
 * Manages file-based state persistence when no Redis is available.
 * Provides advisory locking and work tracking without enforcement.
 *
 * In isolated mode, the system continues to work but without coordination
 * guarantees. This is better than stopping completely.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { CoordinationConfig, CoordinationState } from './coordinationMode';

/**
 * Lock status for files
 */
export interface LockStatus {
  file: string;
  locked: boolean;
  lockedBy?: string;
  timestamp?: number;
}

/**
 * Work item tracking
 */
export interface WorkItem {
  agentId: string;
  prId: string;
  status: string;
  timestamp: number;
  files?: string[];
}

/**
 * File lock record
 */
interface FileLock {
  agentId: string;
  files: string[];
  timestamp: number;
}

/**
 * Notification record
 */
export interface Notification {
  action: string;
  newMode?: string;
  timestamp: number;
}

/**
 * Isolated Mode Handler
 */
export class IsolatedModeHandler {
  private config: Required<CoordinationConfig>;
  private stateDir: string;
  private locksDir: string;
  private workDir: string;
  private notificationsFile: string;

  constructor(config: Required<CoordinationConfig>) {
    this.config = config;
    this.stateDir = config.isolatedStateDir;
    this.locksDir = path.join(this.stateDir, 'locks');
    this.workDir = path.join(this.stateDir, 'work');
    this.notificationsFile = path.join(this.stateDir, 'notifications.jsonl');
  }

  /**
   * Initialize isolated mode directories
   */
  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.stateDir, { recursive: true });
    await fs.mkdir(this.locksDir, { recursive: true });
    await fs.mkdir(this.workDir, { recursive: true });
  }

  /**
   * Save coordination state to file
   */
  async saveState(state: CoordinationState): Promise<void> {
    try {
      await this.ensureDirectories();
      const stateFile = path.join(this.stateDir, 'state.json');
      await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
      console.log('[IsolatedMode] Saved state to file');
    } catch (error) {
      console.error('[IsolatedMode] Failed to save state:', error);
      throw error;
    }
  }

  /**
   * Load coordination state from file
   */
  async loadState(): Promise<CoordinationState | null> {
    try {
      const stateFile = path.join(this.stateDir, 'state.json');
      const data = await fs.readFile(stateFile, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      // No state file found
      return null;
    }
  }

  /**
   * Clear all state files
   */
  async clearState(): Promise<void> {
    try {
      const stateFile = path.join(this.stateDir, 'state.json');
      await fs.unlink(stateFile);
      console.log('[IsolatedMode] Cleared state file');
    } catch (error) {
      // File might not exist, ignore
    }
  }

  /**
   * Record advisory file lock
   */
  async recordFileLock(agentId: string, files: string[]): Promise<void> {
    try {
      await this.ensureDirectories();

      const lock: FileLock = {
        agentId,
        files,
        timestamp: Date.now(),
      };

      const lockFile = path.join(this.locksDir, `${agentId}.json`);
      await fs.writeFile(lockFile, JSON.stringify(lock, null, 2));
      console.log(`[IsolatedMode] Recorded advisory lock for ${agentId}: ${files.length} files`);
    } catch (error) {
      console.warn(`[IsolatedMode] Failed to record lock for ${agentId}:`, error);
    }
  }

  /**
   * Release advisory file lock
   */
  async releaseFileLock(agentId: string, files: string[]): Promise<void> {
    try {
      const lockFile = path.join(this.locksDir, `${agentId}.json`);

      // Read current locks
      const data = await fs.readFile(lockFile, 'utf-8');
      const lock: FileLock = JSON.parse(data);

      // Remove specified files
      lock.files = lock.files.filter(f => !files.includes(f));
      lock.timestamp = Date.now();

      if (lock.files.length === 0) {
        // No more files locked, delete lock file
        await fs.unlink(lockFile);
        console.log(`[IsolatedMode] Released all locks for ${agentId}`);
      } else {
        // Update lock file
        await fs.writeFile(lockFile, JSON.stringify(lock, null, 2));
        console.log(`[IsolatedMode] Released ${files.length} locks for ${agentId}`);
      }
    } catch (error) {
      // Lock file might not exist, ignore
      console.warn(`[IsolatedMode] Failed to release lock for ${agentId}:`, error);
    }
  }

  /**
   * Check advisory file locks
   */
  async checkFileLocks(files: string[]): Promise<LockStatus[]> {
    const statuses: LockStatus[] = [];

    try {
      await this.ensureDirectories();

      // Read all lock files
      const lockFiles = await fs.readdir(this.locksDir);

      // Build map of file -> agent
      const fileLocks = new Map<string, { agentId: string; timestamp: number }>();

      for (const lockFile of lockFiles) {
        try {
          const data = await fs.readFile(path.join(this.locksDir, lockFile), 'utf-8');
          const lock: FileLock = JSON.parse(data);

          for (const file of lock.files) {
            fileLocks.set(file, {
              agentId: lock.agentId,
              timestamp: lock.timestamp,
            });
          }
        } catch (error) {
          // Skip invalid lock files
          continue;
        }
      }

      // Check each requested file
      for (const file of files) {
        const lock = fileLocks.get(file);
        if (lock) {
          statuses.push({
            file,
            locked: true,
            lockedBy: lock.agentId,
            timestamp: lock.timestamp,
          });
        } else {
          statuses.push({
            file,
            locked: false,
          });
        }
      }

      return statuses;
    } catch (error) {
      console.warn('[IsolatedMode] Failed to check file locks:', error);
      // Return all files as unlocked if check fails
      return files.map(file => ({ file, locked: false }));
    }
  }

  /**
   * Record work item
   */
  async recordWorkItem(agentId: string, prId: string, status: string, files?: string[]): Promise<void> {
    try {
      await this.ensureDirectories();

      const workItem: WorkItem = {
        agentId,
        prId,
        status,
        timestamp: Date.now(),
        files,
      };

      const workFile = path.join(this.workDir, `${agentId}-${prId}.json`);
      await fs.writeFile(workFile, JSON.stringify(workItem, null, 2));
      console.log(`[IsolatedMode] Recorded work item: ${agentId} - ${prId} (${status})`);
    } catch (error) {
      console.warn(`[IsolatedMode] Failed to record work item for ${agentId}:`, error);
    }
  }

  /**
   * Get work items
   */
  async getWorkItems(agentId?: string): Promise<WorkItem[]> {
    const workItems: WorkItem[] = [];

    try {
      await this.ensureDirectories();

      const workFiles = await fs.readdir(this.workDir);

      for (const workFile of workFiles) {
        // Filter by agentId if specified
        if (agentId && !workFile.startsWith(`${agentId}-`)) {
          continue;
        }

        try {
          const data = await fs.readFile(path.join(this.workDir, workFile), 'utf-8');
          const workItem: WorkItem = JSON.parse(data);
          workItems.push(workItem);
        } catch (error) {
          // Skip invalid work files
          continue;
        }
      }

      return workItems;
    } catch (error) {
      console.warn('[IsolatedMode] Failed to get work items:', error);
      return [];
    }
  }

  /**
   * Remove work item
   */
  async removeWorkItem(agentId: string, prId: string): Promise<void> {
    try {
      const workFile = path.join(this.workDir, `${agentId}-${prId}.json`);
      await fs.unlink(workFile);
      console.log(`[IsolatedMode] Removed work item: ${agentId} - ${prId}`);
    } catch (error) {
      // File might not exist, ignore
    }
  }

  /**
   * Write notification to file
   */
  async writeNotification(notification: Notification): Promise<void> {
    try {
      await this.ensureDirectories();
      const notificationLine = JSON.stringify(notification) + '\n';
      await fs.appendFile(this.notificationsFile, notificationLine);
      console.log(`[IsolatedMode] Wrote notification: ${notification.action}`);
    } catch (error) {
      console.warn('[IsolatedMode] Failed to write notification:', error);
    }
  }

  /**
   * Read notifications
   */
  async readNotifications(since?: number): Promise<Notification[]> {
    try {
      const data = await fs.readFile(this.notificationsFile, 'utf-8');
      const lines = data.split('\n').filter(line => line.trim().length > 0);

      const notifications: Notification[] = [];
      for (const line of lines) {
        try {
          const notification: Notification = JSON.parse(line);
          if (!since || notification.timestamp > since) {
            notifications.push(notification);
          }
        } catch {
          // Skip invalid lines
          continue;
        }
      }

      return notifications;
    } catch (error) {
      // No notifications file yet
      return [];
    }
  }

  /**
   * Clear old notifications
   */
  async clearOldNotifications(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    try {
      const notifications = await this.readNotifications();
      const now = Date.now();

      const recentNotifications = notifications.filter(
        n => now - n.timestamp < maxAgeMs
      );

      // Rewrite file with only recent notifications
      const content = recentNotifications.map(n => JSON.stringify(n)).join('\n') + '\n';
      await fs.writeFile(this.notificationsFile, content);

      const removedCount = notifications.length - recentNotifications.length;
      console.log(`[IsolatedMode] Cleared ${removedCount} old notifications`);
      return removedCount;
    } catch (error) {
      console.warn('[IsolatedMode] Failed to clear old notifications:', error);
      return 0;
    }
  }

  /**
   * Get statistics about isolated mode
   */
  async getStats(): Promise<{
    locks: number;
    workItems: number;
    notifications: number;
  }> {
    try {
      await this.ensureDirectories();

      const [lockFiles, workFiles] = await Promise.all([
        fs.readdir(this.locksDir),
        fs.readdir(this.workDir),
      ]);

      const notifications = await this.readNotifications();

      return {
        locks: lockFiles.length,
        workItems: workFiles.length,
        notifications: notifications.length,
      };
    } catch (error) {
      return {
        locks: 0,
        workItems: 0,
        notifications: 0,
      };
    }
  }

  /**
   * Clean up all isolated mode files
   */
  async cleanup(): Promise<void> {
    try {
      // Remove all lock files
      const lockFiles = await fs.readdir(this.locksDir);
      for (const file of lockFiles) {
        await fs.unlink(path.join(this.locksDir, file));
      }

      // Remove all work files
      const workFiles = await fs.readdir(this.workDir);
      for (const file of workFiles) {
        await fs.unlink(path.join(this.workDir, file));
      }

      // Clear notifications
      await fs.unlink(this.notificationsFile).catch(() => {});

      console.log('[IsolatedMode] Cleaned up all files');
    } catch (error) {
      console.warn('[IsolatedMode] Failed to cleanup:', error);
    }
  }
}
