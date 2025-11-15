/**
 * Agent Spawning Tests
 *
 * Comprehensive tests for agent process spawning and lifecycle management.
 */

import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';
import { AgentSpawner, AgentSpawnConfig } from '../src/hub/agentSpawner';
import { ProcessManager, ProcessManagerConfig } from '../src/hub/processManager';
import { AgentRegistry, AgentType } from '../src/hub/agentRegistry';
import { RedisClient } from '../src/redis/client';

// Mock child_process
jest.mock('child_process');
import { spawn } from 'child_process';
const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('AgentSpawner', () => {
  let spawner: AgentSpawner;

  beforeEach(() => {
    jest.clearAllMocks();
    spawner = new AgentSpawner({
      redisUrl: 'redis://localhost:6379',
      workDir: '/test',
    });
  });

  afterEach(() => {
    spawner.removeAllListeners();
    spawner.resetCounters();
  });

  describe('spawnAgent', () => {
    it('should spawn agent process with correct configuration', async () => {
      // Mock child process
      const mockChild = createMockChildProcess(1234);
      mockSpawn.mockReturnValue(mockChild as any);

      const config: AgentSpawnConfig = {
        agentType: 'worker',
        redisUrl: 'redis://test:6379',
      };

      const spawned = await spawner.spawnAgent(config);

      // Verify spawn was called
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const spawnArgs = mockSpawn.mock.calls[0];

      // Check process path
      expect(spawnArgs[0]).toBe(process.execPath);

      // Check entry point
      expect(spawnArgs[1]).toContain('worker.js');

      // Check options
      const options = spawnArgs[2];
      expect(options?.cwd).toBe('/test');
      expect(options?.env?.AGENT_TYPE).toBe('worker');
      expect(options?.env?.REDIS_URL).toBe('redis://test:6379');
      expect(options?.env?.AGENT_ID).toMatch(/^worker-agent-\d+$/);

      // Verify returned data
      expect(spawned.type).toBe('worker');
      expect(spawned.pid).toBe(1234);
      expect(spawned.agentId).toMatch(/^worker-agent-\d+$/);
      expect(spawned.process).toBe(mockChild);
    });

    it('should generate unique agent IDs', async () => {
      const mockChild1 = createMockChildProcess(1001);
      const mockChild2 = createMockChildProcess(1002);
      const mockChild3 = createMockChildProcess(1003);

      mockSpawn
        .mockReturnValueOnce(mockChild1 as any)
        .mockReturnValueOnce(mockChild2 as any)
        .mockReturnValueOnce(mockChild3 as any);

      const spawned1 = await spawner.spawnAgent({ agentType: 'worker' });
      const spawned2 = await spawner.spawnAgent({ agentType: 'worker' });
      const spawned3 = await spawner.spawnAgent({ agentType: 'qc' });

      expect(spawned1.agentId).toBe('worker-agent-1');
      expect(spawned2.agentId).toBe('worker-agent-2');
      expect(spawned3.agentId).toBe('qc-agent-1');
    });

    it('should use provided agent ID if specified', async () => {
      const mockChild = createMockChildProcess(1234);
      mockSpawn.mockReturnValue(mockChild as any);

      const spawned = await spawner.spawnAgent({
        agentType: 'worker',
        agentId: 'custom-agent-1',
      });

      expect(spawned.agentId).toBe('custom-agent-1');
    });

    it('should emit spawned event', async () => {
      const mockChild = createMockChildProcess(1234);
      mockSpawn.mockReturnValue(mockChild as any);

      const spawnedListener = jest.fn();
      spawner.on('spawned', spawnedListener);

      await spawner.spawnAgent({ agentType: 'worker' });

      expect(spawnedListener).toHaveBeenCalledTimes(1);
      expect(spawnedListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'worker',
          pid: 1234,
        })
      );
    });

    it('should throw error if spawn fails', async () => {
      mockSpawn.mockReturnValue({
        pid: undefined,
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        on: jest.fn(),
      } as any);

      await expect(
        spawner.spawnAgent({ agentType: 'worker' })
      ).rejects.toThrow('Failed to spawn worker agent');
    });

    it('should support all agent types', async () => {
      const types: AgentType[] = ['worker', 'qc', 'planning', 'review'];

      for (const type of types) {
        const mockChild = createMockChildProcess(1000 + types.indexOf(type));
        mockSpawn.mockReturnValueOnce(mockChild as any);

        const spawned = await spawner.spawnAgent({ agentType: type });

        expect(spawned.type).toBe(type);
        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          expect.arrayContaining([expect.stringContaining(`${type}.js`)]),
          expect.any(Object)
        );
      }
    });

    it('should capture stdout and stderr', async () => {
      const mockChild = createMockChildProcess(1234);
      mockSpawn.mockReturnValue(mockChild as any);

      const stdoutListener = jest.fn();
      const stderrListener = jest.fn();

      spawner.on('stdout', stdoutListener);
      spawner.on('stderr', stderrListener);

      await spawner.spawnAgent({ agentType: 'worker' });

      // Emit stdout
      mockChild.stdout!.emit('data', Buffer.from('test output'));
      expect(stdoutListener).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: expect.any(String),
          data: 'test output',
        })
      );

      // Emit stderr
      mockChild.stderr!.emit('data', Buffer.from('test error'));
      expect(stderrListener).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: expect.any(String),
          data: 'test error',
        })
      );
    });

    it('should handle process errors', async () => {
      const mockChild = createMockChildProcess(1234);
      mockSpawn.mockReturnValue(mockChild as any);

      const errorListener = jest.fn();
      spawner.on('error', errorListener);

      await spawner.spawnAgent({ agentType: 'worker' });

      const error = new Error('Process error');
      mockChild.emit('error', error);

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: expect.any(String),
          error,
        })
      );
    });
  });

  describe('getAgentCounts', () => {
    it('should return agent counts by type', async () => {
      const mockChild = createMockChildProcess(1234);
      mockSpawn.mockReturnValue(mockChild as any);

      await spawner.spawnAgent({ agentType: 'worker' });
      await spawner.spawnAgent({ agentType: 'worker' });
      await spawner.spawnAgent({ agentType: 'qc' });

      const counts = spawner.getAgentCounts();

      expect(counts.worker).toBe(2);
      expect(counts.qc).toBe(1);
      expect(counts.planning).toBe(0);
      expect(counts.review).toBe(0);
    });
  });
});

describe('ProcessManager', () => {
  let spawner: AgentSpawner;
  let registry: AgentRegistry;
  let manager: ProcessManager;
  let mockRedis: jest.Mocked<RedisClient>;

  beforeEach(() => {
    jest.clearAllMocks();

    spawner = new AgentSpawner({
      redisUrl: 'redis://localhost:6379',
    });

    registry = new AgentRegistry({
      interval: 1000,
      timeout: 3000,
    });

    // Create mock Redis client
    mockRedis = createMockRedis();

    // Initialize registry with mock Redis
    registry.initialize(mockRedis);

    manager = new ProcessManager(spawner, registry, {
      maxAgents: 5,
      autoRestart: true,
      restartDelay: 100,
      shutdownTimeout: 1000,
      maxRestartAttempts: 2,
    });
  });

  afterEach(async () => {
    await manager.destroy();
    await registry.clearAll();
    spawner.removeAllListeners();
    spawner.resetCounters();
  });

  describe('spawnAgent', () => {
    it('should spawn agent and register it', async () => {
      const mockChild = createMockChildProcess(1234);
      mockSpawn.mockReturnValue(mockChild as any);

      const agentId = await manager.spawnAgent({ agentType: 'worker' });

      expect(agentId).toMatch(/^worker-agent-\d+$/);
      expect(manager.getAgentCount()).toBe(1);
      expect(manager.isAgentRunning(agentId)).toBe(true);

      // Verify registration
      const agent = await registry.getAgent(agentId);
      expect(agent).toBeDefined();
      expect(agent?.type).toBe('worker');
      expect(agent?.pid).toBe(1234);
    });

    it('should enforce max agent limit', async () => {
      const mockChild = createMockChildProcess(1234);
      mockSpawn.mockReturnValue(mockChild as any);

      // Spawn max agents
      for (let i = 0; i < 5; i++) {
        await manager.spawnAgent({ agentType: 'worker' });
      }

      // Try to spawn one more
      await expect(
        manager.spawnAgent({ agentType: 'worker' })
      ).rejects.toThrow('Maximum agent limit reached');
    });

    it('should emit agentSpawned event', async () => {
      const mockChild = createMockChildProcess(1234);
      mockSpawn.mockReturnValue(mockChild as any);

      const listener = jest.fn();
      manager.on('agentSpawned', listener);

      const agentId = await manager.spawnAgent({ agentType: 'worker' });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId,
          type: 'worker',
          pid: 1234,
        })
      );
    });
  });

  describe('terminateAgent', () => {
    it('should terminate agent gracefully', async () => {
      const mockChild = createMockChildProcess(1234);
      mockSpawn.mockReturnValue(mockChild as any);

      const agentId = await manager.spawnAgent({ agentType: 'worker' });

      await manager.terminateAgent(agentId);

      // Verify SIGTERM was sent
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should force kill if graceful shutdown fails', async () => {
      const mockChild = createMockChildProcess(1234);
      mockChild.killed = false; // Not killed after SIGTERM
      mockSpawn.mockReturnValue(mockChild as any);

      const agentId = await manager.spawnAgent({ agentType: 'worker' });

      await manager.terminateAgent(agentId);

      // Should have tried SIGTERM then SIGKILL
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('should throw error if agent not found', async () => {
      await expect(manager.terminateAgent('nonexistent')).rejects.toThrow(
        'Agent not found: nonexistent'
      );
    });
  });

  describe('process monitoring', () => {
    it('should detect process exit', async () => {
      const mockChild = createMockChildProcess(1234);
      mockSpawn.mockReturnValue(mockChild as any);

      const exitListener = jest.fn();
      manager.on('agentExit', exitListener);

      const agentId = await manager.spawnAgent({ agentType: 'worker' });

      // Simulate process exit
      mockChild.emit('exit', 0, null);

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(exitListener).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId,
          code: 0,
        })
      );

      expect(manager.isAgentRunning(agentId)).toBe(false);
    });

    it('should auto-restart crashed agents', async () => {
      const mockChild1 = createMockChildProcess(1234);
      const mockChild2 = createMockChildProcess(5678);

      mockSpawn
        .mockReturnValueOnce(mockChild1 as any)
        .mockReturnValueOnce(mockChild2 as any);

      const restartListener = jest.fn();
      manager.on('agentRestarted', restartListener);

      const agentId = await manager.spawnAgent({ agentType: 'worker' });

      // Simulate crash (non-zero exit code)
      mockChild1.emit('exit', 1, null);

      // Wait for restart
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(restartListener).toHaveBeenCalled();
      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });

    it('should not restart after clean exit', async () => {
      const mockChild = createMockChildProcess(1234);
      mockSpawn.mockReturnValue(mockChild as any);

      await manager.spawnAgent({ agentType: 'worker' });

      // Simulate clean exit
      mockChild.emit('exit', 0, null);

      // Wait to see if restart happens
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should only have spawned once
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('should limit restart attempts', async () => {
      const mockChild = createMockChildProcess(1234);
      mockSpawn.mockReturnValue(mockChild as any);

      const failListener = jest.fn();
      manager.on('restartFailed', failListener);

      const agentId = await manager.spawnAgent({ agentType: 'worker' });

      // Simulate repeated crashes
      for (let i = 0; i < 3; i++) {
        mockChild.emit('exit', 1, null);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      // Should have tried to restart maxRestartAttempts times (2)
      // Initial spawn + 2 restarts = 3 spawns
      expect(mockSpawn).toHaveBeenCalledTimes(3);
    });
  });

  describe('shutdownAll', () => {
    it('should shutdown all agents', async () => {
      const mockChild1 = createMockChildProcess(1001);
      const mockChild2 = createMockChildProcess(1002);
      const mockChild3 = createMockChildProcess(1003);

      mockSpawn
        .mockReturnValueOnce(mockChild1 as any)
        .mockReturnValueOnce(mockChild2 as any)
        .mockReturnValueOnce(mockChild3 as any);

      await manager.spawnAgent({ agentType: 'worker' });
      await manager.spawnAgent({ agentType: 'qc' });
      await manager.spawnAgent({ agentType: 'planning' });

      expect(manager.getAgentCount()).toBe(3);

      await manager.shutdownAll();

      expect(mockChild1.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockChild2.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockChild3.kill).toHaveBeenCalledWith('SIGTERM');

      expect(manager.getAgentCount()).toBe(0);
    });

    it('should emit allAgentsShutdown event', async () => {
      const mockChild = createMockChildProcess(1234);
      mockSpawn.mockReturnValue(mockChild as any);

      const listener = jest.fn();
      manager.on('allAgentsShutdown', listener);

      await manager.spawnAgent({ agentType: 'worker' });
      await manager.shutdownAll();

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('getAgentsByType', () => {
    it('should return agents filtered by type', async () => {
      const mockChild = createMockChildProcess(1234);
      mockSpawn.mockReturnValue(mockChild as any);

      await manager.spawnAgent({ agentType: 'worker' });
      await manager.spawnAgent({ agentType: 'worker' });
      await manager.spawnAgent({ agentType: 'qc' });

      const workers = manager.getAgentsByType('worker');
      const qcs = manager.getAgentsByType('qc');
      const planning = manager.getAgentsByType('planning');

      expect(workers).toHaveLength(2);
      expect(qcs).toHaveLength(1);
      expect(planning).toHaveLength(0);
    });
  });

  describe('getStatistics', () => {
    it('should return process statistics', async () => {
      const mockChild = createMockChildProcess(1234);
      mockSpawn.mockReturnValue(mockChild as any);

      await manager.spawnAgent({ agentType: 'worker' });
      await manager.spawnAgent({ agentType: 'qc' });

      const stats = manager.getStatistics();

      expect(stats.total).toBe(2);
      expect(stats.byType.worker).toBe(1);
      expect(stats.byType.qc).toBe(1);
    });
  });
});

// Helper functions

function createMockChildProcess(pid: number): any {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as any;

  const mock = {
    pid,
    stdout,
    stderr,
    kill: jest.fn(),
    killed: false,
    on: (event: string, listener: any) => {
      child.on(event, listener);
      return mock;
    },
    once: (event: string, listener: any) => {
      child.once(event, listener);
      return mock;
    },
    emit: (event: string, ...args: any[]) => {
      return child.emit(event, ...args);
    },
    removeListener: (event: string, listener: any) => {
      child.removeListener(event, listener);
      return mock;
    },
  };

  return mock;
}

function createMockRedis(): jest.Mocked<RedisClient> {
  return {
    connect: jest.fn(),
    disconnect: jest.fn(),
    execute: jest.fn().mockImplementation(async (fn) => {
      const mockClient = {
        keys: jest.fn().mockResolvedValue([]),
        hGetAll: jest.fn().mockResolvedValue({}),
        hSet: jest.fn().mockResolvedValue(0),
        hDel: jest.fn().mockResolvedValue(0),
        del: jest.fn().mockResolvedValue(0),
        set: jest.fn().mockResolvedValue('OK'),
        get: jest.fn().mockResolvedValue(null),
      };
      return fn(mockClient as any);
    }),
  } as any;
}
