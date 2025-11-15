/**
 * Cost Tracker
 *
 * Middleware for tracking costs in agent operations.
 * Wraps API calls and automatically records metrics.
 */

import { CostController } from './CostController';
import { CostMetrics } from '../types/cost';

/**
 * API call result with token usage
 */
export interface APICallResult<T = any> {
  /** The actual result data */
  data: T;
  /** Tokens used in this call */
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

/**
 * Cost tracking options for an operation
 */
export interface TrackingOptions {
  /** PR ID for this operation */
  prId: string;
  /** Agent ID performing the operation */
  agentId: string;
  /** Model being used */
  model: string;
  /** Optional operation description */
  operation?: string;
}

/**
 * Cost Tracker class
 */
export class CostTracker {
  private controller: CostController;

  constructor(controller: CostController) {
    this.controller = controller;
  }

  /**
   * Track cost for an API call
   */
  async trackAPICall<T>(
    options: TrackingOptions,
    apiCall: () => Promise<APICallResult<T>>
  ): Promise<T> {
    // Check budget before making the call
    const budgetCheck = await this.controller.checkBudget(
      options.prId,
      10000 // Estimate - will be updated with actual usage
    );

    if (!budgetCheck.should_proceed) {
      throw new Error(
        `Budget limit reached: ${budgetCheck.reason}. Recommendation: ${budgetCheck.recommendation}`
      );
    }

    // Make the API call
    const result = await apiCall();

    // Record actual usage
    if (result.usage) {
      await this.controller.recordCost(
        options.prId,
        options.agentId,
        options.model,
        result.usage.total_tokens,
        {
          input: result.usage.input_tokens,
          output: result.usage.output_tokens,
        },
        options.operation
      );
    }

    return result.data;
  }

  /**
   * Manually record cost (for operations where automatic tracking isn't possible)
   */
  async recordCost(
    prId: string,
    agentId: string,
    model: string,
    tokensUsed: number,
    tokenBreakdown?: { input: number; output: number },
    operation?: string
  ): Promise<CostMetrics> {
    return await this.controller.recordCost(
      prId,
      agentId,
      model,
      tokensUsed,
      tokenBreakdown,
      operation
    );
  }

  /**
   * Check if we can proceed with an operation
   */
  async canProceed(prId: string, estimatedTokens: number): Promise<boolean> {
    const result = await this.controller.checkBudget(prId, estimatedTokens);
    return result.should_proceed;
  }

  /**
   * Get current usage for a PR
   */
  async getUsage(prId: string) {
    return await this.controller.getUsage(prId);
  }

  /**
   * Get cost recommendation for a PR
   */
  async getRecommendation(prId: string, complexity: number, taskCount: number) {
    return await this.controller.getRecommendation(prId, complexity, taskCount);
  }

  /**
   * Get active alerts
   */
  getAlerts() {
    return this.controller.getAlerts();
  }

  /**
   * Clear alerts
   */
  clearAlerts() {
    this.controller.clearAlerts();
  }
}
