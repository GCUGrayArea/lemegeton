/**
 * Cost Control Module
 *
 * Central exports for cost tracking and budget enforcement.
 */

export { CostController, CostStorage } from './CostController';
export { AdapterFactory } from './AdapterFactory';
export { CostTracker, APICallResult, TrackingOptions } from './CostTracker';

// Adapters
export { AnthropicAdapter } from './adapters/AnthropicAdapter';
export { OpenAIAdapter, OPENAI_PRICING } from './adapters/OpenAIAdapter';
export { SelfHostedAdapter } from './adapters/SelfHostedAdapter';

// Storage implementations
export { MemoryStorage } from './storage/MemoryStorage';

// Complexity Scoring (PR-018)
export { ComplexityScorer } from './complexityScorer';
export { KeywordAnalyzer } from './keywords';
export type { KeywordPattern } from './keywords';
export { ModelSelector } from './modelSelection';
export type { ModelConfig as ModelSelectionConfig } from './modelSelection';
export { BatchScorer } from './batchScorer';
export type { BatchScoringResult } from './batchScorer';

// Re-export types for convenience
export type {
  CostConfig,
  CostLimits,
  CostMetrics,
  UsageMetrics,
  BudgetCheckResult,
  CostRecommendation,
  CostAlert,
  CostAdapter,
  LLMProvider,
  FallbackBehavior,
  ModelConfig,
  ModelPricing,
} from '../types/cost';

export { ANTHROPIC_PRICING } from '../types/cost';
