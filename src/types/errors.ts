/**
 * Unified Error Hierarchy for Lemegeton
 *
 * Provides structured error types with context support for better debugging
 * and error handling across all modules.
 */

/**
 * Error context for structured error information
 */
export interface ErrorContext {
  /** Additional metadata about the error */
  [key: string]: unknown;
}

/**
 * Error codes for categorization
 */
export enum ErrorCode {
  // State errors
  INVALID_STATE = 'INVALID_STATE',
  INVALID_TRANSITION = 'INVALID_TRANSITION',
  STATE_SYNC_FAILED = 'STATE_SYNC_FAILED',

  // Lease errors
  LEASE_CONFLICT = 'LEASE_CONFLICT',
  LEASE_EXPIRED = 'LEASE_EXPIRED',
  LEASE_NOT_FOUND = 'LEASE_NOT_FOUND',

  // Cost errors
  BUDGET_EXCEEDED = 'BUDGET_EXCEEDED',
  RATE_LIMIT = 'RATE_LIMIT',
  COST_TRACKING_FAILED = 'COST_TRACKING_FAILED',

  // Redis errors
  REDIS_CONNECTION_FAILED = 'REDIS_CONNECTION_FAILED',
  REDIS_OPERATION_FAILED = 'REDIS_OPERATION_FAILED',
  REDIS_TIMEOUT = 'REDIS_TIMEOUT',

  // Coordination errors
  MODE_TRANSITION_FAILED = 'MODE_TRANSITION_FAILED',
  COORDINATION_FAILED = 'COORDINATION_FAILED',

  // Agent errors
  AGENT_NOT_FOUND = 'AGENT_NOT_FOUND',
  AGENT_CRASHED = 'AGENT_CRASHED',
  AGENT_TIMEOUT = 'AGENT_TIMEOUT',

  // Configuration errors
  CONFIG_INVALID = 'CONFIG_INVALID',
  CONFIG_NOT_FOUND = 'CONFIG_NOT_FOUND',

  // Generic errors
  UNKNOWN = 'UNKNOWN',
  INTERNAL = 'INTERNAL',
}

/**
 * Base error class for all Lemegeton errors
 *
 * Provides:
 * - Error codes for categorization
 * - Structured context for debugging
 * - Proper stack traces
 * - Serialization support
 */
export class LemegetonError extends Error {
  /** Error code for categorization */
  public readonly code: ErrorCode;

  /** Structured error context */
  public readonly context: ErrorContext;

  /** Timestamp when error occurred */
  public readonly timestamp: Date;

  /** Original error if this wraps another error */
  public readonly cause?: Error;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.UNKNOWN,
    context: ErrorContext = {},
    cause?: Error
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = context;
    this.timestamp = new Date();
    this.cause = cause;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to JSON for logging/serialization
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack,
      cause: this.cause ? {
        name: this.cause.name,
        message: this.cause.message,
        stack: this.cause.stack,
      } : undefined,
    };
  }

  /**
   * Get a human-readable string representation
   */
  toString(): string {
    let str = `${this.name} [${this.code}]: ${this.message}`;

    if (Object.keys(this.context).length > 0) {
      str += `\nContext: ${JSON.stringify(this.context, null, 2)}`;
    }

    if (this.cause) {
      str += `\nCaused by: ${this.cause.message}`;
    }

    return str;
  }
}

/**
 * State machine errors
 */
export class StateError extends LemegetonError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.INVALID_STATE,
    context: ErrorContext = {},
    cause?: Error
  ) {
    super(message, code, context, cause);
  }

  /**
   * Create error for invalid state
   */
  static invalidState(state: string, context: ErrorContext = {}): StateError {
    return new StateError(
      `Invalid state: ${state}`,
      ErrorCode.INVALID_STATE,
      { state, ...context }
    );
  }

  /**
   * Create error for invalid transition
   */
  static invalidTransition(from: string, to: string, context: ErrorContext = {}): StateError {
    return new StateError(
      `Invalid transition: ${from} → ${to}`,
      ErrorCode.INVALID_TRANSITION,
      { from, to, ...context }
    );
  }

  /**
   * Create error for state sync failure
   */
  static syncFailed(reason: string, context: ErrorContext = {}, cause?: Error): StateError {
    return new StateError(
      `State synchronization failed: ${reason}`,
      ErrorCode.STATE_SYNC_FAILED,
      context,
      cause
    );
  }
}

/**
 * Lease management errors
 */
export class LeaseError extends LemegetonError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.LEASE_NOT_FOUND,
    context: ErrorContext = {},
    cause?: Error
  ) {
    super(message, code, context, cause);
  }

  /**
   * Create error for lease conflict
   */
  static conflict(
    file: string,
    holder: string,
    requester: string,
    context: ErrorContext = {}
  ): LeaseError {
    return new LeaseError(
      `Lease conflict on ${file}: held by ${holder}, requested by ${requester}`,
      ErrorCode.LEASE_CONFLICT,
      { file, holder, requester, ...context }
    );
  }

  /**
   * Create error for expired lease
   */
  static expired(file: string, holder: string, context: ErrorContext = {}): LeaseError {
    return new LeaseError(
      `Lease expired: ${file} (holder: ${holder})`,
      ErrorCode.LEASE_EXPIRED,
      { file, holder, ...context }
    );
  }

  /**
   * Create error for lease not found
   */
  static notFound(file: string, context: ErrorContext = {}): LeaseError {
    return new LeaseError(
      `Lease not found: ${file}`,
      ErrorCode.LEASE_NOT_FOUND,
      { file, ...context }
    );
  }
}

/**
 * Cost control errors
 */
export class CostError extends LemegetonError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.COST_TRACKING_FAILED,
    context: ErrorContext = {},
    cause?: Error
  ) {
    super(message, code, context, cause);
  }

  /**
   * Create error for budget exceeded
   */
  static budgetExceeded(
    limit: number,
    current: number,
    context: ErrorContext = {}
  ): CostError {
    return new CostError(
      `Budget exceeded: ${current} > ${limit}`,
      ErrorCode.BUDGET_EXCEEDED,
      { limit, current, ...context }
    );
  }

  /**
   * Create error for rate limit
   */
  static rateLimit(
    operation: string,
    retryAfter?: number,
    context: ErrorContext = {}
  ): CostError {
    const message = retryAfter
      ? `Rate limit exceeded for ${operation}, retry after ${retryAfter}ms`
      : `Rate limit exceeded for ${operation}`;
    return new CostError(
      message,
      ErrorCode.RATE_LIMIT,
      { operation, retryAfter, ...context }
    );
  }
}

/**
 * Redis connection errors
 */
export class RedisError extends LemegetonError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.REDIS_OPERATION_FAILED,
    context: ErrorContext = {},
    cause?: Error
  ) {
    super(message, code, context, cause);
  }

  /**
   * Create error for connection failure
   */
  static connectionFailed(url: string, context: ErrorContext = {}, cause?: Error): RedisError {
    return new RedisError(
      `Redis connection failed: ${url}`,
      ErrorCode.REDIS_CONNECTION_FAILED,
      { url, ...context },
      cause
    );
  }

  /**
   * Create error for operation failure
   */
  static operationFailed(
    operation: string,
    context: ErrorContext = {},
    cause?: Error
  ): RedisError {
    return new RedisError(
      `Redis operation failed: ${operation}`,
      ErrorCode.REDIS_OPERATION_FAILED,
      { operation, ...context },
      cause
    );
  }

  /**
   * Create error for timeout
   */
  static timeout(operation: string, timeoutMs: number, context: ErrorContext = {}): RedisError {
    return new RedisError(
      `Redis operation timeout: ${operation} (${timeoutMs}ms)`,
      ErrorCode.REDIS_TIMEOUT,
      { operation, timeoutMs, ...context }
    );
  }
}

/**
 * Coordination mode errors
 */
export class CoordinationError extends LemegetonError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.COORDINATION_FAILED,
    context: ErrorContext = {},
    cause?: Error
  ) {
    super(message, code, context, cause);
  }

  /**
   * Create error for mode transition failure
   */
  static transitionFailed(
    from: string,
    to: string,
    reason: string,
    context: ErrorContext = {},
    cause?: Error
  ): CoordinationError {
    return new CoordinationError(
      `Mode transition failed: ${from} → ${to}: ${reason}`,
      ErrorCode.MODE_TRANSITION_FAILED,
      { from, to, reason, ...context },
      cause
    );
  }
}

/**
 * Agent lifecycle errors
 */
export class AgentError extends LemegetonError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.INTERNAL,
    context: ErrorContext = {},
    cause?: Error
  ) {
    super(message, code, context, cause);
  }

  /**
   * Create error for agent not found
   */
  static notFound(agentId: string, context: ErrorContext = {}): AgentError {
    return new AgentError(
      `Agent not found: ${agentId}`,
      ErrorCode.AGENT_NOT_FOUND,
      { agentId, ...context }
    );
  }

  /**
   * Create error for agent crash
   */
  static crashed(
    agentId: string,
    reason: string,
    context: ErrorContext = {},
    cause?: Error
  ): AgentError {
    return new AgentError(
      `Agent crashed: ${agentId}: ${reason}`,
      ErrorCode.AGENT_CRASHED,
      { agentId, reason, ...context },
      cause
    );
  }

  /**
   * Create error for agent timeout
   */
  static timeout(
    agentId: string,
    operation: string,
    timeoutMs: number,
    context: ErrorContext = {}
  ): AgentError {
    return new AgentError(
      `Agent timeout: ${agentId} (${operation}, ${timeoutMs}ms)`,
      ErrorCode.AGENT_TIMEOUT,
      { agentId, operation, timeoutMs, ...context }
    );
  }
}

/**
 * Configuration errors
 */
export class ConfigError extends LemegetonError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.CONFIG_INVALID,
    context: ErrorContext = {},
    cause?: Error
  ) {
    super(message, code, context, cause);
  }

  /**
   * Create error for invalid configuration
   */
  static invalid(
    key: string,
    reason: string,
    context: ErrorContext = {}
  ): ConfigError {
    return new ConfigError(
      `Invalid configuration: ${key}: ${reason}`,
      ErrorCode.CONFIG_INVALID,
      { key, reason, ...context }
    );
  }

  /**
   * Create error for missing configuration
   */
  static notFound(key: string, context: ErrorContext = {}): ConfigError {
    return new ConfigError(
      `Configuration not found: ${key}`,
      ErrorCode.CONFIG_NOT_FOUND,
      { key, ...context }
    );
  }
}

/**
 * Type guard for LemegetonError
 */
export function isLemegetonError(error: unknown): error is LemegetonError {
  return error instanceof LemegetonError;
}

/**
 * Extract error code from any error
 */
export function getErrorCode(error: unknown): ErrorCode {
  if (isLemegetonError(error)) {
    return error.code;
  }
  return ErrorCode.UNKNOWN;
}

/**
 * Extract error context from any error
 */
export function getErrorContext(error: unknown): ErrorContext {
  if (isLemegetonError(error)) {
    return error.context;
  }
  return {};
}

/**
 * Wrap an unknown error in a LemegetonError
 */
export function wrapError(
  error: unknown,
  message?: string,
  code: ErrorCode = ErrorCode.INTERNAL,
  context: ErrorContext = {}
): LemegetonError {
  if (isLemegetonError(error)) {
    return error;
  }

  const cause = error instanceof Error ? error : undefined;
  const errorMessage = message || (error instanceof Error ? error.message : String(error));

  return new LemegetonError(errorMessage, code, context, cause);
}
