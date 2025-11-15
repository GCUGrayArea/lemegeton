/**
 * Keyword Analyzer
 *
 * Pattern matching and weighting for PR complexity assessment.
 * Analyzes PR titles and descriptions for complexity indicators.
 */

import { PRMetadata } from '../types/pr';

/**
 * Keyword pattern with weight and category
 */
export interface KeywordPattern {
  pattern: RegExp;
  weight: number;
  category: 'complexity' | 'simplicity';
  label: string;
}

/**
 * Keyword Analyzer class
 * Analyzes PR text for complexity keywords
 */
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
  analyze(pr: Pick<PRMetadata, 'title' | 'description'>): number {
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
  getMatches(pr: Pick<PRMetadata, 'title' | 'description'>): string[] {
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

  /**
   * Get all patterns (for inspection/testing)
   */
  getPatterns(): KeywordPattern[] {
    return [...this.patterns];
  }
}
