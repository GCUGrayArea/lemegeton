# PR-018: Complexity Scorer Implementation Plan

**Version:** 1.0
**Date:** 2025-11-14
**Status:** Ready for Implementation
**Dependencies:** PR-009 (Task List Parser) ✅

---

## Overview

Implement PR complexity scoring system that analyzes PRs and assigns a 1-10 complexity score based on file count, dependencies, and keywords. This score enables intelligent model routing (Haiku for simple tasks, Sonnet for complex tasks, Opus for critical reviews), optimizing cost while maintaining quality.

## Goals

1. Score PRs on 1-10 complexity scale
2. Analyze multiple complexity factors (files, dependencies, keywords)
3. Recommend optimal model tier for each PR
4. Provide rationale for scoring decisions
5. Support future heterogeneous agent pool routing
6. Enable cost optimization through intelligent model selection

## Background

From the PRD:
> **Heterogeneous Agent Pools (Phase 0.3):** Use Haiku for simple tasks (file creation, simple CRUD), Sonnet for complex tasks (architecture, algorithms), Opus for review tasks

The complexity scorer is the foundation for cost optimization, enabling:
- **30%+ cost savings** through appropriate model selection
- Faster execution for simple tasks (Haiku is faster)
- Better quality for complex tasks (Sonnet/Opus provide deeper reasoning)

## Architecture

### Complexity Factors

```typescript
interface PRComplexity {
  score: number;              // 1-10 final score
  estimated_minutes: number;  // Time estimate
  file_count: number;         // Number of files affected
  dependency_count: number;   // Number of PR dependencies
  suggested_model: ModelTier; // 'haiku' | 'sonnet' | 'opus'
  rationale: string;          // Explanation of score
  factors: {
    fileScore: number;        // Contribution from file count
    dependencyScore: number;  // Contribution from dependencies
    keywordScore: number;     // Contribution from keywords
    descriptionScore: number; // Contribution from description analysis
  };
}

type ModelTier = 'haiku' | 'sonnet' | 'opus';
```

### Scoring Algorithm

```
Base Score = 0

File-based scoring:
  + (file_count * 0.5)

Dependency-based scoring:
  + (dependency_count * 1.0)

Keyword-based scoring (additive):
  + 3 if matches: /complex|architect|refactor|algorithm|optimize/i
  + 2 if matches: /performance|security|critical|integration/i
  - 2 if matches: /simple|basic|trivial|minor/i
  - 1 if matches: /typo|formatting|comment|documentation/i

Description length:
  + 1 if description > 500 chars (detailed requirements)

Normalize: clamp(Base Score, 1, 10)

Model recommendation:
  score 1-3: haiku
  score 4-7: sonnet
  score 8-10: opus
```

### Component Diagram

```
┌─────────────────────────────────────────────────────────┐
│              ComplexityScorer                           │
│  - Main scoring orchestrator                            │
│  - Combines all factors                                 │
│  - Normalizes and explains score                        │
└────────┬────────────────────────────────┬──────────────┘
         │                                │
         ▼                                ▼
┌──────────────────────┐      ┌──────────────────────────┐
│  KeywordAnalyzer     │      │  ModelSelector           │
│  - Pattern matching  │      │  - Map score to model    │
│  - Weight keywords   │      │  - Provide fallbacks     │
│  - Explain matches   │      │  - Cost estimation       │
└──────────────────────┘      └──────────────────────────┘
```

## Implementation Strategy

### Phase 1: Core Complexity Scorer (15 minutes)

**File:** `src/cost/complexityScorer.ts`

Main complexity scoring logic:

```typescript
import { PR } from '../types/pr';
import { PRComplexity, ModelTier } from '../types/cost';
import { KeywordAnalyzer } from './keywords';

export class ComplexityScorer {
  private keywordAnalyzer: KeywordAnalyzer;

  constructor() {
    this.keywordAnalyzer = new KeywordAnalyzer();
  }

  /**
   * Score a PR's complexity on a 1-10 scale
   */
  score(pr: PR): PRComplexity {
    // Calculate individual factor scores
    const fileScore = this.scoreFiles(pr);
    const dependencyScore = this.scoreDependencies(pr);
    const keywordScore = this.keywordAnalyzer.analyze(pr);
    const descriptionScore = this.scoreDescription(pr);

    // Combine scores
    const rawScore =
      fileScore +
      dependencyScore +
      keywordScore +
      descriptionScore;

    // Normalize to 1-10 range
    const score = Math.max(1, Math.min(10, Math.round(rawScore)));

    // Determine model tier
    const suggested_model = this.selectModel(score);

    // Estimate time (10 minutes per complexity point)
    const estimated_minutes = score * 10;

    // Generate rationale
    const rationale = this.explainScore(pr, {
      fileScore,
      dependencyScore,
      keywordScore,
      descriptionScore,
      score,
    });

    return {
      score,
      estimated_minutes,
      file_count: pr.estimated_files?.length || 0,
      dependency_count: pr.dependencies?.length || 0,
      suggested_model,
      rationale,
      factors: {
        fileScore,
        dependencyScore,
        keywordScore,
        descriptionScore,
      },
    };
  }

  private scoreFiles(pr: PR): number {
    const fileCount = pr.estimated_files?.length || 0;
    return fileCount * 0.5;
  }

  private scoreDependencies(pr: PR): number {
    const depCount = pr.dependencies?.length || 0;
    return depCount * 1.0;
  }

  private scoreDescription(pr: PR): number {
    const description = pr.description || '';
    // Detailed requirements suggest complexity
    return description.length > 500 ? 1 : 0;
  }

  private selectModel(score: number): ModelTier {
    if (score <= 3) return 'haiku';
    if (score <= 7) return 'sonnet';
    return 'opus';
  }

  private explainScore(
    pr: PR,
    factors: {
      fileScore: number;
      dependencyScore: number;
      keywordScore: number;
      descriptionScore: number;
      score: number;
    }
  ): string {
    const parts: string[] = [];

    // File contribution
    if (factors.fileScore > 0) {
      parts.push(
        `${pr.estimated_files?.length || 0} files (${factors.fileScore.toFixed(1)} points)`
      );
    }

    // Dependency contribution
    if (factors.dependencyScore > 0) {
      parts.push(
        `${pr.dependencies?.length || 0} dependencies (${factors.dependencyScore.toFixed(1)} points)`
      );
    }

    // Keyword contribution
    if (factors.keywordScore !== 0) {
      const keywords = this.keywordAnalyzer.getMatches(pr);
      if (factors.keywordScore > 0) {
        parts.push(`complexity keywords: ${keywords.join(', ')} (+${factors.keywordScore})`);
      } else {
        parts.push(`simplicity keywords: ${keywords.join(', ')} (${factors.keywordScore})`);
      }
    }

    // Description contribution
    if (factors.descriptionScore > 0) {
      parts.push('detailed requirements (+1)');
    }

    return `Score ${factors.score}/10: ${parts.join('; ')}`;
  }
}
```

### Phase 2: Keyword Analyzer (15 minutes)

**File:** `src/cost/keywords.ts`

Keyword pattern matching and weighting:

```typescript
import { PR } from '../types/pr';

interface KeywordPattern {
  pattern: RegExp;
  weight: number;
  category: 'complexity' | 'simplicity';
  label: string;
}

export class KeywordAnalyzer {
  private patterns: KeywordPattern[] = [
    // High complexity indicators (+3)
    {
      pattern: /\b(complex|architect|refactor|algorithm|optimize)\b/i,
      weight: 3,
      category: 'complexity',
      label: 'high-complexity',
    },
    // Medium complexity indicators (+2)
    {
      pattern: /\b(performance|security|critical|integration|migration)\b/i,
      weight: 2,
      category: 'complexity',
      label: 'medium-complexity',
    },
    // Simplicity indicators (-2)
    {
      pattern: /\b(simple|basic|trivial|minor|straightforward)\b/i,
      weight: -2,
      category: 'simplicity',
      label: 'simple',
    },
    // Documentation/formatting (-1)
    {
      pattern: /\b(typo|formatting|comment|documentation|docs|readme)\b/i,
      weight: -1,
      category: 'simplicity',
      label: 'documentation',
    },
  ];

  /**
   * Analyze PR description and title for complexity keywords
   */
  analyze(pr: PR): number {
    const text = `${pr.title || ''} ${pr.description || ''}`.toLowerCase();
    let totalScore = 0;

    for (const pattern of this.patterns) {
      if (pattern.pattern.test(text)) {
        totalScore += pattern.weight;
      }
    }

    return totalScore;
  }

  /**
   * Get matched keywords for explanation
   */
  getMatches(pr: PR): string[] {
    const text = `${pr.title || ''} ${pr.description || ''}`.toLowerCase();
    const matches: string[] = [];

    for (const pattern of this.patterns) {
      const match = text.match(pattern.pattern);
      if (match) {
        matches.push(pattern.label);
      }
    }

    return matches;
  }

  /**
   * Add custom keyword pattern (for future extensibility)
   */
  addPattern(pattern: KeywordPattern): void {
    this.patterns.push(pattern);
  }
}
```

### Phase 3: Model Selection (10 minutes)

**File:** `src/cost/modelSelection.ts`

Model tier selection and cost estimation:

```typescript
import { ModelTier, PRComplexity } from '../types/cost';

interface ModelConfig {
  tier: ModelTier;
  name: string;
  tokensPerMinute: number; // Rough estimate
  costPerMillion: number;  // USD per 1M tokens
  characteristics: string[];
}

export class ModelSelector {
  private models: Record<ModelTier, ModelConfig> = {
    haiku: {
      tier: 'haiku',
      name: 'Claude 3 Haiku',
      tokensPerMinute: 5000,
      costPerMillion: 0.25,
      characteristics: [
        'Fast execution',
        'Good for simple tasks',
        'File creation, basic CRUD',
        'Low cost',
      ],
    },
    sonnet: {
      tier: 'sonnet',
      name: 'Claude 3.5 Sonnet',
      tokensPerMinute: 3000,
      costPerMillion: 3.0,
      characteristics: [
        'Balanced performance',
        'Complex logic and architecture',
        'Algorithm implementation',
        'Moderate cost',
      ],
    },
    opus: {
      tier: 'opus',
      name: 'Claude 3 Opus',
      tokensPerMinute: 2000,
      costPerMillion: 15.0,
      characteristics: [
        'Highest quality',
        'Critical reviews',
        'Complex refactoring',
        'High cost',
      ],
    },
  };

  /**
   * Select model based on complexity score
   */
  select(score: number): ModelConfig {
    if (score <= 3) return this.models.haiku;
    if (score <= 7) return this.models.sonnet;
    return this.models.opus;
  }

  /**
   * Get model configuration
   */
  getModel(tier: ModelTier): ModelConfig {
    return this.models[tier];
  }

  /**
   * Estimate cost for a PR
   */
  estimateCost(complexity: PRComplexity): number {
    const model = this.models[complexity.suggested_model];
    const estimatedTokens = complexity.estimated_minutes * model.tokensPerMinute;
    return (estimatedTokens / 1_000_000) * model.costPerMillion;
  }

  /**
   * Get fallback model if preferred unavailable
   */
  getFallback(tier: ModelTier): ModelTier {
    // If requested model unavailable, fall back to Sonnet (balanced)
    // In real implementation, could have smarter fallback logic
    if (tier === 'opus') return 'sonnet';
    if (tier === 'haiku') return 'sonnet';
    return 'sonnet';
  }

  /**
   * Get all available models
   */
  getAvailableModels(): ModelConfig[] {
    return Object.values(this.models);
  }
}
```

### Phase 4: Batch Scoring (5 minutes)

**File:** `src/cost/batchScorer.ts`

Batch scoring for task list optimization:

```typescript
import { PR } from '../types/pr';
import { PRComplexity } from '../types/cost';
import { ComplexityScorer } from './complexityScorer';

export interface BatchScoringResult {
  scores: Map<string, PRComplexity>;
  statistics: {
    avgScore: number;
    minScore: number;
    maxScore: number;
    haikuCount: number;
    sonnetCount: number;
    opusCount: number;
    totalEstimatedMinutes: number;
    totalEstimatedCost: number;
  };
}

export class BatchScorer {
  private scorer: ComplexityScorer;

  constructor() {
    this.scorer = new ComplexityScorer();
  }

  /**
   * Score all PRs in a task list
   */
  scoreAll(prs: PR[]): BatchScoringResult {
    const scores = new Map<string, PRComplexity>();
    let totalScore = 0;
    let minScore = Infinity;
    let maxScore = -Infinity;
    let haikuCount = 0;
    let sonnetCount = 0;
    let opusCount = 0;
    let totalMinutes = 0;

    for (const pr of prs) {
      const complexity = this.scorer.score(pr);
      scores.set(pr.pr_id, complexity);

      totalScore += complexity.score;
      minScore = Math.min(minScore, complexity.score);
      maxScore = Math.max(maxScore, complexity.score);
      totalMinutes += complexity.estimated_minutes;

      // Count model distributions
      if (complexity.suggested_model === 'haiku') haikuCount++;
      else if (complexity.suggested_model === 'sonnet') sonnetCount++;
      else if (complexity.suggested_model === 'opus') opusCount++;
    }

    return {
      scores,
      statistics: {
        avgScore: totalScore / prs.length,
        minScore,
        maxScore,
        haikuCount,
        sonnetCount,
        opusCount,
        totalEstimatedMinutes: totalMinutes,
        totalEstimatedCost: 0, // Calculated separately with ModelSelector
      },
    };
  }

  /**
   * Get distribution summary for planning
   */
  getDistributionSummary(result: BatchScoringResult): string {
    const { statistics } = result;
    return [
      `Average complexity: ${statistics.avgScore.toFixed(1)}/10`,
      `Range: ${statistics.minScore}-${statistics.maxScore}`,
      `Model distribution:`,
      `  - Haiku (1-3): ${statistics.haikuCount} PRs`,
      `  - Sonnet (4-7): ${statistics.sonnetCount} PRs`,
      `  - Opus (8-10): ${statistics.opusCount} PRs`,
      `Total estimated time: ${(statistics.totalEstimatedMinutes / 60).toFixed(1)} hours`,
    ].join('\n');
  }
}
```

### Phase 5: Testing (5 minutes)

**File:** `tests/complexity.test.ts`

Comprehensive test suite:

```typescript
import { ComplexityScorer } from '../src/cost/complexityScorer';
import { KeywordAnalyzer } from '../src/cost/keywords';
import { ModelSelector } from '../src/cost/modelSelection';
import { PR } from '../src/types/pr';

describe('ComplexityScorer', () => {
  let scorer: ComplexityScorer;

  beforeEach(() => {
    scorer = new ComplexityScorer();
  });

  describe('File-based scoring', () => {
    test('scores based on file count', () => {
      const pr: PR = {
        pr_id: 'PR-001',
        title: 'Test PR',
        estimated_files: [
          { path: 'file1.ts', action: 'create' },
          { path: 'file2.ts', action: 'create' },
        ],
        dependencies: [],
      };

      const complexity = scorer.score(pr);
      expect(complexity.file_count).toBe(2);
      expect(complexity.factors.fileScore).toBe(1.0); // 2 * 0.5
    });
  });

  describe('Dependency-based scoring', () => {
    test('scores based on dependency count', () => {
      const pr: PR = {
        pr_id: 'PR-002',
        title: 'Test PR',
        dependencies: ['PR-001', 'PR-003'],
        estimated_files: [],
      };

      const complexity = scorer.score(pr);
      expect(complexity.dependency_count).toBe(2);
      expect(complexity.factors.dependencyScore).toBe(2.0); // 2 * 1.0
    });
  });

  describe('Keyword-based scoring', () => {
    test('increases score for complexity keywords', () => {
      const pr: PR = {
        pr_id: 'PR-003',
        title: 'Complex algorithm optimization',
        description: 'Refactor architecture for performance',
        dependencies: [],
        estimated_files: [],
      };

      const complexity = scorer.score(pr);
      expect(complexity.factors.keywordScore).toBeGreaterThan(0);
      expect(complexity.score).toBeGreaterThan(1);
    });

    test('decreases score for simplicity keywords', () => {
      const pr: PR = {
        pr_id: 'PR-004',
        title: 'Simple typo fix',
        description: 'Basic documentation update',
        dependencies: [],
        estimated_files: [{ path: 'README.md', action: 'modify' }],
      };

      const complexity = scorer.score(pr);
      expect(complexity.factors.keywordScore).toBeLessThan(0);
      expect(complexity.score).toBeLessThanOrEqual(3);
    });
  });

  describe('Model selection', () => {
    test('recommends Haiku for simple tasks', () => {
      const pr: PR = {
        pr_id: 'PR-005',
        title: 'Simple file creation',
        dependencies: [],
        estimated_files: [{ path: 'file.ts', action: 'create' }],
      };

      const complexity = scorer.score(pr);
      expect(complexity.suggested_model).toBe('haiku');
    });

    test('recommends Sonnet for moderate tasks', () => {
      const pr: PR = {
        pr_id: 'PR-006',
        title: 'Implement new feature',
        dependencies: ['PR-001', 'PR-002'],
        estimated_files: [
          { path: 'file1.ts', action: 'create' },
          { path: 'file2.ts', action: 'create' },
          { path: 'file3.ts', action: 'create' },
        ],
      };

      const complexity = scorer.score(pr);
      expect(complexity.suggested_model).toBe('sonnet');
    });

    test('recommends Opus for complex tasks', () => {
      const pr: PR = {
        pr_id: 'PR-007',
        title: 'Complex architectural refactoring',
        description: 'Critical performance optimization with algorithm changes',
        dependencies: ['PR-001', 'PR-002', 'PR-003'],
        estimated_files: Array(10).fill({ path: 'file.ts', action: 'modify' }),
      };

      const complexity = scorer.score(pr);
      expect(complexity.suggested_model).toBe('opus');
    });
  });

  describe('Score normalization', () => {
    test('clamps score to 1-10 range', () => {
      const lowPR: PR = {
        pr_id: 'PR-008',
        title: 'Minimal change',
        dependencies: [],
        estimated_files: [],
      };

      const highPR: PR = {
        pr_id: 'PR-009',
        title: 'Complex refactoring',
        dependencies: Array(20).fill('PR-001'),
        estimated_files: Array(50).fill({ path: 'file.ts', action: 'modify' }),
      };

      const lowComplexity = scorer.score(lowPR);
      const highComplexity = scorer.score(highPR);

      expect(lowComplexity.score).toBeGreaterThanOrEqual(1);
      expect(highComplexity.score).toBeLessThanOrEqual(10);
    });
  });

  describe('Rationale generation', () => {
    test('explains score with contributing factors', () => {
      const pr: PR = {
        pr_id: 'PR-010',
        title: 'Algorithm optimization',
        dependencies: ['PR-001'],
        estimated_files: [
          { path: 'file1.ts', action: 'create' },
          { path: 'file2.ts', action: 'create' },
        ],
      };

      const complexity = scorer.score(pr);
      expect(complexity.rationale).toContain('files');
      expect(complexity.rationale).toContain('dependencies');
    });
  });
});

describe('KeywordAnalyzer', () => {
  let analyzer: KeywordAnalyzer;

  beforeEach(() => {
    analyzer = new KeywordAnalyzer();
  });

  test('detects complexity keywords', () => {
    const pr: PR = {
      pr_id: 'PR-011',
      title: 'Complex architecture refactor',
      dependencies: [],
      estimated_files: [],
    };

    const score = analyzer.analyze(pr);
    expect(score).toBeGreaterThan(0);
  });

  test('detects simplicity keywords', () => {
    const pr: PR = {
      pr_id: 'PR-012',
      title: 'Simple typo fix',
      dependencies: [],
      estimated_files: [],
    };

    const score = analyzer.analyze(pr);
    expect(score).toBeLessThan(0);
  });
});

describe('ModelSelector', () => {
  let selector: ModelSelector;

  beforeEach(() => {
    selector = new ModelSelector();
  });

  test('selects correct model for score', () => {
    expect(selector.select(2).tier).toBe('haiku');
    expect(selector.select(5).tier).toBe('sonnet');
    expect(selector.select(9).tier).toBe('opus');
  });

  test('provides fallback models', () => {
    expect(selector.getFallback('opus')).toBe('sonnet');
    expect(selector.getFallback('haiku')).toBe('sonnet');
  });

  test('estimates cost', () => {
    const complexity: PRComplexity = {
      score: 5,
      estimated_minutes: 50,
      file_count: 3,
      dependency_count: 2,
      suggested_model: 'sonnet',
      rationale: 'Test',
      factors: {
        fileScore: 1.5,
        dependencyScore: 2,
        keywordScore: 0,
        descriptionScore: 0,
      },
    };

    const cost = selector.estimateCost(complexity);
    expect(cost).toBeGreaterThan(0);
  });
});
```

## File Structure

```
src/cost/
├── complexityScorer.ts   # Main scoring logic
├── keywords.ts           # Keyword analysis
├── modelSelection.ts     # Model tier selection
└── batchScorer.ts        # Batch scoring utilities

tests/
└── complexity.test.ts    # Comprehensive tests
```

## Dependencies

### Internal Dependencies

- `src/types/pr.ts` (PR-002) - PR type definitions
- `src/types/cost.ts` (PR-002) - Cost and complexity types
- `src/parser/taskList.ts` (PR-009) - For batch scoring

### No New External Dependencies

All functionality uses standard TypeScript/Node.js libraries.

## Integration Points

### Planning Agent Integration (PR-020)

Planning agent uses complexity scores during task list generation:

```typescript
// In Planning Agent
const scorer = new ComplexityScorer();

for (const pr of generatedPRs) {
  const complexity = scorer.score(pr);
  pr.complexity = complexity;
}
```

### Heterogeneous Pool Manager Integration (PR-019)

Pool manager uses scores to route PRs to appropriate agents:

```typescript
// In Pool Manager
const complexity = pr.complexity;
const pool = this.getPoolForModel(complexity.suggested_model);
const agent = pool.getAvailableAgent();
```

### Hub Integration

Hub can display complexity statistics:

```typescript
// In Hub
const batchScorer = new BatchScorer();
const result = batchScorer.scoreAll(allPRs);
console.log(batchScorer.getDistributionSummary(result));
```

## CLI Integration

Add complexity analysis command:

```typescript
// src/cli/commands/analyze.ts
import { Command } from 'commander';
import { ComplexityScorer } from '../../cost/complexityScorer';
import { TaskListParser } from '../../parser/taskList';

export function createAnalyzeCommand(): Command {
  return new Command('analyze')
    .description('Analyze PR complexity')
    .argument('[pr-id]', 'PR to analyze (or all if omitted)')
    .action(async (prId) => {
      const parser = new TaskListParser();
      const prs = await parser.parse('docs/task-list.md');

      const scorer = new ComplexityScorer();

      if (prId) {
        const pr = prs.find(p => p.pr_id === prId);
        if (!pr) {
          console.error(`PR ${prId} not found`);
          process.exit(1);
        }

        const complexity = scorer.score(pr);
        console.log(`\nComplexity Analysis for ${prId}:`);
        console.log(`  Score: ${complexity.score}/10`);
        console.log(`  Model: ${complexity.suggested_model}`);
        console.log(`  Estimated time: ${complexity.estimated_minutes} minutes`);
        console.log(`  Rationale: ${complexity.rationale}`);
      } else {
        const batchScorer = new BatchScorer();
        const result = batchScorer.scoreAll(prs);
        console.log('\nComplexity Analysis for All PRs:');
        console.log(batchScorer.getDistributionSummary(result));
      }
    });
}
```

## Performance Considerations

### Scoring Performance

- **O(1) per PR:** Scoring is constant time
- **Batch scoring:** Linear with number of PRs
- **No I/O:** All in-memory computation
- **Fast execution:** <1ms per PR

### Memory Usage

- **Minimal:** Only keyword patterns stored
- **No caching needed:** Scoring is cheap enough to recompute

## Success Criteria

- [ ] Scores PRs from 1-10
- [ ] Considers file count, dependencies, keywords
- [ ] Recommends model tier (haiku/sonnet/opus)
- [ ] Provides clear rationale for scores
- [ ] Batch scoring works for entire task list
- [ ] Scoring is consistent and predictable
- [ ] Test coverage >90%
- [ ] Performance: <1ms per PR
- [ ] Integration with Planning Agent ready
- [ ] CLI analyze command works

## Future Enhancements

### Post-PR Improvements

1. **Machine Learning**
   - Train on historical PR data
   - Learn from actual execution times
   - Adjust scoring weights dynamically

2. **Custom Patterns**
   - User-defined keyword patterns
   - Project-specific complexity factors
   - Domain-specific weighting

3. **Advanced Metrics**
   - Code churn prediction
   - Risk assessment
   - Testing complexity

4. **Cost Tracking**
   - Compare estimated vs actual costs
   - Refine cost models
   - Budget forecasting

5. **Visualization**
   - Complexity distribution charts
   - Historical trends
   - Cost optimization suggestions

## Risk Mitigation

### Risk: Inaccurate Scoring

**Mitigation:**
- Conservative scoring (prefer Sonnet when uncertain)
- User can override model selection
- Continuous refinement based on actual execution
- Clear rationale helps users understand scores

### Risk: Keyword Pattern Brittleness

**Mitigation:**
- Multiple keyword categories
- Weight distribution across factors
- Easy to add/modify patterns
- Batch testing against real PRs

### Risk: Model Selection Too Aggressive

**Mitigation:**
- Fallback to Sonnet (balanced model)
- User configuration for model preferences
- Quality monitoring for Haiku-assigned PRs
- Easy to adjust thresholds

## Timeline

- **Phase 1:** Core complexity scorer (15 min)
- **Phase 2:** Keyword analyzer (15 min)
- **Phase 3:** Model selection (10 min)
- **Phase 4:** Batch scoring (5 min)
- **Phase 5:** Testing (5 min)

**Total:** 50 minutes (as estimated in task list)

## Acceptance Criteria

From task list (PR-018):
- [ ] Scores PRs from 1-10
- [ ] Considers file count
- [ ] Analyzes dependencies
- [ ] Keyword analysis works
- [ ] Model recommendations accurate
- [ ] Scoring consistent and predictable

## Example Scoring

### Simple PR (Score: 2, Haiku)
```yaml
pr_id: PR-025
title: Add README documentation
estimated_files:
  - path: README.md
dependencies: []
```
**Score:** 2/10 (Haiku)
**Rationale:** 1 file (0.5 points); documentation keyword (-1); Score 2/10

### Moderate PR (Score: 5, Sonnet)
```yaml
pr_id: PR-026
title: Implement user authentication
estimated_files:
  - path: src/auth/login.ts
  - path: src/auth/register.ts
  - path: tests/auth.test.ts
dependencies: [PR-025]
```
**Score:** 5/10 (Sonnet)
**Rationale:** 3 files (1.5 points); 1 dependency (1 point); Score 5/10

### Complex PR (Score: 9, Opus)
```yaml
pr_id: PR-027
title: Architectural refactoring for performance optimization
description: Critical performance improvements requiring algorithm changes and database migration
estimated_files: [10 files]
dependencies: [PR-025, PR-026, PR-028]
```
**Score:** 9/10 (Opus)
**Rationale:** 10 files (5 points); 3 dependencies (3 points); complexity keywords: architectural, refactoring, performance, optimization (+5); detailed requirements (+1); Score 9/10

## References

- PRD Section: Heterogeneous Agent Pools (Feature #6)
- PRD Section: Complexity Scoring (Architecture)
- PR-002: Cost type definitions
- PR-009: Task list parser
