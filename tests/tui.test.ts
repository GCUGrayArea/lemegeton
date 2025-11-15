/**
 * TUI Progress Tracking Tests
 *
 * Comprehensive tests for progress tracking components
 */

import { DependencyGraph } from '../src/tui/dependencies';
import { MetricsCalculator, MetricsFormatter } from '../src/tui/metrics';
import { PRData } from '../src/parser/types';
import { PRState, ColdState } from '../src/types/pr';

/**
 * Test Helper: Create mock PR data
 */
function createMockPR(id: string, deps: string[] = [], complexity: number = 5): PRData {
  return {
    pr_id: id,
    title: `Test PR ${id}`,
    cold_state: 'new' as ColdState,
    priority: 'medium',
    complexity: {
      score: complexity,
      estimated_minutes: complexity * 10,
      suggested_model: complexity <= 3 ? 'haiku' : complexity <= 7 ? 'sonnet' : 'opus',
      rationale: 'Test complexity',
    },
    dependencies: deps,
  };
}

/**
 * Test Helper: Create mock PR state
 */
function createMockPRState(id: string, coldState: ColdState = 'new'): PRState {
  return {
    pr_id: id,
    cold_state: coldState,
    dependencies: [],
    files_locked: [],
    last_transition: new Date().toISOString(),
  };
}

/**
 * DependencyGraph Tests
 */
describe('DependencyGraph', () => {
  describe('Basic Graph Operations', () => {
    it('should build dependency graph from PRs', () => {
      const prs = [
        createMockPR('PR-001', []),
        createMockPR('PR-002', ['PR-001']),
        createMockPR('PR-003', ['PR-001', 'PR-002']),
      ];

      const graph = new DependencyGraph(prs);

      expect(graph.getDependencies('PR-002')).toEqual(['PR-001']);
      expect(graph.getDependencies('PR-003')).toEqual(['PR-001', 'PR-002']);
      expect(graph.getDependents('PR-001')).toContain('PR-002');
      expect(graph.getDependents('PR-001')).toContain('PR-003');
    });

    it('should return empty dependencies for PRs without deps', () => {
      const prs = [createMockPR('PR-001', [])];
      const graph = new DependencyGraph(prs);

      expect(graph.getDependencies('PR-001')).toEqual([]);
    });

    it('should handle non-existent PR IDs gracefully', () => {
      const prs = [createMockPR('PR-001', [])];
      const graph = new DependencyGraph(prs);

      expect(graph.getDependencies('PR-999')).toEqual([]);
      expect(graph.getDependents('PR-999')).toEqual([]);
    });
  });

  describe('Blocking Detection', () => {
    it('should detect blocked PRs', () => {
      const prs = [
        createMockPR('PR-001', []),
        createMockPR('PR-002', ['PR-001']),
      ];
      const graph = new DependencyGraph(prs);

      const states = new Map<string, PRState>([
        ['PR-001', createMockPRState('PR-001', 'new')],
        ['PR-002', createMockPRState('PR-002', 'new')],
      ]);

      expect(graph.isBlocked('PR-002', states)).toBe(true);
    });

    it('should not block PRs with completed dependencies', () => {
      const prs = [
        createMockPR('PR-001', []),
        createMockPR('PR-002', ['PR-001']),
      ];
      const graph = new DependencyGraph(prs);

      const states = new Map<string, PRState>([
        ['PR-001', createMockPRState('PR-001', 'completed')],
        ['PR-002', createMockPRState('PR-002', 'new')],
      ]);

      expect(graph.isBlocked('PR-002', states)).toBe(false);
    });

    it('should identify all blockers for a PR', () => {
      const prs = [
        createMockPR('PR-001', []),
        createMockPR('PR-002', []),
        createMockPR('PR-003', ['PR-001', 'PR-002']),
      ];
      const graph = new DependencyGraph(prs);

      const states = new Map<string, PRState>([
        ['PR-001', createMockPRState('PR-001', 'new')],
        ['PR-002', createMockPRState('PR-002', 'completed')],
        ['PR-003', createMockPRState('PR-003', 'new')],
      ]);

      const blockers = graph.getBlockers('PR-003', states);
      expect(blockers).toEqual(['PR-001']);
    });
  });

  describe('Cycle Detection', () => {
    it('should detect simple circular dependencies', () => {
      const prs = [
        createMockPR('PR-001', ['PR-002']),
        createMockPR('PR-002', ['PR-001']),
      ];

      const graph = new DependencyGraph(prs);
      const cycles = graph.detectCycles();

      expect(cycles.length).toBeGreaterThan(0);
    });

    it('should detect complex circular dependencies', () => {
      const prs = [
        createMockPR('PR-001', ['PR-003']),
        createMockPR('PR-002', ['PR-001']),
        createMockPR('PR-003', ['PR-002']),
      ];

      const graph = new DependencyGraph(prs);
      const cycles = graph.detectCycles();

      expect(cycles.length).toBeGreaterThan(0);
    });

    it('should not detect cycles in acyclic graphs', () => {
      const prs = [
        createMockPR('PR-001', []),
        createMockPR('PR-002', ['PR-001']),
        createMockPR('PR-003', ['PR-002']),
      ];

      const graph = new DependencyGraph(prs);
      const cycles = graph.detectCycles();

      expect(cycles.length).toBe(0);
    });
  });

  describe('Critical Path Calculation', () => {
    it('should calculate critical path', () => {
      const prs = [
        createMockPR('PR-001', [], 5),
        createMockPR('PR-002', ['PR-001'], 3),
        createMockPR('PR-003', ['PR-001'], 8),
      ];

      const graph = new DependencyGraph(prs);
      const criticalPath = graph.getCriticalPath();

      expect(criticalPath.length).toBeGreaterThan(0);
      expect(criticalPath).toContain('PR-001');
      expect(criticalPath).toContain('PR-003'); // PR-003 has higher complexity
    });

    it('should handle single PR', () => {
      const prs = [createMockPR('PR-001', [], 5)];

      const graph = new DependencyGraph(prs);
      const criticalPath = graph.getCriticalPath();

      expect(criticalPath).toEqual(['PR-001']);
    });
  });

  describe('Ready PRs', () => {
    it('should identify ready PRs', () => {
      const prs = [
        createMockPR('PR-001', []),
        createMockPR('PR-002', ['PR-001']),
        createMockPR('PR-003', ['PR-001']),
      ];
      const graph = new DependencyGraph(prs);

      const states = new Map<string, PRState>([
        ['PR-001', createMockPRState('PR-001', 'completed')],
        ['PR-002', createMockPRState('PR-002', 'new')],
        ['PR-003', createMockPRState('PR-003', 'new')],
      ]);

      const ready = graph.getReadyPRs(states);
      expect(ready).toContain('PR-002');
      expect(ready).toContain('PR-003');
      expect(ready).not.toContain('PR-001'); // Already completed
    });

    it('should not include blocked PRs', () => {
      const prs = [
        createMockPR('PR-001', []),
        createMockPR('PR-002', ['PR-001']),
      ];
      const graph = new DependencyGraph(prs);

      const states = new Map<string, PRState>([
        ['PR-001', createMockPRState('PR-001', 'new')],
        ['PR-002', createMockPRState('PR-002', 'new')],
      ]);

      const ready = graph.getReadyPRs(states);
      expect(ready).not.toContain('PR-002');
      expect(ready).toContain('PR-001');
    });
  });

  describe('Topological Order', () => {
    it('should generate topological layers', () => {
      const prs = [
        createMockPR('PR-001', []),
        createMockPR('PR-002', []),
        createMockPR('PR-003', ['PR-001', 'PR-002']),
        createMockPR('PR-004', ['PR-003']),
      ];

      const graph = new DependencyGraph(prs);
      const layers = graph.getTopologicalOrder();

      expect(layers.length).toBeGreaterThan(0);
      expect(layers[0]).toContain('PR-001');
      expect(layers[0]).toContain('PR-002');
    });

    it('should handle linear dependencies', () => {
      const prs = [
        createMockPR('PR-001', []),
        createMockPR('PR-002', ['PR-001']),
        createMockPR('PR-003', ['PR-002']),
      ];

      const graph = new DependencyGraph(prs);
      const layers = graph.getTopologicalOrder();

      expect(layers.length).toBe(3);
      expect(layers[0]).toEqual(['PR-001']);
      expect(layers[1]).toEqual(['PR-002']);
      expect(layers[2]).toEqual(['PR-003']);
    });
  });

  describe('Completion Estimation', () => {
    it('should estimate completion time', () => {
      const prs = [
        createMockPR('PR-001', [], 5),
        createMockPR('PR-002', ['PR-001'], 3),
        createMockPR('PR-003', ['PR-001'], 8),
      ];

      const graph = new DependencyGraph(prs);
      const states = new Map<string, PRState>([
        ['PR-001', createMockPRState('PR-001', 'new')],
        ['PR-002', createMockPRState('PR-002', 'new')],
        ['PR-003', createMockPRState('PR-003', 'new')],
      ]);

      const estimate = graph.estimateCompletion(states, 3);

      expect(estimate.hoursRemaining).toBeGreaterThan(0);
      expect(estimate.criticalPathHours).toBeGreaterThan(0);
      expect(estimate.estimatedDate).toBeInstanceOf(Date);
    });

    it('should account for completed PRs', () => {
      const prs = [
        createMockPR('PR-001', [], 5),
        createMockPR('PR-002', ['PR-001'], 3),
      ];

      const graph = new DependencyGraph(prs);
      const states = new Map<string, PRState>([
        ['PR-001', createMockPRState('PR-001', 'completed')],
        ['PR-002', createMockPRState('PR-002', 'new')],
      ]);

      const estimate = graph.estimateCompletion(states, 3);

      // Should only count PR-002's time
      expect(estimate.hoursRemaining).toBeLessThan(1); // 30 minutes = 0.5 hours
    });
  });

  describe('Transitive Dependencies', () => {
    it('should get all transitive dependencies', () => {
      const prs = [
        createMockPR('PR-001', []),
        createMockPR('PR-002', ['PR-001']),
        createMockPR('PR-003', ['PR-002']),
        createMockPR('PR-004', ['PR-003']),
      ];

      const graph = new DependencyGraph(prs);
      const transitive = graph.getTransitiveDependencies('PR-004');

      expect(transitive.has('PR-003')).toBe(true);
      expect(transitive.has('PR-002')).toBe(true);
      expect(transitive.has('PR-001')).toBe(true);
    });

    it('should get all transitive dependents', () => {
      const prs = [
        createMockPR('PR-001', []),
        createMockPR('PR-002', ['PR-001']),
        createMockPR('PR-003', ['PR-002']),
        createMockPR('PR-004', ['PR-003']),
      ];

      const graph = new DependencyGraph(prs);
      const transitive = graph.getTransitiveDependents('PR-001');

      expect(transitive.has('PR-002')).toBe(true);
      expect(transitive.has('PR-003')).toBe(true);
      expect(transitive.has('PR-004')).toBe(true);
    });
  });
});

/**
 * MetricsCalculator Tests
 */
describe('MetricsCalculator', () => {
  describe('Count Calculations', () => {
    it('should calculate PR counts by state', () => {
      const prs = [
        createMockPR('PR-001', []),
        createMockPR('PR-002', []),
        createMockPR('PR-003', []),
        createMockPR('PR-004', []),
        createMockPR('PR-005', []),
      ];

      const states = new Map<string, PRState>([
        ['PR-001', createMockPRState('PR-001', 'completed')],
        ['PR-002', createMockPRState('PR-002', 'completed')],
        ['PR-003', createMockPRState('PR-003', 'broken')],
        ['PR-004', createMockPRState('PR-004', 'new')],
        ['PR-005', createMockPRState('PR-005', 'ready')],
      ]);

      const calc = new MetricsCalculator(prs, states);
      const metrics = calc.calculate();

      expect(metrics.total).toBe(5);
      expect(metrics.completed).toBe(2);
      expect(metrics.broken).toBe(1);
    });

    it('should handle empty PR list', () => {
      const calc = new MetricsCalculator([], new Map());
      const metrics = calc.calculate();

      expect(metrics.total).toBe(0);
      expect(metrics.completionPercent).toBe(0);
    });
  });

  describe('Completion Percentage', () => {
    it('should calculate completion percentage correctly', () => {
      const prs = [
        createMockPR('PR-001', []),
        createMockPR('PR-002', []),
        createMockPR('PR-003', []),
        createMockPR('PR-004', []),
      ];

      const states = new Map<string, PRState>([
        ['PR-001', createMockPRState('PR-001', 'completed')],
        ['PR-002', createMockPRState('PR-002', 'completed')],
        ['PR-003', createMockPRState('PR-003', 'new')],
        ['PR-004', createMockPRState('PR-004', 'new')],
      ]);

      const calc = new MetricsCalculator(prs, states);
      const metrics = calc.calculate();

      expect(metrics.completionPercent).toBe(50);
    });

    it('should round completion percentage', () => {
      const prs = [
        createMockPR('PR-001', []),
        createMockPR('PR-002', []),
        createMockPR('PR-003', []),
      ];

      const states = new Map<string, PRState>([
        ['PR-001', createMockPRState('PR-001', 'completed')],
        ['PR-002', createMockPRState('PR-002', 'new')],
        ['PR-003', createMockPRState('PR-003', 'new')],
      ]);

      const calc = new MetricsCalculator(prs, states);
      const metrics = calc.calculate();

      expect(metrics.completionPercent).toBe(33); // 33.33% rounded to 33
    });
  });

  describe('Complexity Distribution', () => {
    it('should calculate complexity distribution', () => {
      const prs = [
        createMockPR('PR-001', [], 2), // haiku
        createMockPR('PR-002', [], 2), // haiku
        createMockPR('PR-003', [], 5), // sonnet
        createMockPR('PR-004', [], 5), // sonnet
        createMockPR('PR-005', [], 5), // sonnet
        createMockPR('PR-006', [], 9), // opus
      ];

      const calc = new MetricsCalculator(prs, new Map());
      const metrics = calc.calculate();

      expect(metrics.complexityDistribution.haiku).toBe(2);
      expect(metrics.complexityDistribution.sonnet).toBe(3);
      expect(metrics.complexityDistribution.opus).toBe(1);
    });
  });

  describe('State Updates', () => {
    it('should update states dynamically', () => {
      const prs = [
        createMockPR('PR-001', []),
        createMockPR('PR-002', []),
      ];

      const initialStates = new Map<string, PRState>([
        ['PR-001', createMockPRState('PR-001', 'new')],
        ['PR-002', createMockPRState('PR-002', 'new')],
      ]);

      const calc = new MetricsCalculator(prs, initialStates);
      let metrics = calc.calculate();
      expect(metrics.completed).toBe(0);

      // Update states
      const updatedStates = new Map<string, PRState>([
        ['PR-001', createMockPRState('PR-001', 'completed')],
        ['PR-002', createMockPRState('PR-002', 'new')],
      ]);

      calc.updateStates(updatedStates);
      metrics = calc.calculate();
      expect(metrics.completed).toBe(1);
    });
  });
});

/**
 * MetricsFormatter Tests
 */
describe('MetricsFormatter', () => {
  describe('Percentage Formatting', () => {
    it('should format percentage with color', () => {
      const high = MetricsFormatter.formatPercent(80);
      expect(high.color).toBe('green');

      const medium = MetricsFormatter.formatPercent(60);
      expect(medium.color).toBe('yellow');

      const low = MetricsFormatter.formatPercent(40);
      expect(low.color).toBe('yellow');

      const veryLow = MetricsFormatter.formatPercent(20);
      expect(veryLow.color).toBe('red');
    });
  });

  describe('Hours Formatting', () => {
    it('should format hours correctly', () => {
      expect(MetricsFormatter.formatHours(0.5)).toContain('m');
      expect(MetricsFormatter.formatHours(2.5)).toContain('h');
      expect(MetricsFormatter.formatHours(25)).toContain('d');
    });
  });

  describe('Progress Bar', () => {
    it('should create progress bar', () => {
      const bar = MetricsFormatter.createProgressBar(50, 10);
      expect(bar.length).toBe(10);
      expect(bar).toContain('█');
      expect(bar).toContain('░');
    });

    it('should handle 0% and 100%', () => {
      const empty = MetricsFormatter.createProgressBar(0, 10);
      expect(empty).toBe('░'.repeat(10));

      const full = MetricsFormatter.createProgressBar(100, 10);
      expect(full).toBe('█'.repeat(10));
    });
  });
});
