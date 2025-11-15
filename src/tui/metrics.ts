/**
 * Metrics Calculator and Panel
 *
 * Calculates and displays aggregate metrics about PR progress,
 * including completion statistics, time estimates, and complexity distribution.
 */

import { PRData } from '../parser/types';
import { PRState, ColdState, HotState } from '../types/pr';
import { DependencyGraph } from './dependencies';

/**
 * Metrics state
 */
export interface MetricsState {
  // Counts by state
  total: number;
  completed: number;
  inProgress: number;
  blocked: number;
  ready: number;
  new: number;
  broken: number;
  approved: number;

  // Completion percentage
  completionPercent: number;

  // Time estimates
  estimatedHoursRemaining: number;
  estimatedCompletionDate: Date | null;
  criticalPathHours: number;

  // Velocity (PRs per day)
  velocity: number | null;

  // Complexity distribution
  complexityDistribution: {
    haiku: number;
    sonnet: number;
    opus: number;
  };

  // Phase progress
  phaseProgress: Map<
    string,
    {
      total: number;
      completed: number;
      percent: number;
    }
  >;
}

/**
 * Phase metrics
 */
export interface PhaseMetrics {
  phaseName: string;
  total: number;
  completed: number;
  inProgress: number;
  blocked: number;
  percent: number;
  estimatedHours: number;
}

/**
 * Metrics Calculator
 *
 * Calculates aggregate statistics from PR data and states
 */
export class MetricsCalculator {
  private prs: PRData[];
  private states: Map<string, PRState>;
  private dependencyGraph: DependencyGraph;

  constructor(prs: PRData[], states: Map<string, PRState>) {
    this.prs = prs;
    this.states = states;
    this.dependencyGraph = new DependencyGraph(prs);
  }

  /**
   * Calculate all metrics
   */
  calculate(): MetricsState {
    const counts = this.calculateCounts();
    const completion = this.calculateCompletion();
    const estimates = this.calculateTimeEstimates();
    const complexity = this.calculateComplexityDistribution();
    const phases = this.calculatePhaseProgress();

    return {
      ...counts,
      completionPercent: completion,
      estimatedHoursRemaining: estimates.hours,
      estimatedCompletionDate: estimates.date,
      criticalPathHours: estimates.criticalPath,
      velocity: this.calculateVelocity(7), // 7-day window
      complexityDistribution: complexity,
      phaseProgress: phases,
    };
  }

  /**
   * Calculate counts by state
   */
  private calculateCounts(): {
    total: number;
    completed: number;
    inProgress: number;
    blocked: number;
    ready: number;
    new: number;
    broken: number;
    approved: number;
  } {
    const counts = {
      total: this.prs.length,
      completed: 0,
      inProgress: 0,
      blocked: 0,
      ready: 0,
      new: 0,
      broken: 0,
      approved: 0,
    };

    for (const pr of this.prs) {
      const state = this.states.get(pr.pr_id);

      if (!state) {
        counts.new++;
        continue;
      }

      // Check cold state
      switch (state.cold_state) {
        case 'completed':
          counts.completed++;
          break;
        case 'approved':
          counts.approved++;
          counts.completed++; // Count as completed
          break;
        case 'broken':
          counts.broken++;
          break;
        case 'new':
          counts.new++;
          break;
        case 'ready':
          counts.ready++;
          break;
        case 'blocked':
          counts.blocked++;
          break;
      }

      // Check if in progress (has hot state or assigned agent)
      if (state.hot_state || state.agent_id) {
        counts.inProgress++;
      } else if (
        state.cold_state !== 'completed' &&
        state.cold_state !== 'approved' &&
        state.cold_state !== 'broken'
      ) {
        // Check if blocked by dependencies
        if (this.dependencyGraph.isBlocked(pr.pr_id, this.states)) {
          if (state.cold_state !== 'blocked') {
            counts.blocked++;
          }
        } else if (state.cold_state !== 'ready' && state.cold_state !== 'new') {
          counts.ready++;
        }
      }
    }

    return counts;
  }

  /**
   * Calculate completion percentage
   */
  private calculateCompletion(): number {
    if (this.prs.length === 0) {
      return 0;
    }

    let completedCount = 0;

    for (const pr of this.prs) {
      const state = this.states.get(pr.pr_id);
      if (
        state &&
        (state.cold_state === 'completed' || state.cold_state === 'approved')
      ) {
        completedCount++;
      }
    }

    return Math.round((completedCount / this.prs.length) * 100);
  }

  /**
   * Calculate time estimates
   */
  private calculateTimeEstimates(): {
    hours: number;
    date: Date | null;
    criticalPath: number;
  } {
    // Use dependency graph for estimate
    const estimate = this.dependencyGraph.estimateCompletion(this.states, 3); // Assume 3 agents

    return {
      hours: estimate.hoursRemaining,
      date: estimate.estimatedDate,
      criticalPath: estimate.criticalPathHours,
    };
  }

  /**
   * Calculate velocity from recent completions
   */
  calculateVelocity(windowDays: number): number | null {
    // This would require tracking completion timestamps
    // For now, return null (will be implemented when we have historical data)
    return null;
  }

  /**
   * Calculate complexity distribution
   */
  private calculateComplexityDistribution(): {
    haiku: number;
    sonnet: number;
    opus: number;
  } {
    const distribution = {
      haiku: 0,
      sonnet: 0,
      opus: 0,
    };

    for (const pr of this.prs) {
      const model = pr.complexity.suggested_model;
      distribution[model]++;
    }

    return distribution;
  }

  /**
   * Calculate phase progress
   */
  private calculatePhaseProgress(): Map<
    string,
    {
      total: number;
      completed: number;
      percent: number;
    }
  > {
    const phases = new Map<
      string,
      {
        total: number;
        completed: number;
        percent: number;
      }
    >();

    // Extract phase from PR title (e.g., "PR-001: Title" -> "Block 1")
    // This is a simple implementation; could be enhanced with phase metadata
    for (const pr of this.prs) {
      const phase = this.extractPhase(pr.pr_id);

      if (!phases.has(phase)) {
        phases.set(phase, { total: 0, completed: 0, percent: 0 });
      }

      const phaseData = phases.get(phase)!;
      phaseData.total++;

      const state = this.states.get(pr.pr_id);
      if (
        state &&
        (state.cold_state === 'completed' || state.cold_state === 'approved')
      ) {
        phaseData.completed++;
      }

      phaseData.percent =
        phaseData.total > 0
          ? Math.round((phaseData.completed / phaseData.total) * 100)
          : 0;
    }

    return phases;
  }

  /**
   * Get metrics for specific phase
   */
  getPhaseMetrics(phase: string): PhaseMetrics {
    const prsInPhase = this.prs.filter((pr) => this.extractPhase(pr.pr_id) === phase);

    let total = prsInPhase.length;
    let completed = 0;
    let inProgress = 0;
    let blocked = 0;
    let estimatedMinutes = 0;

    for (const pr of prsInPhase) {
      const state = this.states.get(pr.pr_id);

      if (
        state &&
        (state.cold_state === 'completed' || state.cold_state === 'approved')
      ) {
        completed++;
      } else {
        estimatedMinutes += pr.complexity.estimated_minutes;

        if (state?.hot_state || state?.agent_id) {
          inProgress++;
        } else if (this.dependencyGraph.isBlocked(pr.pr_id, this.states)) {
          blocked++;
        }
      }
    }

    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    return {
      phaseName: phase,
      total,
      completed,
      inProgress,
      blocked,
      percent,
      estimatedHours: estimatedMinutes / 60,
    };
  }

  /**
   * Estimate completion date based on velocity
   */
  estimateCompletion(agentCount: number): Date {
    const estimate = this.dependencyGraph.estimateCompletion(this.states, agentCount);
    return estimate.estimatedDate;
  }

  /**
   * Extract phase from PR ID
   * Simple heuristic: PR-001 to PR-013 = Phase 0.1a, etc.
   */
  private extractPhase(prId: string): string {
    const match = prId.match(/PR-(\d+)/);
    if (!match) {
      return 'Unknown';
    }

    const num = parseInt(match[1], 10);

    if (num <= 13) return 'Phase 0.1a';
    if (num <= 16) return 'Phase 0.1b';
    if (num <= 25) return 'Phase 0.2';
    if (num <= 31) return 'Phase 0.3';
    if (num <= 36) return 'Phase 0.4';
    if (num <= 50) return 'Phase 1.0';

    return 'Unknown';
  }

  /**
   * Update states (for real-time updates)
   */
  updateStates(states: Map<string, PRState>): void {
    this.states = states;
  }
}

/**
 * Format metrics for display
 */
export class MetricsFormatter {
  /**
   * Format completion percentage with color
   */
  static formatPercent(percent: number): { text: string; color: string } {
    const color =
      percent >= 75 ? 'green' : percent >= 50 ? 'yellow' : percent >= 25 ? 'orange' : 'red';

    return {
      text: `${percent}%`,
      color,
    };
  }

  /**
   * Format hours remaining
   */
  static formatHours(hours: number): string {
    if (hours < 1) {
      return `${Math.round(hours * 60)}m`;
    } else if (hours < 24) {
      return `${hours.toFixed(1)}h`;
    } else {
      const days = Math.floor(hours / 24);
      const remainingHours = Math.round(hours % 24);
      return `${days}d ${remainingHours}h`;
    }
  }

  /**
   * Format date
   */
  static formatDate(date: Date | null): string {
    if (!date) {
      return 'N/A';
    }

    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

    if (days < 0) {
      return 'Overdue';
    } else if (days === 0) {
      return 'Today';
    } else if (days === 1) {
      return 'Tomorrow';
    } else if (days < 7) {
      return `${days} days`;
    } else {
      return date.toLocaleDateString();
    }
  }

  /**
   * Format velocity
   */
  static formatVelocity(velocity: number | null): string {
    if (velocity === null) {
      return 'N/A';
    }

    return `${velocity.toFixed(1)} PRs/day`;
  }

  /**
   * Create progress bar
   */
  static createProgressBar(percent: number, width: number = 20): string {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;

    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  /**
   * Format metrics as text lines
   */
  static formatMetrics(metrics: MetricsState): string[] {
    const lines: string[] = [];

    lines.push('Metrics:');
    lines.push(`• Total PRs: ${metrics.total}`);
    lines.push(
      `• Completed: ${metrics.completed} (${metrics.completionPercent}%)`
    );
    lines.push(`• In Progress: ${metrics.inProgress}`);
    lines.push(`• Blocked: ${metrics.blocked}`);
    lines.push(`• Ready: ${metrics.ready}`);
    lines.push(`• Remaining: ${metrics.total - metrics.completed}`);

    if (metrics.broken > 0) {
      lines.push(`• Broken: ${metrics.broken}`);
    }

    lines.push('');
    lines.push('Complexity:');
    lines.push(`• Haiku: ${metrics.complexityDistribution.haiku} PRs`);
    lines.push(`• Sonnet: ${metrics.complexityDistribution.sonnet} PRs`);
    lines.push(`• Opus: ${metrics.complexityDistribution.opus} PRs`);

    lines.push('');
    lines.push('Estimates:');
    lines.push(
      `• Hours Remaining: ${this.formatHours(metrics.estimatedHoursRemaining)}`
    );
    lines.push(
      `• Critical Path: ${this.formatHours(metrics.criticalPathHours)}`
    );
    lines.push(
      `• Est. Completion: ${this.formatDate(metrics.estimatedCompletionDate)}`
    );

    if (metrics.velocity !== null) {
      lines.push(`• Velocity: ${this.formatVelocity(metrics.velocity)}`);
    }

    return lines;
  }
}
