/**
 * Types for task list parsing
 */

import { ColdState, Priority } from '../types/pr';

export interface ParsedTaskList {
  metadata: TaskListMetadata;
  prs: PRData[];
  raw: string; // Original markdown for preservation
}

export interface TaskListMetadata {
  generated_for?: string;
  estimated_total_complexity?: number;
  recommended_agents?: {
    haiku?: number;
    sonnet?: number;
    opus?: number;
  };
}

export interface PRData {
  pr_id: string;
  title: string;
  cold_state: ColdState;
  priority: Priority;
  complexity: {
    score: number;
    estimated_minutes: number;
    suggested_model: 'haiku' | 'sonnet' | 'opus';
    rationale: string;
  };
  dependencies: string[];
  estimated_files?: FileEstimate[];
  actual_files?: FileActual[];
  description?: string;
  acceptance_criteria?: string[];
  notes?: string;
}

export interface FileEstimate {
  path: string;
  action: 'create' | 'modify' | 'delete';
  description: string;
}

export interface FileActual {
  path: string;
  action: 'create' | 'modify' | 'delete';
  lines_added?: number;
  lines_removed?: number;
}

export interface PRBlock {
  prId: string;
  frontmatter: string;
  data: PRData;
  startLine: number;
  endLine: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
