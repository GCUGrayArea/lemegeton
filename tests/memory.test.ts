/**
 * Memory Bank Test Suite
 *
 * Comprehensive tests for memory bank system including:
 * - FileMemoryAdapter operations
 * - MemoryBank service with Redis caching
 * - Adapter pattern validation
 * - Update trigger logic
 * - Query operations
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileMemoryAdapter } from '../src/adapters/FileMemoryAdapter';
import { MemoryBank } from '../src/memory/MemoryBank';
import {
  MemoryFile,
  MemoryBankSnapshot,
  UpdateContext,
} from '../src/types/memory';

describe('Memory Bank System', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create temporary directory for each test
    testDir = path.join(os.tmpdir(), `lemegeton-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('FileMemoryAdapter', () => {
    describe('read operations', () => {
      it('returns default content for missing files', async () => {
        const adapter = new FileMemoryAdapter(testDir);
        const content = await adapter.read(MemoryFile.SystemPatterns);

        expect(content).toContain('# System Patterns');
        expect(content).toContain('Architectural decisions');
      });

      it('reads existing file content', async () => {
        const adapter = new FileMemoryAdapter(testDir);
        const testContent = '# Test Content\n\nThis is a test.';

        // Write then read
        await adapter.write(MemoryFile.TechContext, testContent);
        const content = await adapter.read(MemoryFile.TechContext);

        expect(content).toBe(testContent);
      });

      it('readAll returns all four memory files', async () => {
        const adapter = new FileMemoryAdapter(testDir);

        // Write some test content
        await adapter.write(MemoryFile.SystemPatterns, 'Patterns content');
        await adapter.write(MemoryFile.TechContext, 'Tech content');

        const snapshot = await adapter.readAll();

        expect(snapshot.systemPatterns).toContain('Patterns content');
        expect(snapshot.techContext).toContain('Tech content');
        expect(snapshot.activeContext).toContain('# Active Context'); // Default
        expect(snapshot.progress).toContain('# Progress'); // Default
        expect(snapshot.lastUpdated).toBeInstanceOf(Date);
      });
    });

    describe('write operations', () => {
      it('writes content atomically', async () => {
        const adapter = new FileMemoryAdapter(testDir);
        const testContent = 'Test content for atomic write';

        await adapter.write(MemoryFile.Progress, testContent);
        const content = await adapter.read(MemoryFile.Progress);

        expect(content).toBe(testContent);
      });

      it('creates directory if missing', async () => {
        const adapter = new FileMemoryAdapter(testDir);
        const testContent = 'Test content';

        // Directory doesn't exist yet
        const memoryDir = path.join(testDir, 'docs', 'memory');
        const exists = await fs
          .access(memoryDir)
          .then(() => true)
          .catch(() => false);
        expect(exists).toBe(false);

        // Write should create directory
        await adapter.write(MemoryFile.ActiveContext, testContent);

        const existsAfter = await fs
          .access(memoryDir)
          .then(() => true)
          .catch(() => false);
        expect(existsAfter).toBe(true);
      });

      it('writeAll writes all files', async () => {
        const adapter = new FileMemoryAdapter(testDir);
        const snapshot: MemoryBankSnapshot = {
          systemPatterns: 'Patterns...',
          techContext: 'Tech...',
          activeContext: 'Active...',
          progress: 'Progress...',
          lastUpdated: new Date(),
        };

        await adapter.writeAll(snapshot);

        const readSnapshot = await adapter.readAll();
        expect(readSnapshot.systemPatterns).toBe('Patterns...');
        expect(readSnapshot.techContext).toBe('Tech...');
        expect(readSnapshot.activeContext).toBe('Active...');
        expect(readSnapshot.progress).toBe('Progress...');
      });
    });

    describe('exists operations', () => {
      it('returns false for non-existent files', async () => {
        const adapter = new FileMemoryAdapter(testDir);
        const exists = await adapter.exists(MemoryFile.SystemPatterns);

        expect(exists).toBe(false);
      });

      it('returns true for existing files', async () => {
        const adapter = new FileMemoryAdapter(testDir);

        await adapter.write(MemoryFile.TechContext, 'Test');
        const exists = await adapter.exists(MemoryFile.TechContext);

        expect(exists).toBe(true);
      });
    });

    describe('query operations', () => {
      it('finds files with matching keywords', async () => {
        const adapter = new FileMemoryAdapter(testDir);

        await adapter.write(
          MemoryFile.SystemPatterns,
          'Hot/cold state pattern used for coordination'
        );
        await adapter.write(MemoryFile.TechContext, 'TypeScript and Redis');

        const results = await adapter.query('state pattern');

        expect(results).toHaveLength(1);
        expect(results[0].file).toBe(MemoryFile.SystemPatterns);
        expect(results[0].content).toContain('Hot/cold state pattern');
      });

      it('returns empty array when no matches', async () => {
        const adapter = new FileMemoryAdapter(testDir);

        await adapter.write(MemoryFile.Progress, 'PR-001 completed');

        const results = await adapter.query('nonexistent keyword');

        expect(results).toHaveLength(0);
      });

      it('filters by specific files', async () => {
        const adapter = new FileMemoryAdapter(testDir);

        await adapter.write(MemoryFile.SystemPatterns, 'State pattern');
        await adapter.write(MemoryFile.TechContext, 'State management');

        const results = await adapter.query('state', {
          fileFilter: [MemoryFile.SystemPatterns],
        });

        expect(results).toHaveLength(1);
        expect(results[0].file).toBe(MemoryFile.SystemPatterns);
      });

      it('limits results with k option', async () => {
        const adapter = new FileMemoryAdapter(testDir);

        await adapter.write(MemoryFile.SystemPatterns, 'test content');
        await adapter.write(MemoryFile.TechContext, 'test content');
        await adapter.write(MemoryFile.ActiveContext, 'test content');

        const results = await adapter.query('test', { k: 2 });

        expect(results.length).toBeLessThanOrEqual(2);
      });

      it('includes excerpt with context', async () => {
        const adapter = new FileMemoryAdapter(testDir);

        await adapter.write(
          MemoryFile.SystemPatterns,
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Hot/cold state pattern is used. More text here.'
        );

        const results = await adapter.query('state pattern');

        expect(results[0].excerpt).toBeDefined();
        expect(results[0].excerpt).toContain('state pattern');
      });
    });

    describe('default content templates', () => {
      it('provides unique templates for each file', async () => {
        const adapter = new FileMemoryAdapter(testDir);

        const systemPatterns = await adapter.read(MemoryFile.SystemPatterns);
        const techContext = await adapter.read(MemoryFile.TechContext);
        const activeContext = await adapter.read(MemoryFile.ActiveContext);
        const progress = await adapter.read(MemoryFile.Progress);

        expect(systemPatterns).toContain('System Patterns');
        expect(techContext).toContain('Tech Context');
        expect(activeContext).toContain('Active Context');
        expect(progress).toContain('Progress');

        // Ensure they're different
        expect(systemPatterns).not.toBe(techContext);
        expect(techContext).not.toBe(activeContext);
        expect(activeContext).not.toBe(progress);
      });
    });
  });

  describe('MemoryBank Service', () => {
    let mockRedis: any;

    beforeEach(() => {
      // Create mock Redis client with proper spies
      const cache = new Map<string, string>();

      mockRedis = {
        cache,

        get: jest.fn(async (key: string): Promise<string | null> => {
          return cache.get(key) || null;
        }),

        setex: jest.fn(async (key: string, ttl: number, value: string): Promise<void> => {
          cache.set(key, value);
        }),

        del: jest.fn(async (keys: string | string[]): Promise<void> => {
          const keyArray = Array.isArray(keys) ? keys : [keys];
          keyArray.forEach((key) => cache.delete(key));
        }),
      };
    });

    describe('read with caching', () => {
      it('caches reads in Redis', async () => {
        const adapter = new FileMemoryAdapter(testDir);
        const memoryBank = new MemoryBank(adapter, mockRedis);

        await adapter.write(MemoryFile.SystemPatterns, 'Test content');
        await memoryBank.read(MemoryFile.SystemPatterns);

        expect(mockRedis.get).toHaveBeenCalledWith('memory:systemPatterns');
        expect(mockRedis.setex).toHaveBeenCalledWith(
          'memory:systemPatterns',
          3600,
          'Test content'
        );
      });

      it('returns cached value on second read', async () => {
        const adapter = new FileMemoryAdapter(testDir);
        const memoryBank = new MemoryBank(adapter, mockRedis);

        await adapter.write(MemoryFile.Progress, 'Original');

        // First read - cache miss
        const first = await memoryBank.read(MemoryFile.Progress);
        expect(first).toBe('Original');

        // Update file directly (bypass MemoryBank)
        await adapter.write(MemoryFile.Progress, 'Updated');

        // Second read - cache hit (should return cached "Original")
        const second = await memoryBank.read(MemoryFile.Progress);
        expect(second).toBe('Original');
      });
    });

    describe('write with cache invalidation', () => {
      it('invalidates cache on write', async () => {
        const adapter = new FileMemoryAdapter(testDir);
        const memoryBank = new MemoryBank(adapter, mockRedis);

        await memoryBank.write(MemoryFile.TechContext, 'Updated content');

        expect(mockRedis.del).toHaveBeenCalledWith('memory:techContext');
      });

      it('updates cache after write', async () => {
        const adapter = new FileMemoryAdapter(testDir);
        const memoryBank = new MemoryBank(adapter, mockRedis);

        await memoryBank.write(MemoryFile.ActiveContext, 'New content');

        expect(mockRedis.setex).toHaveBeenCalledWith(
          'memory:activeContext',
          3600,
          'New content'
        );
      });
    });

    describe('batch operations', () => {
      it('writeAll invalidates all caches', async () => {
        const adapter = new FileMemoryAdapter(testDir);
        const memoryBank = new MemoryBank(adapter, mockRedis);

        const snapshot: MemoryBankSnapshot = {
          systemPatterns: 'Patterns',
          techContext: 'Tech',
          activeContext: 'Active',
          progress: 'Progress',
          lastUpdated: new Date(),
        };

        await memoryBank.writeAll(snapshot);

        expect(mockRedis.del).toHaveBeenCalled();
        expect(mockRedis.setex).toHaveBeenCalledTimes(4);
      });

      it('readAll delegates to adapter', async () => {
        const adapter = new FileMemoryAdapter(testDir);
        const memoryBank = new MemoryBank(adapter, mockRedis);

        await adapter.write(MemoryFile.SystemPatterns, 'Test patterns');

        const snapshot = await memoryBank.readAll();

        expect(snapshot.systemPatterns).toContain('Test patterns');
      });
    });

    describe('update trigger logic', () => {
      it('returns true when pattern discovered', () => {
        const adapter = new FileMemoryAdapter(testDir);
        const memoryBank = new MemoryBank(adapter, mockRedis);

        const context: UpdateContext = {
          discoveredNewPattern: true,
          implementedMajorChange: false,
          needsClarification: false,
          prComplete: false,
          userRequested: false,
        };

        expect(memoryBank.shouldUpdate(context)).toBe(true);
      });

      it('returns true when major change implemented', () => {
        const adapter = new FileMemoryAdapter(testDir);
        const memoryBank = new MemoryBank(adapter, mockRedis);

        const context: UpdateContext = {
          discoveredNewPattern: false,
          implementedMajorChange: true,
          needsClarification: false,
          prComplete: false,
          userRequested: false,
        };

        expect(memoryBank.shouldUpdate(context)).toBe(true);
      });

      it('returns false when no triggers', () => {
        const adapter = new FileMemoryAdapter(testDir);
        const memoryBank = new MemoryBank(adapter, mockRedis);

        const context: UpdateContext = {
          discoveredNewPattern: false,
          implementedMajorChange: false,
          needsClarification: false,
          prComplete: false,
          userRequested: false,
        };

        expect(memoryBank.shouldUpdate(context)).toBe(false);
      });

      it('recommends correct files for pattern discovery', () => {
        const adapter = new FileMemoryAdapter(testDir);
        const memoryBank = new MemoryBank(adapter, mockRedis);

        const context: UpdateContext = {
          discoveredNewPattern: true,
          implementedMajorChange: false,
          needsClarification: false,
          prComplete: false,
          userRequested: false,
        };

        const files = memoryBank.getRecommendedUpdates(context);

        expect(files).toContain(MemoryFile.SystemPatterns);
      });

      it('recommends correct files for PR completion', () => {
        const adapter = new FileMemoryAdapter(testDir);
        const memoryBank = new MemoryBank(adapter, mockRedis);

        const context: UpdateContext = {
          discoveredNewPattern: false,
          implementedMajorChange: false,
          needsClarification: false,
          prComplete: true,
          userRequested: false,
        };

        const files = memoryBank.getRecommendedUpdates(context);

        expect(files).toContain(MemoryFile.Progress);
        expect(files).toContain(MemoryFile.ActiveContext);
      });

      it('removes duplicate file recommendations', () => {
        const adapter = new FileMemoryAdapter(testDir);
        const memoryBank = new MemoryBank(adapter, mockRedis);

        const context: UpdateContext = {
          discoveredNewPattern: false,
          implementedMajorChange: true,
          needsClarification: true,
          prComplete: true,
          userRequested: false,
        };

        const files = memoryBank.getRecommendedUpdates(context);

        // ActiveContext recommended by both major change and clarification
        const activeCount = files.filter(
          (f) => f === MemoryFile.ActiveContext
        ).length;
        expect(activeCount).toBe(1);
      });
    });

    describe('query operations', () => {
      it('delegates queries to adapter', async () => {
        const adapter = new FileMemoryAdapter(testDir);
        const memoryBank = new MemoryBank(adapter, mockRedis);

        await adapter.write(MemoryFile.SystemPatterns, 'Test pattern');

        const results = await memoryBank.query('pattern');

        expect(results).toHaveLength(1);
        expect(results[0].file).toBe(MemoryFile.SystemPatterns);
      });
    });
  });

  describe('Adapter Pattern', () => {
    it('allows swapping implementations', async () => {
      // FileMemoryAdapter
      const fileAdapter = new FileMemoryAdapter(testDir);
      const memoryBank1 = new MemoryBank(fileAdapter, mockRedis());

      // Both use same API
      await memoryBank1.write(MemoryFile.Progress, 'Test');
      const content1 = await memoryBank1.read(MemoryFile.Progress);
      expect(content1).toBe('Test');

      // Future: VectorMemoryAdapter would work the same way
      // const vectorAdapter = new VectorMemoryAdapter(config);
      // const memoryBank2 = new MemoryBank(vectorAdapter, mockRedis());
      // await memoryBank2.write(MemoryFile.Progress, 'Test');
      // const content2 = await memoryBank2.read(MemoryFile.Progress);
    });
  });

  // Helper to create mock Redis for adapter pattern test
  function mockRedis(): any {
    return {
      cache: new Map<string, string>(),
      async get(key: string): Promise<string | null> {
        return this.cache.get(key) || null;
      },
      async setex(key: string, ttl: number, value: string): Promise<void> {
        this.cache.set(key, value);
      },
      async del(keys: string | string[]): Promise<void> {
        const keyArray = Array.isArray(keys) ? keys : [keys];
        keyArray.forEach((key: string) => this.cache.delete(key));
      },
    };
  }
});
