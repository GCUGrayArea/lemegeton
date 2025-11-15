/**
 * Error Recovery Manager
 */

import { EventEmitter } from 'events';
import { ErrorCategory, ErrorInfo } from './types';

export type RecoveryAction =
  | { action: 'retry'; delay: number }
  | { action: 'report'; escalate: boolean }
  | { action: 'fail'; cleanup: boolean }
  | { action: 'shutdown' };

export interface RecoveryConfig {
  maxRetries: number;
  retryDelay: number;
  retryBackoff: number;
}

const DEFAULT_CONFIG: RecoveryConfig = {
  maxRetries: 3,
  retryDelay: 1000,
  retryBackoff: 2, // Exponential backoff multiplier
};

export class RecoveryManager extends EventEmitter {
  private config: RecoveryConfig;
  private retryAttempts: Map<string, number> = new Map();

  constructor(config: Partial<RecoveryConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Handle an error and determine recovery action
   */
  async handleError(error: Error, category: ErrorCategory): Promise<RecoveryAction> {
    const errorInfo: ErrorInfo = {
      message: error.message,
      stack: error.stack,
      code: (error as any).code,
      category,
    };

    this.emit('error', errorInfo);

    switch (category) {
      case ErrorCategory.TRANSIENT:
        return this.handleTransientError(error);

      case ErrorCategory.ASSIGNMENT:
        return this.handleAssignmentError(error);

      case ErrorCategory.EXECUTION:
        return this.handleExecutionError(error);

      case ErrorCategory.FATAL:
        return this.handleFatalError(error);

      default:
        return { action: 'fail', cleanup: true };
    }
  }

  /**
   * Retry an operation with exponential backoff
   */
  async retry<T>(
    operation: () => Promise<T>,
    key: string = 'default'
  ): Promise<T> {
    const attempts = this.retryAttempts.get(key) || 0;

    if (attempts >= this.config.maxRetries) {
      this.retryAttempts.delete(key);
      throw new Error(`Max retries (${this.config.maxRetries}) exceeded for ${key}`);
    }

    try {
      const result = await operation();
      this.retryAttempts.delete(key); // Success - clear retry count
      return result;
    } catch (error) {
      this.retryAttempts.set(key, attempts + 1);

      // Calculate backoff delay
      const delay = this.config.retryDelay * Math.pow(this.config.retryBackoff, attempts);

      this.emit('retrying', {
        key,
        attempt: attempts + 1,
        maxRetries: this.config.maxRetries,
        delay,
        error,
      });

      // Wait before retry
      await this.sleep(delay);

      // Recursive retry
      return this.retry(operation, key);
    }
  }

  /**
   * Report failure to Hub
   */
  async reportFailure(error: Error, recoverable: boolean): Promise<void> {
    this.emit('failureReported', {
      error: {
        message: error.message,
        stack: error.stack,
        code: (error as any).code,
      },
      recoverable,
      timestamp: Date.now(),
    });
  }

  /**
   * Attempt recovery after failure
   */
  async recover(): Promise<void> {
    this.emit('recovering');
    // Clear all retry attempts
    this.retryAttempts.clear();
    this.emit('recovered');
  }

  /**
   * Handle transient errors (network issues, temporary failures)
   */
  private handleTransientError(error: Error): RecoveryAction {
    return { action: 'retry', delay: this.config.retryDelay };
  }

  /**
   * Handle assignment errors (invalid work assignment)
   */
  private handleAssignmentError(error: Error): RecoveryAction {
    return { action: 'report', escalate: false };
  }

  /**
   * Handle execution errors (work execution failure)
   */
  private handleExecutionError(error: Error): RecoveryAction {
    return { action: 'fail', cleanup: true };
  }

  /**
   * Handle fatal errors (unrecoverable)
   */
  private handleFatalError(error: Error): RecoveryAction {
    return { action: 'shutdown' };
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get retry statistics
   */
  getStats(): { retryAttempts: Map<string, number> } {
    return {
      retryAttempts: new Map(this.retryAttempts),
    };
  }
}
