# Cost Controller

The Cost Controller module provides budget tracking and enforcement for LLM operations in Lemegeton.

## Features

- Multi-provider support (Anthropic, OpenAI, self-hosted)
- Flexible budget limits (tokens, API calls, costs)
- Configurable fallback behaviors (pause, degrade, continue)
- Real-time budget checking and alerts
- Model tier recommendations based on task complexity
- Detailed usage metrics and breakdowns

## Quick Start

```typescript
import {
  CostController,
  AdapterFactory,
  MemoryStorage,
  CostConfig,
} from 'lemegeton';

// Configure cost controller
const config: CostConfig = {
  provider: 'anthropic',
  limits: {
    max_tokens_per_pr: 100000,
    max_cost_per_day: 10.0,
    warning_threshold: 80,
  },
  fallback_behavior: 'pause',
  track_costs: true,
};

// Create adapter and storage
const adapter = AdapterFactory.createAdapter(config.provider);
const storage = new MemoryStorage();

// Initialize controller
const controller = new CostController(config, adapter, storage);
```

## Usage Examples

### Recording Costs

```typescript
// Record cost for an operation
const metric = await controller.recordCost(
  'PR-001',          // PR ID
  'agent-001',       // Agent ID
  'claude-3-5-sonnet', // Model name
  10000,             // Total tokens
  {                  // Token breakdown (optional)
    input: 8000,
    output: 2000,
  },
  'code-generation'  // Operation type (optional)
);
```

### Checking Budget Before Operations

```typescript
// Check if operation should proceed
const result = await controller.checkBudget('PR-001', 5000);

if (result.should_proceed) {
  // Proceed with operation
} else {
  console.log(`Operation blocked: ${result.reason}`);
  console.log(`Recommendation: ${result.recommendation}`);
}
```

### Getting Recommendations

```typescript
// Get model recommendation based on complexity
const recommendation = await controller.getRecommendation(
  'PR-001',    // PR ID
  7,           // Complexity (1-10)
  15           // Number of tasks
);

console.log(`Recommended tier: ${recommendation.model_tier}`);
console.log(`Estimated tokens: ${recommendation.estimated_tokens}`);
console.log(`Estimated cost: $${recommendation.estimated_cost}`);
console.log(`Within budget: ${recommendation.within_budget}`);
```

### Using CostTracker Middleware

```typescript
import { CostTracker } from 'lemegeton';

const tracker = new CostTracker(controller);

// Track an API call automatically
const result = await tracker.trackAPICall(
  {
    prId: 'PR-001',
    agentId: 'agent-001',
    model: 'claude-3-5-sonnet',
    operation: 'code-review',
  },
  async () => {
    // Your API call here
    return {
      data: { message: 'Review complete' },
      usage: {
        input_tokens: 8000,
        output_tokens: 2000,
        total_tokens: 10000,
      },
    };
  }
);
```

## Configuration

### Cost Limits

```typescript
interface CostLimits {
  max_tokens_per_pr?: number;      // Maximum tokens per PR
  max_tokens_per_hour?: number;    // Maximum tokens per hour
  max_api_calls_per_pr?: number;   // Maximum API calls per PR
  max_cost_per_day?: number;       // Maximum cost per day (USD)
  max_cost_per_month?: number;     // Maximum cost per month (USD)
  warning_threshold?: number;      // Warning threshold (percentage)
}
```

### Fallback Behaviors

- `pause`: Stop work when budget limits are reached
- `degrade`: Switch to cheaper models when limits are approached
- `continue`: Keep working but log warnings

### Provider Adapters

#### Anthropic
```typescript
const adapter = new AnthropicAdapter({
  // Optional custom pricing (USD per 1M tokens)
  sonnet_input: 3.0,
  sonnet_output: 15.0,
});
```

#### OpenAI
```typescript
const adapter = new OpenAIAdapter({
  // Optional custom pricing
  sonnet_input: 2.5,
  sonnet_output: 10.0,
});
```

#### Self-Hosted
```typescript
// No costs tracked, but still monitors token usage
const adapter = new SelfHostedAdapter();
```

## Alerts

The controller raises alerts when limits are approached or exceeded:

```typescript
// Get active alerts
const alerts = controller.getAlerts();

alerts.forEach(alert => {
  console.log(`[${alert.severity}] ${alert.message}`);
  console.log(`Usage: ${alert.percentage}%`);
  if (alert.should_pause) {
    console.log('Work should be paused!');
  }
});

// Clear alerts
controller.clearAlerts();
```

## Usage Metrics

```typescript
// Get usage for a specific PR
const usage = await controller.getUsage('PR-001');

console.log(`Tokens: ${usage.tokens}`);
console.log(`Cost: $${usage.cost}`);
console.log(`API calls: ${usage.api_calls}`);

// Breakdown by model
if (usage.by_model) {
  Object.entries(usage.by_model).forEach(([model, stats]) => {
    console.log(`${model}: ${stats.tokens} tokens, $${stats.cost}`);
  });
}
```

## Storage Implementations

### In-Memory Storage (Development/Testing)

```typescript
import { MemoryStorage } from 'lemegeton';

const storage = new MemoryStorage();

// Clear all metrics (useful for testing)
storage.clear();

// Get all metrics
const allMetrics = storage.getAllMetrics();
```

### Custom Storage Implementation

Implement the `CostStorage` interface for production use:

```typescript
interface CostStorage {
  storeCostMetric(metric: CostMetrics): Promise<void>;
  getPRUsage(prId: string): Promise<UsageMetrics>;
  getUsageByPeriod(start: Date, end: Date): Promise<UsageMetrics>;
  getHourlyUsage(): Promise<UsageMetrics>;
  getDailyUsage(): Promise<UsageMetrics>;
  getMonthlyUsage(): Promise<UsageMetrics>;
}
```

## Model Tier Recommendations

The controller automatically recommends model tiers based on complexity:

- **Complexity 1-3**: Haiku tier (fast, cheap)
- **Complexity 4-7**: Sonnet tier (balanced)
- **Complexity 8-10**: Opus tier (powerful)

```typescript
const adapter = new AnthropicAdapter();

// Get recommended model for complexity level
const model = adapter.getRecommendedModel(5);
// Returns: 'claude-3-5-sonnet'
```

## Testing

Run the cost controller tests:

```bash
npm test -- costController.test.ts
```

## Architecture

```
cost/
├── CostController.ts       # Main controller class
├── CostTracker.ts         # Middleware for tracking
├── AdapterFactory.ts      # Creates provider adapters
├── adapters/
│   ├── AnthropicAdapter.ts
│   ├── OpenAIAdapter.ts
│   └── SelfHostedAdapter.ts
├── storage/
│   └── MemoryStorage.ts   # In-memory storage
└── index.ts               # Module exports
```

## Future Enhancements

- Redis-based persistent storage
- Cost forecasting and analytics
- Budget alerts via webhooks/email
- Dynamic pricing updates
- Multi-region pricing support
