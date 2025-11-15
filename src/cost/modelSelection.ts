/**
 * Model Selection
 *
 * Model tier selection and cost estimation for intelligent routing.
 */

import { PRComplexity } from '../types/pr';

type ModelTier = 'haiku' | 'sonnet' | 'opus';

/**
 * Model configuration with characteristics
 */
export interface ModelConfig {
  tier: ModelTier;
  name: string;
  tokensPerMinute: number; // Rough estimate
  costPerMillion: number;  // USD per 1M tokens
  characteristics: string[];
}

/**
 * Model Selector class
 * Selects appropriate model tier and estimates costs
 */
export class ModelSelector {
  private models: Record<ModelTier, ModelConfig> = {
    haiku: {
      tier: 'haiku',
      name: 'Claude 3 Haiku',
      tokensPerMinute: 5000,
      costPerMillion: 0.25,
      characteristics: [
        'Fast execution',
        'Good for simple tasks',
        'File creation, basic CRUD',
        'Low cost',
      ],
    },
    sonnet: {
      tier: 'sonnet',
      name: 'Claude 3.5 Sonnet',
      tokensPerMinute: 3000,
      costPerMillion: 3.0,
      characteristics: [
        'Balanced performance',
        'Complex logic and architecture',
        'Algorithm implementation',
        'Moderate cost',
      ],
    },
    opus: {
      tier: 'opus',
      name: 'Claude 3 Opus',
      tokensPerMinute: 2000,
      costPerMillion: 15.0,
      characteristics: [
        'Highest quality',
        'Critical reviews',
        'Complex refactoring',
        'High cost',
      ],
    },
  };

  /**
   * Select model based on complexity score
   */
  select(score: number): ModelConfig {
    if (score <= 3) return this.models.haiku;
    if (score <= 7) return this.models.sonnet;
    return this.models.opus;
  }

  /**
   * Get model configuration
   */
  getModel(tier: ModelTier): ModelConfig {
    return this.models[tier];
  }

  /**
   * Estimate cost for a PR
   */
  estimateCost(complexity: PRComplexity): number {
    const model = this.models[complexity.suggested_model];
    const estimatedTokens = complexity.estimated_minutes * model.tokensPerMinute;
    return (estimatedTokens / 1_000_000) * model.costPerMillion;
  }

  /**
   * Get fallback model if preferred unavailable
   */
  getFallback(tier: ModelTier): ModelTier {
    // If requested model unavailable, fall back to Sonnet (balanced)
    // In real implementation, could have smarter fallback logic
    if (tier === 'opus') return 'sonnet';
    if (tier === 'haiku') return 'sonnet';
    return 'sonnet';
  }

  /**
   * Get all available models
   */
  getAvailableModels(): ModelConfig[] {
    return Object.values(this.models);
  }

  /**
   * Update model pricing (for custom configurations)
   */
  updatePricing(tier: ModelTier, costPerMillion: number): void {
    this.models[tier].costPerMillion = costPerMillion;
  }

  /**
   * Update model characteristics (for custom configurations)
   */
  updateModel(tier: ModelTier, updates: Partial<ModelConfig>): void {
    this.models[tier] = { ...this.models[tier], ...updates };
  }
}
