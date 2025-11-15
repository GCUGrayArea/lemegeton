/**
 * CLI Tests
 *
 * Tests for CLI commands, formatters, and error handling.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  CLIError,
  HubNotRunningError,
  HubAlreadyRunningError,
  InvalidPRError,
  formatCLIError,
  getExitCode
} from '../src/cli/errors';
import { OutputFormatter, HubStatus, TaskProgress, WorkResult } from '../src/cli/formatters';
import { HubClient } from '../src/cli/hubClient';
import { AgentInfo } from '../src/hub/agentRegistry';
import { CoordinationMode } from '../src/core/coordinationMode';

describe('CLI Errors', () => {
  describe('CLIError', () => {
    it('should create error with message, exit code, and suggestions', () => {
      const error = new CLIError('Test error', 2, ['Suggestion 1', 'Suggestion 2']);

      expect(error.message).toBe('Test error');
      expect(error.exitCode).toBe(2);
      expect(error.suggestions).toEqual(['Suggestion 1', 'Suggestion 2']);
    });

    it('should default to exit code 1', () => {
      const error = new CLIError('Test error');
      expect(error.exitCode).toBe(1);
    });

    it('should default to empty suggestions', () => {
      const error = new CLIError('Test error');
      expect(error.suggestions).toEqual([]);
    });
  });

  describe('HubNotRunningError', () => {
    it('should have appropriate message and suggestions', () => {
      const error = new HubNotRunningError();

      expect(error.message).toBe('Hub daemon is not running');
      expect(error.exitCode).toBe(1);
      expect(error.suggestions.length).toBeGreaterThan(0);
      expect(error.suggestions[0]).toContain('lemegeton hub start');
    });
  });

  describe('HubAlreadyRunningError', () => {
    it('should include PID in message', () => {
      const error = new HubAlreadyRunningError(12345);

      expect(error.message).toContain('12345');
      expect(error.suggestions.length).toBeGreaterThan(0);
    });
  });

  describe('InvalidPRError', () => {
    it('should include PR ID in message', () => {
      const error = new InvalidPRError('PR-999');

      expect(error.message).toContain('PR-999');
      expect(error.suggestions.length).toBeGreaterThan(0);
    });
  });

  describe('formatCLIError', () => {
    it('should format CLIError with suggestions', () => {
      const error = new CLIError('Test error', 1, ['Suggestion 1', 'Suggestion 2']);
      const formatted = formatCLIError(error);

      expect(formatted).toContain('Error: Test error');
      expect(formatted).toContain('Suggestions:');
      expect(formatted).toContain('Suggestion 1');
      expect(formatted).toContain('Suggestion 2');
    });

    it('should format regular Error without suggestions', () => {
      const error = new Error('Regular error');
      const formatted = formatCLIError(error);

      expect(formatted).toContain('Error: Regular error');
      expect(formatted).not.toContain('Suggestions:');
    });
  });

  describe('getExitCode', () => {
    it('should return exit code from CLIError', () => {
      const error = new CLIError('Test', 3);
      expect(getExitCode(error)).toBe(3);
    });

    it('should return 1 for regular Error', () => {
      const error = new Error('Test');
      expect(getExitCode(error)).toBe(1);
    });
  });
});

describe('Output Formatters', () => {
  describe('formatHubStatus', () => {
    it('should format running hub status', () => {
      const status: HubStatus = {
        running: true,
        pid: 12345,
        mode: CoordinationMode.DISTRIBUTED,
        agents: [],
        taskProgress: {
          total: 10,
          completed: 5,
          inProgress: 2,
          pending: 3,
          failed: 0
        }
      };

      const output = OutputFormatter.formatHubStatus(status, false);

      expect(output).toContain('Running');
      expect(output).toContain('12345');
      expect(output).toContain('distributed');
    });

    it('should format not running status', () => {
      const status: HubStatus = {
        running: false,
        agents: []
      };

      const output = OutputFormatter.formatHubStatus(status, false);

      expect(output).toContain('Not Running');
    });

    it('should format status with agents', () => {
      const agents: AgentInfo[] = [
        {
          id: 'agent-1',
          type: 'worker',
          status: 'active',
          assignedPR: 'PR-009',
          lastHeartbeat: Date.now(),
          pid: 5001,
          startedAt: Date.now() - 60000
        },
        {
          id: 'agent-2',
          type: 'qc',
          status: 'active',
          assignedPR: null,
          lastHeartbeat: Date.now(),
          pid: 5002,
          startedAt: Date.now() - 60000
        }
      ];

      const status: HubStatus = {
        running: true,
        pid: 12345,
        mode: CoordinationMode.DISTRIBUTED,
        agents
      };

      const output = OutputFormatter.formatHubStatus(status, false);

      expect(output).toContain('agent-1');
      expect(output).toContain('agent-2');
      expect(output).toContain('PR-009');
    });

    it('should return JSON when requested', () => {
      const status: HubStatus = {
        running: true,
        pid: 12345,
        agents: []
      };

      const output = OutputFormatter.formatHubStatus(status, true);
      const parsed = JSON.parse(output);

      expect(parsed.running).toBe(true);
      expect(parsed.pid).toBe(12345);
    });
  });

  describe('formatTaskProgress', () => {
    it('should format task progress', () => {
      const progress: TaskProgress = {
        total: 20,
        completed: 10,
        inProgress: 5,
        pending: 5,
        failed: 0
      };

      const output = OutputFormatter.formatTaskProgress(progress, false);

      expect(output).toContain('10/20');
      expect(output).toContain('50%');
      expect(output).toContain('In Progress: 5');
    });

    it('should handle failed tasks', () => {
      const progress: TaskProgress = {
        total: 20,
        completed: 10,
        inProgress: 5,
        pending: 3,
        failed: 2
      };

      const output = OutputFormatter.formatTaskProgress(progress, false);

      expect(output).toContain('Failed: 2');
    });

    it('should return JSON when requested', () => {
      const progress: TaskProgress = {
        total: 20,
        completed: 10,
        inProgress: 5,
        pending: 5,
        failed: 0
      };

      const output = OutputFormatter.formatTaskProgress(progress, true);
      const parsed = JSON.parse(output);

      expect(parsed.total).toBe(20);
      expect(parsed.completed).toBe(10);
    });
  });

  describe('formatWorkResult', () => {
    it('should format successful result', () => {
      const result: WorkResult = {
        prId: 'PR-009',
        success: true,
        duration: 5000
      };

      const output = OutputFormatter.formatWorkResult(result, false);

      expect(output).toContain('PR-009');
      expect(output).toContain('completed successfully');
    });

    it('should format failed result', () => {
      const result: WorkResult = {
        prId: 'PR-009',
        success: false,
        error: 'Test failed'
      };

      const output = OutputFormatter.formatWorkResult(result, false);

      expect(output).toContain('PR-009');
      expect(output).toContain('failed');
      expect(output).toContain('Test failed');
    });
  });

  describe('createProgressBar', () => {
    it('should create progress bar', () => {
      const bar = OutputFormatter.createProgressBar(50, 100);

      expect(bar).toContain('[');
      expect(bar).toContain(']');
      expect(bar).toContain('50%');
    });

    it('should handle zero total', () => {
      const bar = OutputFormatter.createProgressBar(0, 0);

      expect(bar).toContain('[');
      expect(bar).toContain(']');
    });
  });

  describe('formatDuration', () => {
    it('should format seconds', () => {
      const formatted = OutputFormatter.formatDuration(5000);
      expect(formatted).toBe('5s');
    });

    it('should format minutes and seconds', () => {
      const formatted = OutputFormatter.formatDuration(125000);
      expect(formatted).toContain('m');
      expect(formatted).toContain('s');
    });

    it('should format hours and minutes', () => {
      const formatted = OutputFormatter.formatDuration(7200000);
      expect(formatted).toContain('h');
    });
  });

  describe('formatRelativeTime', () => {
    it('should format recent time as "just now"', () => {
      const now = Date.now();
      const formatted = OutputFormatter.formatRelativeTime(now);
      expect(formatted).toBe('just now');
    });

    it('should format seconds ago', () => {
      const past = Date.now() - 30000; // 30 seconds ago
      const formatted = OutputFormatter.formatRelativeTime(past);
      expect(formatted).toContain('s ago');
    });

    it('should format minutes ago', () => {
      const past = Date.now() - 300000; // 5 minutes ago
      const formatted = OutputFormatter.formatRelativeTime(past);
      expect(formatted).toContain('m ago');
    });
  });

  describe('Utility formatters', () => {
    it('should format success message', () => {
      const msg = OutputFormatter.success('Test passed');
      expect(msg).toContain('Test passed');
    });

    it('should format error message', () => {
      const msg = OutputFormatter.error('Test failed');
      expect(msg).toContain('Test failed');
    });

    it('should format info message', () => {
      const msg = OutputFormatter.info('Information');
      expect(msg).toContain('Information');
    });

    it('should format warning message', () => {
      const msg = OutputFormatter.warning('Warning');
      expect(msg).toContain('Warning');
    });
  });
});

describe('HubClient', () => {
  let testDir: string;
  let client: HubClient;

  beforeEach(() => {
    // Create temporary test directory
    testDir = path.join(__dirname, '.test-hub-client');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    client = new HubClient(testDir);
  });

  afterEach(async () => {
    // Cleanup
    await client.close();

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('getStatus', () => {
    it('should return not running status when no daemon', async () => {
      const status = await client.getStatus();

      expect(status.running).toBe(false);
      expect(status.pid).toBeUndefined();
      expect(status.agents).toEqual([]);
    });
  });

  describe('stopHub', () => {
    it('should throw HubNotRunningError when daemon not running', async () => {
      await expect(client.stopHub()).rejects.toThrow(HubNotRunningError);
    });
  });

  describe('runPR', () => {
    it('should throw HubNotRunningError when daemon not running', async () => {
      await expect(client.runPR('PR-009')).rejects.toThrow(HubNotRunningError);
    });
  });

  describe('runAll', () => {
    it('should throw HubNotRunningError when daemon not running', async () => {
      await expect(client.runAll()).rejects.toThrow(HubNotRunningError);
    });
  });
});
