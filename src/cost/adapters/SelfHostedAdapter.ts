/**
 * Self-Hosted/Free Model Cost Adapter
 *
 * Implements cost calculation for self-hosted or free models.
 * No actual costs, but still tracks usage metrics.
 */

import {
  CostAdapter,
  LLMProvider,
  UsageMetrics,
  CostLimits,
} from '../../types/cost';

export class SelfHostedAdapter implements CostAdapter {
  provider: LLMProvider;

  constructor(provider: LLMProvider = 'self-hosted') {
    this.provider = provider;
  }

  /**
   * Calculate cost - always 0 for self-hosted/free models
   */
  calculateCost(
    tokens: number,
    model: string,
    breakdown?: { input: number; output: number }
  ): number {
    return 0;
  }

  /**
   * Get pricing information - always null for free models
   */
  getModelPricing(model: string): { input: number; output: number } | null {
    return null;
  }

  /**
   * Check if usage is within budget
   * For self-hosted, only check non-cost limits
   */
  isWithinBudget(usage: UsageMetrics, limits: CostLimits): boolean {
    // Check token limits
    if (limits.max_tokens_per_pr && usage.tokens >= limits.max_tokens_per_pr) {
      return false;
    }

    if (limits.max_tokens_per_hour && usage.tokens >= limits.max_tokens_per_hour) {
      return false;
    }

    // Check API call limits
    if (limits.max_api_calls_per_pr && usage.api_calls >= limits.max_api_calls_per_pr) {
      return false;
    }

    // Ignore cost limits for free models
    return true;
  }

  /**
   * This is a free model
   */
  isFreeModel(): boolean {
    return true;
  }

  /**
   * Get recommended model for complexity level
   * For self-hosted, return generic model names
   */
  getRecommendedModel(complexity: number): string {
    if (complexity <= 3) {
      return 'small-model';
    } else if (complexity <= 7) {
      return 'medium-model';
    } else {
      return 'large-model';
    }
  }
}
