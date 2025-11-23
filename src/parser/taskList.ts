/**
 * Task List Parser
 *
 * Main parser for task-list.md files with YAML frontmatter
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ParsedTaskList, PRData, TaskListMetadata, ValidationResult } from './types';
import { extractFrontmatter, reconstructDocument, addPRBlock } from './frontmatter';
import { validatePR, validateTaskList } from './validation';
import { FileError, ValidationError } from './errors';
import { SimpleCache } from '../utils/cache';

export class TaskListParser {
  private cache = new SimpleCache<string, ParsedTaskList>({ ttl: 30000 });

  /**
   * Parse a task list file
   */
  async parse(filePath: string, useCache: boolean = true): Promise<ParsedTaskList> {
    // Check cache
    if (useCache) {
      const cached = this.cache.get(filePath);
      if (cached) {
        return cached;
      }
    }

    // Read file
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      throw new FileError(
        `Failed to read task list file: ${error instanceof Error ? error.message : String(error)}`,
        filePath,
        (error as NodeJS.ErrnoException).code
      );
    }

    // Extract metadata from header
    const metadata = this.extractMetadata(content);

    // Extract PR blocks
    const blocks = extractFrontmatter(content);
    const prs = blocks.map(b => b.data);

    // Validate task list
    const validation = validateTaskList(prs);
    if (!validation.valid) {
      throw new ValidationError(
        'Task list validation failed',
        undefined,
        undefined,
        validation.errors
      );
    }

    const result: ParsedTaskList = {
      metadata,
      prs,
      raw: content,
    };

    // Cache result
    if (useCache) {
      this.cache.set(filePath, result);
    }

    return result;
  }

  /**
   * Update a single PR in the task list
   */
  async update(
    filePath: string,
    prId: string,
    updates: Partial<PRData>
  ): Promise<void> {
    // Parse current state
    const taskList = await this.parse(filePath, false);

    // Find PR to update
    const pr = taskList.prs.find(p => p.pr_id === prId);
    if (!pr) {
      throw new ValidationError(`PR ${prId} not found in task list`);
    }

    // Apply updates
    const updatedPR = { ...pr, ...updates };

    // Validate updated PR
    const prIds = new Set(taskList.prs.map(p => p.pr_id));
    const validation = validatePR(updatedPR, prIds);
    if (!validation.valid) {
      throw new ValidationError(
        `Updated PR ${prId} failed validation`,
        prId,
        undefined,
        validation.errors
      );
    }

    // Reconstruct document
    const newContent = reconstructDocument(taskList.raw, prId, updatedPR);

    // Write atomically
    await this.writeAtomic(filePath, newContent);

    // Invalidate cache
    this.cache.delete(filePath);
    this.cacheTimestamps.delete(filePath);
  }

  /**
   * Add a new PR to the task list
   */
  async addPR(filePath: string, pr: PRData): Promise<void> {
    // Parse current state
    const taskList = await this.parse(filePath, false);

    // Check for duplicate PR ID
    if (taskList.prs.some(p => p.pr_id === pr.pr_id)) {
      throw new ValidationError(`PR ${pr.pr_id} already exists in task list`);
    }

    // Validate new PR
    const prIds = new Set(taskList.prs.map(p => p.pr_id));
    const validation = validatePR(pr, prIds);
    if (!validation.valid) {
      throw new ValidationError(
        `New PR ${pr.pr_id} failed validation`,
        pr.pr_id,
        undefined,
        validation.errors
      );
    }

    // Add to document
    const newContent = addPRBlock(taskList.raw, pr);

    // Write atomically
    await this.writeAtomic(filePath, newContent);

    // Invalidate cache
    this.cache.delete(filePath);
    this.cacheTimestamps.delete(filePath);
  }

  /**
   * Validate a PR data object without writing
   */
  validate(data: PRData, allPRIds?: Set<string>): ValidationResult {
    return validatePR(data, allPRIds);
  }

  /**
   * Clear parser cache
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheTimestamps.clear();
  }

  /**
   * Extract metadata from task list header
   */
  private extractMetadata(content: string): TaskListMetadata {
    const metadata: TaskListMetadata = {};

    // Extract from markdown headers and comments
    const lines = content.split('\n');

    for (const line of lines) {
      // Stop at first PR block
      if (line.trim() === '---') {
        break;
      }

      // Parse metadata patterns
      const generatedMatch = line.match(/\*\*Generated for:\*\*\s*(.+)/);
      if (generatedMatch) {
        metadata.generated_for = generatedMatch[1].trim();
      }

      const complexityMatch = line.match(/\*\*Estimated Total Complexity:\*\*\s*(\d+)/);
      if (complexityMatch) {
        metadata.estimated_total_complexity = parseInt(complexityMatch[1], 10);
      }

      const haikuMatch = line.match(/Haiku agents:\s*(\d+)/);
      if (haikuMatch) {
        metadata.recommended_agents = metadata.recommended_agents || {};
        metadata.recommended_agents.haiku = parseInt(haikuMatch[1], 10);
      }

      const sonnetMatch = line.match(/Sonnet agents:\s*(\d+)/);
      if (sonnetMatch) {
        metadata.recommended_agents = metadata.recommended_agents || {};
        metadata.recommended_agents.sonnet = parseInt(sonnetMatch[1], 10);
      }

      const opusMatch = line.match(/Opus agents:\s*(\d+)/);
      if (opusMatch) {
        metadata.recommended_agents = metadata.recommended_agents || {};
        metadata.recommended_agents.opus = parseInt(opusMatch[1], 10);
      }
    }

    return metadata;
  }

  /**
   * Atomic file write (temp file + rename)
   */
  private async writeAtomic(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath);
    const tempPath = path.join(dir, `.${path.basename(filePath)}.tmp`);

    try {
      // Write to temp file
      await fs.writeFile(tempPath, content, 'utf-8');

      // Atomic rename
      await fs.rename(tempPath, filePath);
    } catch (error) {
      // Clean up temp file on error
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      throw new FileError(
        `Failed to write task list file: ${error instanceof Error ? error.message : String(error)}`,
        filePath,
        (error as NodeJS.ErrnoException).code
      );
    }
  }
}
