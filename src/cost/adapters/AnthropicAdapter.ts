/**
 * Anthropic Cost Adapter
 *
 * Implements cost calculation for Anthropic Claude models.
 */

import {
  CostAdapter,
  LLMProvider,
  ModelPricing,
  UsageMetrics,
  CostLimits,
  ANTHROPIC_PRICING,
} from '../../types/cost';

/**
 * Anthropic model name mapping
 */
const MODEL_TIER_MAP: Record<string, 'haiku' | 'sonnet' | 'opus'> = {
  'claude-3-haiku': 'haiku',
  'claude-3-5-haiku': 'haiku',
  'claude-haiku': 'haiku',
  'claude-3-sonnet': 'sonnet',
  'claude-3-5-sonnet': 'sonnet',
  'claude-sonnet': 'sonnet',
  'claude-3-opus': 'opus',
  'claude-opus': 'opus',
  haiku: 'haiku',
  sonnet: 'sonnet',
  opus: 'opus',
};

export class AnthropicAdapter implements CostAdapter {
  provider: LLMProvider = 'anthropic';
  private pricing: Required<ModelPricing>;

  constructor(customPricing?: ModelPricing) {
    // Use custom pricing if provided, otherwise use defaults
    this.pricing = {
      ...ANTHROPIC_PRICING,
      ...customPricing,
    };
  }

  /**
   * Calculate cost for given tokens and model
   */
  calculateCost(
    tokens: number,
    model: string,
    breakdown?: { input: number; output: number }
  ): number {
    const tier = this.getModelTier(model);
    const pricing = this.getModelPricing(model);

    if (!pricing) {
      // Unknown model - use sonnet pricing as default
      return (tokens / 1_000_000) * this.pricing.sonnet_input;
    }

    // If we have breakdown, calculate precisely
    if (breakdown) {
      const inputCost = (breakdown.input / 1_000_000) * pricing.input;
      const outputCost = (breakdown.output / 1_000_000) * pricing.output;
      return inputCost + outputCost;
    }

    // Otherwise, assume 80/20 split (typical for most operations)
    const inputTokens = tokens * 0.8;
    const outputTokens = tokens * 0.2;
    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;

    return inputCost + outputCost;
  }

  /**
   * Get pricing information for a model
   */
  getModelPricing(model: string): { input: number; output: number } | null {
    const tier = this.getModelTier(model);

    switch (tier) {
      case 'haiku':
        return {
          input: this.pricing.haiku_input,
          output: this.pricing.haiku_output,
        };
      case 'sonnet':
        return {
          input: this.pricing.sonnet_input,
          output: this.pricing.sonnet_output,
        };
      case 'opus':
        return {
          input: this.pricing.opus_input,
          output: this.pricing.opus_output,
        };
      default:
        return null;
    }
  }

  /**
   * Check if usage is within budget
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

    // Check cost limits
    if (limits.max_cost_per_day && usage.cost >= limits.max_cost_per_day) {
      return false;
    }

    if (limits.max_cost_per_month && usage.cost >= limits.max_cost_per_month) {
      return false;
    }

    return true;
  }

  /**
   * This is not a free model
   */
  isFreeModel(): boolean {
    return false;
  }

  /**
   * Get recommended model for complexity level
   */
  getRecommendedModel(complexity: number): string {
    if (complexity <= 3) {
      return 'claude-3-5-haiku';
    } else if (complexity <= 7) {
      return 'claude-3-5-sonnet';
    } else {
      return 'claude-3-opus';
    }
  }

  /**
   * Get model tier from model name
   */
  private getModelTier(model: string): 'haiku' | 'sonnet' | 'opus' {
    // Normalize model name (lowercase, remove version numbers)
    const normalized = model.toLowerCase().replace(/-\d+/, '');

    // Check each mapping
    for (const [pattern, tier] of Object.entries(MODEL_TIER_MAP)) {
      if (normalized.includes(pattern)) {
        return tier;
      }
    }

    // Default to sonnet if unknown
    return 'sonnet';
  }
}
