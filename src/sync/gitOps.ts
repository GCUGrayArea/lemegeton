/**
 * Git Operations for Cold State Management
 *
 * Handles git commits for cold state transitions, loading state from git,
 * and maintaining clean git history.
 */

import simpleGit, { SimpleGit } from 'simple-git';
import { TaskListParser } from '../parser/taskList';
import { ParsedTaskList, PRData } from '../parser/types';
import { ColdState, PRState } from '../types/pr';
import { CommitMetadata, IGitCommitter } from '../core/stateMachine';
import { DisplayUpdate, GitCommit, StateSyncError } from './types';
import * as path from 'path';

/**
 * Git operations for state synchronization
 */
export class GitOps implements IGitCommitter {
  private git: SimpleGit;
  private taskListPath: string;

  constructor(
    private parser: TaskListParser,
    repoPath?: string,
    taskListPath?: string
  ) {
    this.git = simpleGit(repoPath || process.cwd());
    this.taskListPath = taskListPath || path.join(process.cwd(), 'docs', 'task-list.md');
  }

  /**
   * Load task list from git
   */
  async loadTaskList(): Promise<ParsedTaskList> {
    try {
      return await this.parser.parse(this.taskListPath, false);
    } catch (error) {
      throw new StateSyncError(
        'Failed to load task list from git',
        error as Error,
        { taskListPath: this.taskListPath }
      );
    }
  }

  /**
   * Reconstruct PR states from task list
   */
  async reconstructState(): Promise<Map<string, PRState>> {
    const taskList = await this.loadTaskList();
    const states = new Map<string, PRState>();

    for (const pr of taskList.prs) {
      states.set(pr.pr_id, this.prDataToPRState(pr));
    }

    return states;
  }

  /**
   * Commit cold state change to git (implements IGitCommitter)
   */
  async commit(message: string, metadata: CommitMetadata): Promise<void> {
    await this.commitColdStateChange(
      metadata.pr_id,
      metadata.to_state,
      metadata
    );
  }

  /**
   * Commit a cold state change immediately
   */
  async commitColdStateChange(
    prId: string,
    newState: ColdState,
    metadata: CommitMetadata
  ): Promise<void> {
    try {
      // Update task list frontmatter
      await this.parser.update(this.taskListPath, prId, {
        cold_state: newState
      });

      // Generate commit message
      const message = this.generateColdStateCommitMessage(prId, newState, metadata);

      // Git add and commit
      await this.git.add(this.taskListPath);
      await this.git.commit(message);

      console.log(`[GitOps] Committed cold state: ${prId} → ${newState}`);
    } catch (error) {
      throw new StateSyncError(
        `Failed to commit cold state change for ${prId}`,
        error as Error,
        { prId, newState, metadata }
      );
    }
  }

  /**
   * Commit display sync updates (30-second cycle)
   */
  async commitDisplaySync(updates: DisplayUpdate[]): Promise<void> {
    if (updates.length === 0) {
      return;
    }

    try {
      // Check for recent commits to avoid conflicts
      const hasRecentCommit = await this.hasRecentCommit(5000); // 5 seconds
      if (hasRecentCommit) {
        console.log('[GitOps] Skipping display sync - recent cold commit detected');
        return;
      }

      // Update display section in task-list.md
      await this.updateDisplaySection(updates);

      // Generate commit message
      const message = this.generateDisplaySyncMessage(updates);

      // Git add and commit
      await this.git.add(this.taskListPath);
      await this.git.commit(message);

      console.log(`[GitOps] Committed display sync for ${updates.length} PRs`);
    } catch (error) {
      // Display sync failures are non-critical
      console.warn('[GitOps] Display sync commit failed:', error);
    }
  }

  /**
   * Get last commit for a specific PR
   */
  async getLastCommitForPR(prId: string): Promise<GitCommit | null> {
    try {
      const log = await this.git.log({
        file: this.taskListPath,
        maxCount: 50
      });

      for (const commit of log.all) {
        if (commit.message.includes(prId)) {
          return {
            hash: commit.hash,
            message: commit.message,
            author: commit.author_name,
            timestamp: new Date(commit.date),
            files: [this.taskListPath]
          };
        }
      }

      return null;
    } catch (error) {
      console.warn(`[GitOps] Failed to get last commit for ${prId}:`, error);
      return null;
    }
  }

  /**
   * Check if git history is clean (only milestone commits)
   */
  async isCleanHistory(): Promise<boolean> {
    try {
      const log = await this.git.log({
        file: this.taskListPath,
        maxCount: 100
      });

      // Check for any commits that shouldn't be there
      const invalidCommits = log.all.filter((commit: any) => {
        const msg = commit.message.toLowerCase();
        // Exclude heartbeat, hot-to-hot transitions, etc.
        return (
          msg.includes('heartbeat') ||
          msg.includes('investigating → planning') ||
          msg.includes('planning → in-progress')
        );
      });

      return invalidCommits.length === 0;
    } catch (error) {
      console.warn('[GitOps] Failed to check history cleanliness:', error);
      return false;
    }
  }

  /**
   * Check if there was a recent commit (within timeMs)
   */
  private async hasRecentCommit(timeMs: number): Promise<boolean> {
    try {
      const log = await this.git.log({
        file: this.taskListPath,
        maxCount: 1
      });

      if (log.all.length === 0) {
        return false;
      }

      const lastCommit = log.all[0];
      const commitTime = new Date(lastCommit.date).getTime();
      const now = Date.now();

      return (now - commitTime) < timeMs;
    } catch (error) {
      return false;
    }
  }

  /**
   * Update display section in task-list.md
   */
  private async updateDisplaySection(updates: DisplayUpdate[]): Promise<void> {
    // Read current content
    const content = await this.parser.parse(this.taskListPath, false);
    let raw = content.raw;

    // Find or create display section
    const displaySectionMarker = '<!-- HOT STATE DISPLAY -->';
    const displayEndMarker = '<!-- END HOT STATE DISPLAY -->';

    // Generate display content
    const displayContent = this.generateDisplayContent(updates);

    // Replace or add display section
    if (raw.includes(displaySectionMarker)) {
      // Replace existing section
      const startIdx = raw.indexOf(displaySectionMarker);
      const endIdx = raw.indexOf(displayEndMarker) + displayEndMarker.length;

      raw = raw.substring(0, startIdx) +
            `${displaySectionMarker}\n${displayContent}\n${displayEndMarker}` +
            raw.substring(endIdx);
    } else {
      // Add new section at top
      raw = `${displaySectionMarker}\n${displayContent}\n${displayEndMarker}\n\n${raw}`;
    }

    // Write back
    const fs = await import('fs/promises');
    await fs.writeFile(this.taskListPath, raw, 'utf-8');
  }

  /**
   * Generate display content for hot states
   */
  private generateDisplayContent(updates: DisplayUpdate[]): string {
    const lines = [
      '## Active Work (Hot States)',
      '',
      'Last updated: ' + new Date().toISOString(),
      ''
    ];

    if (updates.length === 0) {
      lines.push('_No active work_');
    } else {
      lines.push('| PR | State | Agent | Since |');
      lines.push('|----|-------|-------|-------|');

      for (const update of updates) {
        lines.push(
          `| ${update.pr_id} | ${update.hot_state} | ${update.agent_id || 'N/A'} | ${update.timestamp.toISOString()} |`
        );
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate commit message for cold state change
   */
  private generateColdStateCommitMessage(
    prId: string,
    newState: ColdState,
    metadata: CommitMetadata
  ): string {
    const lines = [
      `${prId}: ${metadata.from_state} → ${newState}`,
      ''
    ];

    if (metadata.agent_id) {
      lines.push(`Agent: ${metadata.agent_id}`);
    }

    if (metadata.reason) {
      lines.push(`Reason: ${metadata.reason}`);
    }

    lines.push('');
    lines.push('Metadata:');
    lines.push(`- From: ${metadata.from_state}`);
    lines.push(`- To: ${newState}`);
    lines.push(`- Timestamp: ${metadata.timestamp.toISOString()}`);

    return lines.join('\n');
  }

  /**
   * Generate commit message for display sync
   */
  private generateDisplaySyncMessage(updates: DisplayUpdate[]): string {
    const lines = [
      '[Display Sync] Update hot state visibility',
      '',
      'Updated display for:'
    ];

    for (const update of updates) {
      lines.push(`- ${update.pr_id}: ${update.hot_state}${update.agent_id ? ` (${update.agent_id})` : ''}`);
    }

    return lines.join('\n');
  }

  /**
   * Convert PRData to PRState
   */
  private prDataToPRState(pr: PRData): PRState {
    return {
      pr_id: pr.pr_id,
      cold_state: pr.cold_state,
      hot_state: undefined, // Hot states not persisted in git
      dependencies: pr.dependencies || [],
      files_locked: [], // Not persisted in git
      last_transition: new Date().toISOString(), // Current time if not available
      complexity: pr.complexity ? {
        ...pr.complexity,
        file_count: pr.estimated_files?.length || 0,
        dependency_count: pr.dependencies?.length || 0
      } : undefined
    };
  }
}
