/**
 * Hub Daemon Process Tests
 *
 * Comprehensive test suite for the Hub orchestrator.
 */

import { Hub, HubConfig } from '../src/hub';
import { DaemonManager } from '../src/hub/daemon';
import { StartupSequence } from '../src/hub/startup';
import { ShutdownHandler } from '../src/hub/shutdown';
import { AgentRegistry, AgentInfo, AgentType } from '../src/hub/agentRegistry';
import { RedisClient, RedisConnectionState } from '../src/redis/client';
import { CoordinationMode } from '../src/core/coordinationMode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as docker from '../src/utils/docker';

// Mock Redis client
class MockRedisClient {
  private data: Map<string, any> = new Map();
  private connected = false;

  async connect() {
    this.connected = true;
  }

  async disconnect() {
    this.connected = false;
  }

  getState() {
    return this.connected ? RedisConnectionState.CONNECTED : RedisConnectionState.DISCONNECTED;
  }

  async execute<T>(command: (client: any) => Promise<T>): Promise<T> {
    return command(this);
  }

  async set(key: string, value: string) {
    this.data.set(key, value);
  }

  async hSet(key: string, field: any, value?: any) {
    if (!this.data.has(key)) {
      this.data.set(key, {});
    }
    if (typeof field === 'object') {
      Object.assign(this.data.get(key), field);
    } else {
      this.data.get(key)[field] = value;
    }
  }

  async hGetAll(key: string) {
    return this.data.get(key) || {};
  }

  async hGet(key: string, field: string) {
    const hash = this.data.get(key);
    return hash ? hash[field] : null;
  }

  async hDel(key: string, fields: string | string[]) {
    const hash = this.data.get(key);
    if (hash) {
      const fieldsArray = Array.isArray(fields) ? fields : [fields];
      for (const field of fieldsArray) {
        delete hash[field];
      }
    }
  }

  async keys(pattern: string) {
    const regex = new RegExp(pattern.replace('*', '.*'));
    return Array.from(this.data.keys()).filter(key => regex.test(key));
  }

  async del(keys: string | string[]) {
    const keysArray = Array.isArray(keys) ? keys : [keys];
    for (const key of keysArray) {
      this.data.delete(key);
    }
  }

  async exists(key: string) {
    return this.data.has(key) ? 1 : 0;
  }

  async sRem(key: string, member: string) {
    // Mock implementation
  }

  async ping() {
    return 'PONG';
  }

  async publish(channel: string, message: string) {
    return 1;
  }

  subscribe(channel: string, callback: (message: string) => void) {
    // Mock implementation
  }
}

describe('Hub', () => {
  let testDir: string;
  let hub: Hub;
  let mockRedis: MockRedisClient;

  beforeEach(async () => {
    // Create test directory
    testDir = path.join(__dirname, '.test-hub');
    await fs.mkdir(testDir, { recursive: true });

    // Set environment for testing
    process.env.NODE_ENV = 'test';
    process.env.LEMEGETON_NO_DAEMON = 'true';

    // Create mock Redis
    mockRedis = new MockRedisClient();

    // Mock the Redis singleton
    jest.spyOn(RedisClient.prototype, 'connect').mockResolvedValue(undefined);
    jest.spyOn(RedisClient.prototype, 'disconnect').mockResolvedValue(undefined);
    jest.spyOn(RedisClient.prototype, 'getState').mockReturnValue(RedisConnectionState.CONNECTED);
    jest.spyOn(RedisClient.prototype, 'execute').mockImplementation(
      (command: any) => mockRedis.execute(command)
    );
  });

  afterEach(async () => {
    // Stop hub if running
    if (hub && hub.isHubRunning()) {
      await hub.stop();
    }

    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }

    // Clear mocks
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should start successfully with default config', async () => {
      hub = new Hub();
      await hub.start();

      expect(hub.isHubRunning()).toBe(true);
      expect(hub.isAcceptingWork()).toBe(true);
    });

    it('should reject duplicate starts', async () => {
      hub = new Hub();
      await hub.start();

      await expect(hub.start()).rejects.toThrow('Hub already running');
    });

    it('should initialize all components', async () => {
      hub = new Hub();
      await hub.start();

      expect(hub.getRedisClient()).toBeDefined();
      expect(hub.getCoordinationMode()).toBeDefined();
    });

    it('should handle startup errors gracefully', async () => {
      // Force an error during startup - mock the getState first to trigger connection
      jest.spyOn(RedisClient.prototype, 'getState').mockReturnValueOnce(
        RedisConnectionState.DISCONNECTED
      );
      jest.spyOn(RedisClient.prototype, 'connect').mockRejectedValueOnce(
        new Error('Connection failed')
      );

      hub = new Hub();
      await expect(hub.start()).rejects.toThrow('Connection failed');
      expect(hub.isHubRunning()).toBe(false);
    });
  });

  describe('daemon management', () => {
    let daemon: DaemonManager;

    beforeEach(() => {
      daemon = new DaemonManager({
        pidFile: path.join(testDir, 'hub.pid'),
        logFile: path.join(testDir, 'hub.log'),
        workDir: testDir,
      });
    });

    it('should check if daemon is running', async () => {
      const status = await daemon.status();
      expect(status.running).toBe(false);
    });

    it('should write PID file on start', async () => {
      hub = new Hub({
        daemon: {
          pidFile: path.join(testDir, 'hub.pid'),
          workDir: testDir,
        },
      });

      await daemon.start(hub);

      const pidFile = daemon.getPidFilePath();
      const exists = await fs.stat(pidFile).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      if (exists) {
        const pid = await fs.readFile(pidFile, 'utf-8');
        expect(parseInt(pid, 10)).toBe(process.pid);
      }
    });

    it('should prevent multiple instances', async () => {
      hub = new Hub({
        daemon: {
          pidFile: path.join(testDir, 'hub.pid'),
          workDir: testDir,
        },
      });

      await daemon.start(hub);

      const daemon2 = new DaemonManager({
        pidFile: path.join(testDir, 'hub.pid'),
        workDir: testDir,
      });

      await expect(daemon2.start(hub)).rejects.toThrow('Hub daemon already running');
    });

    it('should clean up PID file on stop', async () => {
      hub = new Hub({
        daemon: {
          pidFile: path.join(testDir, 'hub.pid'),
          workDir: testDir,
        },
      });

      await daemon.start(hub);
      await daemon.cleanup();

      const pidFile = daemon.getPidFilePath();
      const exists = await fs.stat(pidFile).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });
  });

  describe('startup sequence', () => {
    let startup: StartupSequence;

    beforeEach(async () => {
      startup = new StartupSequence(mockRedis as any, testDir);

      // Create a test task-list.md
      const taskListContent = `# Task List

### PR-001: Test PR

---
pr_id: PR-001
title: Test PR
cold_state: new
priority: high
complexity:
  score: 5
  estimated_minutes: 50
  suggested_model: sonnet
  rationale: Test complexity
dependencies: []
estimated_files:
  - path: src/test.ts
    action: create
    description: test file
---

### PR-002: Another Test

---
pr_id: PR-002
title: Another Test PR
cold_state: in_progress
priority: medium
complexity:
  score: 3
  estimated_minutes: 30
  suggested_model: haiku
dependencies: [PR-001]
---`;

      await fs.mkdir(path.join(testDir, 'docs'), { recursive: true });
      await fs.writeFile(
        path.join(testDir, 'docs', 'task-list.md'),
        taskListContent,
        'utf-8'
      );
    });

    it('should parse task-list.md correctly', async () => {
      await startup.hydrateFromGit();

      const taskList = startup.getTaskList();
      expect(taskList).toBeDefined();
      expect(taskList?.prs).toHaveLength(2);

      const pr1 = startup.getPR('PR-001');
      expect(pr1?.title).toBe('Test PR');
      expect(pr1?.cold_state).toBe('new');
      expect(pr1?.complexity.score).toBe(5);

      const pr2 = startup.getPR('PR-002');
      expect(pr2?.dependencies).toContain('PR-001');
    });

    it('should populate Redis with cold state', async () => {
      await startup.hydrateFromGit();

      // Check Redis was populated
      const pr1Data = await mockRedis.hGetAll('pr:PR-001');
      expect(pr1Data.id).toBe('PR-001');
      expect(pr1Data.cold_state).toBe('new');
      expect(pr1Data.complexity_score).toBe('5');
    });

    it('should handle missing task-list.md', async () => {
      await fs.rm(path.join(testDir, 'docs', 'task-list.md'));

      await startup.hydrateFromGit();
      const taskList = startup.getTaskList();
      expect(taskList?.prs).toHaveLength(0);
    });

    it('should clean orphaned leases', async () => {
      // Create orphaned lease
      await mockRedis.hSet('lease:test-file', {
        agent_id: 'orphan-agent',
        file: 'test.ts',
      });

      await startup.hydrateFromGit();

      // Lease should be removed since agent doesn't exist
      const lease = await mockRedis.hGetAll('lease:test-file');
      expect(Object.keys(lease).length).toBe(0);
    });
  });

  describe('agent registry', () => {
    let registry: AgentRegistry;

    beforeEach(async () => {
      registry = new AgentRegistry({
        interval: 1000,  // 1 second for testing
        timeout: 3000,   // 3 seconds for testing
      });
      await registry.initialize(mockRedis as any);
    });

    it('should register agents', async () => {
      const agent: AgentInfo = {
        id: 'agent-1',
        type: 'worker',
        status: 'idle',
        lastHeartbeat: Date.now(),
        assignedPR: null,
        pid: process.pid,
        startedAt: Date.now(),
      };

      await registry.registerAgent(agent);

      const retrieved = await registry.getAgent('agent-1');
      expect(retrieved?.id).toBe('agent-1');
      expect(retrieved?.type).toBe('worker');
    });

    it('should handle heartbeats', async () => {
      const agent: AgentInfo = {
        id: 'agent-2',
        type: 'worker',
        status: 'active',
        lastHeartbeat: Date.now() - 5000,
        assignedPR: null,
        pid: process.pid,
        startedAt: Date.now(),
      };

      await registry.registerAgent(agent);
      const oldHeartbeat = agent.lastHeartbeat;

      await new Promise(resolve => setTimeout(resolve, 100));
      await registry.handleHeartbeat('agent-2');

      const updated = await registry.getAgent('agent-2');
      expect(updated?.lastHeartbeat).toBeGreaterThan(oldHeartbeat);
    });

    it('should detect crashed agents', async () => {
      const agent: AgentInfo = {
        id: 'agent-3',
        type: 'worker',
        status: 'active',
        lastHeartbeat: Date.now() - 5000,  // 5 seconds ago
        assignedPR: 'PR-001',
        pid: 99999,
        startedAt: Date.now() - 10000,
      };

      await registry.registerAgent(agent);

      // Simulate timeout
      agent.lastHeartbeat = Date.now() - 4000;  // Beyond timeout

      const crashed = await registry.checkForCrashedAgents();
      expect(crashed).toContain('agent-3');

      const crashedAgent = await registry.getAgent('agent-3');
      expect(crashedAgent?.status).toBe('crashed');
    });

    it('should track agent assignments', async () => {
      const agent: AgentInfo = {
        id: 'agent-4',
        type: 'worker',
        status: 'idle',
        lastHeartbeat: Date.now(),
        assignedPR: null,
        pid: process.pid,
        startedAt: Date.now(),
      };

      await registry.registerAgent(agent);
      await registry.assignPR('agent-4', 'PR-002');

      const assigned = await registry.getAgent('agent-4');
      expect(assigned?.assignedPR).toBe('PR-002');
      expect(assigned?.status).toBe('working');

      await registry.unassignPR('agent-4');
      const unassigned = await registry.getAgent('agent-4');
      expect(unassigned?.assignedPR).toBeNull();
      expect(unassigned?.status).toBe('idle');
    });

    it('should provide agent statistics', async () => {
      await registry.registerAgent({
        id: 'agent-5',
        type: 'worker',
        status: 'idle',
        lastHeartbeat: Date.now(),
        assignedPR: null,
        pid: 1,
        startedAt: Date.now(),
      });

      await registry.registerAgent({
        id: 'agent-6',
        type: 'qc',
        status: 'working',
        lastHeartbeat: Date.now(),
        assignedPR: 'PR-003',
        pid: 2,
        startedAt: Date.now(),
      });

      const stats = registry.getStatistics();
      expect(stats.total).toBe(2);
      expect(stats.idle).toBe(1);
      expect(stats.working).toBe(1);
      expect(stats.type_worker).toBe(1);
      expect(stats.type_qc).toBe(1);
    });
  });

  describe('shutdown', () => {
    let shutdown: ShutdownHandler;

    beforeEach(() => {
      shutdown = new ShutdownHandler({
        timeout: 2000,  // 2 seconds for testing
        graceful: true,
      });
    });

    it('should stop accepting work on shutdown', async () => {
      hub = new Hub();
      await hub.start();

      expect(hub.isAcceptingWork()).toBe(true);

      hub.stopAcceptingWork();
      expect(hub.isAcceptingWork()).toBe(false);
    });

    it('should perform graceful shutdown', async () => {
      hub = new Hub({
        shutdown: {
          timeout: 2000,
          graceful: true,
        },
      });
      await hub.start();

      // Register an agent
      await hub.registerAgent({
        id: 'test-agent',
        type: 'worker',
        status: 'idle',
        lastHeartbeat: Date.now(),
        assignedPR: null,
        pid: process.pid,
        startedAt: Date.now(),
      });

      await hub.stop();

      expect(hub.isHubRunning()).toBe(false);
      expect(hub.isAcceptingWork()).toBe(false);
    });

    it('should handle shutdown timeout', async () => {
      hub = new Hub({
        shutdown: {
          timeout: 100,  // Very short timeout
          graceful: true,
        },
      });
      await hub.start();

      // Register a "stuck" agent
      await hub.registerAgent({
        id: 'stuck-agent',
        type: 'worker',
        status: 'working',
        lastHeartbeat: Date.now(),
        assignedPR: 'PR-999',
        pid: process.pid,
        startedAt: Date.now(),
      });

      // Shutdown should complete despite stuck agent
      await hub.stop();
      expect(hub.isHubRunning()).toBe(false);
    });

    it('should handle multiple stop calls', async () => {
      hub = new Hub();
      await hub.start();

      // Call stop() twice immediately (before the first completes)
      const promise1 = hub.stop();
      const promise2 = hub.stop();

      // Both should resolve to the same promise reference
      expect(promise1).toBe(promise2);

      // Wait for the promises to complete
      await Promise.all([promise1, promise2]);

      // Hub should be stopped
      expect(hub.isHubRunning()).toBe(false);

      // Even after completion, calling stop() again should return the same promise
      const promise3 = hub.stop();
      expect(promise3).toBe(promise1);

      await promise3;
    });
  });

  describe('integration with components', () => {
    it('should integrate with coordination mode manager', async () => {
      hub = new Hub();
      await hub.start();

      const mode = hub.getCoordinationMode();
      expect(mode).toBeDefined();
      // Mode will be ISOLATED in test environment without real Redis
    });

    it('should handle agent crashes and reclaim work', async () => {
      hub = new Hub();
      await hub.start();

      // Register agent with work
      await hub.registerAgent({
        id: 'crash-test',
        type: 'worker',
        status: 'working',
        lastHeartbeat: Date.now() - 100000,  // Way past timeout
        assignedPR: 'PR-CRASH',
        pid: 99999,
        startedAt: Date.now() - 200000,
      });

      // Trigger heartbeat check
      const registry = hub['agentRegistry'];
      const crashed = await registry.checkForCrashedAgents();

      expect(crashed).toContain('crash-test');
    });
  });
});