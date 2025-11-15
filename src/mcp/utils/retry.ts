/**
 * Retry Manager
 *
 * Handles retry logic with exponential backoff for MCP requests.
 */

interface RetryConfig {
  maxAttempts?: number;
  initialDelay?: number;
  backoffMultiplier?: number;
  maxDelay?: number;
}

/**
 * Retry manager for MCP requests
 */
export class RetryManager {
  private maxAttempts: number;
  private initialDelay: number;
  private backoffMultiplier: number;
  private maxDelay: number;

  constructor(config?: RetryConfig) {
    this.maxAttempts = config?.maxAttempts || 3;
    this.initialDelay = config?.initialDelay || 1000;
    this.backoffMultiplier = config?.backoffMultiplier || 2;
    this.maxDelay = config?.maxDelay || 10000;
  }

  /**
   * Execute a function with retry logic
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;
    let delay = this.initialDelay;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        // Don't retry on last attempt
        if (attempt === this.maxAttempts) {
          break;
        }

        // Check if error is retryable
        if (!this.isRetryable(error)) {
          throw error;
        }

        // Wait before retrying
        await this.sleep(delay);

        // Exponential backoff
        delay = Math.min(delay * this.backoffMultiplier, this.maxDelay);
      }
    }

    throw lastError || new Error('Retry failed');
  }

  /**
   * Check if error is retryable
   */
  private isRetryable(error: any): boolean {
    // Network errors are retryable
    if (
      error?.code === 'ECONNREFUSED' ||
      error?.code === 'ETIMEDOUT' ||
      error?.code === 'ENOTFOUND' ||
      error?.code === 'ENETUNREACH'
    ) {
      return true;
    }

    // HTTP 5xx errors are retryable
    if (error?.status >= 500 && error?.status < 600) {
      return true;
    }

    // HTTP 429 (Too Many Requests) is retryable
    if (error?.status === 429) {
      return true;
    }

    // Default: not retryable
    return false;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
