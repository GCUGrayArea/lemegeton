/**
 * File-based Memory Adapter
 *
 * Phase 0.1a implementation using filesystem storage.
 * Stores memory files in docs/memory/ for git tracking and sharing.
 *
 * Features:
 * - Atomic writes (temp file + rename)
 * - Default content templates for empty files
 * - Simple keyword-based queries
 * - Batch operations for efficiency
 *
 * Future: VectorMemoryAdapter will provide semantic search without
 * changing consumer code (MemoryBank service).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  MemoryAdapter,
  MemoryFile,
  MemoryBankSnapshot,
  QueryOptions,
  MemoryQueryResult,
} from '../types/memory';

export class FileMemoryAdapter implements MemoryAdapter {
  private baseDir: string;

  /**
   * Map of memory files to their filesystem paths.
   * All paths relative to project root.
   */
  private fileMap: Map<MemoryFile, string> = new Map([
    [MemoryFile.SystemPatterns, 'docs/memory/systemPatterns.md'],
    [MemoryFile.TechContext, 'docs/memory/techContext.md'],
    [MemoryFile.ActiveContext, 'docs/memory/activeContext.md'],
    [MemoryFile.Progress, 'docs/memory/progress.md'],
  ]);

  /**
   * Create a new FileMemoryAdapter.
   *
   * @param projectRoot - Absolute path to project root directory
   */
  constructor(projectRoot: string) {
    this.baseDir = projectRoot;
  }

  /**
   * Read content from a memory file.
   * Returns default template if file doesn't exist.
   */
  async read(file: MemoryFile): Promise<string> {
    const filePath = this.getFilePath(file);

    try {
      const content = await fs.readFile(filePath, 'utf8');
      return content;
    } catch (error: any) {
      // Return default content if file doesn't exist
      if (error.code === 'ENOENT') {
        return this.getDefaultContent(file);
      }
      throw error;
    }
  }

  /**
   * Write content to a memory file with atomic operation.
   * Uses temp file + rename to prevent corruption.
   */
  async write(file: MemoryFile, content: string): Promise<void> {
    const filePath = this.getFilePath(file);

    // Ensure directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Atomic write: temp file + rename
    const tempPath = `${filePath}.tmp`;
    try {
      await fs.writeFile(tempPath, content, 'utf8');
      await fs.rename(tempPath, filePath);
    } catch (error) {
      // Clean up temp file if rename fails
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Check if a memory file exists.
   */
  async exists(file: MemoryFile): Promise<boolean> {
    const filePath = this.getFilePath(file);

    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read all memory files in parallel.
   */
  async readAll(): Promise<MemoryBankSnapshot> {
    const [systemPatterns, techContext, activeContext, progress] =
      await Promise.all([
        this.read(MemoryFile.SystemPatterns),
        this.read(MemoryFile.TechContext),
        this.read(MemoryFile.ActiveContext),
        this.read(MemoryFile.Progress),
      ]);

    return {
      systemPatterns,
      techContext,
      activeContext,
      progress,
      lastUpdated: new Date(),
    };
  }

  /**
   * Write all memory files in parallel.
   */
  async writeAll(snapshot: MemoryBankSnapshot): Promise<void> {
    await Promise.all([
      this.write(MemoryFile.SystemPatterns, snapshot.systemPatterns),
      this.write(MemoryFile.TechContext, snapshot.techContext),
      this.write(MemoryFile.ActiveContext, snapshot.activeContext),
      this.write(MemoryFile.Progress, snapshot.progress),
    ]);
  }

  /**
   * Query memory files using simple keyword matching.
   *
   * Future: VectorMemoryAdapter will provide semantic search with rankings.
   */
  async query(
    question: string,
    options?: QueryOptions
  ): Promise<MemoryQueryResult[]> {
    // Determine which files to search
    const files = options?.fileFilter || [
      MemoryFile.SystemPatterns,
      MemoryFile.TechContext,
      MemoryFile.ActiveContext,
      MemoryFile.Progress,
    ];

    const results: MemoryQueryResult[] = [];

    // Search each file for keyword matches
    for (const file of files) {
      const content = await this.read(file);

      if (this.matchesQuery(content, question)) {
        results.push({
          file,
          content,
          excerpt: this.extractExcerpt(content, question),
        });
      }
    }

    // Limit results if k specified
    if (options?.k && results.length > options.k) {
      return results.slice(0, options.k);
    }

    return results;
  }

  /**
   * Get absolute filesystem path for a memory file.
   */
  private getFilePath(file: MemoryFile): string {
    const relativePath = this.fileMap.get(file);
    if (!relativePath) {
      throw new Error(`Unknown memory file: ${file}`);
    }
    return path.join(this.baseDir, relativePath);
  }

  /**
   * Simple keyword matching (case-insensitive).
   * Returns true if content contains any keyword from the query.
   */
  private matchesQuery(content: string, question: string): boolean {
    const keywords = question.toLowerCase().split(/\s+/);
    const contentLower = content.toLowerCase();

    return keywords.some((keyword) => contentLower.includes(keyword));
  }

  /**
   * Extract a short excerpt showing match context.
   * Centers on first keyword match with surrounding text.
   */
  private extractExcerpt(
    content: string,
    query: string,
    contextChars: number = 200
  ): string {
    const queryLower = query.toLowerCase();
    const contentLower = content.toLowerCase();

    // Find first keyword
    const firstKeyword = queryLower.split(/\s+/)[0];
    const index = contentLower.indexOf(firstKeyword);

    if (index === -1) {
      // No match found (shouldn't happen), return start of content
      return content.slice(0, contextChars) + '...';
    }

    // Center excerpt on match
    const start = Math.max(0, index - contextChars / 2);
    const end = Math.min(content.length, index + contextChars / 2);

    let excerpt = content.slice(start, end);

    // Add ellipsis if truncated
    if (start > 0) excerpt = '...' + excerpt;
    if (end < content.length) excerpt = excerpt + '...';

    return excerpt;
  }

  /**
   * Get default template content for a memory file.
   * Used when file doesn't exist yet.
   */
  private getDefaultContent(file: MemoryFile): string {
    switch (file) {
      case MemoryFile.SystemPatterns:
        return `# System Patterns

Architectural decisions, design patterns, and component relationships discovered during implementation.

## Overview

This file documents the key architectural patterns and design decisions that emerge during development. These patterns should be discovered through implementation (not planned upfront) and documented for future reference.

## Patterns

_(To be filled during development as patterns emerge)_

## Design Decisions

_(Document significant choices with rationale)_

## Anti-Patterns to Avoid

_(Note patterns that were tried and abandoned)_
`;

      case MemoryFile.TechContext:
        return `# Tech Context

Actual technologies used, development setup, constraints, and integration points.

## Technology Stack

_(Document actual technologies as they're adopted)_

## Development Environment

_(Setup instructions, tool versions, compatibility notes)_

## External Integrations

_(Third-party services, APIs, dependencies)_

## Constraints

_(Technical limitations, compatibility requirements, performance targets)_
`;

      case MemoryFile.ActiveContext:
        return `# Active Context

Current work focus, recent changes, priorities, and active decisions or blockers.

**Note:** This file changes most frequently. Update at start/end of significant work sessions.

## Current Focus

_(What PR or feature is currently being worked on)_

## Recent Changes

_(Summary of recent work completed)_

## Active Decisions

_(Open questions, pending choices, areas needing clarification)_

## Blockers

_(Current blockers and their status)_

## Next Steps

_(Immediate priorities for upcoming work)_
`;

      case MemoryFile.Progress:
        return `# Progress

What works vs. what's planned, remaining work, feature status, and known technical debt.

## Completed Features

_(List of working features and completed PRs)_

## In Progress

_(Current work being implemented)_

## Planned

_(Upcoming PRs and features from task list)_

## Known Issues

_(Bugs, limitations, or technical debt to address)_

## Testing Status

_(Test coverage, known test gaps, testing approach)_
`;

      default:
        return '';
    }
  }
}
