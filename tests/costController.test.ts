/**
 * Cost Controller Tests
 */

import {
  CostController,
  CostConfig,
  AnthropicAdapter,
  OpenAIAdapter,
  SelfHostedAdapter,
  MemoryStorage,
  AdapterFactory,
  CostTracker,
  APICallResult,
} from '../src/cost';

describe('CostController', () => {
  let controller: CostController;
  let storage: MemoryStorage;
  let config: CostConfig;

  beforeEach(() => {
    storage = new MemoryStorage();
    config = {
      provider: 'anthropic',
      limits: {
        max_tokens_per_pr: 100000,
        max_tokens_per_hour: 500000,
        max_cost_per_day: 10.0,
        max_cost_per_month: 100.0,
        warning_threshold: 80,
      },
      fallback_behavior: 'pause',
      track_costs: true,
    };

    const adapter = new AnthropicAdapter();
    controller = new CostController(config, adapter, storage);
  });

  describe('Cost Recording', () => {
    it('should record cost metrics', async () => {
      const metric = await controller.recordCost(
        'PR-001',
        'agent-001',
        'claude-3-5-sonnet',
        10000,
        { input: 8000, output: 2000 }
      );

      expect(metric.pr_id).toBe('PR-001');
      expect(metric.agent_id).toBe('agent-001');
      expect(metric.tokens_used).toBe(10000);
      expect(metric.estimated_cost).toBeGreaterThan(0);
    });

    it('should track zero cost for self-hosted models', async () => {
      const selfHostedConfig: CostConfig = {
        provider: 'self-hosted',
        fallback_behavior: 'continue',
        track_costs: false,
      };

      const selfHostedAdapter = new SelfHostedAdapter();
      const selfHostedController = new CostController(
        selfHostedConfig,
        selfHostedAdapter,
        storage
      );

      const metric = await selfHostedController.recordCost(
        'PR-001',
        'agent-001',
        'local-model',
        10000
      );

      expect(metric.estimated_cost).toBe(0);
    });

    it('should store metrics in storage', async () => {
      await controller.recordCost(
        'PR-001',
        'agent-001',
        'claude-3-5-sonnet',
        10000
      );

      const usage = await storage.getPRUsage('PR-001');
      expect(usage.tokens).toBe(10000);
      expect(usage.api_calls).toBe(1);
    });
  });

  describe('Budget Checking', () => {
    it('should allow operations within budget', async () => {
      const result = await controller.checkBudget('PR-001', 5000);

      expect(result.should_proceed).toBe(true);
      expect(result.recommendation).toBe('proceed');
    });

    it('should block operations exceeding token limit', async () => {
      // Record usage near limit
      await controller.recordCost(
        'PR-001',
        'agent-001',
        'claude-3-5-sonnet',
        95000
      );

      // Try to exceed limit
      const result = await controller.checkBudget('PR-001', 10000);

      expect(result.should_proceed).toBe(false);
      expect(result.reason).toContain('limit exceeded');
    });

    it('should warn when approaching limit', async () => {
      // Record usage at 85% of limit (above warning threshold)
      await controller.recordCost(
        'PR-001',
        'agent-001',
        'claude-3-5-sonnet',
        85000
      );

      await controller.checkBudget('PR-001', 1000);

      const alerts = controller.getAlerts();
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].type).toBe('warning');
    });

    it('should respect fallback behavior', async () => {
      // Test pause behavior
      const pauseConfig = { ...config, fallback_behavior: 'pause' as const };
      const pauseAdapter = new AnthropicAdapter();
      const pauseController = new CostController(pauseConfig, pauseAdapter, storage);

      await pauseController.recordCost(
        'PR-001',
        'agent-001',
        'claude-3-5-sonnet',
        95000
      );

      const pauseResult = await pauseController.checkBudget('PR-001', 10000);
      expect(pauseResult.should_proceed).toBe(false);
      expect(pauseResult.recommendation).toBe('pause');

      // Test continue behavior
      storage.clear();
      const continueConfig = { ...config, fallback_behavior: 'continue' as const };
      const continueAdapter = new AnthropicAdapter();
      const continueController = new CostController(
        continueConfig,
        continueAdapter,
        storage
      );

      await continueController.recordCost(
        'PR-001',
        'agent-001',
        'claude-3-5-sonnet',
        95000
      );

      const continueResult = await continueController.checkBudget('PR-001', 10000);
      expect(continueResult.should_proceed).toBe(true);
      expect(continueResult.recommendation).toBe('proceed');
    });

    it('should check hourly limits', async () => {
      // Record usage near hourly limit
      for (let i = 0; i < 10; i++) {
        await controller.recordCost(
          `PR-00${i}`,
          'agent-001',
          'claude-3-5-sonnet',
          50000
        );
      }

      const result = await controller.checkBudget('PR-999', 5000);
      expect(result.should_proceed).toBe(false);
      expect(result.reason).toContain('hourly');
    });
  });

  describe('Cost Recommendations', () => {
    it('should recommend haiku for simple tasks', async () => {
      const rec = await controller.getRecommendation('PR-001', 2, 5);

      expect(rec.model_tier).toBe('haiku');
      expect(rec.within_budget).toBe(true);
      expect(rec.estimated_tokens).toBeGreaterThan(0);
    });

    it('should recommend sonnet for medium complexity', async () => {
      const rec = await controller.getRecommendation('PR-001', 5, 5);

      expect(rec.model_tier).toBe('sonnet');
      expect(rec.within_budget).toBe(true);
    });

    it('should recommend opus for complex tasks', async () => {
      const rec = await controller.getRecommendation('PR-001', 9, 20);

      expect(rec.model_tier).toBe('opus');
      expect(rec.rationale).toContain('Complexity 9');
    });

    it('should indicate when over budget', async () => {
      // Use up most of the budget
      await controller.recordCost(
        'PR-001',
        'agent-001',
        'claude-3-5-sonnet',
        90000
      );

      const rec = await controller.getRecommendation('PR-001', 8, 50);

      expect(rec.within_budget).toBe(false);
    });
  });

  describe('Usage Reporting', () => {
    it('should get usage for specific PR', async () => {
      await controller.recordCost(
        'PR-001',
        'agent-001',
        'claude-3-5-sonnet',
        10000
      );
      await controller.recordCost(
        'PR-001',
        'agent-002',
        'claude-3-5-haiku',
        5000
      );

      const usage = await controller.getUsage('PR-001');

      expect(usage.tokens).toBe(15000);
      expect(usage.api_calls).toBe(2);
      expect(usage.cost).toBeGreaterThan(0);
    });

    it('should break down usage by model', async () => {
      await controller.recordCost(
        'PR-001',
        'agent-001',
        'claude-3-5-sonnet',
        10000
      );
      await controller.recordCost(
        'PR-001',
        'agent-002',
        'claude-3-5-haiku',
        5000
      );

      const usage = await controller.getUsage('PR-001');

      expect(usage.by_model).toBeDefined();
      expect(usage.by_model!['claude-3-5-sonnet'].tokens).toBe(10000);
      expect(usage.by_model!['claude-3-5-haiku'].tokens).toBe(5000);
    });
  });

  describe('Configuration', () => {
    it('should allow config updates', () => {
      controller.updateConfig({
        limits: {
          max_tokens_per_pr: 200000,
        },
      });

      const config = controller.getConfig();
      expect(config.limits?.max_tokens_per_pr).toBe(200000);
    });

    it('should work without limits', async () => {
      const noLimitConfig: CostConfig = {
        provider: 'anthropic',
        fallback_behavior: 'continue',
        track_costs: true,
      };

      const adapter = new AnthropicAdapter();
      const noLimitController = new CostController(noLimitConfig, adapter, storage);

      const result = await noLimitController.checkBudget('PR-001', 1000000);
      expect(result.should_proceed).toBe(true);
    });
  });

  describe('Alerts', () => {
    it('should track alerts', async () => {
      await controller.recordCost(
        'PR-001',
        'agent-001',
        'claude-3-5-sonnet',
        95000
      );

      await controller.checkBudget('PR-001', 10000);

      const alerts = controller.getAlerts();
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].severity).toBe('error');
    });

    it('should clear alerts', async () => {
      await controller.recordCost(
        'PR-001',
        'agent-001',
        'claude-3-5-sonnet',
        95000
      );

      await controller.checkBudget('PR-001', 10000);
      expect(controller.getAlerts().length).toBeGreaterThan(0);

      controller.clearAlerts();
      expect(controller.getAlerts().length).toBe(0);
    });
  });
});

describe('CostAdapters', () => {
  describe('AnthropicAdapter', () => {
    let adapter: AnthropicAdapter;

    beforeEach(() => {
      adapter = new AnthropicAdapter();
    });

    it('should calculate cost with breakdown', () => {
      const cost = adapter.calculateCost(
        10000,
        'claude-3-5-sonnet',
        { input: 8000, output: 2000 }
      );

      // (8000/1M * 3.0) + (2000/1M * 15.0) = 0.024 + 0.030 = 0.054
      expect(cost).toBeCloseTo(0.054, 3);
    });

    it('should calculate cost without breakdown', () => {
      const cost = adapter.calculateCost(10000, 'claude-3-5-sonnet');

      // Should use 80/20 split
      expect(cost).toBeGreaterThan(0);
    });

    it('should identify model tiers correctly', () => {
      expect(adapter.getRecommendedModel(2)).toContain('haiku');
      expect(adapter.getRecommendedModel(5)).toContain('sonnet');
      expect(adapter.getRecommendedModel(9)).toContain('opus');
    });

    it('should get pricing for models', () => {
      const pricing = adapter.getModelPricing('claude-3-5-sonnet');
      expect(pricing).toBeDefined();
      expect(pricing!.input).toBe(3.0);
      expect(pricing!.output).toBe(15.0);
    });

    it('should not be a free model', () => {
      expect(adapter.isFreeModel()).toBe(false);
    });
  });

  describe('OpenAIAdapter', () => {
    let adapter: OpenAIAdapter;

    beforeEach(() => {
      adapter = new OpenAIAdapter();
    });

    it('should calculate cost correctly', () => {
      const cost = adapter.calculateCost(
        10000,
        'gpt-4o',
        { input: 8000, output: 2000 }
      );

      expect(cost).toBeGreaterThan(0);
    });

    it('should map models to tiers', () => {
      expect(adapter.getRecommendedModel(2)).toBe('gpt-4o-mini');
      expect(adapter.getRecommendedModel(5)).toBe('gpt-4o');
      expect(adapter.getRecommendedModel(9)).toBe('gpt-4-turbo');
    });

    it('should not be a free model', () => {
      expect(adapter.isFreeModel()).toBe(false);
    });
  });

  describe('SelfHostedAdapter', () => {
    let adapter: SelfHostedAdapter;

    beforeEach(() => {
      adapter = new SelfHostedAdapter();
    });

    it('should return zero cost', () => {
      const cost = adapter.calculateCost(10000, 'any-model');
      expect(cost).toBe(0);
    });

    it('should return null pricing', () => {
      const pricing = adapter.getModelPricing('any-model');
      expect(pricing).toBeNull();
    });

    it('should be a free model', () => {
      expect(adapter.isFreeModel()).toBe(true);
    });

    it('should check non-cost limits', () => {
      const usage = { tokens: 100000, cost: 0, api_calls: 10 };
      const limits = { max_tokens_per_pr: 50000 };

      expect(adapter.isWithinBudget(usage, limits)).toBe(false);
    });
  });
});

describe('AdapterFactory', () => {
  it('should create Anthropic adapter', () => {
    const adapter = AdapterFactory.createAdapter('anthropic');
    expect(adapter).toBeInstanceOf(AnthropicAdapter);
  });

  it('should create OpenAI adapter', () => {
    const adapter = AdapterFactory.createAdapter('openai');
    expect(adapter).toBeInstanceOf(OpenAIAdapter);
  });

  it('should create self-hosted adapter', () => {
    const adapter = AdapterFactory.createAdapter('self-hosted');
    expect(adapter).toBeInstanceOf(SelfHostedAdapter);
  });

  it('should throw for unknown provider', () => {
    expect(() => {
      AdapterFactory.createAdapter('unknown' as any);
    }).toThrow();
  });
});

describe('CostTracker', () => {
  let tracker: CostTracker;
  let controller: CostController;
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    const config: CostConfig = {
      provider: 'anthropic',
      limits: {
        max_tokens_per_pr: 100000,
      },
      fallback_behavior: 'pause',
      track_costs: true,
    };

    const adapter = new AnthropicAdapter();
    controller = new CostController(config, adapter, storage);
    tracker = new CostTracker(controller);
  });

  describe('API Call Tracking', () => {
    it('should track API call with usage', async () => {
      const mockAPICall = async (): Promise<APICallResult> => {
        return {
          data: { message: 'success' },
          usage: {
            input_tokens: 8000,
            output_tokens: 2000,
            total_tokens: 10000,
          },
        };
      };

      const result = await tracker.trackAPICall(
        {
          prId: 'PR-001',
          agentId: 'agent-001',
          model: 'claude-3-5-sonnet',
          operation: 'test',
        },
        mockAPICall
      );

      expect(result).toEqual({ message: 'success' });

      const usage = await tracker.getUsage('PR-001');
      expect(usage.tokens).toBe(10000);
    });

    it('should block API call when over budget', async () => {
      // Use up the budget
      await controller.recordCost(
        'PR-001',
        'agent-001',
        'claude-3-5-sonnet',
        95000
      );

      const mockAPICall = async (): Promise<APICallResult> => {
        return {
          data: { message: 'success' },
          usage: {
            input_tokens: 8000,
            output_tokens: 2000,
            total_tokens: 10000,
          },
        };
      };

      await expect(
        tracker.trackAPICall(
          {
            prId: 'PR-001',
            agentId: 'agent-001',
            model: 'claude-3-5-sonnet',
          },
          mockAPICall
        )
      ).rejects.toThrow('Budget limit reached');
    });
  });

  describe('Manual Recording', () => {
    it('should manually record cost', async () => {
      await tracker.recordCost('PR-001', 'agent-001', 'claude-3-5-sonnet', 5000);

      const usage = await tracker.getUsage('PR-001');
      expect(usage.tokens).toBe(5000);
    });
  });

  describe('Budget Checking', () => {
    it('should check if can proceed', async () => {
      const canProceed = await tracker.canProceed('PR-001', 5000);
      expect(canProceed).toBe(true);
    });

    it('should return false when over budget', async () => {
      await controller.recordCost(
        'PR-001',
        'agent-001',
        'claude-3-5-sonnet',
        95000
      );

      const canProceed = await tracker.canProceed('PR-001', 10000);
      expect(canProceed).toBe(false);
    });
  });
});

describe('MemoryStorage', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('should store and retrieve metrics', async () => {
    const metric = {
      pr_id: 'PR-001',
      agent_id: 'agent-001',
      model: 'claude-3-5-sonnet',
      tokens_used: 10000,
      estimated_cost: 0.054,
      api_calls: 1,
      timestamp: new Date(),
    };

    await storage.storeCostMetric(metric);

    const usage = await storage.getPRUsage('PR-001');
    expect(usage.tokens).toBe(10000);
    expect(usage.cost).toBeCloseTo(0.054, 3);
  });

  it('should aggregate multiple metrics', async () => {
    await storage.storeCostMetric({
      pr_id: 'PR-001',
      agent_id: 'agent-001',
      model: 'claude-3-5-sonnet',
      tokens_used: 10000,
      estimated_cost: 0.054,
      api_calls: 1,
      timestamp: new Date(),
    });

    await storage.storeCostMetric({
      pr_id: 'PR-001',
      agent_id: 'agent-002',
      model: 'claude-3-5-haiku',
      tokens_used: 5000,
      estimated_cost: 0.010,
      api_calls: 1,
      timestamp: new Date(),
    });

    const usage = await storage.getPRUsage('PR-001');
    expect(usage.tokens).toBe(15000);
    expect(usage.cost).toBeCloseTo(0.064, 3);
    expect(usage.api_calls).toBe(2);
  });

  it('should get usage by time period', async () => {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    await storage.storeCostMetric({
      pr_id: 'PR-001',
      agent_id: 'agent-001',
      model: 'claude-3-5-sonnet',
      tokens_used: 10000,
      estimated_cost: 0.054,
      api_calls: 1,
      timestamp: hourAgo,
    });

    await storage.storeCostMetric({
      pr_id: 'PR-002',
      agent_id: 'agent-001',
      model: 'claude-3-5-sonnet',
      tokens_used: 5000,
      estimated_cost: 0.027,
      api_calls: 1,
      timestamp: twoDaysAgo,
    });

    const dailyUsage = await storage.getDailyUsage();
    expect(dailyUsage.tokens).toBe(10000);

    const allUsage = await storage.getUsageByPeriod(twoDaysAgo, now);
    expect(allUsage.tokens).toBe(15000);
  });

  it('should clear all metrics', async () => {
    await storage.storeCostMetric({
      pr_id: 'PR-001',
      agent_id: 'agent-001',
      model: 'claude-3-5-sonnet',
      tokens_used: 10000,
      estimated_cost: 0.054,
      api_calls: 1,
      timestamp: new Date(),
    });

    storage.clear();

    const usage = await storage.getPRUsage('PR-001');
    expect(usage.tokens).toBe(0);
  });
});
