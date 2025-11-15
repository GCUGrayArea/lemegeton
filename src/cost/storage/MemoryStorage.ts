/**
 * In-Memory Cost Storage
 *
 * Simple in-memory implementation of cost storage for testing and development.
 * In production, this would be replaced with a Redis or database implementation.
 */

import { CostMetrics, UsageMetrics } from '../../types/cost';
import { CostStorage } from '../CostController';

export class MemoryStorage implements CostStorage {
  private metrics: CostMetrics[] = [];

  /**
   * Store a cost metric
   */
  async storeCostMetric(metric: CostMetrics): Promise<void> {
    this.metrics.push(metric);
  }

  /**
   * Get usage for a specific PR
   */
  async getPRUsage(prId: string): Promise<UsageMetrics> {
    const prMetrics = this.metrics.filter((m) => m.pr_id === prId);
    return this.aggregateMetrics(prMetrics);
  }

  /**
   * Get usage for a time period
   */
  async getUsageByPeriod(start: Date, end: Date): Promise<UsageMetrics> {
    const periodMetrics = this.metrics.filter(
      (m) => m.timestamp >= start && m.timestamp <= end
    );
    return this.aggregateMetrics(periodMetrics, start, end);
  }

  /**
   * Get usage for current hour
   */
  async getHourlyUsage(): Promise<UsageMetrics> {
    const now = new Date();
    const hourStart = new Date(now);
    hourStart.setMinutes(0, 0, 0);

    return this.getUsageByPeriod(hourStart, now);
  }

  /**
   * Get usage for current day
   */
  async getDailyUsage(): Promise<UsageMetrics> {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);

    return this.getUsageByPeriod(dayStart, now);
  }

  /**
   * Get usage for current month
   */
  async getMonthlyUsage(): Promise<UsageMetrics> {
    const now = new Date();
    const monthStart = new Date(now);
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    return this.getUsageByPeriod(monthStart, now);
  }

  /**
   * Clear all stored metrics (useful for testing)
   */
  clear(): void {
    this.metrics = [];
  }

  /**
   * Get all metrics (useful for testing)
   */
  getAllMetrics(): CostMetrics[] {
    return [...this.metrics];
  }

  /**
   * Aggregate metrics into usage summary
   */
  private aggregateMetrics(
    metrics: CostMetrics[],
    start?: Date,
    end?: Date
  ): UsageMetrics {
    const usage: UsageMetrics = {
      tokens: 0,
      cost: 0,
      api_calls: 0,
    };

    if (start && end) {
      usage.period = { start, end };
    }

    // Aggregate totals
    for (const metric of metrics) {
      usage.tokens += metric.tokens_used;
      usage.cost += metric.estimated_cost;
      usage.api_calls += metric.api_calls;
    }

    // Build by_model breakdown
    const byModel: Record<
      string,
      { tokens: number; cost: number; api_calls: number }
    > = {};

    for (const metric of metrics) {
      if (!byModel[metric.model]) {
        byModel[metric.model] = {
          tokens: 0,
          cost: 0,
          api_calls: 0,
        };
      }

      byModel[metric.model].tokens += metric.tokens_used;
      byModel[metric.model].cost += metric.estimated_cost;
      byModel[metric.model].api_calls += metric.api_calls;
    }

    if (Object.keys(byModel).length > 0) {
      usage.by_model = byModel;
    }

    return usage;
  }
}
