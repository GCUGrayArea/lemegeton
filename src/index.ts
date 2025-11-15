/**
 * Lemegeton - Agent Orchestration Framework for Coding Projects
 *
 * Main entry point for the Lemegeton npm package.
 * Type definitions and additional exports will be added as components are implemented.
 */

import * as pkg from '../package.json';

export const version = pkg.version;

// Cost Control (PR-017)
export {
  CostController,
  CostTracker,
  AdapterFactory,
  AnthropicAdapter,
  OpenAIAdapter,
  SelfHostedAdapter,
  MemoryStorage,
  ANTHROPIC_PRICING,
  OPENAI_PRICING,
} from './cost';

export type {
  CostConfig,
  CostLimits,
  CostMetrics,
  UsageMetrics,
  BudgetCheckResult,
  CostRecommendation,
  CostAlert,
  CostAdapter,
  CostStorage,
  LLMProvider,
  FallbackBehavior,
  ModelConfig,
  ModelPricing,
  APICallResult,
  TrackingOptions,
} from './cost';

// Type exports will be added here as subsequent PRs define interfaces
// For example:
// export type { PRState, PRComplexity, CoordinationMode } from './types';
// export { Hub } from './hub';
// export { Agent } from './agents';
