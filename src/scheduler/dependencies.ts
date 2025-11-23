/**
 * Dependency Graph Analysis
 *
 * Manages the directed acyclic graph (DAG) of PR dependencies,
 * determining which PRs are available for work based on completion status.
 */

import { PRNode, Priority, TraversalOptions, WorkType } from './types';
import { ColdState } from '../types/pr';

/**
 * Dependency graph for PR scheduling
 */
export class DependencyGraph {
  private nodes: Map<string, PRNode> = new Map();
  private completedPRs: Set<string> = new Set();
  private workingPRs: Set<string> = new Set(); // PRs currently being worked on

  /**
   * Add a PR node to the graph
   */
  addNode(node: PRNode): void {
    this.nodes.set(node.id, node);

    // Update state tracking
    if (node.state === 'completed' || node.state === 'approved') {
      this.completedPRs.add(node.id);
    }

    // Ensure bidirectional dependency links
    for (const depId of node.dependencies) {
      const depNode = this.nodes.get(depId);
      if (depNode) {
        depNode.dependents.add(node.id);
      }
    }

    // Update dependents for this node
    for (const dependent of node.dependents) {
      const depNode = this.nodes.get(dependent);
      if (depNode) {
        depNode.dependencies.add(node.id);
      }
    }
  }

  /**
   * Build graph from task list data
   */
  buildFromTaskList(taskList: import('../parser/types').ParsedTaskList): void {
    // Clear existing graph
    this.clear();

    // First pass: create all nodes
    for (const pr of taskList.prs || []) {
      const node: PRNode = {
        id: pr.pr_id,
        title: pr.title || '',
        state: pr.cold_state || 'new',
        dependencies: new Set(pr.dependencies || []),
        dependents: new Set(),
        files: new Set(),
        priority: this.parsePriority(pr.priority),
        complexity: pr.complexity?.score || 1,
        estimatedMinutes: pr.complexity?.estimated_minutes || 10,
        suggestedModel: pr.complexity?.suggested_model,
      };

      // Add estimated files
      if (pr.estimated_files) {
        for (const file of pr.estimated_files) {
          node.files.add(file.path);
        }
      }

      // Add actual files if available
      if (pr.actual_files) {
        for (const file of pr.actual_files) {
          node.files.add(file.path);
        }
      }

      this.nodes.set(node.id, node);
    }

    // Second pass: build dependent relationships
    for (const node of this.nodes.values()) {
      for (const depId of node.dependencies) {
        const depNode = this.nodes.get(depId);
        if (depNode) {
          depNode.dependents.add(node.id);
        }
      }

      // Update state tracking
      if (node.state === 'completed' || node.state === 'approved') {
        this.completedPRs.add(node.id);
      }
    }

    // Validate graph (check for cycles)
    this.validateGraph();
  }

  /**
   * Get all PRs available for work (any work type)
   */
  getAvailable(): PRNode[] {
    const available: PRNode[] = [];

    for (const node of this.nodes.values()) {
      // Skip if already completed/approved or currently being worked on
      if (node.state === 'completed' || node.state === 'approved') {
        continue;
      }

      // Skip if already being worked on
      if (this.workingPRs.has(node.id)) {
        continue;
      }

      // Check if all dependencies are complete
      let allDepsComplete = true;
      for (const depId of node.dependencies) {
        if (!this.completedPRs.has(depId)) {
          allDepsComplete = false;
          break;
        }
      }

      if (allDepsComplete) {
        available.push(node);
      }
    }

    return available;
  }

  /**
   * Get PRs available for a specific type of work
   */
  getAvailableForWorkType(workType: WorkType): PRNode[] {
    const available: PRNode[] = [];

    for (const node of this.nodes.values()) {
      // Skip if already being worked on
      if (this.workingPRs.has(node.id)) {
        continue;
      }

      // Check work type eligibility based on current state
      let eligible = false;

      switch (workType) {
        case WorkType.PLANNING:
          // Planning agents work on 'new' or 'ready' PRs
          eligible = node.state === 'new' || node.state === 'ready';
          break;

        case WorkType.IMPLEMENTATION:
          // Implementation agents work on 'planned' PRs
          eligible = node.state === 'planned';
          break;

        case WorkType.QC:
          // QC agents work on 'completed' PRs
          eligible = node.state === 'completed';
          break;

        case WorkType.REVIEW:
          // Review agents work on 'completed' PRs (similar to QC)
          eligible = node.state === 'completed';
          break;
      }

      if (!eligible) {
        continue;
      }

      // Check if all dependencies are complete (except for QC/Review)
      if (workType !== WorkType.QC && workType !== WorkType.REVIEW) {
        let allDepsComplete = true;
        for (const depId of node.dependencies) {
          if (!this.completedPRs.has(depId)) {
            allDepsComplete = false;
            break;
          }
        }

        if (!allDepsComplete) {
          continue;
        }
      }

      available.push(node);
    }

    return available;
  }

  /**
   * Mark a PR as complete
   */
  markComplete(prId: string): void {
    const node = this.nodes.get(prId);
    if (!node) {
      throw new Error(`PR ${prId} not found in graph`);
    }

    node.state = 'completed';
    this.completedPRs.add(prId);
    this.workingPRs.delete(prId);
  }

  /**
   * Mark a PR as being worked on (for tracking purposes)
   */
  markWorking(prId: string): void {
    const node = this.nodes.get(prId);
    if (!node) {
      throw new Error(`PR ${prId} not found in graph`);
    }

    // Don't change the cold state - just track that it's being worked on
    this.workingPRs.add(prId);
  }

  /**
   * Mark a PR as no longer being worked on
   */
  markNotWorking(prId: string): void {
    this.workingPRs.delete(prId);
  }

  /**
   * Mark a PR as failed/abandoned
   */
  markFailed(prId: string): void {
    const node = this.nodes.get(prId);
    if (!node) {
      throw new Error(`PR ${prId} not found in graph`);
    }

    // Don't change cold state - just remove from working set
    this.workingPRs.delete(prId);
  }

  /**
   * Get a specific node
   */
  getNode(prId: string): PRNode | undefined {
    return this.nodes.get(prId);
  }

  /**
   * Get all nodes
   */
  getAllNodes(): PRNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get dependency chain for a PR
   */
  getDependencyChain(prId: string): string[] {
    const chain: string[] = [];
    const visited = new Set<string>();

    const traverse = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);

      const node = this.nodes.get(id);
      if (!node) return;

      for (const depId of node.dependencies) {
        traverse(depId);
      }

      chain.push(id);
    };

    traverse(prId);
    return chain;
  }

  /**
   * Get all PRs that depend on a given PR
   */
  getDependents(prId: string): string[] {
    const node = this.nodes.get(prId);
    if (!node) return [];

    const allDependents: Set<string> = new Set();
    const toProcess = [prId];

    while (toProcess.length > 0) {
      const current = toProcess.pop()!;
      const currentNode = this.nodes.get(current);
      if (!currentNode) continue;

      for (const dependent of currentNode.dependents) {
        if (!allDependents.has(dependent)) {
          allDependents.add(dependent);
          toProcess.push(dependent);
        }
      }
    }

    return Array.from(allDependents);
  }

  /**
   * Check if graph has cycles (invalid state)
   */
  hasCycles(): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycleDFS = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (!node) return false;

      for (const depId of node.dependencies) {
        if (!visited.has(depId)) {
          if (hasCycleDFS(depId)) return true;
        } else if (recursionStack.has(depId)) {
          return true; // Found a cycle
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        if (hasCycleDFS(nodeId)) return true;
      }
    }

    return false;
  }

  /**
   * Validate the graph structure
   */
  private validateGraph(): void {
    // Check for cycles
    if (this.hasCycles()) {
      throw new Error('Dependency graph contains cycles');
    }

    // Check for missing dependencies
    for (const node of this.nodes.values()) {
      for (const depId of node.dependencies) {
        if (!this.nodes.has(depId)) {
          console.warn(`PR ${node.id} depends on unknown PR ${depId}`);
        }
      }
    }
  }

  /**
   * Parse priority from string
   */
  private parsePriority(priority: string | undefined): Priority {
    switch (priority?.toLowerCase()) {
      case 'critical':
        return Priority.CRITICAL;
      case 'high':
        return Priority.HIGH;
      case 'low':
        return Priority.LOW;
      default:
        return Priority.MEDIUM;
    }
  }

  /**
   * Get graph statistics
   */
  getStats(): {
    total: number;
    completed: number;
    inProgress: number;
    available: number;
    blocked: number;
  } {
    const available = this.getAvailable();
    const total = this.nodes.size;
    const completed = this.completedPRs.size;
    const inProgress = this.workingPRs.size;

    return {
      total,
      completed,
      inProgress,
      available: available.length,
      blocked: total - completed - inProgress - available.length,
    };
  }

  /**
   * Clear the graph
   */
  clear(): void {
    this.nodes.clear();
    this.completedPRs.clear();
    this.workingPRs.clear();
  }

  /**
   * Export graph to JSON for debugging
   */
  toJSON(): import('./types').DependencyGraphJSON {
    const nodes: import('./types').SerializedPRNode[] = [];

    for (const node of this.nodes.values()) {
      nodes.push({
        id: node.id,
        title: node.title,
        state: node.state,
        dependencies: Array.from(node.dependencies),
        dependents: Array.from(node.dependents),
        files: Array.from(node.files),
        priority: node.priority,
        complexity: node.complexity,
      });
    }

    return {
      nodes,
      completedPRs: Array.from(this.completedPRs),
      workingPRs: Array.from(this.workingPRs),
    };
  }
}