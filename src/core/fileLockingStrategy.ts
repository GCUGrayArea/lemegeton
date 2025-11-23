/**
 * File Locking Strategy Interface
 *
 * Defines different strategies for expanding file lists before locking.
 * This allows for flexible handling of paired files (e.g., source + test files).
 */

import { expandWithPairedFiles, PairedFiles, PairedLockingConfig } from './pairedLocking';

/**
 * Result of expanding a file list for locking
 */
export interface FileExpansionResult {
  /** All files that should be locked */
  all: string[];
  /** Whether the file list was expanded */
  expanded: boolean;
}

/**
 * Strategy interface for file locking expansion
 */
export interface FileLockingStrategy {
  /**
   * Expand the given file list according to the strategy
   * @param files - Files requested for locking
   * @returns Expanded file list and expansion flag
   */
  expandFiles(files: string[]): Promise<FileExpansionResult>;
}

/**
 * Simple file locking strategy - no expansion
 */
export class SimpleFileLockingStrategy implements FileLockingStrategy {
  async expandFiles(files: string[]): Promise<FileExpansionResult> {
    return {
      all: files,
      expanded: false,
    };
  }
}

/**
 * Paired file locking strategy - expands to include paired files
 */
export class PairedFileLockingStrategy implements FileLockingStrategy {
  constructor(
    private readonly patterns: PairedLockingConfig['patterns'],
    private readonly checkExists: PairedLockingConfig['checkExists']
  ) {}

  async expandFiles(files: string[]): Promise<FileExpansionResult> {
    const paired = await expandWithPairedFiles(
      files,
      this.patterns,
      this.checkExists
    );

    return {
      all: paired.all,
      expanded: paired.all.length > files.length,
    };
  }
}

/**
 * Factory function to create the appropriate strategy
 */
export function createFileLockingStrategy(
  config: PairedLockingConfig
): FileLockingStrategy {
  if (config.enabled) {
    return new PairedFileLockingStrategy(config.patterns, config.checkExists);
  }
  return new SimpleFileLockingStrategy();
}
