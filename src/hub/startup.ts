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
    const lines = content.split('\n');

    let currentPR: Partial<TaskListPR> | null = null;
    let inYamlBlock = false;
    let yamlLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Start of YAML frontmatter
      if (line.trim() === '---') {
        if (!inYamlBlock) {
          inYamlBlock = true;
          yamlLines = [];
          currentPR = {};
        } else {
          // End of YAML frontmatter
          inYamlBlock = false;
          if (currentPR && yamlLines.length > 0) {
            const pr = this.parseYamlFrontmatter(yamlLines.join('\n'));
            if (pr) {
              prs.push(pr);
            }
          }
          currentPR = null;
        }
        continue;
      }

      // Collect YAML lines
      if (inYamlBlock && currentPR) {
        yamlLines.push(line);
      }
    }

    return { prs };
  }

  /**
   * Parse YAML frontmatter for a PR
   */
  private parseYamlFrontmatter(yaml: string): TaskListPR | null {
    try {
      // Simple YAML parsing (in production, would use a proper YAML parser)
      const pr: Partial<TaskListPR> = {};
      const lines = yaml.split('\n');

      for (const line of lines) {
        const match = line.match(/^(\w+):\s*(.*)$/);
        if (match) {
          const [, key, value] = match;
          switch (key) {
            case 'pr_id':
              pr.id = value.trim();
              break;
            case 'title':
              pr.title = value.trim();
              break;
            case 'cold_state':
              pr.cold_state = value.trim() as ColdState;
              break;
            case 'priority':
              pr.priority = value.trim() as any;
              break;
            case 'dependencies':
              // Parse array notation [PR-001, PR-002]
              const deps = value.match(/\[(.*?)\]/);
              if (deps) {
                pr.dependencies = deps[1].split(',').map(d => d.trim());
              } else {
                pr.dependencies = [];
              }
              break;
          }
        }

        // Parse complexity block
        if (line.includes('complexity:')) {
          pr.complexity = this.parseComplexityBlock(lines, lines.indexOf(line));
        }

        // Parse file lists
        if (line.includes('estimated_files:') || line.includes('actual_files:')) {
          const fileType = line.includes('estimated_files:') ? 'estimated_files' : 'actual_files';
          pr[fileType] = this.parseFileList(lines, lines.indexOf(line));
        }
      }

      // Validate required fields
      if (pr.id && pr.cold_state) {
        return {
          id: pr.id,
          title: pr.title || '',
          cold_state: pr.cold_state,
          priority: pr.priority || 'medium',
          complexity: pr.complexity || {
            score: 1,
            estimated_minutes: 10,
            suggested_model: 'haiku',
            rationale: 'Default complexity',
          },
          dependencies: pr.dependencies || [],
          estimated_files: pr.estimated_files,
          actual_files: pr.actual_files,
        };
      }

      return null;
    } catch (error) {
      console.warn('[Startup] Failed to parse PR YAML:', error);
      return null;
    }
  }

  /**
   * Parse complexity block from YAML
   */
  private parseComplexityBlock(lines: string[], startIdx: number): TaskListPR['complexity'] {
    const complexity: any = {
      score: 1,
      estimated_minutes: 10,
      suggested_model: 'haiku',
      rationale: '',
    };

    for (let i = startIdx + 1; i < lines.length && lines[i].startsWith('  '); i++) {
      const line = lines[i].trim();
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match) {
        const [, key, value] = match;
        switch (key) {
          case 'score':
            complexity.score = parseInt(value, 10) || 1;
            break;
          case 'estimated_minutes':
            complexity.estimated_minutes = parseInt(value, 10) || 10;
            break;
          case 'suggested_model':
            complexity.suggested_model = value.trim();
            break;
          case 'rationale':
            complexity.rationale = value.trim();
            break;
        }
      }
    }

    return complexity;
  }

  /**
   * Parse file list from YAML
   */
  private parseFileList(lines: string[], startIdx: number): TaskListPR['estimated_files'] {
    const files: any[] = [];

    for (let i = startIdx + 1; i < lines.length && lines[i].startsWith('  '); i++) {
      const line = lines[i].trim();
      if (line.startsWith('- path:')) {
        const file: any = {
          path: line.replace('- path:', '').trim(),
          action: 'create',
          description: '',
        };

        // Look for action and description
        if (i + 1 < lines.length && lines[i + 1].includes('action:')) {
          file.action = lines[i + 1].split('action:')[1].trim();
          i++;
        }
        if (i + 1 < lines.length && lines[i + 1].includes('description:')) {
          file.description = lines[i + 1].split('description:')[1].trim();
          i++;
        }

        files.push(file);
      }
    }

    return files.length > 0 ? files : undefined;
  }

  /**
   * Populate Redis with cold state
   */
  private async populateRedis(): Promise<void> {
    if (!this.taskList) {
      return;
    }

    console.log('[Startup] Populating Redis with cold state...');

    await this.redis.execute(async (client) => {
      for (const pr of this.taskList!.prs) {
        const key = `pr:${pr.id}`;

        // Only hydrate cold state fields
        // Hot state (assigned_to, started_at, progress) is ephemeral
        await client.hSet(key, {
          'id': pr.id,
          'title': pr.title,
          'cold_state': pr.cold_state,
          'priority': pr.priority,
          'complexity_score': String(pr.complexity.score),
          'complexity_minutes': String(pr.complexity.estimated_minutes),
          'complexity_model': pr.complexity.suggested_model,
          'dependencies': JSON.stringify(pr.dependencies),
        });

        // Store file lists if present
        if (pr.estimated_files) {
          await client.hSet(key, 'estimated_files', JSON.stringify(pr.estimated_files));
        }
        if (pr.actual_files) {
          await client.hSet(key, 'actual_files', JSON.stringify(pr.actual_files));
        }
      }
    });

    console.log(`[Startup] Populated ${this.taskList.prs.length} PRs in Redis`);
  }

  /**
   * Verify lease consistency
   */
  private async verifyLeases(): Promise<void> {
    console.log('[Startup] Verifying lease consistency...');

    await this.redis.execute(async (client) => {
      // Get all active leases
      const leaseKeys = await client.keys('lease:*');

      for (const leaseKey of leaseKeys) {
        const lease = await client.hGetAll(leaseKey);

        // Check if agent exists
        const agentKey = `agent:${lease.agent_id}`;
        const agentExists = await client.exists(agentKey);

        if (!agentExists) {
          console.log(`[Startup] Releasing orphaned lease: ${leaseKey}`);
          await client.del(leaseKey);

          // Also remove from agent's lease set
          if (lease.agent_id) {
            await client.sRem(`agent:${lease.agent_id}:leases`, leaseKey);
          }
        }
      }
    });
  }

  /**
   * Clean up orphaned hot states
   */
  private async cleanOrphans(): Promise<void> {
    console.log('[Startup] Cleaning orphaned hot states...');

    await this.redis.execute(async (client) => {
      // Get all PR keys
      const prKeys = await client.keys('pr:*');

      for (const prKey of prKeys) {
        const pr = await client.hGetAll(prKey);

        // If PR has hot state but no active agent, clean it
        if (pr.assigned_to) {
          const agentExists = await client.exists(`agent:${pr.assigned_to}`);
          if (!agentExists) {
            console.log(`[Startup] Cleaning orphaned assignment: ${prKey}`);
            await client.hDel(prKey, ['assigned_to', 'started_at', 'progress']);
          }
        }
      }

      // Clean up any temporary keys
      const tempKeys = await client.keys('temp:*');
      if (tempKeys.length > 0) {
        console.log(`[Startup] Removing ${tempKeys.length} temporary keys`);
        await client.del(tempKeys);
      }
    });
  }

  /**
   * Get parsed task list
   */
  getTaskList(): TaskList | null {
    return this.taskList;
  }

  /**
   * Get PR by ID
   */
  getPR(prId: string): TaskListPR | undefined {
    return this.taskList?.prs.find(pr => pr.id === prId);
  }

  /**
   * Get all PRs
   */
  getAllPRs(): TaskListPR[] {
    return this.taskList?.prs || [];
  }
}