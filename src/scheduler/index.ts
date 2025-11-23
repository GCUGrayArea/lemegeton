/**
 * MIS Scheduler Module
 *
 * Main entry point for the scheduling system that finds optimal
 * parallel work assignments while respecting dependencies and conflicts.
 */

import {
  PRNode,
  Assignment,
  SchedulerResult,
  SchedulerConfig,
  SchedulerStats,
} from './types';
import { DependencyGraph } from './dependencies';
import { ConflictDetector } from './conflicts';
import { MISScheduler } from './mis';
import { AssignmentManager, AssignmentStrategy, AssignmentConfig } from './assignment';
import { AgentInfo } from '../hub/agentRegistry';

/**
 * Full scheduler configuration
 */
export interface FullSchedulerConfig {
  scheduler?: SchedulerConfig;
  assignment?: AssignmentConfig;
}

/**
 * Main Scheduler class that orchestrates all components
 */
export class Scheduler {
  private dependencyGraph: DependencyGraph;
  private conflictDetector: ConflictDetector;
  private misScheduler: MISScheduler;
  private assignmentManager: AssignmentManager;
  private lastSchedulingResult: SchedulerResult | null = null;

  constructor(config: FullSchedulerConfig = {}) {
    this.dependencyGraph = new DependencyGraph();
    this.conflictDetector = new ConflictDetector();
    this.misScheduler = new MISScheduler(
      this.dependencyGraph,
      this.conflictDetector,
      config.scheduler
    );
    this.assignmentManager = new AssignmentManager(config.assignment);
  }

  /**
   * Initialize scheduler with task list
   */
  async initialize(taskList: import('../parser/types').ParsedTaskList): Promise<void> {
    this.dependencyGraph.buildFromTaskList(taskList);
  }

  /**
   * Schedule work and assign to agents
   */
  async scheduleAndAssign(
    availableAgents: AgentInfo[]
  ): Promise<{
    assignments: Assignment[];
    result: SchedulerResult;
  }> {
    // Find maximum independent set
    const result = this.misScheduler.findMaximumIndependentSet();
    this.lastSchedulingResult = result;

    // Assign work to agents
    const assignments = this.assignmentManager.assignWork(
      result.selectedPRs,
      availableAgents
    );

    // Mark assigned PRs as being worked on
    for (const assignment of assignments) {
      this.dependencyGraph.markWorking(assignment.prId);
    }

    return { assignments, result };
  }

  /**
   * Just find the MIS without assigning
   */
  async findOptimalSet(): Promise<SchedulerResult> {
    const result = this.misScheduler.findMaximumIndependentSet();
    this.lastSchedulingResult = result;
    return result;
  }

  /**
   * Mark a PR as complete
   */
  async markComplete(prId: string): Promise<void> {
    this.dependencyGraph.markComplete(prId);
    this.assignmentManager.completeAssignment(prId);
    this.misScheduler.clearCache(); // Invalidate cache
  }

  /**
   * Mark a PR as failed
   */
  async markFailed(prId: string): Promise<void> {
    this.dependencyGraph.markFailed(prId);
    this.assignmentManager.completeAssignment(prId);
    this.misScheduler.clearCache();
  }

  /**
   * Get available PRs
   */
  getAvailablePRs(): PRNode[] {
    return this.dependencyGraph.getAvailable();
  }

  /**
   * Get PR dependencies
   */
  getDependencies(prId: string): string[] {
    const node = this.dependencyGraph.getNode(prId);
    return node ? Array.from(node.dependencies) : [];
  }

  /**
   * Get PRs that depend on a given PR
   */
  getDependents(prId: string): string[] {
    return this.dependencyGraph.getDependents(prId);
  }

  /**
   * Check if two PRs conflict
   */
  hasConflict(pr1: string, pr2: string): boolean {
    // Ensure conflicts are detected for current graph
    const allNodes = this.dependencyGraph.getAllNodes();
    this.conflictDetector.detectConflicts(allNodes);
    return this.conflictDetector.hasConflict(pr1, pr2);
  }

  /**
   * Get all conflicts for a PR
   */
  getConflicts(prId: string): Set<string> {
    const allNodes = this.dependencyGraph.getAllNodes();
    this.conflictDetector.detectConflicts(allNodes);
    return this.conflictDetector.getConflictingPRs(prId);
  }

  /**
   * Get scheduler statistics
   */
  getStats(): SchedulerStats {
    const graphStats = this.dependencyGraph.getStats();
    const assignmentStats = this.assignmentManager.getStats();
    const lastResult = this.lastSchedulingResult;

    return {
      totalPRs: graphStats.total,
      availablePRs: graphStats.available,
      inProgressPRs: graphStats.inProgress,
      completedPRs: graphStats.completed,
      avgSchedulingTimeMs: lastResult?.schedulingTimeMs || 0,
      maxParallelism: lastResult?.selectedPRs.length || 0,
      currentParallelism: assignmentStats.activeAgents,
      schedulingDecisions: 0, // Would need to track this
    };
  }

  /**
   * Get detailed statistics
   */
  getDetailedStats(): import('./types').DetailedSchedulerStats {
    return {
      scheduler: this.misScheduler.getStats(),
      assignments: this.assignmentManager.getStats(),
      lastResult: this.lastSchedulingResult,
    };
  }

  /**
   * Reset scheduler state
   */
  reset(): void {
    this.dependencyGraph.clear();
    this.conflictDetector.clear();
    this.misScheduler.clearCache();
    this.assignmentManager.clearAssignments();
    this.lastSchedulingResult = null;
  }

  /**
   * Export state for debugging
   */
  exportState(): import('./types').SchedulerStateExport {
    return {
      graph: this.dependencyGraph.toJSON(),
      conflicts: this.conflictDetector.toJSON(),
      assignments: this.assignmentManager.getAssignments(),
      lastResult: this.lastSchedulingResult,
    };
  }
}

// Export all types and classes
export * from './types';
export { DependencyGraph } from './dependencies';
export { ConflictDetector } from './conflicts';
export { MISScheduler } from './mis';
export {
  AssignmentManager,
  AssignmentStrategy,
  AssignmentConfig,
} from './assignment';
export { WorkType, Priority } from './types';