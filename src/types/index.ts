/**
 * Lemegeton Type Definitions
 *
 * This module exports all type definitions used throughout Lemegeton.
 * Types are organized by domain for clarity and maintainability.
 *
 * ## Architecture Overview
 *
 * Lemegeton coordinates multiple AI coding agents through a hub-and-spoke model:
 * - **Hub**: Central coordinator managing state, scheduling, and agent lifecycle
 * - **Redis**: Ephemeral cache for coordination (reconstructible from git)
 * - **Git**: Source of truth for durable state
 * - **Agents**: Autonomous workers executing PRs without cross-agent communication
 *
 * ## State Model
 *
 * The system uses a hot/cold state model:
 * - **Hot states**: Ephemeral work-in-progress in Redis (investigating, planning, in-progress, under-review)
 * - **Cold states**: Durable checkpoints in git (new, ready, blocked, planned, completed, approved, broken)
 *
 * ## Coordination Modes
 *
 * Three modes ensure productivity even during infrastructure failures:
 * - **Distributed**: Normal operation with shared Redis for pessimistic locking
 * - **Degraded**: Local Redis + git branches when shared Redis unavailable
 * - **Isolated**: Pure local work without Redis when Docker unavailable
 *
 * @module types
 */

// ============================================================================
// PR State Management
// ============================================================================

export type {
  HotState,
  ColdState,
  PRTransition,
  PRState,
  PRComplexity,
  PRMetadata
} from './pr';

// ============================================================================
// Agent Types
// ============================================================================

export type {
  AgentType,
  ModelTier,
  AgentCapabilities,
  AgentState,
  AgentStatus,
  AgentHeartbeat,
  HubToAgentMessage,
  HubMessageType,
  AgentToHubMessage,
  AgentMessageType,
  AgentPoolConfig,
  AgentAllocation
} from './agent';

// ============================================================================
// Coordination and Leases
// ============================================================================

export {
  CoordinationMode
} from './coordination';

export type {
  CoordinationState,
  FileLease,
  LeaseResult,
  LeaseConflict,
  RedisHealth,
  DockerAvailability,
  ModeTransition,
  DegradedBranch,
  IsolatedStateFile
} from './coordination';

// ============================================================================
// Cost Control
// ============================================================================

export type {
  LLMProvider,
  FallbackBehavior,
  CostConfig,
  CostLimits,
  ModelConfig,
  ModelPricing,
  CostMetrics,
  UsageMetrics,
  BudgetCheckResult,
  CostRecommendation,
  CostAlert,
  CostAdapter
} from './cost';

export {
  ANTHROPIC_PRICING
} from './cost';

// ============================================================================
// Prompts
// ============================================================================

export {
  PromptName
} from './prompts';

export type {
  BasePrompt,
  AgentDefaultsPrompt,
  CommitPolicyPrompt,
  CostGuidelinesPrompt,
  PlanningAgentPrompt,
  Prompt
} from './prompts';

export {
  isAgentDefaultsPrompt,
  isCommitPolicyPrompt,
  isCostGuidelinesPrompt,
  isPlanningAgentPrompt
} from './prompts';

// ============================================================================
// Error Hierarchy
// ============================================================================

export {
  ErrorCode
} from './errors';

export type {
  ErrorContext
} from './errors';

export {
  LemegetonError,
  StateError,
  LeaseError,
  CostError,
  RedisError,
  CoordinationError,
  AgentError,
  ConfigError,
  isLemegetonError,
  wrapError
} from './errors';

// Re-export error utilities from both modules
export {
  getErrorCode as getErrorCodeFromGuards,
  getErrorContext
} from './errors';

// ============================================================================
// Type Guards
// ============================================================================

export {
  isHotState,
  isColdState,
  isValidState,
  assertColdState,
  assertHotState,
  isCoordinationMode,
  isNodeError,
  hasStack,
  getErrorMessage,
  getErrorCode
} from './guards';

export type {
  NodeError
} from './guards';

// ============================================================================
// Version
// ============================================================================

/**
 * Lemegeton version.
 * Follows semantic versioning.
 */
export const VERSION = '0.1.0-alpha';

/**
 * Supported state machine version.
 * Used for compatibility checking when loading state.
 */
export const STATE_VERSION = '1.0';
