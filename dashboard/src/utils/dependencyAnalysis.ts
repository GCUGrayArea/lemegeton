/**
 * Dependency Analysis Utilities
 *
 * Ported from TUI (src/tui/dependencies.ts) to provide dependency graph
 * analysis for the web dashboard. Includes cycle detection, critical path
 * calculation, and blocker identification.
 */

/**
 * PR data structure (simplified from parser/types)
 */
export interface PRData {
  pr_id: string;
  title: string;
  cold_state: string;
  dependencies: string[];
  complexity: {
    score: number;
    estimated_minutes: number;
    suggested_model: string;
  };
}

/**
 * PR state (cold + hot states)
 */
export interface PRState {
  coldState: string;
  hotState?: string;
}

/**
 * Dependency graph node
 */
interface GraphNode {
  prId: string;
  dependencies: string[];
  dependents: string[];
  complexity: number;
  estimatedMinutes: number;
}

/**
 * Completion estimate result
 */
export interface CompletionEstimate {
  hoursRemaining: number;
  estimatedDate: Date | null;
  criticalPathHours: number;
  parallelizationFactor: number;
}

/**
 * Dependency Graph
 *
 * Builds and analyzes PR dependency relationships
 */
export class DependencyGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private adjacencyList: Map<string, Set<string>> = new Map();
  private reverseAdjacencyList: Map<string, Set<string>> = new Map();

  constructor(prs: PRData[]) {
    this.buildGraph(prs);
  }

  /**
   * Build dependency graph from PRs
   */
  private buildGraph(prs: PRData[]): void {
    // Initialize nodes
    for (const pr of prs) {
      this.nodes.set(pr.pr_id, {
        prId: pr.pr_id,
        dependencies: pr.dependencies || [],
        dependents: [],
        complexity: pr.complexity.score,
        estimatedMinutes: pr.complexity.estimated_minutes,
      });

      this.adjacencyList.set(pr.pr_id, new Set(pr.dependencies || []));
      this.reverseAdjacencyList.set(pr.pr_id, new Set());
    }

    // Build reverse adjacency list (dependents)
    for (const [prId, deps] of this.adjacencyList) {
      for (const dep of deps) {
        const dependents = this.reverseAdjacencyList.get(dep);
        if (dependents) {
          dependents.add(prId);
        }
      }
    }

    // Update dependents in nodes
    for (const [prId, node] of this.nodes) {
      const dependents = this.reverseAdjacencyList.get(prId);
      if (dependents) {
        node.dependents = Array.from(dependents);
      }
    }
  }

  /**
   * Get direct dependencies for a PR
   */
  getDependencies(prId: string): string[] {
    const node = this.nodes.get(prId);
    return node ? [...node.dependencies] : [];
  }

  /**
   * Get all PRs that depend on this PR
   */
  getDependents(prId: string): string[] {
    const node = this.nodes.get(prId);
    return node ? [...node.dependents] : [];
  }

  /**
   * Get all dependencies as a map
   */
  getDependencyMap(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const [prId, node] of this.nodes) {
      map.set(prId, [...node.dependencies]);
    }
    return map;
  }

  /**
   * Check if PR state is completed
   */
  private isCompleted(state: PRState): boolean {
    return state.coldState === 'completed' || state.coldState === 'approved';
  }

  /**
   * Check if PR state is in progress
   */
  private isInProgress(state: PRState): boolean {
    return (
      state.hotState === 'in-progress' ||
      state.hotState === 'investigating' ||
      state.hotState === 'planning' ||
      state.hotState === 'under-review'
    );
  }

  /**
   * Check if PR is blocked by incomplete dependencies
   */
  isBlocked(prId: string, states: Map<string, PRState>): boolean {
    const deps = this.getDependencies(prId);
    if (deps.length === 0) {
      return false;
    }

    // Check if any dependency is not completed
    for (const depId of deps) {
      const state = states.get(depId);
      if (!state || !this.isCompleted(state)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get all PRs blocking this PR
   */
  getBlockers(prId: string, states: Map<string, PRState>): string[] {
    const deps = this.getDependencies(prId);
    const blockers: string[] = [];

    for (const depId of deps) {
      const state = states.get(depId);
      if (!state || !this.isCompleted(state)) {
        blockers.push(depId);
      }
    }

    return blockers;
  }

  /**
   * Calculate critical path (longest dependency chain)
   */
  getCriticalPath(): string[] {
    const visited = new Set<string>();
    const memo = new Map<string, { path: string[]; length: number }>();

    const dfs = (prId: string): { path: string[]; length: number } => {
      if (memo.has(prId)) {
        return memo.get(prId)!;
      }

      visited.add(prId);

      const node = this.nodes.get(prId);
      if (!node || node.dependencies.length === 0) {
        const result = { path: [prId], length: node?.estimatedMinutes || 0 };
        memo.set(prId, result);
        return result;
      }

      let longestPath: string[] = [];
      let longestLength = 0;

      for (const depId of node.dependencies) {
        if (!visited.has(depId)) {
          const depResult = dfs(depId);
          if (depResult.length > longestLength) {
            longestPath = depResult.path;
            longestLength = depResult.length;
          }
        }
      }

      const result = {
        path: [...longestPath, prId],
        length: longestLength + node.estimatedMinutes,
      };

      memo.set(prId, result);
      visited.delete(prId);

      return result;
    };

    let globalLongestPath: string[] = [];
    let globalLongestLength = 0;

    for (const prId of this.nodes.keys()) {
      const result = dfs(prId);
      if (result.length > globalLongestLength) {
        globalLongestPath = result.path;
        globalLongestLength = result.length;
      }
    }

    return globalLongestPath;
  }

  /**
   * Get critical path length in hours
   */
  getCriticalPathHours(): number {
    const visited = new Set<string>();
    const memo = new Map<string, number>();

    const dfs = (prId: string): number => {
      if (memo.has(prId)) {
        return memo.get(prId)!;
      }

      visited.add(prId);

      const node = this.nodes.get(prId);
      if (!node || node.dependencies.length === 0) {
        const length = node?.estimatedMinutes || 0;
        memo.set(prId, length);
        return length;
      }

      let longestLength = 0;
      for (const depId of node.dependencies) {
        if (!visited.has(depId)) {
          const depLength = dfs(depId);
          if (depLength > longestLength) {
            longestLength = depLength;
          }
        }
      }

      const length = longestLength + node.estimatedMinutes;
      memo.set(prId, length);
      visited.delete(prId);

      return length;
    };

    let maxLength = 0;
    for (const prId of this.nodes.keys()) {
      const length = dfs(prId);
      if (length > maxLength) {
        maxLength = length;
      }
    }

    return maxLength / 60; // Convert minutes to hours
  }

  /**
   * Get all PRs ready to start (dependencies met)
   */
  getReadyPRs(states: Map<string, PRState>): string[] {
    const ready: string[] = [];

    for (const prId of this.nodes.keys()) {
      const state = states.get(prId);

      // Skip if already completed or in progress
      if (state && (this.isCompleted(state) || this.isInProgress(state))) {
        continue;
      }

      // Check if not blocked
      if (!this.isBlocked(prId, states)) {
        ready.push(prId);
      }
    }

    return ready;
  }

  /**
   * Detect circular dependencies using DFS
   */
  detectCycles(): string[][] {
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const cycles: string[][] = [];

    const dfs = (prId: string, path: string[]): void => {
      visited.add(prId);
      recStack.add(prId);
      path.push(prId);

      const deps = this.adjacencyList.get(prId);
      if (deps) {
        for (const depId of deps) {
          if (!visited.has(depId)) {
            dfs(depId, [...path]);
          } else if (recStack.has(depId)) {
            // Found a cycle
            const cycleStart = path.indexOf(depId);
            if (cycleStart !== -1) {
              const cycle = path.slice(cycleStart);
              cycle.push(depId);
              cycles.push(cycle);
            }
          }
        }
      }

      recStack.delete(prId);
    };

    for (const prId of this.nodes.keys()) {
      if (!visited.has(prId)) {
        dfs(prId, []);
      }
    }

    return cycles;
  }

  /**
   * Get all nodes (for visualization)
   */
  getAllNodes(): Map<string, GraphNode> {
    return new Map(this.nodes);
  }

  /**
   * Calculate completion estimate
   */
  estimateCompletion(
    states: Map<string, PRState>,
    velocityPRsPerDay: number = 2
  ): CompletionEstimate {
    // Count remaining PRs
    let remainingPRs = 0;
    let remainingMinutes = 0;

    for (const [prId, node] of this.nodes) {
      const state = states.get(prId);
      if (!state || !this.isCompleted(state)) {
        remainingPRs++;
        remainingMinutes += node.estimatedMinutes;
      }
    }

    const hoursRemaining = remainingMinutes / 60;
    const criticalPathHours = this.getCriticalPathHours();

    // Calculate parallelization factor
    const parallelizationFactor =
      criticalPathHours > 0 ? hoursRemaining / criticalPathHours : 1;

    // Estimate completion date based on velocity
    let estimatedDate: Date | null = null;
    if (velocityPRsPerDay > 0) {
      const daysRemaining = remainingPRs / velocityPRsPerDay;
      estimatedDate = new Date();
      estimatedDate.setDate(estimatedDate.getDate() + Math.ceil(daysRemaining));
    }

    return {
      hoursRemaining,
      estimatedDate,
      criticalPathHours,
      parallelizationFactor,
    };
  }
}

/**
 * Calculate phase progress from PR data
 */
export interface PhaseProgress {
  phaseName: string;
  total: number;
  completed: number;
  inProgress: number;
  blocked: number;
  percent: number;
}

export function calculatePhaseProgress(
  prs: PRData[],
  states: Map<string, PRState>,
  dependencyGraph: DependencyGraph
): PhaseProgress[] {
  // Extract phase from PR ID (e.g., "PR-015" -> "Phase 0.1b")
  // This is a simplified version - actual implementation would parse task-list.md
  const phases = new Map<string, PhaseProgress>();

  for (const pr of prs) {
    // Simple phase extraction (would need to be more sophisticated in reality)
    const prNum = parseInt(pr.pr_id.replace('PR-', ''));
    let phaseName = 'Phase 0.1a';

    if (prNum <= 13) {
      phaseName = 'Phase 0.1a - Core Coordination';
    } else if (prNum <= 16) {
      phaseName = 'Phase 0.1b - UX & Integration';
    } else if (prNum <= 25) {
      phaseName = 'Phase 0.2 - Intelligence & Optimization';
    } else if (prNum <= 31) {
      phaseName = 'Phase 0.3 - Advanced Features';
    } else if (prNum <= 36) {
      phaseName = 'Phase 0.4 - Validation';
    } else {
      phaseName = 'Phase 1.0 - Team Features';
    }

    if (!phases.has(phaseName)) {
      phases.set(phaseName, {
        phaseName,
        total: 0,
        completed: 0,
        inProgress: 0,
        blocked: 0,
        percent: 0,
      });
    }

    const phase = phases.get(phaseName)!;
    phase.total++;

    const state = states.get(pr.pr_id);
    if (state) {
      if (state.coldState === 'completed' || state.coldState === 'approved') {
        phase.completed++;
      } else if (state.hotState) {
        phase.inProgress++;
      } else if (dependencyGraph.isBlocked(pr.pr_id, states)) {
        phase.blocked++;
      }
    }
  }

  // Calculate percentages
  for (const phase of phases.values()) {
    phase.percent = phase.total > 0 ? (phase.completed / phase.total) * 100 : 0;
  }

  return Array.from(phases.values());
}
