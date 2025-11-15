/**
 * OpenAI Cost Adapter
 *
 * Implements cost calculation for OpenAI models.
 */

import {
  CostAdapter,
  LLMProvider,
  ModelPricing,
  UsageMetrics,
  CostLimits,
} from '../../types/cost';

/**
 * Default OpenAI pricing (USD per 1M tokens)
 * Updated as of November 2024
 */
export const OPENAI_PRICING: Required<ModelPricing> = {
  // GPT-4o mini (equivalent to Haiku)
  haiku_input: 0.15,
  haiku_output: 0.60,
  // GPT-4o (equivalent to Sonnet)
  sonnet_input: 2.50,
  sonnet_output: 10.00,
  // GPT-4 Turbo (equivalent to Opus)
  opus_input: 10.00,
  opus_output: 30.00,
};

/**
 * OpenAI model name mapping
 */
const MODEL_TIER_MAP: Record<string, 'haiku' | 'sonnet' | 'opus'> = {
  'gpt-4o-mini': 'haiku',
  'gpt-3.5-turbo': 'haiku',
  'gpt-4o': 'sonnet',
  'gpt-4-turbo': 'opus',
  'gpt-4': 'opus',
};

export class OpenAIAdapter implements CostAdapter {
  provider: LLMProvider = 'openai';
  private pricing: Required<ModelPricing>;

  constructor(customPricing?: ModelPricing) {
    // Use custom pricing if provided, otherwise use defaults
    this.pricing = {
      ...OPENAI_PRICING,
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
    const pricing = this.getModelPricing(model);

    if (!pricing) {
      // Unknown model - use mid-tier pricing as default
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
      return 'gpt-4o-mini';
    } else if (complexity <= 7) {
      return 'gpt-4o';
    } else {
      return 'gpt-4-turbo';
    }
  }

  /**
   * Get model tier from model name
   */
  private getModelTier(model: string): 'haiku' | 'sonnet' | 'opus' {
    // Normalize model name (lowercase)
    const normalized = model.toLowerCase();

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
