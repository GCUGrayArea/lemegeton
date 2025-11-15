/**
 * Planning Agent Type Definitions
 *
 * Types for spec parsing, PRD generation, task list creation,
 * and tech stack clarification workflows.
 */

import { PRComplexity } from '../../types/pr';
import { PRData } from '../../parser/types';

/**
 * Project specification parsed from input file
 */
export interface Spec {
  title: string;
  description: string;
  requirements: string[];
  techStack: Partial<TechStack>;
  metadata?: Record<string, any>;
}

/**
 * Complete technology stack specification
 */
export interface TechStack {
  language: string;
  webFramework?: string;
  database?: string;
  buildTools?: string;
  testingFramework?: string;
  deploymentTarget?: string;
  [key: string]: string | undefined;
}

/**
 * Product Requirements Document structure
 */
export interface PRD {
  title: string;
  sections: PRDSection[];
  metadata?: {
    version?: string;
    author?: string;
    date?: string;
  };
}

/**
 * Section within a PRD document
 */
export interface PRDSection {
  title: string;
  content: string;
  subsections?: PRDSection[];
}

/**
 * Suggested technology option from MCP
 */
export interface TechOption {
  name: string;
  description: string;
  popularity: string;
  latestVersion?: string;
  documentation?: string;
}

/**
 * Tech stack suggestion from MCP queries
 */
export interface TechStackSuggestion {
  category: string;
  options: TechOption[];
}

/**
 * Planning workflow options
 */
export interface PlanningOptions {
  outputPath?: string;
  interactive?: boolean;
  enableMCP?: boolean;
  skipLemegetonSetup?: boolean;
  autoApprove?: boolean;
}

/**
 * Result of planning workflow
 */
export interface PlanningResult {
  prd: PRD;
  taskList: string;
  prs: PRData[];
  approved: boolean;
  documentsWritten?: boolean;
}

/**
 * Validation result for tech stack or documents
 */
export interface ValidationResult {
  valid: boolean;
  issues: string[];
  warnings?: string[];
}

/**
 * Dependency block for organizing PRs
 */
export interface DependencyBlock {
  id: number;
  title: string;
  prs: PRData[];
  dependencies: number[];
}

/**
 * Estimated file change for a PR
 */
export interface EstimatedFile {
  path: string;
  action: 'create' | 'modify' | 'delete';
  description: string;
}
