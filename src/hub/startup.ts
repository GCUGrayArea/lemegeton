/**
 * Startup Sequence
 *
 * Handles the hub startup process including:
 * - Parsing task-list.md
 * - Hydrating Redis from git (cold state)
 * - Verifying lease consistency
 * - Cleaning up orphaned hot states
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { RedisClient } from '../redis/client';
import { ColdState } from '../types/pr';

/**
 * Task list structure (simplified for now)
 */
interface TaskListPR {
  id: string;
  title: string;
  cold_state: ColdState;
  priority: 'critical' | 'high' | 'medium' | 'low';
  complexity: {
    score: number;
    estimated_minutes: number;
    suggested_model: string;
    rationale: string;
  };
  dependencies: string[];
  estimated_files?: Array<{
    path: string;
    action: 'create' | 'modify' | 'delete';
    description: string;
  }>;
  actual_files?: Array<{
    path: string;
    action: 'create' | 'modify' | 'delete';
    description: string;
  }>;
}

interface TaskList {
  prs: TaskListPR[];
  metadata?: {
    version?: string;
    generated?: string;
    total_complexity?: number;
  };
}

/**
 * Startup sequence for hub initialization
 */
export class StartupSequence {
  private taskList: TaskList | null = null;

  constructor(
    private redis: RedisClient,
    private workDir: string = process.cwd()
  ) {}

  /**
   * Hydrate Redis state from git
   */
  async hydrateFromGit(): Promise<void> {
    console.log('[Startup] Hydrating state from git...');

    // Parse task list
    await this.parseTaskList();

    // Populate Redis with cold state
    await this.populateRedis();

    // Verify lease consistency
    await this.verifyLeases();

    // Clean up orphaned hot states
    await this.cleanOrphans();

    console.log('[Startup] Hydration complete');
  }

  /**
   * Parse task-list.md
   */
  private async parseTaskList(): Promise<void> {
    const taskListPath = path.join(this.workDir, 'docs', 'task-list.md');

    try {
      const content = await fs.readFile(taskListPath, 'utf-8');
      this.taskList = this.parseTaskListContent(content);
      console.log(`[Startup] Parsed ${this.taskList.prs.length} PRs from task-list.md`);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.warn('[Startup] task-list.md not found, starting with empty task list');
        this.taskList = { prs: [] };
      } else {
        throw new Error(`Failed to parse task-list.md: ${error.message}`);
      }
    }
  }

  /**
   * Parse task list content
   */
  private parseTaskListContent(content: string): TaskList {
    const prs: TaskListPR[] = [];

    // Normalize line endings to handle both Windows (CRLF) and Unix (LF)
    const normalized = content.replace(/\r\n/g, '\n');

    // Split by the separator lines (---) to get YAML blocks
    const blocks = normalized.split(/\n---\n/);

    for (const block of blocks) {
      const trimmed = block.trim();

      // Skip empty blocks
      if (!trimmed) {
        continue;
      }

      // Only parse blocks that START with pr_id: (actual YAML blocks)
      // This filters out markdown sections that might contain pr_id in text
      if (!trimmed.startsWith('pr_id:')) {
        continue;
      }

      try {
        // Parse the YAML block
        const parsed = yaml.load(trimmed) as any;

        // Validate and convert to TaskListPR
        if (parsed && parsed.pr_id && parsed.cold_state) {
          const pr: TaskListPR = {
            id: parsed.pr_id,
            title: parsed.title || '',
            cold_state: parsed.cold_state as ColdState,
            priority: parsed.priority || 'medium',
            complexity: parsed.complexity || {
              score: 1,
              estimated_minutes: 10,
              suggested_model: 'haiku',
              rationale: 'Default complexity',
            },
            dependencies: parsed.dependencies || [],
            estimated_files: parsed.estimated_files,
            actual_files: parsed.actual_files,
          };

          prs.push(pr);
        }
      } catch (error) {
        // Skip blocks that can't be parsed as YAML
        console.warn('[Startup] Failed to parse YAML block:', error);
        continue;
      }
    }

    return { prs };
  }

  /**
   * Populate Redis with cold state
   */
  private async populateRedis(): Promise<void> {
    console.log('[Startup] Populating Redis with cold state...');

    if (!this.taskList || this.taskList.prs.length === 0) {
      console.log('[Startup] No PRs to populate');
      return;
    }

    const client = this.redis.getClient();

    // Store PRs in Redis
    const prData: Record<string, any> = {};
    for (const pr of this.taskList.prs) {
      prData[pr.id] = {
        id: pr.id,
        title: pr.title,
        cold_state: pr.cold_state,
        priority: pr.priority,
        complexity: pr.complexity,
        dependencies: pr.dependencies,
        estimated_files: pr.estimated_files,
        actual_files: pr.actual_files,
      };
    }

    await client.set('state:prs', JSON.stringify(prData));
    console.log(`[Startup] Populated ${this.taskList.prs.length} PRs in Redis`);
  }

  /**
   * Verify lease consistency
   */
  private async verifyLeases(): Promise<void> {
    console.log('[Startup] Verifying lease consistency...');
    // TODO: Implement lease verification
    // For now, just log
  }

  /**
   * Clean up orphaned hot states
   */
  private async cleanOrphans(): Promise<void> {
    console.log('[Startup] Cleaning orphaned hot states...');
    // TODO: Implement orphan cleanup
    // For now, just log
  }
}
