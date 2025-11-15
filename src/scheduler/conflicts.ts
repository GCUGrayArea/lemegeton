/**
 * File Conflict Detection
 *
 * Detects which PRs would conflict due to modifying the same files.
 * Two PRs conflict if they share any files in their modification sets.
 */

import { PRNode, ConflictInfo } from './types';

/**
 * Conflict detection and management
 */
export class ConflictDetector {
  /** Map of PR pairs to their conflicting files */
  private conflicts: Map<string, Set<string>> = new Map();

  /** Map of files to PRs that modify them */
  private fileToPRs: Map<string, Set<string>> = new Map();

  /** Cache for quick conflict lookups */
  private conflictCache: Map<string, boolean> = new Map();

  /**
   * Build conflict matrix from PR nodes
   */
  detectConflicts(nodes: PRNode[]): void {
    // Clear previous state
    this.clear();

    // Build file-to-PRs mapping
    for (const node of nodes) {
      for (const file of node.files) {
        if (!this.fileToPRs.has(file)) {
          this.fileToPRs.set(file, new Set());
        }
        this.fileToPRs.get(file)!.add(node.id);
      }
    }

    // Detect conflicts
    for (const [file, prs] of this.fileToPRs.entries()) {
      if (prs.size > 1) {
        // Multiple PRs modify this file - they conflict
        const prArray = Array.from(prs);
        for (let i = 0; i < prArray.length; i++) {
          for (let j = i + 1; j < prArray.length; j++) {
            const key = this.getConflictKey(prArray[i], prArray[j]);

            if (!this.conflicts.has(key)) {
              this.conflicts.set(key, new Set());
            }
            this.conflicts.get(key)!.add(file);
          }
        }
      }
    }
  }

  /**
   * Check if two PRs have a conflict
   */
  hasConflict(pr1: string, pr2: string): boolean {
    if (pr1 === pr2) return false;

    // Check cache first
    const cacheKey = this.getCacheKey(pr1, pr2);
    if (this.conflictCache.has(cacheKey)) {
      return this.conflictCache.get(cacheKey)!;
    }

    // Check conflict map
    const conflictKey = this.getConflictKey(pr1, pr2);
    const hasConflict = this.conflicts.has(conflictKey);

    // Cache the result
    this.conflictCache.set(cacheKey, hasConflict);

    return hasConflict;
  }

  /**
   * Get conflicting files between two PRs
   */
  getConflictingFiles(pr1: string, pr2: string): Set<string> {
    const key = this.getConflictKey(pr1, pr2);
    return this.conflicts.get(key) || new Set();
  }

  /**
   * Get all PRs that conflict with a given PR
   */
  getConflictingPRs(prId: string): Set<string> {
    const conflicting = new Set<string>();

    // Check all conflict entries
    for (const key of this.conflicts.keys()) {
      const [pr1, pr2] = key.split('|');
      if (pr1 === prId) {
        conflicting.add(pr2);
      } else if (pr2 === prId) {
        conflicting.add(pr1);
      }
    }

    return conflicting;
  }

  /**
   * Get all PRs that modify a specific file
   */
  getPRsForFile(file: string): Set<string> {
    return this.fileToPRs.get(file) || new Set();
  }

  /**
   * Find independent sets (PRs with no conflicts between them)
   */
  findIndependentSets(nodes: PRNode[]): PRNode[][] {
    const sets: PRNode[][] = [];
    const used = new Set<string>();

    for (const node of nodes) {
      if (used.has(node.id)) continue;

      const independentSet: PRNode[] = [node];
      used.add(node.id);

      // Try to add more nodes to this independent set
      for (const candidate of nodes) {
        if (used.has(candidate.id)) continue;

        // Check if candidate conflicts with any node in the set
        let canAdd = true;
        for (const setNode of independentSet) {
          if (this.hasConflict(candidate.id, setNode.id)) {
            canAdd = false;
            break;
          }
        }

        if (canAdd) {
          independentSet.push(candidate);
          used.add(candidate.id);
        }
      }

      sets.push(independentSet);
    }

    return sets;
  }

  /**
   * Get conflict density (ratio of conflicts to possible conflicts)
   */
  getConflictDensity(nodes: PRNode[]): number {
    if (nodes.length < 2) return 0;

    let conflictCount = 0;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (this.hasConflict(nodes[i].id, nodes[j].id)) {
          conflictCount++;
        }
      }
    }

    const possibleConflicts = (nodes.length * (nodes.length - 1)) / 2;
    return conflictCount / possibleConflicts;
  }

  /**
   * Get detailed conflict information
   */
  getConflictInfo(): ConflictInfo[] {
    const info: ConflictInfo[] = [];

    for (const [key, files] of this.conflicts.entries()) {
      const [pr1, pr2] = key.split('|');
      info.push({
        pr1,
        pr2,
        conflictingFiles: new Set(files),
      });
    }

    return info;
  }

  /**
   * Clear all conflict data
   */
  clear(): void {
    this.conflicts.clear();
    this.fileToPRs.clear();
    this.conflictCache.clear();
  }

  /**
   * Get a consistent key for a PR pair
   */
  private getConflictKey(pr1: string, pr2: string): string {
    // Always use lexicographic order for consistency
    return pr1 < pr2 ? `${pr1}|${pr2}` : `${pr2}|${pr1}`;
  }

  /**
   * Get cache key for conflict lookup
   */
  private getCacheKey(pr1: string, pr2: string): string {
    return pr1 < pr2 ? `${pr1}:${pr2}` : `${pr2}:${pr1}`;
  }

  /**
   * Export conflicts to JSON for debugging
   */
  toJSON(): any {
    const conflicts: any[] = [];

    for (const [key, files] of this.conflicts.entries()) {
      const [pr1, pr2] = key.split('|');
      conflicts.push({
        pr1,
        pr2,
        files: Array.from(files),
      });
    }

    const fileMap: any = {};
    for (const [file, prs] of this.fileToPRs.entries()) {
      fileMap[file] = Array.from(prs);
    }

    return {
      conflicts,
      fileMap,
      totalConflicts: conflicts.length,
      totalFiles: this.fileToPRs.size,
    };
  }

  /**
   * Get statistics about conflicts
   */
  getStats(): {
    totalConflicts: number;
    totalFiles: number;
    avgConflictsPerFile: number;
    maxConflictsForFile: { file: string; count: number } | null;
  } {
    let maxConflicts = 0;
    let maxFile = '';

    for (const [file, prs] of this.fileToPRs.entries()) {
      if (prs.size > maxConflicts) {
        maxConflicts = prs.size;
        maxFile = file;
      }
    }

    const totalPRsWithFiles = Array.from(this.fileToPRs.values())
      .reduce((sum, prs) => sum + prs.size, 0);

    return {
      totalConflicts: this.conflicts.size,
      totalFiles: this.fileToPRs.size,
      avgConflictsPerFile: this.fileToPRs.size > 0
        ? totalPRsWithFiles / this.fileToPRs.size
        : 0,
      maxConflictsForFile: maxFile
        ? { file: maxFile, count: maxConflicts }
        : null,
    };
  }
}