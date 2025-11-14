/**
 * Paired file locking logic for test files
 *
 * This module handles the automatic detection and pairing of source files
 * with their corresponding test files, ensuring both are locked atomically.
 */

import * as path from 'path';
import * as fs from 'fs';

/**
 * Configuration for test file patterns
 */
export interface TestFilePattern {
  /** Source directory pattern (e.g., 'src') */
  sourceDir: string | RegExp;
  /** Test directory pattern (e.g., 'tests', '__tests__') */
  testDir: string;
  /** Test file suffix (e.g., '.test', '.spec') */
  suffix: string;
  /** File extension (e.g., '.ts', '.js') */
  extension?: string;
  /** Whether test files are colocated with source files */
  colocated?: boolean;
}

/**
 * Default test file patterns for common project structures
 */
export const DEFAULT_TEST_PATTERNS: TestFilePattern[] = [
  // TypeScript/JavaScript patterns
  { sourceDir: 'src', testDir: 'tests', suffix: '.test', extension: '.ts' },
  { sourceDir: 'src', testDir: 'tests', suffix: '.test', extension: '.tsx' },
  { sourceDir: 'src', testDir: 'tests', suffix: '.test', extension: '.js' },
  { sourceDir: 'src', testDir: 'tests', suffix: '.test', extension: '.jsx' },
  { sourceDir: 'src', testDir: 'test', suffix: '.test', extension: '.ts' },
  { sourceDir: 'src', testDir: 'test', suffix: '.test', extension: '.js' },
  { sourceDir: 'lib', testDir: 'test', suffix: '.test', extension: '.js' },

  // Spec patterns
  { sourceDir: 'src', testDir: 'tests', suffix: '.spec', extension: '.ts' },
  { sourceDir: 'src', testDir: 'spec', suffix: '.spec', extension: '.ts' },
  { sourceDir: 'src', testDir: 'spec', suffix: '.spec', extension: '.js' },

  // Colocated test patterns (test files next to source files)
  { sourceDir: 'src', testDir: 'src', suffix: '.test', colocated: true },
  { sourceDir: 'src', testDir: 'src', suffix: '.spec', colocated: true },
  { sourceDir: /.*/, testDir: '__tests__', suffix: '', colocated: true },

  // Python patterns
  { sourceDir: /.*/, testDir: 'tests', suffix: '_test', extension: '.py' },
  { sourceDir: /.*/, testDir: 'tests', suffix: '', extension: '.py' },  // test_*.py pattern

  // Go patterns (package-level tests)
  { sourceDir: /.*/, testDir: '', suffix: '_test', extension: '.go', colocated: true },

  // Ruby patterns
  { sourceDir: 'lib', testDir: 'spec', suffix: '_spec', extension: '.rb' },
  { sourceDir: 'app', testDir: 'spec', suffix: '_spec', extension: '.rb' },

  // Rust patterns
  { sourceDir: 'src', testDir: 'tests', suffix: '', extension: '.rs' },
];

/**
 * Result of finding paired files
 */
export interface PairedFiles {
  /** Original requested files */
  requested: string[];
  /** Test files found for the requested files */
  testFiles: string[];
  /** Source files found for test files (if test files were requested) */
  sourceFiles: string[];
  /** All files that should be locked together */
  all: string[];
}

/**
 * Finds test files for a given source file
 *
 * @param sourceFile Path to the source file
 * @param patterns Test file patterns to use
 * @returns Array of potential test file paths
 */
export function findTestFiles(
  sourceFile: string,
  patterns: TestFilePattern[] = DEFAULT_TEST_PATTERNS
): string[] {
  const testFiles: string[] = [];
  const normalized = sourceFile.replace(/\\/g, '/');
  const parsed = path.parse(sourceFile);
  const dir = parsed.dir.replace(/\\/g, '/');
  const name = parsed.name;
  const ext = parsed.ext;

  for (const pattern of patterns) {
    // Check if source directory matches
    const sourceDirMatch = pattern.sourceDir instanceof RegExp
      ? pattern.sourceDir.test(dir)
      : dir.includes(pattern.sourceDir);

    if (!sourceDirMatch) continue;

    // Skip if extension doesn't match (if specified)
    if (pattern.extension && ext !== pattern.extension) continue;

    if (pattern.colocated) {
      // Test file is in the same directory or a subdirectory
      if (pattern.testDir === '__tests__') {
        // Look in __tests__ subdirectory
        testFiles.push(path.join(dir, '__tests__', `${name}${pattern.suffix}${ext}`));
      } else {
        // Test file is next to source file
        testFiles.push(path.join(dir, `${name}${pattern.suffix}${ext}`));
      }
    } else {
      // Test file is in a separate test directory
      const testDir = typeof pattern.sourceDir === 'string'
        ? dir.replace(pattern.sourceDir, pattern.testDir)
        : pattern.testDir;

      testFiles.push(path.join(testDir, `${name}${pattern.suffix}${ext}`));
    }
  }

  // Also check for special test file naming conventions
  // test_*.py pattern for Python
  if (ext === '.py') {
    const testDir = dir.replace(/\\/g, '/').replace(/\/?(src|lib|app)/, '/tests');
    testFiles.push(path.join(testDir, `test_${name}${ext}`));
  }

  // Remove duplicates
  return [...new Set(testFiles)];
}

/**
 * Finds source files for a given test file
 *
 * @param testFile Path to the test file
 * @param patterns Test file patterns to use
 * @returns Array of potential source file paths
 */
export function findSourceFiles(
  testFile: string,
  patterns: TestFilePattern[] = DEFAULT_TEST_PATTERNS
): string[] {
  const sourceFiles: string[] = [];
  const normalized = testFile.replace(/\\/g, '/');
  const parsed = path.parse(testFile);
  const dir = parsed.dir.replace(/\\/g, '/');
  let name = parsed.name;
  const ext = parsed.ext;

  for (const pattern of patterns) {
    // Skip if extension doesn't match (if specified)
    if (pattern.extension && ext !== pattern.extension) continue;

    // Remove test suffix if present
    if (pattern.suffix && name.endsWith(pattern.suffix)) {
      name = name.slice(0, -pattern.suffix.length);
    }

    // Handle Python test_ prefix
    if (ext === '.py' && name.startsWith('test_')) {
      name = name.slice(5);
    }

    if (pattern.colocated) {
      if (pattern.testDir === '__tests__' && dir.endsWith('__tests__')) {
        // Source file is in parent directory
        const parentDir = path.dirname(dir);
        sourceFiles.push(path.join(parentDir, `${name}${ext}`));
      } else if (pattern.suffix) {
        // Source file is in same directory without suffix
        sourceFiles.push(path.join(dir, `${name}${ext}`));
      }
    } else {
      // Source file is in a separate source directory
      const testDirPattern = new RegExp(`[/\\\\]${pattern.testDir}[/\\\\]`);
      if (testDirPattern.test(dir)) {
        const sourceDir = typeof pattern.sourceDir === 'string'
          ? dir.replace(pattern.testDir, pattern.sourceDir)
          : 'src';  // Default to src if pattern is regex

        sourceFiles.push(path.join(sourceDir, `${name}${ext}`));
      }
    }
  }

  // Remove duplicates
  return [...new Set(sourceFiles)];
}

/**
 * Checks if a file is a test file based on common patterns
 *
 * @param filepath Path to check
 * @returns True if the file appears to be a test file
 */
export function isTestFile(filepath: string): boolean {
  const normalized = filepath.replace(/\\/g, '/');
  const parsed = path.parse(filepath);
  const name = parsed.name;
  const dir = normalized;

  // Check common test file patterns
  if (name.includes('.test') || name.includes('.spec')) return true;
  if (name.includes('_test') || name.includes('_spec')) return true;
  if (name.startsWith('test_') || name.startsWith('test.')) return true;

  // Check common test directory patterns
  if (dir.includes('/tests/') || dir.includes('/test/')) return true;
  if (dir.includes('/__tests__/') || dir.includes('/spec/')) return true;

  return false;
}

/**
 * Expands a list of files to include their paired files
 *
 * @param files List of files to expand
 * @param patterns Test file patterns to use
 * @param checkExists Whether to check if files exist on disk
 * @returns Paired files result
 */
export async function expandWithPairedFiles(
  files: string[],
  patterns: TestFilePattern[] = DEFAULT_TEST_PATTERNS,
  checkExists: boolean = false
): Promise<PairedFiles> {
  const requested = [...files];
  const testFiles: Set<string> = new Set();
  const sourceFiles: Set<string> = new Set();
  const all: Set<string> = new Set(files);

  for (const file of files) {
    if (isTestFile(file)) {
      // This is a test file, find its source files
      const sources = findSourceFiles(file, patterns);
      for (const source of sources) {
        if (checkExists) {
          try {
            await fs.promises.access(source, fs.constants.F_OK);
            sourceFiles.add(source);
            all.add(source);
          } catch {
            // File doesn't exist, skip
          }
        } else {
          sourceFiles.add(source);
          all.add(source);
        }
      }
    } else {
      // This is a source file, find its test files
      const tests = findTestFiles(file, patterns);
      for (const test of tests) {
        if (checkExists) {
          try {
            await fs.promises.access(test, fs.constants.F_OK);
            testFiles.add(test);
            all.add(test);
          } catch {
            // File doesn't exist, skip
          }
        } else {
          testFiles.add(test);
          all.add(test);
        }
      }
    }
  }

  return {
    requested,
    testFiles: Array.from(testFiles),
    sourceFiles: Array.from(sourceFiles),
    all: Array.from(all),
  };
}

/**
 * Configuration for paired locking behavior
 */
export interface PairedLockingConfig {
  /** Whether to enable paired locking */
  enabled?: boolean;
  /** Custom test file patterns */
  patterns?: TestFilePattern[];
  /** Whether to check if files exist before locking */
  checkExists?: boolean;
  /** Whether to fail if test files are missing */
  requireTests?: boolean;
}

/**
 * Default paired locking configuration
 */
export const DEFAULT_PAIRED_LOCKING_CONFIG: Required<PairedLockingConfig> = {
  enabled: true,
  patterns: DEFAULT_TEST_PATTERNS,
  checkExists: true,
  requireTests: false,
};