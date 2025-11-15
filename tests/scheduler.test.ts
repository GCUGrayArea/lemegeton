/**
 * MIS Scheduler Tests
 *
 * Comprehensive test suite for the scheduling system.
 */

import {
  Scheduler,
  DependencyGraph,
  ConflictDetector,
  MISScheduler,
  AssignmentManager,
  AssignmentStrategy,
  Priority,
  PRNode,
} from '../src/scheduler';
import { AgentInfo } from '../src/hub/agentRegistry';

describe('MIS Scheduler', () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    scheduler = new Scheduler();
  });

  describe('DependencyGraph', () => {
    let graph: DependencyGraph;

    beforeEach(() => {
      graph = new DependencyGraph();
    });

    it('should build graph from task list', () => {
      const taskList = {
        prs: [
          {
            id: 'PR-001',
            title: 'First PR',
            cold_state: 'new',
            dependencies: [],
            priority: 'high',
            complexity: { score: 5 },
          },
          {
            id: 'PR-002',
            title: 'Second PR',
            cold_state: 'new',
            dependencies: ['PR-001'],
            priority: 'medium',
            complexity: { score: 3 },
          },
          {
            id: 'PR-003',
            title: 'Third PR',
            cold_state: 'new',
            dependencies: ['PR-001', 'PR-002'],
            priority: 'low',
            complexity: { score: 7 },
          },
        ],
      };

      graph.buildFromTaskList(taskList);

      expect(graph.getAllNodes()).toHaveLength(3);
      expect(graph.getAvailable()).toHaveLength(1);
      expect(graph.getAvailable()[0].id).toBe('PR-001');
    });

    it('should detect circular dependencies', () => {
      const circular: PRNode = {
        id: 'PR-A',
        title: 'A',
        state: 'new',
        dependencies: new Set(['PR-B']),
        dependents: new Set(),
        files: new Set(),
        priority: Priority.MEDIUM,
        complexity: 1,
        estimatedMinutes: 10,
      };

      const circular2: PRNode = {
        id: 'PR-B',
        title: 'B',
        state: 'new',
        dependencies: new Set(['PR-A']),
        dependents: new Set(),
        files: new Set(),
        priority: Priority.MEDIUM,
        complexity: 1,
        estimatedMinutes: 10,
      };

      graph.addNode(circular);
      graph.addNode(circular2);

      expect(graph.hasCycles()).toBe(true);
    });

    it('should update available PRs when dependencies complete', () => {
      const taskList = {
        prs: [
          {
            id: 'PR-001',
            cold_state: 'new',
            dependencies: [],
          },
          {
            id: 'PR-002',
            cold_state: 'new',
            dependencies: ['PR-001'],
          },
          {
            id: 'PR-003',
            cold_state: 'new',
            dependencies: ['PR-002'],
          },
        ],
      };

      graph.buildFromTaskList(taskList);

      // Initially only PR-001 available
      expect(graph.getAvailable().map(n => n.id)).toEqual(['PR-001']);

      // Complete PR-001
      graph.markComplete('PR-001');
      expect(graph.getAvailable().map(n => n.id)).toEqual(['PR-002']);

      // Complete PR-002
      graph.markComplete('PR-002');
      expect(graph.getAvailable().map(n => n.id)).toEqual(['PR-003']);
    });

    it('should track dependency chains', () => {
      const taskList = {
        prs: [
          { id: 'PR-001', dependencies: [] },
          { id: 'PR-002', dependencies: ['PR-001'] },
          { id: 'PR-003', dependencies: ['PR-002'] },
          { id: 'PR-004', dependencies: ['PR-003'] },
        ],
      };

      graph.buildFromTaskList(taskList);

      const chain = graph.getDependencyChain('PR-004');
      expect(chain).toEqual(['PR-001', 'PR-002', 'PR-003', 'PR-004']);
    });

    it('should find all dependents of a PR', () => {
      const taskList = {
        prs: [
          { id: 'PR-001', dependencies: [] },
          { id: 'PR-002', dependencies: ['PR-001'] },
          { id: 'PR-003', dependencies: ['PR-001'] },
          { id: 'PR-004', dependencies: ['PR-002'] },
        ],
      };

      graph.buildFromTaskList(taskList);

      const dependents = graph.getDependents('PR-001');
      expect(dependents).toContain('PR-002');
      expect(dependents).toContain('PR-003');
      expect(dependents).toContain('PR-004');
    });
  });

  describe('ConflictDetector', () => {
    let detector: ConflictDetector;

    beforeEach(() => {
      detector = new ConflictDetector();
    });

    it('should detect file conflicts', () => {
      const nodes: PRNode[] = [
        {
          id: 'PR-001',
          title: 'First',
          state: 'new',
          dependencies: new Set(),
          dependents: new Set(),
          files: new Set(['file1.ts', 'file2.ts']),
          priority: Priority.MEDIUM,
          complexity: 1,
          estimatedMinutes: 10,
        },
        {
          id: 'PR-002',
          title: 'Second',
          state: 'new',
          dependencies: new Set(),
          dependents: new Set(),
          files: new Set(['file2.ts', 'file3.ts']),
          priority: Priority.MEDIUM,
          complexity: 1,
          estimatedMinutes: 10,
        },
        {
          id: 'PR-003',
          title: 'Third',
          state: 'new',
          dependencies: new Set(),
          dependents: new Set(),
          files: new Set(['file4.ts']),
          priority: Priority.MEDIUM,
          complexity: 1,
          estimatedMinutes: 10,
        },
      ];

      detector.detectConflicts(nodes);

      expect(detector.hasConflict('PR-001', 'PR-002')).toBe(true);
      expect(detector.hasConflict('PR-001', 'PR-003')).toBe(false);
      expect(detector.hasConflict('PR-002', 'PR-003')).toBe(false);
    });

    it('should find conflicting files', () => {
      const nodes: PRNode[] = [
        {
          id: 'PR-001',
          title: 'First',
          state: 'new',
          dependencies: new Set(),
          dependents: new Set(),
          files: new Set(['shared.ts', 'unique1.ts']),
          priority: Priority.MEDIUM,
          complexity: 1,
          estimatedMinutes: 10,
        },
        {
          id: 'PR-002',
          title: 'Second',
          state: 'new',
          dependencies: new Set(),
          dependents: new Set(),
          files: new Set(['shared.ts', 'unique2.ts']),
          priority: Priority.MEDIUM,
          complexity: 1,
          estimatedMinutes: 10,
        },
      ];

      detector.detectConflicts(nodes);

      const conflictingFiles = detector.getConflictingFiles('PR-001', 'PR-002');
      expect(conflictingFiles.has('shared.ts')).toBe(true);
      expect(conflictingFiles.size).toBe(1);
    });

    it('should calculate conflict density', () => {
      const nodes: PRNode[] = [
        {
          id: 'PR-001',
          title: 'First',
          state: 'new',
          dependencies: new Set(),
          dependents: new Set(),
          files: new Set(['file.ts']),
          priority: Priority.MEDIUM,
          complexity: 1,
          estimatedMinutes: 10,
        },
        {
          id: 'PR-002',
          title: 'Second',
          state: 'new',
          dependencies: new Set(),
          dependents: new Set(),
          files: new Set(['file.ts']),
          priority: Priority.MEDIUM,
          complexity: 1,
          estimatedMinutes: 10,
        },
        {
          id: 'PR-003',
          title: 'Third',
          state: 'new',
          dependencies: new Set(),
          dependents: new Set(),
          files: new Set(['file.ts']),
          priority: Priority.MEDIUM,
          complexity: 1,
          estimatedMinutes: 10,
        },
      ];

      detector.detectConflicts(nodes);

      // All PRs conflict with each other (3 conflicts out of 3 possible)
      const density = detector.getConflictDensity(nodes);
      expect(density).toBe(1.0);
    });
  });

  describe('MIS Algorithm', () => {
    let graph: DependencyGraph;
    let detector: ConflictDetector;
    let misScheduler: MISScheduler;

    beforeEach(() => {
      graph = new DependencyGraph();
      detector = new ConflictDetector();
      misScheduler = new MISScheduler(graph, detector);
    });

    it('should find maximum independent set', () => {
      const nodes: PRNode[] = [
        {
          id: 'PR-001',
          title: 'First',
          state: 'new',
          dependencies: new Set(),
          dependents: new Set(),
          files: new Set(['file1.ts']),
          priority: Priority.HIGH,
          complexity: 2,
          estimatedMinutes: 20,
        },
        {
          id: 'PR-002',
          title: 'Second',
          state: 'new',
          dependencies: new Set(),
          dependents: new Set(),
          files: new Set(['file2.ts']),
          priority: Priority.MEDIUM,
          complexity: 3,
          estimatedMinutes: 30,
        },
        {
          id: 'PR-003',
          title: 'Third',
          state: 'new',
          dependencies: new Set(),
          dependents: new Set(),
          files: new Set(['file1.ts']), // Conflicts with PR-001
          priority: Priority.LOW,
          complexity: 1,
          estimatedMinutes: 10,
        },
      ];

      const result = misScheduler.findMaximumIndependentSet(nodes);

      // Should select PR-001 and PR-002 (no conflict)
      // PR-003 blocked due to conflict with PR-001
      expect(result.selectedPRs).toHaveLength(2);
      expect(result.selectedPRs.map(pr => pr.id)).toContain('PR-001');
      expect(result.selectedPRs.map(pr => pr.id)).toContain('PR-002');
      expect(result.blockedPRs).toHaveLength(1);
      expect(result.blockedPRs[0].id).toBe('PR-003');
    });

    it('should respect priority ordering', () => {
      const nodes: PRNode[] = [
        {
          id: 'PR-LOW',
          title: 'Low Priority',
          state: 'new',
          dependencies: new Set(),
          dependents: new Set(),
          files: new Set(['shared.ts']),
          priority: Priority.LOW,
          complexity: 1,
          estimatedMinutes: 10,
        },
        {
          id: 'PR-CRITICAL',
          title: 'Critical Priority',
          state: 'new',
          dependencies: new Set(),
          dependents: new Set(),
          files: new Set(['shared.ts']), // Conflicts with PR-LOW
          priority: Priority.CRITICAL,
          complexity: 5,
          estimatedMinutes: 50,
        },
      ];

      const result = misScheduler.findMaximumIndependentSet(nodes);

      // Should select PR-CRITICAL over PR-LOW due to priority
      expect(result.selectedPRs).toHaveLength(1);
      expect(result.selectedPRs[0].id).toBe('PR-CRITICAL');
    });

    it('should handle complex scenarios', () => {
      const taskList = {
        prs: [
          {
            id: 'PR-001',
            cold_state: 'completed',
            dependencies: [],
            estimated_files: [{ path: 'core.ts' }],
          },
          {
            id: 'PR-002',
            cold_state: 'new',
            dependencies: ['PR-001'],
            estimated_files: [{ path: 'module1.ts' }],
            priority: 'high',
            complexity: { score: 3 },
          },
          {
            id: 'PR-003',
            cold_state: 'new',
            dependencies: ['PR-001'],
            estimated_files: [{ path: 'module2.ts' }],
            priority: 'medium',
            complexity: { score: 2 },
          },
          {
            id: 'PR-004',
            cold_state: 'new',
            dependencies: ['PR-001'],
            estimated_files: [{ path: 'module1.ts' }], // Conflicts with PR-002
            priority: 'low',
            complexity: { score: 1 },
          },
          {
            id: 'PR-005',
            cold_state: 'new',
            dependencies: ['PR-002'],
            estimated_files: [{ path: 'feature.ts' }],
            priority: 'high',
            complexity: { score: 4 },
          },
        ],
      };

      graph.buildFromTaskList(taskList);
      const available = graph.getAvailable();
      const result = misScheduler.findMaximumIndependentSet(available);

      // PR-002, PR-003 are available (PR-001 is complete)
      // PR-004 conflicts with PR-002
      // PR-005 depends on PR-002 (not available yet)
      expect(result.selectedPRs.map(pr => pr.id)).toContain('PR-002');
      expect(result.selectedPRs.map(pr => pr.id)).toContain('PR-003');
      expect(result.selectedPRs.map(pr => pr.id)).not.toContain('PR-004'); // Conflicts
      expect(result.selectedPRs.map(pr => pr.id)).not.toContain('PR-005'); // Not available
    });
  });

  describe('AssignmentManager', () => {
    let manager: AssignmentManager;

    beforeEach(() => {
      manager = new AssignmentManager({
        strategy: AssignmentStrategy.FIRST_AVAILABLE, // Simpler for testing
        maxAssignmentsPerAgent: 2,
      });
    });

    it('should assign work to agents based on state and agent type', () => {
      const prs: PRNode[] = [
        {
          id: 'PR-001',
          title: 'Needs planning',
          state: 'new', // Planning agents can work on this
          dependencies: new Set(),
          dependents: new Set(),
          files: new Set(),
          priority: Priority.MEDIUM,
          complexity: 2,
          estimatedMinutes: 20,
        },
        {
          id: 'PR-002',
          title: 'Ready for implementation',
          state: 'planned', // Worker agents can work on this
          dependencies: new Set(),
          dependents: new Set(),
          files: new Set(),
          priority: Priority.HIGH,
          complexity: 6,
          estimatedMinutes: 60,
        },
      ];

      const agents: AgentInfo[] = [
        {
          id: 'agent-1',
          type: 'worker', // Can only work on 'planned' PRs
          status: 'idle',
          lastHeartbeat: Date.now(),
          assignedPR: null,
          pid: 1,
          startedAt: Date.now(),
        },
        {
          id: 'agent-2',
          type: 'planning', // Can only work on 'new'/'ready' PRs
          status: 'idle',
          lastHeartbeat: Date.now(),
          assignedPR: null,
          pid: 2,
          startedAt: Date.now(),
        },
      ];

      const assignments = manager.assignWork(prs, agents);

      // Should assign at least one PR based on agent type compatibility
      expect(assignments.length).toBeGreaterThan(0);

      // Verify assignments respect agent type compatibility
      for (const assignment of assignments) {
        const pr = prs.find(p => p.id === assignment.prId);
        const agent = agents.find(a => a.id === assignment.agentId);

        if (pr && agent) {
          // Planning agents should only get new/ready PRs
          if (agent.type === 'planning') {
            expect(['new', 'ready']).toContain(pr.state);
          }
          // Worker agents should only get planned PRs
          if (agent.type === 'worker') {
            expect(pr.state).toBe('planned');
          }
        }
      }
    });

    it('should respect agent capacity limits', () => {
      const prs: PRNode[] = [
        {
          id: 'PR-001',
          title: 'Task 1',
          state: 'planned', // Worker agents work on planned PRs
          dependencies: new Set(),
          dependents: new Set(),
          files: new Set(),
          priority: Priority.MEDIUM,
          complexity: 3,
          estimatedMinutes: 30,
        },
        {
          id: 'PR-002',
          title: 'Task 2',
          state: 'planned',
          dependencies: new Set(),
          dependents: new Set(),
          files: new Set(),
          priority: Priority.MEDIUM,
          complexity: 3,
          estimatedMinutes: 30,
        },
        {
          id: 'PR-003',
          title: 'Task 3',
          state: 'planned',
          dependencies: new Set(),
          dependents: new Set(),
          files: new Set(),
          priority: Priority.MEDIUM,
          complexity: 3,
          estimatedMinutes: 30,
        },
      ];

      const agents: AgentInfo[] = [
        {
          id: 'agent-1',
          type: 'worker',
          status: 'idle',
          lastHeartbeat: Date.now(),
          assignedPR: null,
          pid: 1,
          startedAt: Date.now(),
        },
      ];

      // Manager configured with maxAssignmentsPerAgent: 2
      const assignments = manager.assignWork(prs, agents);

      // Agent should only get 2 assignments
      expect(assignments).toHaveLength(2);
      expect(assignments.filter(a => a.agentId === 'agent-1')).toHaveLength(2);
    });

    it('should use load balancing strategy', () => {
      const loadManager = new AssignmentManager({
        strategy: AssignmentStrategy.LOAD_BALANCED,
      });

      const prs: PRNode[] = Array.from({ length: 6 }, (_, i) => ({
        id: `PR-${i + 1}`,
        title: `Task ${i + 1}`,
        state: 'planned' as const, // Worker agents work on planned PRs
        dependencies: new Set(),
        dependents: new Set(),
        files: new Set(),
        priority: Priority.MEDIUM,
        complexity: 2,
        estimatedMinutes: 20,
      }));

      const agents: AgentInfo[] = [
        {
          id: 'agent-1',
          type: 'worker',
          status: 'idle',
          lastHeartbeat: Date.now(),
          assignedPR: null,
          pid: 1,
          startedAt: Date.now(),
        },
        {
          id: 'agent-2',
          type: 'worker',
          status: 'idle',
          lastHeartbeat: Date.now(),
          assignedPR: null,
          pid: 2,
          startedAt: Date.now(),
        },
      ];

      const assignments = loadManager.assignWork(prs, agents);

      // Should distribute work evenly
      const agent1Assignments = assignments.filter(a => a.agentId === 'agent-1');
      const agent2Assignments = assignments.filter(a => a.agentId === 'agent-2');

      expect(Math.abs(agent1Assignments.length - agent2Assignments.length)).toBeLessThanOrEqual(1);
    });
  });

  describe('Full Scheduler Integration', () => {
    it('should schedule and assign work end-to-end', async () => {
      const taskList = {
        prs: [
          {
            id: 'PR-001',
            cold_state: 'new',
            dependencies: [],
            estimated_files: [{ path: 'file1.ts' }],
            priority: 'high',
            complexity: { score: 3, estimated_minutes: 30 },
          },
          {
            id: 'PR-002',
            cold_state: 'new',
            dependencies: [],
            estimated_files: [{ path: 'file2.ts' }],
            priority: 'medium',
            complexity: { score: 2, estimated_minutes: 20 },
          },
          {
            id: 'PR-003',
            cold_state: 'new',
            dependencies: ['PR-001'],
            estimated_files: [{ path: 'file3.ts' }],
            priority: 'low',
            complexity: { score: 1, estimated_minutes: 10 },
          },
        ],
      };

      const agents: AgentInfo[] = [
        {
          id: 'agent-1',
          type: 'planning', // Planning agents can work on 'new' PRs
          status: 'idle',
          lastHeartbeat: Date.now(),
          assignedPR: null,
          pid: 1,
          startedAt: Date.now(),
        },
        {
          id: 'agent-2',
          type: 'planning',
          status: 'idle',
          lastHeartbeat: Date.now(),
          assignedPR: null,
          pid: 2,
          startedAt: Date.now(),
        },
      ];

      await scheduler.initialize(taskList);
      const { assignments, result } = await scheduler.scheduleAndAssign(agents);

      // PR-001 and PR-002 should be scheduled (no conflicts, no deps)
      // PR-003 depends on PR-001, so not available
      expect(result.selectedPRs).toHaveLength(2);
      expect(assignments).toHaveLength(2);

      // Complete PR-001
      await scheduler.markComplete('PR-001');

      // Now PR-003 should be available
      const available = scheduler.getAvailablePRs();
      expect(available.map(pr => pr.id)).toContain('PR-003');
    });

    it('should handle failures and retry', async () => {
      const taskList = {
        prs: [
          {
            id: 'PR-001',
            cold_state: 'ready',
            dependencies: [],
          },
        ],
      };

      await scheduler.initialize(taskList);

      // Mark as failed
      await scheduler.markFailed('PR-001');

      // Should be available again
      const available = scheduler.getAvailablePRs();
      expect(available.map(pr => pr.id)).toContain('PR-001');
    });

    it('should provide accurate statistics', async () => {
      const taskList = {
        prs: [
          {
            id: 'PR-001',
            cold_state: 'completed',
            dependencies: [],
          },
          {
            id: 'PR-002',
            cold_state: 'ready',
            dependencies: ['PR-001'],
          },
          {
            id: 'PR-003',
            cold_state: 'new',
            dependencies: ['PR-001'],
          },
          {
            id: 'PR-004',
            cold_state: 'new',
            dependencies: ['PR-002'],
          },
        ],
      };

      await scheduler.initialize(taskList);

      const stats = scheduler.getStats();
      expect(stats.totalPRs).toBe(4);
      expect(stats.completedPRs).toBe(1);
      expect(stats.inProgressPRs).toBe(0); // No PRs are being worked on
      expect(stats.availablePRs).toBe(2); // PR-002 and PR-003 (both have dependencies met)
    });
  });
});