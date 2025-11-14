/**
 * Cost Control Types
 *
 * Defines interfaces for cost tracking and budget enforcement.
 * Tool-agnostic design supports multiple LLM providers.
 */

/**
 * Supported LLM providers.
 */
export type LLMProvider = 'anthropic' | 'openai' | 'self-hosted' | 'opencode';

/**
 * Fallback behavior when budget limits are approached.
 *
 * - pause: Stop work until budget resets
 * - degrade: Switch to cheaper models
 * - continue: Keep working but log warnings
 */
export type FallbackBehavior = 'pause' | 'degrade' | 'continue';

/**
 * Cost controller configuration.
 * Defines budget limits and provider settings.
 */
export interface CostConfig {
  /** LLM provider being used */
  provider: LLMProvider;

  /** Budget limits (all optional) */
  limits?: CostLimits;

  /** Model names for different task types */
  models?: ModelConfig;

  /** What to do when limits are reached */
  fallback_behavior: FallbackBehavior;

  /** Pricing information (per 1M tokens) */
  pricing?: ModelPricing;

  /** Whether to track costs (false for self-hosted) */
  track_costs: boolean;
}

/**
 * Budget limit definitions.
 * All limits are optional and can be combined.
 */
export interface CostLimits {
  /** Maximum tokens per PR */
  max_tokens_per_pr?: number;

  /** Maximum tokens per hour */
  max_tokens_per_hour?: number;

  /** Maximum API calls per PR */
  max_api_calls_per_pr?: number;

  /** Maximum cost per day (USD) */
  max_cost_per_day?: number;

  /** Maximum cost per month (USD) */
  max_cost_per_month?: number;

  /** Warning threshold (percentage of limit) */
  warning_threshold?: number;
}

/**
 * Model configuration for different task complexities.
 */
export interface ModelConfig {
  /** Model for simple tasks (complexity 1-3) */
  simple_tasks?: string;

  /** Model for complex tasks (complexity 4-7) */
  complex_tasks?: string;

  /** Model for review and architecture (complexity 8-10) */
  review_tasks?: string;
}

/**
 * Pricing information per 1 million tokens.
 * Used to calculate costs for cloud providers.
 */
export interface ModelPricing {
  /** Haiku or equivalent - input tokens per 1M */
  haiku_input?: number;

  /** Haiku or equivalent - output tokens per 1M */
  haiku_output?: number;

  /** Sonnet or equivalent - input tokens per 1M */
  sonnet_input?: number;

  /** Sonnet or equivalent - output tokens per 1M */
  sonnet_output?: number;

  /** Opus or equivalent - input tokens per 1M */
  opus_input?: number;

  /** Opus or equivalent - output tokens per 1M */
  opus_output?: number;
}

/**
 * Default Anthropic pricing (USD per 1M tokens).
 * Updated as of November 2024.
 */
export const ANTHROPIC_PRICING: Required<ModelPricing> = {
  haiku_input: 0.25,
  haiku_output: 1.25,
  sonnet_input: 3.0,
  sonnet_output: 15.0,
  opus_input: 15.0,
  opus_output: 75.0
};

/**
 * Cost metrics for a specific operation.
 * Tracked per API call for detailed analysis.
 */
export interface CostMetrics {
  /** PR this cost is associated with */
  pr_id: string;

  /** Agent that incurred this cost */
  agent_id: string;

  /** Model used */
  model: string;

  /** Tokens used (input + output) */
  tokens_used: number;

  /** Breakdown of token usage */
  token_breakdown?: {
    input_tokens: number;
    output_tokens: number;
  };

  /** Estimated cost in USD */
  estimated_cost: number;

  /** Number of API calls */
  api_calls: number;

  /** Timestamp of this metric */
  timestamp: Date;

  /** Operation type (for categorization) */
  operation?: string;
}

/**
 * Aggregated usage metrics.
 * Used for tracking against limits.
 */
export interface UsageMetrics {
  /** Total tokens used */
  tokens: number;

  /** Total cost in USD */
  cost: number;

  /** Total API calls made */
  api_calls: number;

  /** Time period these metrics cover */
  period?: {
    start: Date;
    end: Date;
  };

  /** Breakdown by model tier */
  by_model?: Record<string, {
    tokens: number;
    cost: number;
    api_calls: number;
  }>;
}

/**
 * Budget check result.
 * Returned when checking if operation should proceed.
 */
export interface BudgetCheckResult {
  /** Whether operation should proceed */
  should_proceed: boolean;

  /** Reason if operation blocked */
  reason?: string;

  /** Current usage metrics */
  current_usage: UsageMetrics;

  /** Applicable limits */
  limits: CostLimits;

  /** Percentage of limit consumed */
  usage_percentage?: number;

  /** Recommended action */
  recommendation?: 'proceed' | 'degrade' | 'pause';
}

/**
 * Cost optimization recommendation.
 * Suggests model tier based on complexity and budget.
 */
export interface CostRecommendation {
  /** Recommended model tier */
  model_tier: 'haiku' | 'sonnet' | 'opus';

  /** Estimated cost for this PR */
  estimated_cost: number;

  /** Estimated tokens needed */
  estimated_tokens: number;

  /** Confidence in recommendation (0-1) */
  confidence: number;

  /** Rationale for recommendation */
  rationale: string;

  /** Whether budget allows this tier */
  within_budget: boolean;
}

/**
 * Cost alert configuration.
 * Defines when to notify about cost issues.
 */
export interface CostAlert {
  /** Alert type */
  type: 'warning' | 'limit_reached' | 'exceeded';

  /** Alert severity */
  severity: 'info' | 'warning' | 'error';

  /** Message to display */
  message: string;

  /** Current usage */
  current_usage: UsageMetrics;

  /** Applicable limit */
  limit_value?: number;

  /** Percentage of limit reached */
  percentage?: number;

  /** Timestamp of alert */
  timestamp: Date;

  /** Whether to pause work */
  should_pause: boolean;
}

/**
 * Provider-specific cost adapter interface.
 * Implement this to support different LLM providers.
 */
export interface CostAdapter {
  /** Provider name */
  provider: LLMProvider;

  /** Calculate cost for given tokens and model */
  calculateCost(tokens: number, model: string, breakdown?: { input: number; output: number }): number;

  /** Get pricing information for a model */
  getModelPricing(model: string): { input: number; output: number } | null;

  /** Check if within budget */
  isWithinBudget(usage: UsageMetrics, limits: CostLimits): boolean;

  /** Whether this is a free/self-hosted model */
  isFreeModel(): boolean;

  /** Get recommended model for complexity */
  getRecommendedModel(complexity: number): string;
}
