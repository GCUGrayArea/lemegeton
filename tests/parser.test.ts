/**
 * Task List Parser Tests
 */

import { TaskListParser, ParseError, ValidationError, StructureError } from '../src/parser';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('TaskListParser', () => {
  let parser: TaskListParser;
  const fixturesDir = path.join(__dirname, 'fixtures');
  const validTaskListPath = path.join(fixturesDir, 'valid-task-list.md');

  beforeEach(() => {
    parser = new TaskListParser();
  });

  describe('parse()', () => {
    it('should parse a valid task list', async () => {
      const result = await parser.parse(validTaskListPath);

      expect(result.prs).toHaveLength(2);
      expect(result.prs[0].pr_id).toBe('PR-001');
      expect(result.prs[1].pr_id).toBe('PR-002');
      expect(result.metadata.estimated_total_complexity).toBe(15);
    });

    it('should extract metadata correctly', async () => {
      const result = await parser.parse(validTaskListPath);

      expect(result.metadata.generated_for).toBe('Test Project v1.0');
      expect(result.metadata.recommended_agents?.haiku).toBe(1);
      expect(result.metadata.recommended_agents?.sonnet).toBe(1);
      expect(result.metadata.recommended_agents?.opus).toBe(1);
    });

    it('should preserve raw content', async () => {
      const result = await parser.parse(validTaskListPath);

      expect(result.raw).toContain('PR-001');
      expect(result.raw).toContain('PR-002');
    });

    it('should use cache on second call', async () => {
      const result1 = await parser.parse(validTaskListPath);
      const result2 = await parser.parse(validTaskListPath);

      expect(result1).toBe(result2); // Same object reference
    });

    it('should throw FileError for non-existent file', async () => {
      await expect(parser.parse('nonexistent.md')).rejects.toThrow();
    });
  });

  describe('validate()', () => {
    it('should validate a complete PR', () => {
      const pr = {
        pr_id: 'PR-001',
        title: 'Test PR',
        cold_state: 'new' as const,
        priority: 'high' as const,
        complexity: {
          score: 5,
          estimated_minutes: 50,
          suggested_model: 'sonnet' as const,
          rationale: 'Test'
        },
        dependencies: []
      };

      const result = parser.validate(pr);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject PR with missing required fields', () => {
      const pr = {
        pr_id: 'PR-001',
        title: 'Test PR',
        // missing cold_state, priority, complexity, dependencies
      } as any;

      const result = parser.validate(pr);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject invalid cold_state', () => {
      const pr = {
        pr_id: 'PR-001',
        title: 'Test PR',
        cold_state: 'invalid_state' as any,
        priority: 'high' as const,
        complexity: {
          score: 5,
          estimated_minutes: 50,
          suggested_model: 'sonnet' as const,
          rationale: 'Test'
        },
        dependencies: []
      };

      const result = parser.validate(pr);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid cold_state');
    });

    it('should reject complexity score out of range', () => {
      const pr = {
        pr_id: 'PR-001',
        title: 'Test PR',
        cold_state: 'new' as const,
        priority: 'high' as const,
        complexity: {
          score: 15, // Invalid - should be 1-10
          estimated_minutes: 50,
          suggested_model: 'sonnet' as const,
          rationale: 'Test'
        },
        dependencies: []
      };

      const result = parser.validate(pr);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('complexity.score must be between 1 and 10');
    });
  });

  describe('clearCache()', () => {
    it('should clear the cache', async () => {
      const result1 = await parser.parse(validTaskListPath);
      parser.clearCache();
      const result2 = await parser.parse(validTaskListPath);

      expect(result1).not.toBe(result2); // Different object references
    });
  });
});
