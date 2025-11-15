/**
 * Complexity Scorer Tests
 *
 * Comprehensive test suite for PR complexity scoring system.
 */

import { ComplexityScorer } from '../src/cost/complexityScorer';
import { KeywordAnalyzer } from '../src/cost/keywords';
import { ModelSelector } from '../src/cost/modelSelection';
import { BatchScorer } from '../src/cost/batchScorer';
import { PRMetadata } from '../src/types/pr';

describe('ComplexityScorer', () => {
  let scorer: ComplexityScorer;

  beforeEach(() => {
    scorer = new ComplexityScorer();
  });

  describe('File-based scoring', () => {
    test('scores based on file count', () => {
      const pr: PRMetadata = {
        pr_id: 'PR-001',
        title: 'Test PR',
        cold_state: 'new',
        priority: 'medium',
        description: '',
        acceptance_criteria: [],
        estimated_files: [
          { path: 'file1.ts', action: 'create', description: 'File 1' },
          { path: 'file2.ts', action: 'create', description: 'File 2' },
        ],
        dependencies: [],
        files_locked: [],
        last_transition: new Date().toISOString(),
      };

      const complexity = scorer.score(pr);
      expect(complexity.file_count).toBe(2);
      expect(complexity.factors).toBeDefined();
      expect(complexity.factors?.fileScore).toBe(1.0); // 2 * 0.5
    });

    test('handles PRs with no files', () => {
      const pr: PRMetadata = {
        pr_id: 'PR-002',
        title: 'Test PR',
        cold_state: 'new',
        priority: 'medium',
        description: '',
        acceptance_criteria: [],
        estimated_files: [],
        dependencies: [],
        files_locked: [],
        last_transition: new Date().toISOString(),
      };

      const complexity = scorer.score(pr);
      expect(complexity.file_count).toBe(0);
      expect(complexity.factors).toBeDefined();
      expect(complexity.factors?.fileScore).toBe(0);
    });
  });

  describe('Dependency-based scoring', () => {
    test('scores based on dependency count', () => {
      const pr: PRMetadata = {
        pr_id: 'PR-002',
        title: 'Test PR',
        cold_state: 'new',
        priority: 'medium',
        description: '',
        acceptance_criteria: [],
        dependencies: ['PR-001', 'PR-003'],
        estimated_files: [],
        files_locked: [],
        last_transition: new Date().toISOString(),
      };

      const complexity = scorer.score(pr);
      expect(complexity.dependency_count).toBe(2);
      expect(complexity.factors).toBeDefined();
      expect(complexity.factors?.dependencyScore).toBe(2.0); // 2 * 1.0
    });

    test('handles PRs with no dependencies', () => {
      const pr: PRMetadata = {
        pr_id: 'PR-003',
        title: 'Test PR',
        cold_state: 'new',
        priority: 'medium',
        description: '',
        acceptance_criteria: [],
        dependencies: [],
        estimated_files: [],
        files_locked: [],
        last_transition: new Date().toISOString(),
      };

      const complexity = scorer.score(pr);
      expect(complexity.dependency_count).toBe(0);
      expect(complexity.factors).toBeDefined();
      expect(complexity.factors?.dependencyScore).toBe(0);
    });
  });

  describe('Keyword-based scoring', () => {
    test('increases score for complexity keywords', () => {
      const pr: PRMetadata = {
        pr_id: 'PR-003',
        title: 'Complex algorithm optimization',
        description: 'Refactor architecture for performance',
        cold_state: 'new',
        priority: 'medium',
        acceptance_criteria: [],
        dependencies: [],
        estimated_files: [],
        files_locked: [],
        last_transition: new Date().toISOString(),
      };

      const complexity = scorer.score(pr);
      expect(complexity.factors).toBeDefined();
      expect(complexity.factors?.keywordScore).toBeGreaterThan(0);
      expect(complexity.score).toBeGreaterThan(1);
    });

    test('decreases score for simplicity keywords', () => {
      const pr: PRMetadata = {
        pr_id: 'PR-004',
        title: 'Simple typo fix',
        description: 'Basic documentation update',
        cold_state: 'new',
        priority: 'medium',
        acceptance_criteria: [],
        dependencies: [],
        estimated_files: [{ path: 'README.md', action: 'modify', description: 'Update readme' }],
        files_locked: [],
        last_transition: new Date().toISOString(),
      };

      const complexity = scorer.score(pr);
      expect(complexity.factors).toBeDefined();
      expect(complexity.factors?.keywordScore).toBeLessThan(0);
      expect(complexity.score).toBeLessThanOrEqual(3);
    });
  });

  describe('Description length scoring', () => {
    test('adds point for long descriptions', () => {
      const pr: PRMetadata = {
        pr_id: 'PR-005',
        title: 'Test PR',
        description: 'A'.repeat(501), // 501 characters
        cold_state: 'new',
        priority: 'medium',
        acceptance_criteria: [],
        dependencies: [],
        estimated_files: [],
        files_locked: [],
        last_transition: new Date().toISOString(),
      };

      const complexity = scorer.score(pr);
      expect(complexity.factors).toBeDefined();
      expect(complexity.factors?.descriptionScore).toBe(1);
    });

    test('no point for short descriptions', () => {
      const pr: PRMetadata = {
        pr_id: 'PR-006',
        title: 'Test PR',
        description: 'Short description',
        cold_state: 'new',
        priority: 'medium',
        acceptance_criteria: [],
        dependencies: [],
        estimated_files: [],
        files_locked: [],
        last_transition: new Date().toISOString(),
      };

      const complexity = scorer.score(pr);
      expect(complexity.factors).toBeDefined();
      expect(complexity.factors?.descriptionScore).toBe(0);
    });
  });

  describe('Model selection', () => {
    test('recommends Haiku for simple tasks', () => {
      const pr: PRMetadata = {
        pr_id: 'PR-005',
        title: 'Simple file creation',
        description: '',
        cold_state: 'new',
        priority: 'medium',
        acceptance_criteria: [],
        dependencies: [],
        estimated_files: [{ path: 'file.ts', action: 'create', description: 'New file' }],
        files_locked: [],
        last_transition: new Date().toISOString(),
      };

      const complexity = scorer.score(pr);
      expect(complexity.suggested_model).toBe('haiku');
      expect(complexity.score).toBeLessThanOrEqual(3);
    });

    test('recommends Sonnet for moderate tasks', () => {
      const pr: PRMetadata = {
        pr_id: 'PR-006',
        title: 'Implement new feature',
        description: '',
        cold_state: 'new',
        priority: 'medium',
        acceptance_criteria: [],
        dependencies: ['PR-001', 'PR-002'],
        estimated_files: [
          { path: 'file1.ts', action: 'create', description: 'File 1' },
          { path: 'file2.ts', action: 'create', description: 'File 2' },
          { path: 'file3.ts', action: 'create', description: 'File 3' },
        ],
        files_locked: [],
        last_transition: new Date().toISOString(),
      };

      const complexity = scorer.score(pr);
      expect(complexity.suggested_model).toBe('sonnet');
      expect(complexity.score).toBeGreaterThanOrEqual(4);
      expect(complexity.score).toBeLessThanOrEqual(7);
    });

    test('recommends Opus for complex tasks', () => {
      const pr: PRMetadata = {
        pr_id: 'PR-007',
        title: 'Complex architectural refactoring',
        description: 'Critical performance optimization with algorithm changes',
        cold_state: 'new',
        priority: 'medium',
        acceptance_criteria: [],
        dependencies: ['PR-001', 'PR-002', 'PR-003'],
        estimated_files: Array(10).fill(null).map((_, i) => ({
          path: `file${i}.ts`,
          action: 'modify' as const,
          description: `File ${i}`,
        })),
        files_locked: [],
        last_transition: new Date().toISOString(),
      };

      const complexity = scorer.score(pr);
      expect(complexity.suggested_model).toBe('opus');
      expect(complexity.score).toBeGreaterThanOrEqual(8);
    });
  });

  describe('Score normalization', () => {
    test('clamps score to 1-10 range', () => {
      const lowPR: PRMetadata = {
        pr_id: 'PR-008',
        title: 'Minimal change',
        description: '',
        cold_state: 'new',
        priority: 'medium',
        acceptance_criteria: [],
        dependencies: [],
        estimated_files: [],
        files_locked: [],
        last_transition: new Date().toISOString(),
      };

      const highPR: PRMetadata = {
        pr_id: 'PR-009',
        title: 'Complex refactoring',
        description: '',
        cold_state: 'new',
        priority: 'medium',
        acceptance_criteria: [],
        dependencies: Array(20).fill('PR-001'),
        estimated_files: Array(50).fill(null).map((_, i) => ({
          path: `file${i}.ts`,
          action: 'modify' as const,
          description: `File ${i}`,
        })),
        files_locked: [],
        last_transition: new Date().toISOString(),
      };

      const lowComplexity = scorer.score(lowPR);
      const highComplexity = scorer.score(highPR);

      expect(lowComplexity.score).toBeGreaterThanOrEqual(1);
      expect(highComplexity.score).toBeLessThanOrEqual(10);
    });
  });

  describe('Time estimation', () => {
    test('estimates 10 minutes per complexity point', () => {
      const pr: PRMetadata = {
        pr_id: 'PR-010',
        title: 'Test PR',
        description: '',
        cold_state: 'new',
        priority: 'medium',
        acceptance_criteria: [],
        dependencies: ['PR-001', 'PR-002'],
        estimated_files: [
          { path: 'file1.ts', action: 'create', description: 'File 1' },
          { path: 'file2.ts', action: 'create', description: 'File 2' },
        ],
        files_locked: [],
        last_transition: new Date().toISOString(),
      };

      const complexity = scorer.score(pr);
      expect(complexity.estimated_minutes).toBe(complexity.score * 10);
    });
  });

  describe('Rationale generation', () => {
    test('explains score with contributing factors', () => {
      const pr: PRMetadata = {
        pr_id: 'PR-010',
        title: 'Algorithm optimization',
        description: '',
        cold_state: 'new',
        priority: 'medium',
        acceptance_criteria: [],
        dependencies: ['PR-001'],
        estimated_files: [
          { path: 'file1.ts', action: 'create', description: 'File 1' },
          { path: 'file2.ts', action: 'create', description: 'File 2' },
        ],
        files_locked: [],
        last_transition: new Date().toISOString(),
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
    const pr: Pick<PRMetadata, 'title' | 'description'> = {
      title: 'Complex architecture refactor',
      description: '',
    };

    const score = analyzer.analyze(pr);
    expect(score).toBeGreaterThan(0);
  });

  test('detects simplicity keywords', () => {
    const pr: Pick<PRMetadata, 'title' | 'description'> = {
      title: 'Simple typo fix',
      description: '',
    };

    const score = analyzer.analyze(pr);
    expect(score).toBeLessThan(0);
  });

  test('returns matched keywords', () => {
    const pr: Pick<PRMetadata, 'title' | 'description'> = {
      title: 'Complex refactor',
      description: '',
    };

    const matches = analyzer.getMatches(pr);
    expect(matches).toContain('high-complexity');
  });

  test('allows adding custom patterns', () => {
    analyzer.addPattern({
      pattern: /\bcustom\b/i,
      weight: 5,
      category: 'complexity',
      label: 'custom-pattern',
    });

    const pr: Pick<PRMetadata, 'title' | 'description'> = {
      title: 'Custom implementation',
      description: '',
    };

    const score = analyzer.analyze(pr);
    expect(score).toBe(5);
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
    const complexity = {
      score: 5,
      estimated_minutes: 50,
      file_count: 3,
      dependency_count: 2,
      suggested_model: 'sonnet' as const,
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

  test('gets all available models', () => {
    const models = selector.getAvailableModels();
    expect(models).toHaveLength(3);
    expect(models.map(m => m.tier)).toEqual(['haiku', 'sonnet', 'opus']);
  });

  test('updates pricing', () => {
    selector.updatePricing('haiku', 0.5);
    const model = selector.getModel('haiku');
    expect(model.costPerMillion).toBe(0.5);
  });
});

describe('BatchScorer', () => {
  let batchScorer: BatchScorer;

  beforeEach(() => {
    batchScorer = new BatchScorer();
  });

  test('scores multiple PRs', () => {
    const prs: PRMetadata[] = [
      {
        pr_id: 'PR-001',
        title: 'Simple task',
        description: '',
        cold_state: 'new',
        priority: 'medium',
        acceptance_criteria: [],
        dependencies: [],
        estimated_files: [{ path: 'file.ts', action: 'create', description: 'File' }],
        files_locked: [],
        last_transition: new Date().toISOString(),
      },
      {
        pr_id: 'PR-002',
        title: 'Complex architectural refactoring',
        description: 'Critical performance optimization',
        cold_state: 'new',
        priority: 'medium',
        acceptance_criteria: [],
        dependencies: ['PR-001', 'PR-003'],
        estimated_files: Array(5).fill(null).map((_, i) => ({
          path: `file${i}.ts`,
          action: 'modify' as const,
          description: `File ${i}`,
        })),
        files_locked: [],
        last_transition: new Date().toISOString(),
      },
    ];

    const result = batchScorer.scoreAll(prs);
    expect(result.scores.size).toBe(2);
    expect(result.statistics.avgScore).toBeGreaterThan(0);
  });

  test('generates distribution summary', () => {
    const prs: PRMetadata[] = [
      {
        pr_id: 'PR-001',
        title: 'Simple task',
        description: '',
        cold_state: 'new',
        priority: 'medium',
        acceptance_criteria: [],
        dependencies: [],
        estimated_files: [{ path: 'file.ts', action: 'create', description: 'File' }],
        files_locked: [],
        last_transition: new Date().toISOString(),
      },
    ];

    const result = batchScorer.scoreAll(prs);
    const summary = batchScorer.getDistributionSummary(result);
    expect(summary).toContain('Average complexity');
    expect(summary).toContain('Model distribution');
  });

  test('filters PRs by tier', () => {
    const prs: PRMetadata[] = [
      {
        pr_id: 'PR-001',
        title: 'Simple task',
        description: '',
        cold_state: 'new',
        priority: 'medium',
        acceptance_criteria: [],
        dependencies: [],
        estimated_files: [{ path: 'file.ts', action: 'create', description: 'File' }],
        files_locked: [],
        last_transition: new Date().toISOString(),
      },
      {
        pr_id: 'PR-002',
        title: 'Complex task',
        description: '',
        cold_state: 'new',
        priority: 'medium',
        acceptance_criteria: [],
        dependencies: ['PR-001', 'PR-003'],
        estimated_files: Array(10).fill(null).map((_, i) => ({
          path: `file${i}.ts`,
          action: 'modify' as const,
          description: `File ${i}`,
        })),
        files_locked: [],
        last_transition: new Date().toISOString(),
      },
    ];

    const result = batchScorer.scoreAll(prs);
    const haikuPRs = batchScorer.getPRsByTier(result, 'haiku');
    expect(haikuPRs.length).toBeGreaterThan(0);
  });

  test('generates histogram', () => {
    const prs: PRMetadata[] = [
      {
        pr_id: 'PR-001',
        title: 'Task 1',
        description: '',
        cold_state: 'new',
        priority: 'medium',
        acceptance_criteria: [],
        dependencies: [],
        estimated_files: [{ path: 'file.ts', action: 'create', description: 'File' }],
        files_locked: [],
        last_transition: new Date().toISOString(),
      },
    ];

    const result = batchScorer.scoreAll(prs);
    const histogram = batchScorer.getHistogram(result);
    expect(Object.keys(histogram)).toHaveLength(10);
  });

  test('calculates cost breakdown', () => {
    const prs: PRMetadata[] = [
      {
        pr_id: 'PR-001',
        title: 'Simple task',
        description: '',
        cold_state: 'new',
        priority: 'medium',
        acceptance_criteria: [],
        dependencies: [],
        estimated_files: [{ path: 'file.ts', action: 'create', description: 'File' }],
        files_locked: [],
        last_transition: new Date().toISOString(),
      },
    ];

    const result = batchScorer.scoreAll(prs);
    const breakdown = batchScorer.getCostBreakdown(result);
    expect(breakdown.total).toBeGreaterThanOrEqual(0);
    expect(breakdown.total).toBe(breakdown.haiku + breakdown.sonnet + breakdown.opus);
  });
});
