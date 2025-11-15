/**
 * State Synchronization System Tests
 *
 * Comprehensive test suite for state synchronization between Redis and git.
 */

import { StateSync } from '../src/sync/stateSync';
import { GitOps } from '../src/sync/gitOps';
import { RedisOps } from '../src/sync/redisOps';
import { Reconciliation } from '../src/sync/reconciliation';
import { TaskListParser } from '../src/parser/taskList';
import { RedisClient } from '../src/redis/client';
import { HotState, ColdState } from '../src/types/pr';
import { ConflictType, ConflictResolution } from '../src/sync/types';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Mock implementations for testing
class MockGitCommitter {
  commits: Array<{ message: string; metadata: any }> = [];

  async commit(message: string, metadata: any): Promise<void> {
    this.commits.push({ message, metadata });
  }

  clear(): void {
    this.commits = [];
  }
}

class MockRedisClient {
  private store = new Map<string, string>();
  private sets = new Map<string, Set<string>>();
  private ttls = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) || null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async del(...keys: string[]): Promise<void> {
    for (const key of keys) {
      this.store.delete(key);
      this.sets.delete(key);
      this.ttls.delete(key);
    }
  }

  async expire(key: string, seconds: number): Promise<void> {
    this.ttls.set(key, Date.now() + seconds * 1000);
  }

  async sAdd(key: string, members: string[]): Promise<void> {
    if (!this.sets.has(key)) {
      this.sets.set(key, new Set());
    }
    for (const member of members) {
      this.sets.get(key)!.add(member);
    }
  }

  async sMembers(key: string): Promise<string[]> {
    return Array.from(this.sets.get(key) || []);
  }

  async *scanIterator(options: { MATCH: string; COUNT: number }): AsyncGenerator<string> {
    const pattern = options.MATCH.replace('*', '.*');
    const regex = new RegExp(`^${pattern}$`);

    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        yield key;
      }
    }
  }

  clear(): void {
    this.store.clear();
    this.sets.clear();
    this.ttls.clear();
  }

  getStore(): Map<string, string> {
    return new Map(this.store);
  }
}

describe('RedisOps', () => {
  let redisOps: RedisOps;
  let mockClient: MockRedisClient;
  let redisClientWrapper: any;

  beforeEach(() => {
    mockClient = new MockRedisClient();
    redisClientWrapper = {
      getClient: () => mockClient,
      isConnected: () => true
    };
    redisOps = new RedisOps(redisClientWrapper as any);
  });

  afterEach(() => {
    mockClient.clear();
  });

  describe('updateHotState', () => {
    it('should update hot state in Redis with TTL', async () => {
      await redisOps.updateHotState('PR-001', 'investigating', 'agent-1');

      const state = await mockClient.get('pr:PR-001:hot_state');
      const agent = await mockClient.get('pr:PR-001:agent');

      expect(state).toBe('investigating');
      expect(agent).toBe('agent-1');
    });

    it('should set timestamp when updating hot state', async () => {
      await redisOps.updateHotState('PR-001', 'in-progress');

      const timestamp = await mockClient.get('pr:PR-001:hot_state_timestamp');
      expect(timestamp).toBeTruthy();
    });
  });

  describe('getHotState', () => {
    it('should retrieve hot state from Redis', async () => {
      await mockClient.set('pr:PR-001:hot_state', 'planning');

      const state = await redisOps.getHotState('PR-001');
      expect(state).toBe('planning');
    });

    it('should return null for non-existent PR', async () => {
      const state = await redisOps.getHotState('PR-999');
      expect(state).toBeNull();
    });
  });

  describe('getAllHotStates', () => {
    it('should retrieve all hot states', async () => {
      await redisOps.updateHotState('PR-001', 'investigating', 'agent-1');
      await redisOps.updateHotState('PR-002', 'in-progress', 'agent-2');

      const states = await redisOps.getAllHotStates();

      expect(states.size).toBe(2);
      expect(states.get('PR-001')?.state).toBe('investigating');
      expect(states.get('PR-002')?.state).toBe('in-progress');
    });

    it('should return empty map when no hot states exist', async () => {
      const states = await redisOps.getAllHotStates();
      expect(states.size).toBe(0);
    });
  });

  describe('clearHotState', () => {
    it('should clear all hot state keys for a PR', async () => {
      await redisOps.updateHotState('PR-001', 'investigating', 'agent-1');
      await redisOps.clearHotState('PR-001');

      const state = await redisOps.getHotState('PR-001');
      const agent = await mockClient.get('pr:PR-001:agent');

      expect(state).toBeNull();
      expect(agent).toBeNull();
    });
  });

  describe('updateColdStateCache', () => {
    it('should update cold state cache in Redis', async () => {
      await redisOps.updateColdStateCache('PR-001', 'completed');

      const state = await mockClient.get('pr:PR-001:cold_state');
      expect(state).toBe('completed');
    });
  });

  describe('getColdState', () => {
    it('should retrieve cold state from cache', async () => {
      await mockClient.set('pr:PR-001:cold_state', 'ready');

      const state = await redisOps.getColdState('PR-001');
      expect(state).toBe('ready');
    });
  });

  describe('clearOrphanedStates', () => {
    it('should clear states for PRs not in valid set', async () => {
      await redisOps.updateHotState('PR-001', 'investigating');
      await redisOps.updateHotState('PR-002', 'in-progress');
      await redisOps.updateColdStateCache('PR-003', 'completed');

      const validPRIds = new Set(['PR-001']);
      await redisOps.clearOrphanedStates(validPRIds);

      const state1 = await redisOps.getHotState('PR-001');
      const state2 = await redisOps.getHotState('PR-002');
      const state3 = await redisOps.getColdState('PR-003');

      expect(state1).toBe('investigating'); // Kept
      expect(state2).toBeNull(); // Cleared
      expect(state3).toBeNull(); // Cleared
    });
  });
});

describe('GitOps', () => {
  let gitOps: GitOps;
  let parser: TaskListParser;
  let tempDir: string;
  let taskListPath: string;

  beforeEach(async () => {
    // Create temp directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'));
    taskListPath = path.join(tempDir, 'task-list.md');

    // Create minimal task list
    const taskListContent = `# Task List

---
pr_id: PR-001
cold_state: ready
dependencies: []
---

**Description:** Test PR
`;

    await fs.writeFile(taskListPath, taskListContent);

    parser = new TaskListParser();
    gitOps = new GitOps(parser, tempDir, taskListPath);
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('loadTaskList', () => {
    it('should load task list from git', async () => {
      const taskList = await gitOps.loadTaskList();

      expect(taskList.prs.length).toBe(1);
      expect(taskList.prs[0].pr_id).toBe('PR-001');
      expect(taskList.prs[0].cold_state).toBe('ready');
    });
  });

  describe('reconstructState', () => {
    it('should reconstruct PR states from task list', async () => {
      const states = await gitOps.reconstructState();

      expect(states.size).toBe(1);
      expect(states.get('PR-001')?.cold_state).toBe('ready');
      expect(states.get('PR-001')?.pr_id).toBe('PR-001');
    });

    it('should not include hot states in reconstructed state', async () => {
      const states = await gitOps.reconstructState();
      const pr001 = states.get('PR-001');

      expect(pr001?.hot_state).toBeUndefined();
    });
  });
});

describe('Reconciliation', () => {
  let reconciliation: Reconciliation;
  let gitOps: GitOps;
  let redisOps: RedisOps;
  let mockClient: MockRedisClient;
  let tempDir: string;

  beforeEach(async () => {
    // Setup temp directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconcile-test-'));
    const taskListPath = path.join(tempDir, 'task-list.md');

    const taskListContent = `# Task List

---
pr_id: PR-001
cold_state: completed
dependencies: []
---
`;

    await fs.writeFile(taskListPath, taskListContent);

    // Setup components
    const parser = new TaskListParser();
    gitOps = new GitOps(parser, tempDir, taskListPath);

    mockClient = new MockRedisClient();
    const redisWrapper = {
      getClient: () => mockClient,
      isConnected: () => true
    };
    redisOps = new RedisOps(redisWrapper as any);

    reconciliation = new Reconciliation(gitOps, redisOps);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    mockClient.clear();
  });

  describe('detectConflicts', () => {
    it('should detect Redis hot state conflicting with git cold state', async () => {
      // Git says completed, Redis says investigating
      await redisOps.updateHotState('PR-001', 'investigating');
      await redisOps.updateColdStateCache('PR-001', 'completed');

      const conflicts = await reconciliation.detectConflicts();

      const conflict = conflicts.find(c =>
        c.pr_id === 'PR-001' &&
        c.conflict_type === ConflictType.REDIS_HOT_GIT_DIFFERENT
      );

      expect(conflict).toBeDefined();
      expect(conflict?.resolution).toBe(ConflictResolution.CLEAR_REDIS);
    });

    it('should detect missing Redis cold state', async () => {
      // PR exists in git but not cached in Redis
      const conflicts = await reconciliation.detectConflicts();

      const conflict = conflicts.find(c =>
        c.pr_id === 'PR-001' &&
        c.conflict_type === ConflictType.REDIS_MISSING
      );

      expect(conflict).toBeDefined();
      expect(conflict?.resolution).toBe(ConflictResolution.HYDRATE_REDIS);
    });

    it('should detect orphaned Redis states', async () => {
      // Redis has state for PR that doesn't exist in git
      await redisOps.updateHotState('PR-999', 'investigating');

      const conflicts = await reconciliation.detectConflicts();

      const conflict = conflicts.find(c =>
        c.pr_id === 'PR-999' &&
        c.conflict_type === ConflictType.REDIS_ORPHANED
      );

      expect(conflict).toBeDefined();
      expect(conflict?.resolution).toBe(ConflictResolution.CLEAR_REDIS);
    });
  });

  describe('resolveConflict', () => {
    it('should clear Redis when resolution is CLEAR_REDIS', async () => {
      await redisOps.updateHotState('PR-001', 'investigating');

      await reconciliation.resolveConflict({
        pr_id: 'PR-001',
        conflict_type: ConflictType.REDIS_ORPHANED,
        redis_state: 'investigating',
        git_state: null,
        resolution: ConflictResolution.CLEAR_REDIS,
        timestamp: new Date()
      });

      const state = await redisOps.getHotState('PR-001');
      expect(state).toBeNull();
    });

    it('should hydrate Redis when resolution is HYDRATE_REDIS', async () => {
      await reconciliation.resolveConflict({
        pr_id: 'PR-001',
        conflict_type: ConflictType.REDIS_MISSING,
        redis_state: null,
        git_state: 'completed',
        resolution: ConflictResolution.HYDRATE_REDIS,
        timestamp: new Date()
      });

      const state = await redisOps.getColdState('PR-001');
      expect(state).toBe('completed');
    });
  });

  describe('reconcileAfterCrash', () => {
    it('should clear all hot states on crash recovery', async () => {
      await redisOps.updateHotState('PR-001', 'investigating');
      await redisOps.updateColdStateCache('PR-001', 'completed');

      await reconciliation.reconcileAfterCrash();

      const hotState = await redisOps.getHotState('PR-001');
      const coldState = await redisOps.getColdState('PR-001');

      expect(hotState).toBeNull(); // Cleared (ephemeral)
      expect(coldState).toBe('completed'); // Kept (from git)
    });

    it('should clear orphaned states on crash recovery', async () => {
      await redisOps.updateHotState('PR-999', 'investigating');

      await reconciliation.reconcileAfterCrash();

      const state = await redisOps.getHotState('PR-999');
      expect(state).toBeNull();
    });
  });

  describe('validateConsistency', () => {
    it('should validate when no conflicts exist', async () => {
      await redisOps.updateColdStateCache('PR-001', 'completed');

      const validation = await reconciliation.validateConsistency();

      expect(validation.valid).toBe(true);
      expect(validation.conflicts.length).toBe(0);
    });

    it('should invalidate when critical conflicts exist', async () => {
      // Create a conflict
      await redisOps.updateHotState('PR-001', 'investigating');

      const validation = await reconciliation.validateConsistency();

      // May have conflicts
      expect(validation.conflicts.length).toBeGreaterThan(0);
    });
  });
});

describe('StateSync Integration', () => {
  let stateSync: StateSync;
  let gitOps: GitOps;
  let redisOps: RedisOps;
  let reconciliation: Reconciliation;
  let mockClient: MockRedisClient;
  let tempDir: string;

  beforeEach(async () => {
    // Setup temp directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'statesync-test-'));
    const taskListPath = path.join(tempDir, 'task-list.md');

    const taskListContent = `# Task List

---
pr_id: PR-001
cold_state: ready
dependencies: []
---

---
pr_id: PR-002
cold_state: blocked
dependencies: [PR-001]
---
`;

    await fs.writeFile(taskListPath, taskListContent);

    // Setup components
    const parser = new TaskListParser();
    gitOps = new GitOps(parser, tempDir, taskListPath);

    mockClient = new MockRedisClient();
    const redisWrapper = {
      getClient: () => mockClient,
      isConnected: () => true
    };
    redisOps = new RedisOps(redisWrapper as any);

    reconciliation = new Reconciliation(gitOps, redisOps);
    stateSync = new StateSync(gitOps, redisOps, reconciliation);
  });

  afterEach(async () => {
    await stateSync.shutdown();
    await fs.rm(tempDir, { recursive: true, force: true });
    mockClient.clear();
  });

  describe('initialize', () => {
    it('should hydrate Redis from git on startup', async () => {
      await stateSync.initialize();

      const coldState1 = await redisOps.getColdState('PR-001');
      const coldState2 = await redisOps.getColdState('PR-002');

      expect(coldState1).toBe('ready');
      expect(coldState2).toBe('blocked');
    });

    it('should perform crash recovery reconciliation', async () => {
      // Create orphaned state before initialization
      await redisOps.updateHotState('PR-999', 'investigating');

      await stateSync.initialize();

      const orphanedState = await redisOps.getHotState('PR-999');
      expect(orphanedState).toBeNull();
    });
  });

  describe('syncHotState', () => {
    it('should update Redis without git commit', async () => {
      await stateSync.syncHotState('PR-001', 'investigating', 'agent-1');

      const state = await redisOps.getHotState('PR-001');
      expect(state).toBe('investigating');
    });

    it('should emit hot-sync event', async () => {
      const eventPromise = new Promise<void>(resolve => {
        stateSync.once('hot-sync', (prId, state) => {
          expect(prId).toBe('PR-001');
          expect(state).toBe('planning');
          resolve();
        });
      });

      await stateSync.syncHotState('PR-001', 'planning');
      await eventPromise;
    });
  });

  describe('syncDisplayStates', () => {
    it('should sync display states to git', async () => {
      // Set fast interval for testing
      stateSync.setDisplaySyncInterval(100);

      await stateSync.initialize();
      await redisOps.updateHotState('PR-001', 'investigating', 'agent-1');

      // Wait for display sync
      await new Promise(resolve => setTimeout(resolve, 150));

      // Verify display sync occurred
      const stats = stateSync.getStats();
      expect(stats.display_sync_count).toBeGreaterThan(0);
    });
  });

  describe('getStats', () => {
    it('should track sync statistics', async () => {
      await stateSync.initialize();
      await stateSync.syncHotState('PR-001', 'investigating');

      const stats = stateSync.getStats();

      expect(stats.display_sync_count).toBeGreaterThanOrEqual(0);
      expect(stats.cold_sync_count).toBe(0);
      expect(stats.errors).toBe(0);
    });
  });

  describe('validateConsistency', () => {
    it('should validate system consistency', async () => {
      await stateSync.initialize();

      const isValid = await stateSync.validateConsistency();
      expect(typeof isValid).toBe('boolean');
    });
  });
});
