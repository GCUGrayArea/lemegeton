/**
 * Complexity Scorer
 *
 * Main complexity scoring orchestrator that combines all factors
 * to produce a 1-10 complexity score for PRs.
 */

import { PRMetadata, PRComplexity } from '../types/pr';
import { KeywordAnalyzer } from './keywords';

type ModelTier = 'haiku' | 'sonnet' | 'opus';

/**
 * Complexity scoring factors breakdown
 */
export interface ComplexityFactors {
  fileScore: number;
  dependencyScore: number;
  keywordScore: number;
  descriptionScore: number;
}

/**
 * Description length threshold for considering a PR to have detailed requirements
 * Longer descriptions typically indicate more complex requirements
 */
const LONG_DESCRIPTION_THRESHOLD = 500;

/**
 * Complexity Scorer class
 * Scores PRs from 1-10 based on multiple factors
 */
export class ComplexityScorer {
  private keywordAnalyzer: KeywordAnalyzer;

  constructor() {
    this.keywordAnalyzer = new KeywordAnalyzer();
  }

  /**
   * Score a PR's complexity on a 1-10 scale
   */
  score(pr: PRMetadata): PRComplexity {
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

  /**
   * Score based on file count
   * Algorithm: file_count * 0.5
   */
  private scoreFiles(pr: PRMetadata): number {
    const fileCount = pr.estimated_files?.length || 0;
    return fileCount * 0.5;
  }

  /**
   * Score based on dependency count
   * Algorithm: dependency_count * 1.0
   */
  private scoreDependencies(pr: PRMetadata): number {
    const depCount = pr.dependencies?.length || 0;
    return depCount * 1.0;
  }

  /**
   * Score based on description length
   * Algorithm: +1 if description exceeds threshold
   */
  private scoreDescription(pr: PRMetadata): number {
    const description = pr.description || '';
    // Detailed requirements suggest complexity
    return description.length > LONG_DESCRIPTION_THRESHOLD ? 1 : 0;
  }

  /**
   * Select model tier based on score
   * 1-3: haiku, 4-7: sonnet, 8-10: opus
   */
  private selectModel(score: number): ModelTier {
    if (score <= 3) return 'haiku';
    if (score <= 7) return 'sonnet';
    return 'opus';
  }

  /**
   * Generate explanation of score with contributing factors
   */
  private explainScore(
    pr: PRMetadata,
    factors: ComplexityFactors & { score: number }
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

  /**
   * Get keyword analyzer instance (for testing)
   */
  getKeywordAnalyzer(): KeywordAnalyzer {
    return this.keywordAnalyzer;
  }
}
