/**
 * Degraded Mode Handler
 *
 * Manages branch-based work isolation when shared Redis is unavailable
 * but local Docker Redis is still functional.
 *
 * In degraded mode, each agent works on its own branch to avoid conflicts.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { CoordinationConfig } from './coordinationMode';

const execAsync = promisify(exec);

/**
 * Reconciliation result
 */
export interface ReconciliationResult {
  success: boolean;
  mergedBranches: string[];
  conflictedBranches: string[];
  errors: string[];
}

/**
 * Conflict report
 */
export interface ConflictReport {
  branch: string;
  conflicts: string[];
  timestamp: number;
}

/**
 * Work state for degraded mode
 */
export interface DegradedWorkState {
  agentId: string;
  prId: string;
  branch: string;
  status: string;
  timestamp: number;
}

/**
 * Degraded Mode Handler
 */
export class DegradedModeHandler {
  private config: Required<CoordinationConfig>;

  constructor(config: Required<CoordinationConfig>) {
    this.config = config;
  }

  /**
   * Generate agent-specific branch name
   */
  generateBranchName(agentId: string, prId: string): string {
    // Format: agent-{agentId}-{prId}
    // Example: agent-a1b2c3d4-PR-007
    return `agent-${agentId}-${prId}`;
  }

  /**
   * Create an agent-specific branch
   */
  async createAgentBranch(agentId: string, prId: string): Promise<string> {
    const branchName = this.generateBranchName(agentId, prId);

    try {
      // Check if branch already exists
      const { stdout: branches } = await execAsync('git branch --list');
      if (branches.includes(branchName)) {
        // Branch exists, check it out
        await execAsync(`git checkout ${branchName}`);
        return branchName;
      }

      // Create new branch from current HEAD
      await execAsync(`git checkout -b ${branchName}`);
      console.log(`[DegradedMode] Created branch: ${branchName}`);

      return branchName;
    } catch (error: any) {
      console.error(`[DegradedMode] Failed to create branch ${branchName}:`, error);
      throw new Error(`Failed to create agent branch: ${error.message}`);
    }
  }

  /**
   * Switch to an agent branch
   */
  async switchToAgentBranch(branch: string): Promise<void> {
    try {
      await execAsync(`git checkout ${branch}`);
      console.log(`[DegradedMode] Switched to branch: ${branch}`);
    } catch (error: any) {
      throw new Error(`Failed to switch to branch ${branch}: ${error.message}`);
    }
  }

  /**
   * Switch to main branch
   */
  async switchToMainBranch(): Promise<void> {
    try {
      await execAsync('git checkout main');
      console.log('[DegradedMode] Switched to main branch');
    } catch (error: any) {
      // Try 'master' as fallback
      try {
        await execAsync('git checkout master');
        console.log('[DegradedMode] Switched to master branch');
      } catch {
        throw new Error(`Failed to switch to main/master branch: ${error.message}`);
      }
    }
  }

  /**
   * Save work state to local Redis or files
   */
  async saveWorkState(agentId: string, state: any): Promise<void> {
    try {
      const stateDir = path.join(this.config.isolatedStateDir, 'work');
      await fs.mkdir(stateDir, { recursive: true });

      const stateFile = path.join(stateDir, `${agentId}.json`);
      await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
    } catch (error) {
      console.warn(`[DegradedMode] Failed to save work state for ${agentId}:`, error);
    }
  }

  /**
   * Load work state from files
   */
  async loadWorkState(agentId: string): Promise<any> {
    try {
      const stateFile = path.join(this.config.isolatedStateDir, 'work', `${agentId}.json`);
      const data = await fs.readFile(stateFile, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      // No state found, return null
      return null;
    }
  }

  /**
   * Reconcile all agent branches
   */
  async reconcileBranches(): Promise<ReconciliationResult> {
    const result: ReconciliationResult = {
      success: true,
      mergedBranches: [],
      conflictedBranches: [],
      errors: [],
    };

    try {
      // Get current branch
      const { stdout: currentBranch } = await execAsync('git branch --show-current');
      const originalBranch = currentBranch.trim();

      // List all agent branches
      const { stdout: branchList } = await execAsync('git branch --list "agent-*"');
      const agentBranches = branchList
        .split('\n')
        .map(b => b.trim().replace(/^\*\s*/, ''))
        .filter(b => b.length > 0);

      console.log(`[DegradedMode] Found ${agentBranches.length} agent branches to reconcile`);

      // Switch to main for merging
      await this.switchToMainBranch();

      // Attempt to merge each branch
      for (const branch of agentBranches) {
        try {
          const merged = await this.attemptAutoMerge(branch);
          if (merged) {
            result.mergedBranches.push(branch);
            // Delete merged branch
            await execAsync(`git branch -d ${branch}`);
            console.log(`[DegradedMode] Merged and deleted branch: ${branch}`);
          } else {
            result.conflictedBranches.push(branch);
            result.success = false;
            console.warn(`[DegradedMode] Branch has conflicts: ${branch}`);
          }
        } catch (error: any) {
          result.errors.push(`${branch}: ${error.message}`);
          result.conflictedBranches.push(branch);
          result.success = false;
        }
      }

      // Return to original branch
      if (originalBranch && originalBranch !== 'main' && originalBranch !== 'master') {
        try {
          await execAsync(`git checkout ${originalBranch}`);
        } catch {
          // Original branch may have been deleted, stay on main
        }
      }

      console.log(`[DegradedMode] Reconciliation complete: ${result.mergedBranches.length} merged, ${result.conflictedBranches.length} conflicts`);
      return result;
    } catch (error: any) {
      result.success = false;
      result.errors.push(`Reconciliation failed: ${error.message}`);
      return result;
    }
  }

  /**
   * Attempt automatic merge of a branch
   */
  async attemptAutoMerge(branch: string): Promise<boolean> {
    try {
      // Try merge with --no-ff to preserve branch history
      await execAsync(`git merge --no-ff --no-edit ${branch}`);
      return true;
    } catch (error) {
      // Merge failed, likely due to conflicts
      // Abort the merge
      try {
        await execAsync('git merge --abort');
      } catch {
        // Ignore abort errors
      }
      return false;
    }
  }

  /**
   * Create conflict report for branches
   */
  async createConflictReport(branches: string[]): Promise<ConflictReport[]> {
    const reports: ConflictReport[] = [];

    for (const branch of branches) {
      try {
        // Try merge to identify conflicts
        await execAsync(`git merge --no-commit --no-ff ${branch}`);

        // Get conflicted files
        const { stdout: statusOutput } = await execAsync('git status --porcelain');
        const conflicts = statusOutput
          .split('\n')
          .filter(line => line.startsWith('UU '))
          .map(line => line.substring(3).trim());

        // Abort merge
        await execAsync('git merge --abort');

        reports.push({
          branch,
          conflicts,
          timestamp: Date.now(),
        });
      } catch (error) {
        // Error getting conflicts, but still report the branch
        reports.push({
          branch,
          conflicts: ['Unable to determine conflicts'],
          timestamp: Date.now(),
        });
      }
    }

    return reports;
  }

  /**
   * List all agent branches
   */
  async listAgentBranches(): Promise<string[]> {
    try {
      const { stdout } = await execAsync('git branch --list "agent-*"');
      return stdout
        .split('\n')
        .map(b => b.trim().replace(/^\*\s*/, ''))
        .filter(b => b.length > 0);
    } catch (error) {
      return [];
    }
  }

  /**
   * Clean up old agent branches
   */
  async cleanupOldBranches(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    let deletedCount = 0;

    try {
      const branches = await this.listAgentBranches();
      const now = Date.now();

      for (const branch of branches) {
        try {
          // Get last commit timestamp for branch
          const { stdout } = await execAsync(`git log -1 --format=%ct ${branch}`);
          const lastCommitTime = parseInt(stdout.trim()) * 1000;

          if (now - lastCommitTime > maxAgeMs) {
            await execAsync(`git branch -D ${branch}`);
            deletedCount++;
            console.log(`[DegradedMode] Cleaned up old branch: ${branch}`);
          }
        } catch (error) {
          console.warn(`[DegradedMode] Failed to check/delete branch ${branch}:`, error);
        }
      }

      return deletedCount;
    } catch (error) {
      console.error('[DegradedMode] Failed to cleanup old branches:', error);
      return deletedCount;
    }
  }

  /**
   * Get current git branch
   */
  async getCurrentBranch(): Promise<string | null> {
    try {
      const { stdout } = await execAsync('git branch --show-current');
      return stdout.trim() || null; // Keep || here - empty string should return null
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if current branch is an agent branch
   */
  async isOnAgentBranch(): Promise<boolean> {
    const currentBranch = await this.getCurrentBranch();
    return currentBranch ? currentBranch.startsWith('agent-') : false;
  }
}
