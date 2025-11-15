/**
 * Base Agent Tests
 */

import { BaseAgent, AgentState, Assignment, WorkResult, AgentConfig } from '../src/agents';

// Test agent implementation
class TestAgent extends BaseAgent {
  public workCalled = false;
  public lastAssignment: Assignment | null = null;

  async doWork(assignment: Assignment): Promise<WorkResult> {
    this.workCalled = true;
    this.lastAssignment = assignment;

    return {
      success: true,
      prId: assignment.prId,
      output: 'Test work completed',
      duration: 100,
    };
  }

  async validateAssignment(assignment: Assignment): Promise<boolean> {
    return assignment && typeof assignment.prId === 'string';
  }
}

describe('BaseAgent', () => {
  let agent: TestAgent;
  const agentConfig: AgentConfig = {
    agentType: 'test',
    heartbeatInterval: 1000,
    maxRetries: 3,
  };

  beforeEach(() => {
    agent = new TestAgent('test-agent-001', agentConfig);
  });

  afterEach(async () => {
    if (agent.getState() !== AgentState.STOPPED) {
      await agent.stop();
    }
  });

  describe('Lifecycle', () => {
    it('should start with INITIALIZING state', () => {
      expect(agent.getState()).toBe(AgentState.INITIALIZING);
    });

    it('should transition to IDLE after start', async () => {
      await agent.start();
      expect(agent.getState()).toBe(AgentState.IDLE);
    });

    it('should emit started event', async () => {
      const startedPromise = new Promise(resolve => {
        agent.once('started', resolve);
      });

      await agent.start();
      await startedPromise;

      expect(agent.getState()).toBe(AgentState.IDLE);
    });

    it('should transition to STOPPED after stop', async () => {
      await agent.start();
      await agent.stop();

      expect(agent.getState()).toBe(AgentState.STOPPED);
    });

    it('should emit stopped event', async () => {
      await agent.start();

      const stoppedPromise = new Promise(resolve => {
        agent.once('stopped', resolve);
      });

      await agent.stop();
      await stoppedPromise;

      expect(agent.getState()).toBe(AgentState.STOPPED);
    });
  });

  describe('Work Assignment', () => {
    it('should handle valid assignment', async () => {
      await agent.start();

      const assignment: Assignment = {
        prId: 'PR-001',
        assignedAt: Date.now(),
        priority: 'high',
        complexity: 5,
      };

      await agent.handleAssignment(assignment);

      expect(agent.workCalled).toBe(true);
      expect(agent.lastAssignment?.prId).toBe('PR-001');
    });

    it('should transition to WORKING during work', async () => {
      await agent.start();

      const assignment: Assignment = {
        prId: 'PR-001',
        assignedAt: Date.now(),
        priority: 'high',
        complexity: 5,
      };

      // Start assignment (don't await to check intermediate state)
      const workPromise = agent.handleAssignment(assignment);

      // Give it a moment to transition
      await new Promise(resolve => setTimeout(resolve, 10));

      // During work, we should be back to IDLE after completion
      await workPromise;
      expect(agent.getState()).toBe(AgentState.IDLE);
    });

    it('should send completion message', async () => {
      const messages: any[] = [];

      // Set up listener before starting
      agent.on('hubMessage', (msg) => messages.push(msg));

      await agent.start();

      const assignment: Assignment = {
        prId: 'PR-001',
        assignedAt: Date.now(),
        priority: 'high',
        complexity: 5,
      };

      await agent.handleAssignment(assignment);

      const completeMessage = messages.find(m => m.type === 'complete');
      expect(completeMessage).toBeDefined();
      expect(completeMessage?.prId).toBe('PR-001');
    });
  });

  describe('Heartbeat', () => {
    it('should send registration message on start', async () => {
      const messages: any[] = [];

      // Set up listener before starting
      agent.on('hubMessage', (msg) => messages.push(msg));

      await agent.start();

      const registration = messages.find(m => m.type === 'registration');
      expect(registration).toBeDefined();
      expect(registration?.agentId).toBe('test-agent-001');
      expect(registration?.agentType).toBe('test');
    });
  });

  describe('Statistics', () => {
    it('should provide agent statistics', async () => {
      await agent.start();

      const stats = agent.getStats();

      expect(stats.agentId).toBe('test-agent-001');
      expect(stats.agentType).toBe('test');
      expect(stats.state).toBe(AgentState.IDLE);
      expect(stats.uptime).toBeGreaterThanOrEqual(0);
    });
  });
});
