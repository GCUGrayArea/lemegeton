/**
 * Batch Scorer
 *
 * Batch scoring utilities for task list optimization.
 * Analyzes entire task lists and provides statistics.
 */

import { PRMetadata, PRComplexity } from '../types/pr';
import { ComplexityScorer } from './complexityScorer';
import { ModelSelector } from './modelSelection';

/**
 * Batch scoring result with statistics
 */
export interface BatchScoringResult {
  scores: Map<string, PRComplexity>;
  statistics: {
    avgScore: number;
    minScore: number;
    maxScore: number;
    haikuCount: number;
    sonnetCount: number;
    opusCount: number;
    totalEstimatedMinutes: number;
    totalEstimatedCost: number;
  };
}

/**
 * Batch Scorer class
 * Scores multiple PRs and generates statistics
 */
export class BatchScorer {
  private scorer: ComplexityScorer;
  private modelSelector: ModelSelector;

  constructor() {
    this.scorer = new ComplexityScorer();
    this.modelSelector = new ModelSelector();
  }

  /**
   * Score all PRs in a task list
   */
  scoreAll(prs: PRMetadata[]): BatchScoringResult {
    const scores = new Map<string, PRComplexity>();
    let totalScore = 0;
    let minScore = Infinity;
    let maxScore = -Infinity;
    let haikuCount = 0;
    let sonnetCount = 0;
    let opusCount = 0;
    let totalMinutes = 0;
    let totalCost = 0;

    for (const pr of prs) {
      const complexity = this.scorer.score(pr);
      scores.set(pr.pr_id, complexity);

      totalScore += complexity.score;
      minScore = Math.min(minScore, complexity.score);
      maxScore = Math.max(maxScore, complexity.score);
      totalMinutes += complexity.estimated_minutes;

      // Calculate cost for this PR
      totalCost += this.modelSelector.estimateCost(complexity);

      // Count model distributions
      if (complexity.suggested_model === 'haiku') haikuCount++;
      else if (complexity.suggested_model === 'sonnet') sonnetCount++;
      else if (complexity.suggested_model === 'opus') opusCount++;
    }

    return {
      scores,
      statistics: {
        avgScore: prs.length > 0 ? totalScore / prs.length : 0,
        minScore: prs.length > 0 ? minScore : 0,
        maxScore: prs.length > 0 ? maxScore : 0,
        haikuCount,
        sonnetCount,
        opusCount,
        totalEstimatedMinutes: totalMinutes,
        totalEstimatedCost: totalCost,
      },
    };
  }

  /**
   * Get distribution summary for planning
   */
  getDistributionSummary(result: BatchScoringResult): string {
    const { statistics } = result;
    return [
      `Average complexity: ${statistics.avgScore.toFixed(1)}/10`,
      `Range: ${statistics.minScore}-${statistics.maxScore}`,
      `Model distribution:`,
      `  - Haiku (1-3): ${statistics.haikuCount} PRs`,
      `  - Sonnet (4-7): ${statistics.sonnetCount} PRs`,
      `  - Opus (8-10): ${statistics.opusCount} PRs`,
      `Total estimated time: ${(statistics.totalEstimatedMinutes / 60).toFixed(1)} hours`,
      `Total estimated cost: $${statistics.totalEstimatedCost.toFixed(2)}`,
    ].join('\n');
  }

  /**
   * Get PRs by model tier
   */
  getPRsByTier(result: BatchScoringResult, tier: 'haiku' | 'sonnet' | 'opus'): string[] {
    const prIds: string[] = [];
    for (const [prId, complexity] of result.scores) {
      if (complexity.suggested_model === tier) {
        prIds.push(prId);
      }
    }
    return prIds;
  }

  /**
   * Get complexity distribution histogram
   */
  getHistogram(result: BatchScoringResult): Record<number, number> {
    const histogram: Record<number, number> = {};
    for (let i = 1; i <= 10; i++) {
      histogram[i] = 0;
    }

    for (const complexity of result.scores.values()) {
      histogram[complexity.score]++;
    }

    return histogram;
  }

  /**
   * Get cost breakdown by tier
   */
  getCostBreakdown(result: BatchScoringResult): {
    haiku: number;
    sonnet: number;
    opus: number;
    total: number;
  } {
    let haikuCost = 0;
    let sonnetCost = 0;
    let opusCost = 0;

    for (const complexity of result.scores.values()) {
      const cost = this.modelSelector.estimateCost(complexity);
      if (complexity.suggested_model === 'haiku') {
        haikuCost += cost;
      } else if (complexity.suggested_model === 'sonnet') {
        sonnetCost += cost;
      } else {
        opusCost += cost;
      }
    }

    return {
      haiku: haikuCost,
      sonnet: sonnetCost,
      opus: opusCost,
      total: haikuCost + sonnetCost + opusCost,
    };
  }
}
