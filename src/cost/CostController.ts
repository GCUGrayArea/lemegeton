/**
 * Cost Controller
 *
 * Central budget tracking and enforcement system for LLM operations.
 * Monitors token usage and costs against configured limits.
 */

import {
  CostConfig,
  CostLimits,
  CostMetrics,
  UsageMetrics,
  BudgetCheckResult,
  CostRecommendation,
  CostAlert,
  CostAdapter,
  FallbackBehavior,
} from '../types/cost';

/**
 * Storage interface for cost metrics
 */
export interface CostStorage {
  /** Store a cost metric */
  storeCostMetric(metric: CostMetrics): Promise<void>;

  /** Get usage for a specific PR */
  getPRUsage(prId: string): Promise<UsageMetrics>;

  /** Get usage for a time period */
  getUsageByPeriod(start: Date, end: Date): Promise<UsageMetrics>;

  /** Get usage for current hour */
  getHourlyUsage(): Promise<UsageMetrics>;

  /** Get usage for current day */
  getDailyUsage(): Promise<UsageMetrics>;

  /** Get usage for current month */
  getMonthlyUsage(): Promise<UsageMetrics>;
}

/**
 * Main Cost Controller class
 */
export class CostController {
  private config: CostConfig;
  private adapter: CostAdapter;
  private storage: CostStorage;
  private alerts: CostAlert[] = [];

  constructor(
    config: CostConfig,
    adapter: CostAdapter,
    storage: CostStorage
  ) {
    this.config = config;
    this.adapter = adapter;
    this.storage = storage;
  }

  /**
   * Record cost for an operation
   */
  async recordCost(
    prId: string,
    agentId: string,
    model: string,
    tokensUsed: number,
    tokenBreakdown?: { input: number; output: number },
    operation?: string
  ): Promise<CostMetrics> {
    // Calculate cost
    const estimatedCost = this.config.track_costs
      ? this.adapter.calculateCost(tokensUsed, model, tokenBreakdown)
      : 0;

    // Create metric
    const metric: CostMetrics = {
      pr_id: prId,
      agent_id: agentId,
      model,
      tokens_used: tokensUsed,
      token_breakdown: tokenBreakdown ? {
        input_tokens: tokenBreakdown.input,
        output_tokens: tokenBreakdown.output,
      } : undefined,
      estimated_cost: estimatedCost,
      api_calls: 1,
      timestamp: new Date(),
      operation,
    };

    // Store metric
    await this.storage.storeCostMetric(metric);

    return metric;
  }

  /**
   * Check if operation should proceed based on budget limits
   */
  async checkBudget(
    prId: string,
    estimatedTokens: number
  ): Promise<BudgetCheckResult> {
    if (!this.config.limits) {
      // No limits configured - always proceed
      return {
        should_proceed: true,
        current_usage: await this.storage.getPRUsage(prId),
        limits: {},
        recommendation: 'proceed',
      };
    }

    const limits = this.config.limits;
    const currentPRUsage = await this.storage.getPRUsage(prId);
    const hourlyUsage = await this.storage.getHourlyUsage();
    const dailyUsage = await this.storage.getDailyUsage();
    const monthlyUsage = await this.storage.getMonthlyUsage();

    // Check each limit type
    const checks: Array<{
      limit: number | undefined;
      current: number;
      estimated: number;
      type: string;
    }> = [
      {
        limit: limits.max_tokens_per_pr,
        current: currentPRUsage.tokens,
        estimated: estimatedTokens,
        type: 'PR tokens',
      },
      {
        limit: limits.max_tokens_per_hour,
        current: hourlyUsage.tokens,
        estimated: estimatedTokens,
        type: 'hourly tokens',
      },
      {
        limit: limits.max_api_calls_per_pr,
        current: currentPRUsage.api_calls,
        estimated: 1,
        type: 'PR API calls',
      },
    ];

    // Check cost limits (only if tracking costs)
    if (this.config.track_costs) {
      const estimatedCost = this.adapter.calculateCost(estimatedTokens, 'sonnet');

      checks.push(
        {
          limit: limits.max_cost_per_day,
          current: dailyUsage.cost,
          estimated: estimatedCost,
          type: 'daily cost',
        },
        {
          limit: limits.max_cost_per_month,
          current: monthlyUsage.cost,
          estimated: estimatedCost,
          type: 'monthly cost',
        }
      );
    }

    // Find first exceeded limit
    for (const check of checks) {
      if (check.limit !== undefined) {
        const projected = check.current + check.estimated;
        const percentage = (projected / check.limit) * 100;

        // Exceeded limit
        if (projected > check.limit) {
          await this.raiseAlert({
            type: 'exceeded',
            severity: 'error',
            message: `${check.type} limit exceeded: ${projected} > ${check.limit}`,
            current_usage: currentPRUsage,
            limit_value: check.limit,
            percentage,
            timestamp: new Date(),
            should_pause: this.config.fallback_behavior === 'pause',
          });

          return {
            should_proceed: this.config.fallback_behavior === 'continue',
            reason: `${check.type} limit exceeded`,
            current_usage: currentPRUsage,
            limits,
            usage_percentage: percentage,
            recommendation: this.getRecommendationFromBehavior(this.config.fallback_behavior),
          };
        }

        // Approaching limit (warning threshold)
        const warningThreshold = limits.warning_threshold || 80;
        if (percentage >= warningThreshold) {
          await this.raiseAlert({
            type: 'warning',
            severity: 'warning',
            message: `${check.type} approaching limit: ${percentage.toFixed(1)}%`,
            current_usage: currentPRUsage,
            limit_value: check.limit,
            percentage,
            timestamp: new Date(),
            should_pause: false,
          });
        }
      }
    }

    // All checks passed
    return {
      should_proceed: true,
      current_usage: currentPRUsage,
      limits,
      recommendation: 'proceed',
    };
  }

  /**
   * Get cost recommendation for a PR based on complexity
   */
  async getRecommendation(
    prId: string,
    complexity: number,
    taskCount: number
  ): Promise<CostRecommendation> {
    // Estimate tokens needed based on complexity and task count
    // Simple heuristic: base tokens + (complexity * task_count * multiplier)
    const baseTokens = 5000;
    const tokensPerComplexity = 2000;
    const estimatedTokens = baseTokens + (complexity * taskCount * tokensPerComplexity);

    // Get recommended model tier based on complexity
    let modelTier: 'haiku' | 'sonnet' | 'opus';
    if (complexity <= 3) {
      modelTier = 'haiku';
    } else if (complexity <= 7) {
      modelTier = 'sonnet';
    } else {
      modelTier = 'opus';
    }

    // Calculate estimated cost
    const estimatedCost = this.config.track_costs
      ? this.adapter.calculateCost(estimatedTokens, modelTier)
      : 0;

    // Check if within budget
    const budgetCheck = await this.checkBudget(prId, estimatedTokens);
    const withinBudget = budgetCheck.should_proceed;

    // Generate rationale
    let rationale = `Complexity ${complexity} suggests ${modelTier} tier. `;
    rationale += `Estimated ${estimatedTokens.toLocaleString()} tokens across ${taskCount} tasks. `;
    if (this.config.track_costs) {
      rationale += `Projected cost: $${estimatedCost.toFixed(4)}.`;
    }

    // Confidence based on historical data (simplified - could be enhanced)
    const confidence = complexity <= 7 ? 0.85 : 0.7;

    return {
      model_tier: modelTier,
      estimated_cost: estimatedCost,
      estimated_tokens: estimatedTokens,
      confidence,
      rationale,
      within_budget: withinBudget,
    };
  }

  /**
   * Get current usage metrics
   */
  async getUsage(prId?: string): Promise<UsageMetrics> {
    if (prId) {
      return await this.storage.getPRUsage(prId);
    }

    // Return overall usage (daily)
    return await this.storage.getDailyUsage();
  }

  /**
   * Get all active alerts
   */
  getAlerts(): CostAlert[] {
    return [...this.alerts];
  }

  /**
   * Clear alerts
   */
  clearAlerts(): void {
    this.alerts = [];
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CostConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): CostConfig {
    return { ...this.config };
  }

  /**
   * Raise a cost alert
   */
  private async raiseAlert(alert: CostAlert): Promise<void> {
    this.alerts.push(alert);
    // Could also emit event or send notification here
  }

  /**
   * Get recommendation based on fallback behavior
   */
  private getRecommendationFromBehavior(
    behavior: FallbackBehavior
  ): 'proceed' | 'degrade' | 'pause' {
    switch (behavior) {
      case 'continue':
        return 'proceed';
      case 'degrade':
        return 'degrade';
      case 'pause':
        return 'pause';
    }
  }
}
