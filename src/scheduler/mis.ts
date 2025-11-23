/**
 * MIS (Minimum Input Set) Algorithm Implementation
 *
 * Finds the maximum set of PRs that can be worked on in parallel
 * without conflicts, respecting dependencies and priorities.
 */

import { createHash } from 'crypto';
import {
  PRNode,
  Priority,
  SchedulerResult,
  SchedulerConfig,
  WorkType,
} from './types';
import { DependencyGraph } from './dependencies';
import { ConflictDetector } from './conflicts';
import { SimpleCache } from '../utils/cache';
import { mergeConfig } from '../utils/config';

/**
 * Default scheduler configuration
 */
const DEFAULT_CONFIG: Required<SchedulerConfig> = {
  maxSchedulingTime: 100, // 100ms
  enableCaching: true,
  cacheTTL: 30, // 30 seconds
  usePriority: true,
  useComplexity: true,
  maxParallelPRs: 10,
};

/**
 * MIS Scheduler implementation
 */
export class MISScheduler {
  private config: Required<SchedulerConfig>;
  private dependencyGraph: DependencyGraph;
  private conflictDetector: ConflictDetector;
  private resultCache: SimpleCache<string, SchedulerResult>;

  constructor(
    dependencyGraph: DependencyGraph,
    conflictDetector: ConflictDetector,
    config: SchedulerConfig = {}
  ) {
    this.config = mergeConfig(DEFAULT_CONFIG, config);
    this.dependencyGraph = dependencyGraph;
    this.conflictDetector = conflictDetector;
    // Initialize cache with TTL in ms (config.cacheTTL is in seconds)
    this.resultCache = new SimpleCache({ ttl: this.config.cacheTTL * 1000 });
  }

  /**
   * Find the maximum independent set of PRs
   */
  findMaximumIndependentSet(
    availablePRs?: PRNode[],
    workType?: WorkType
  ): SchedulerResult {
    const startTime = Date.now();

    // Get available PRs if not provided
    let available: PRNode[];
    if (availablePRs) {
      available = availablePRs;
    } else if (workType) {
      available = this.dependencyGraph.getAvailableForWorkType(workType);
    } else {
      available = this.dependencyGraph.getAvailable();
    }

    // Check cache if enabled
    if (this.config.enableCaching) {
      const cacheKey = this.getCacheKey(available);
      const cached = this.resultCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Detect conflicts for available PRs
    this.conflictDetector.detectConflicts(available);

    // Sort PRs by priority and complexity
    const sorted = this.sortPRs(available);

    // Run greedy algorithm
    const result = this.greedyMIS(sorted);

    // Add metadata
    result.timestamp = Date.now();
    result.schedulingTimeMs = Date.now() - startTime;

    // Cache result if enabled
    if (this.config.enableCaching) {
      const cacheKey = this.getCacheKey(available);
      this.resultCache.set(cacheKey, result);
    }

    return result;
  }

  /**
   * Greedy algorithm for finding MIS
   */
  private greedyMIS(candidates: PRNode[]): SchedulerResult {
    const selected: PRNode[] = [];
    const blocked: PRNode[] = [];
    const blockReasons = new Map<string, string>();

    // Track which PRs have been selected
    const selectedIds = new Set<string>();

    for (const candidate of candidates) {
      // Check if we've reached max parallel PRs
      if (selected.length >= this.config.maxParallelPRs) {
        blocked.push(candidate);
        blockReasons.set(
          candidate.id,
          `Maximum parallel PRs (${this.config.maxParallelPRs}) reached`
        );
        continue;
      }

      // Check for conflicts with already selected PRs
      let hasConflict = false;
      let conflictingPR = '';

      for (const selectedPR of selected) {
        if (this.conflictDetector.hasConflict(candidate.id, selectedPR.id)) {
          hasConflict = true;
          conflictingPR = selectedPR.id;
          break;
        }
      }

      if (hasConflict) {
        blocked.push(candidate);
        const conflictingFiles = this.conflictDetector.getConflictingFiles(
          candidate.id,
          conflictingPR
        );
        blockReasons.set(
          candidate.id,
          `Conflicts with ${conflictingPR} on files: ${Array.from(conflictingFiles).join(', ')}`
        );
      } else {
        selected.push(candidate);
        selectedIds.add(candidate.id);
      }
    }

    return {
      selectedPRs: selected,
      blockedPRs: blocked,
      blockReasons,
      timestamp: 0, // Will be set by caller
      schedulingTimeMs: 0, // Will be set by caller
    };
  }

  /**
   * Sort PRs by priority and complexity
   */
  private sortPRs(prs: PRNode[]): PRNode[] {
    return [...prs].sort((a, b) => {
      // First sort by priority (if enabled)
      if (this.config.usePriority) {
        const priorityOrder = {
          [Priority.CRITICAL]: 0,
          [Priority.HIGH]: 1,
          [Priority.MEDIUM]: 2,
          [Priority.LOW]: 3,
        };

        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) return priorityDiff;
      }

      // Then sort by complexity (if enabled) - prefer simpler tasks
      if (this.config.useComplexity) {
        const complexityDiff = a.complexity - b.complexity;
        if (complexityDiff !== 0) return complexityDiff;
      }

      // Finally, sort by ID for determinism
      return a.id.localeCompare(b.id);
    });
  }

  /**
   * Alternative: Find MIS using maximal matching (for better optimality)
   */
  findMISMaximal(availablePRs?: PRNode[]): SchedulerResult {
    const startTime = Date.now();
    const available = availablePRs || this.dependencyGraph.getAvailable();

    // Detect conflicts
    this.conflictDetector.detectConflicts(available);

    // Build conflict graph
    const conflictGraph = this.buildConflictGraph(available);

    // Find maximal independent set
    const selected = this.maximalIndependentSet(available, conflictGraph);

    // Identify blocked PRs
    const selectedIds = new Set(selected.map(pr => pr.id));
    const blocked = available.filter(pr => !selectedIds.has(pr.id));
    const blockReasons = new Map<string, string>();

    // Determine block reasons
    for (const blockedPR of blocked) {
      const conflictingPRs = Array.from(selectedIds).filter(id =>
        this.conflictDetector.hasConflict(blockedPR.id, id)
      );

      if (conflictingPRs.length > 0) {
        blockReasons.set(
          blockedPR.id,
          `Conflicts with selected PRs: ${conflictingPRs.join(', ')}`
        );
      } else {
        blockReasons.set(blockedPR.id, 'Not selected by maximal algorithm');
      }
    }

    return {
      selectedPRs: selected,
      blockedPRs: blocked,
      blockReasons,
      timestamp: Date.now(),
      schedulingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Build conflict graph adjacency list
   */
  private buildConflictGraph(nodes: PRNode[]): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();

    // Initialize adjacency list
    for (const node of nodes) {
      graph.set(node.id, new Set());
    }

    // Add edges for conflicts
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (this.conflictDetector.hasConflict(nodes[i].id, nodes[j].id)) {
          graph.get(nodes[i].id)!.add(nodes[j].id);
          graph.get(nodes[j].id)!.add(nodes[i].id);
        }
      }
    }

    return graph;
  }

  /**
   * Find maximal independent set (more optimal than greedy)
   */
  private maximalIndependentSet(
    nodes: PRNode[],
    conflictGraph: Map<string, Set<string>>
  ): PRNode[] {
    // Sort nodes by degree (number of conflicts) - ascending
    const nodesByDegree = [...nodes].sort((a, b) => {
      const degreeA = conflictGraph.get(a.id)?.size || 0;
      const degreeB = conflictGraph.get(b.id)?.size || 0;
      return degreeA - degreeB; // Prefer nodes with fewer conflicts
    });

    const selected = new Set<string>();
    const excluded = new Set<string>();

    for (const node of nodesByDegree) {
      if (excluded.has(node.id)) continue;

      // Check if we can add this node
      let canAdd = true;
      for (const selectedId of selected) {
        if (conflictGraph.get(node.id)?.has(selectedId)) {
          canAdd = false;
          break;
        }
      }

      if (canAdd) {
        selected.add(node.id);
        // Exclude all neighbors
        const neighbors = conflictGraph.get(node.id) || new Set();
        for (const neighbor of neighbors) {
          excluded.add(neighbor);
        }
      }
    }

    // Return selected nodes
    return nodes.filter(node => selected.has(node.id));
  }

  /**
   * Get cache key for a set of available PRs
   * Uses hashing for efficiency with large PR counts
   */
  private getCacheKey(prs: PRNode[]): string {
    // For small PR counts, simple string concatenation is fine
    if (prs.length <= 10) {
      const ids = prs.map(pr => pr.id).sort().join(',');
      return `mis:${ids}`;
    }

    // For larger counts, use hash to avoid creating large cache keys
    const ids = prs.map(pr => pr.id).sort().join(',');
    const hash = createHash('sha256')
      .update(ids)
      .digest('hex')
      .slice(0, 16); // First 16 chars provides good distribution
    return `mis:${hash}`;
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.resultCache.clear();
  }

  /**
   * Get scheduler statistics
   */
  getStats(): import('./types').MISStats {
    const graphStats = this.dependencyGraph.getStats();
    const conflictStats = this.conflictDetector.getStats();

    // Convert graph stats to SchedulerStats format
    const schedulerStats: import('./types').SchedulerStats = {
      totalPRs: graphStats.total,
      availablePRs: graphStats.available,
      inProgressPRs: graphStats.inProgress,
      completedPRs: graphStats.completed,
      avgSchedulingTimeMs: 0, // TODO: Track this metric in future PR
      maxParallelism: this.config.maxParallelPRs,
      currentParallelism: graphStats.inProgress,
      schedulingDecisions: 0, // TODO: Track this metric in future PR
    };

    return {
      graph: schedulerStats,
      conflicts: conflictStats,
      cache: {
        size: this.resultCache.size(),
        enabled: this.config.enableCaching ?? false,
        ttl: this.config.cacheTTL ?? 300,
      },
      config: this.config,
    };
  }
}