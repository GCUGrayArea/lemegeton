/**
 * useProgressMetrics Hook
 *
 * Calculates and provides progress metrics for the dashboard including:
 * - PR counts by state
 * - Completion percentage
 * - Time estimates and critical path
 * - Phase progress
 * - Dependency graph analysis
 */

import { useMemo } from 'react';
import {
  DependencyGraph,
  PRData,
  PRState,
  calculatePhaseProgress,
  PhaseProgress,
} from '../utils/dependencyAnalysis';

export interface ProgressMetrics {
  // Counts by state
  total: number;
  completed: number;
  inProgress: number;
  blocked: number;
  ready: number;
  newPRs: number;
  broken: number;
  approved: number;

  // Completion percentage
  completionPercent: number;

  // Time estimates
  estimatedHoursRemaining: number;
  estimatedCompletionDate: Date | null;
  criticalPathHours: number;
  parallelizationFactor: number;

  // Phase progress
  phaseProgress: PhaseProgress[];

  // Dependency information
  cyclesDetected: string[][];
  readyPRs: string[];
  criticalPath: string[];
  criticalPathCompleted: number;

  // Dependency graph instance (for further analysis)
  dependencyGraph: DependencyGraph | null;
}

interface UseProgressMetricsProps {
  prs: PRData[] | null;
  states: Record<string, PRState> | null;
  velocityPRsPerDay?: number;
}

/**
 * Hook to calculate progress metrics from PR data and states
 */
export function useProgressMetrics({
  prs,
  states,
  velocityPRsPerDay = 2,
}: UseProgressMetricsProps): ProgressMetrics {
  return useMemo(() => {
    // Return empty metrics if no data
    if (!prs || !states) {
      return {
        total: 0,
        completed: 0,
        inProgress: 0,
        blocked: 0,
        ready: 0,
        newPRs: 0,
        broken: 0,
        approved: 0,
        completionPercent: 0,
        estimatedHoursRemaining: 0,
        estimatedCompletionDate: null,
        criticalPathHours: 0,
        parallelizationFactor: 1,
        phaseProgress: [],
        cyclesDetected: [],
        readyPRs: [],
        criticalPath: [],
        criticalPathCompleted: 0,
        dependencyGraph: null,
      };
    }

    // Convert states object to Map
    const statesMap = new Map<string, PRState>(Object.entries(states));

    // Build dependency graph
    const dependencyGraph = new DependencyGraph(prs);

    // Calculate counts
    let total = prs.length;
    let completed = 0;
    let inProgress = 0;
    let blocked = 0;
    let newPRs = 0;
    let broken = 0;
    let approved = 0;

    for (const pr of prs) {
      const state = statesMap.get(pr.pr_id);

      if (!state) {
        newPRs++;
        continue;
      }

      // Count by cold state
      switch (state.coldState) {
        case 'completed':
          completed++;
          break;
        case 'approved':
          approved++;
          completed++; // Approved counts as completed for percentage
          break;
        case 'broken':
          broken++;
          break;
        case 'new':
        case 'ready':
          newPRs++;
          break;
      }

      // Count in-progress (hot states)
      if (state.hotState) {
        inProgress++;
      }

      // Count blocked
      if (dependencyGraph.isBlocked(pr.pr_id, statesMap)) {
        blocked++;
      }
    }

    // Calculate completion percentage
    const completionPercent = total > 0 ? (completed / total) * 100 : 0;

    // Get ready PRs
    const readyPRs = dependencyGraph.getReadyPRs(statesMap);

    // Detect cycles
    const cyclesDetected = dependencyGraph.detectCycles();

    // Get critical path
    const criticalPath = dependencyGraph.getCriticalPath();

    // Count completed PRs in critical path
    const criticalPathCompleted = criticalPath.filter((prId) => {
      const state = statesMap.get(prId);
      return state?.coldState === 'completed' || state?.coldState === 'approved';
    }).length;

    // Calculate completion estimate
    const estimate = dependencyGraph.estimateCompletion(statesMap, velocityPRsPerDay);

    // Calculate phase progress
    const phaseProgress = calculatePhaseProgress(prs, statesMap, dependencyGraph);

    return {
      total,
      completed,
      inProgress,
      blocked,
      ready: readyPRs.length,
      newPRs,
      broken,
      approved,
      completionPercent,
      estimatedHoursRemaining: estimate.hoursRemaining,
      estimatedCompletionDate: estimate.estimatedDate,
      criticalPathHours: estimate.criticalPathHours,
      parallelizationFactor: estimate.parallelizationFactor,
      phaseProgress,
      cyclesDetected,
      readyPRs,
      criticalPath,
      criticalPathCompleted,
      dependencyGraph,
    };
  }, [prs, states, velocityPRsPerDay]);
}
