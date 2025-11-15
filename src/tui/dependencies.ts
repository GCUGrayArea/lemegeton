/**
 * Dependency Graph Component
 *
 * Manages PR dependencies, detects cycles, calculates critical paths,
 * and provides dependency resolution utilities for the progress tracker.
 */

import { PRData } from '../parser/types';
import { PRState, ColdState, HotState } from '../types/pr';

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
  estimatedDate: Date;
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
            const cycle = path.slice(cycleStart);
            cycles.push([...cycle, depId]);
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
   * Get topological order for parallel execution
   * Returns layers where each layer can be executed in parallel
   */
  getTopologicalOrder(): string[][] {
    const inDegree = new Map<string, number>();
    const layers: string[][] = [];

    // Calculate in-degrees
    for (const prId of this.nodes.keys()) {
      const deps = this.adjacencyList.get(prId);
      inDegree.set(prId, deps?.size || 0);
    }

    // Process layers
    while (inDegree.size > 0) {
      const currentLayer: string[] = [];

      // Find all nodes with in-degree 0
      for (const [prId, degree] of inDegree) {
        if (degree === 0) {
          currentLayer.push(prId);
        }
      }

      if (currentLayer.length === 0) {
        // Circular dependency detected
        break;
      }

      // Remove processed nodes and update in-degrees
      for (const prId of currentLayer) {
        inDegree.delete(prId);

        const dependents = this.reverseAdjacencyList.get(prId);
        if (dependents) {
          for (const depId of dependents) {
            const currentDegree = inDegree.get(depId);
            if (currentDegree !== undefined) {
              inDegree.set(depId, currentDegree - 1);
            }
          }
        }
      }

      layers.push(currentLayer);
    }

    return layers;
  }

  /**
   * Estimate completion time based on complexity and parallelism
   */
  estimateCompletion(
    states: Map<string, PRState>,
    agentCount: number
  ): CompletionEstimate {
    // Calculate remaining work
    let totalMinutesRemaining = 0;
    const incompletePRs: string[] = [];

    for (const [prId, node] of this.nodes) {
      const state = states.get(prId);
      if (!state || !this.isCompleted(state)) {
        totalMinutesRemaining += node.estimatedMinutes;
        incompletePRs.push(prId);
      }
    }

    // Calculate critical path for remaining work
    const criticalPath = this.getCriticalPath();
    let criticalPathMinutes = 0;

    for (const prId of criticalPath) {
      const state = states.get(prId);
      if (!state || !this.isCompleted(state)) {
        const node = this.nodes.get(prId);
        if (node) {
          criticalPathMinutes += node.estimatedMinutes;
        }
      }
    }

    // Calculate parallelization factor
    const topologicalOrder = this.getTopologicalOrder();
    let maxParallelism = 0;

    for (const layer of topologicalOrder) {
      const incompleteInLayer = layer.filter((prId) => {
        const state = states.get(prId);
        return !state || !this.isCompleted(state);
      });
      maxParallelism = Math.max(maxParallelism, incompleteInLayer.length);
    }

    const effectiveAgents = Math.min(agentCount, maxParallelism);
    const parallelizationFactor = effectiveAgents > 0 ? effectiveAgents : 1;

    // Estimate hours remaining (parallel execution)
    // Use the maximum of critical path and parallelized total work
    const parallelizedHours = totalMinutesRemaining / 60 / parallelizationFactor;
    const criticalPathHours = criticalPathMinutes / 60;
    const hoursRemaining = Math.max(parallelizedHours, criticalPathHours);

    // Calculate estimated completion date
    const now = new Date();
    const estimatedDate = new Date(now.getTime() + hoursRemaining * 60 * 60 * 1000);

    return {
      hoursRemaining,
      estimatedDate,
      criticalPathHours,
      parallelizationFactor,
    };
  }

  /**
   * Get all transitive dependencies (recursive)
   */
  getTransitiveDependencies(prId: string): Set<string> {
    const allDeps = new Set<string>();
    const visited = new Set<string>();

    const dfs = (id: string): void => {
      if (visited.has(id)) {
        return;
      }
      visited.add(id);

      const deps = this.getDependencies(id);
      for (const dep of deps) {
        allDeps.add(dep);
        dfs(dep);
      }
    };

    dfs(prId);
    return allDeps;
  }

  /**
   * Get all transitive dependents (recursive)
   */
  getTransitiveDependents(prId: string): Set<string> {
    const allDeps = new Set<string>();
    const visited = new Set<string>();

    const dfs = (id: string): void => {
      if (visited.has(id)) {
        return;
      }
      visited.add(id);

      const deps = this.getDependents(id);
      for (const dep of deps) {
        allDeps.add(dep);
        dfs(dep);
      }
    };

    dfs(prId);
    return allDeps;
  }

  /**
   * Check if a PR state is completed
   */
  private isCompleted(state: PRState): boolean {
    return state.cold_state === 'completed' || state.cold_state === 'approved';
  }

  /**
   * Check if a PR is in progress
   */
  private isInProgress(state: PRState): boolean {
    return (
      state.hot_state !== undefined ||
      state.cold_state === 'planned' ||
      state.agent_id !== undefined
    );
  }

  /**
   * Get node info
   */
  getNode(prId: string): GraphNode | undefined {
    return this.nodes.get(prId);
  }

  /**
   * Get all nodes
   */
  getAllNodes(): Map<string, GraphNode> {
    return new Map(this.nodes);
  }

  /**
   * Get total PR count
   */
  getTotalCount(): number {
    return this.nodes.size;
  }
}
