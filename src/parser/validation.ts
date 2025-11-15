/**
 * Task list validation system
 */

import { ColdState, Priority } from '../types/pr';
import { PRData, ValidationResult } from './types';
import { ValidationError } from './errors';

const REQUIRED_FIELDS = [
  'pr_id',
  'title',
  'cold_state',
  'priority',
  'complexity',
  'dependencies',
];

const VALID_COLD_STATES: ColdState[] = [
  'new',
  'ready',
  'blocked',
  'planned',
  'completed',
  'approved',
  'broken',
];

const VALID_PRIORITIES: Priority[] = [
  'critical',
  'high',
  'medium',
  'low',
];

const VALID_MODELS = ['haiku', 'sonnet', 'opus'];

/**
 * Validate a parsed PR data object
 */
export function validatePR(data: any, allPRIds?: Set<string>): ValidationResult {
  const errors: string[] = [];

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in data) || data[field] === undefined || data[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Type validation
  if (data.pr_id !== undefined && typeof data.pr_id !== 'string') {
    errors.push('pr_id must be a string');
  }

  if (data.title !== undefined && typeof data.title !== 'string') {
    errors.push('title must be a string');
  }

  // Cold state validation
  if (data.cold_state !== undefined) {
    if (!VALID_COLD_STATES.includes(data.cold_state)) {
      errors.push(
        `Invalid cold_state "${data.cold_state}". ` +
        `Must be one of: ${VALID_COLD_STATES.join(', ')}`
      );
    }
  }

  // Priority validation
  if (data.priority !== undefined) {
    if (!VALID_PRIORITIES.includes(data.priority)) {
      errors.push(
        `Invalid priority "${data.priority}". ` +
        `Must be one of: ${VALID_PRIORITIES.join(', ')}`
      );
    }
  }

  // Complexity validation
  if (data.complexity !== undefined) {
    if (typeof data.complexity !== 'object') {
      errors.push('complexity must be an object');
    } else {
      if (typeof data.complexity.score !== 'number') {
        errors.push('complexity.score must be a number');
      } else if (data.complexity.score < 1 || data.complexity.score > 10) {
        errors.push('complexity.score must be between 1 and 10');
      }

      if (typeof data.complexity.estimated_minutes !== 'number') {
        errors.push('complexity.estimated_minutes must be a number');
      } else if (data.complexity.estimated_minutes < 1 || data.complexity.estimated_minutes > 600) {
        errors.push('complexity.estimated_minutes must be between 1 and 600');
      }

      if (data.complexity.suggested_model !== undefined) {
        if (!VALID_MODELS.includes(data.complexity.suggested_model)) {
          errors.push(
            `Invalid complexity.suggested_model "${data.complexity.suggested_model}". ` +
            `Must be one of: ${VALID_MODELS.join(', ')}`
          );
        }
      }

      if (typeof data.complexity.rationale !== 'string') {
        errors.push('complexity.rationale must be a string');
      }
    }
  }

  // Dependencies validation
  if (data.dependencies !== undefined) {
    if (!Array.isArray(data.dependencies)) {
      errors.push('dependencies must be an array');
    } else {
      for (const dep of data.dependencies) {
        if (typeof dep !== 'string') {
          errors.push(`Invalid dependency: ${dep} (must be string)`);
        } else if (allPRIds && dep !== '' && !allPRIds.has(dep)) {
          errors.push(`Dependency "${dep}" references non-existent PR`);
        }
      }
    }
  }

  // File estimates validation
  if (data.estimated_files !== undefined) {
    if (!Array.isArray(data.estimated_files)) {
      errors.push('estimated_files must be an array');
    } else {
      for (let i = 0; i < data.estimated_files.length; i++) {
        const file = data.estimated_files[i];
        if (typeof file !== 'object') {
          errors.push(`estimated_files[${i}] must be an object`);
          continue;
        }

        if (typeof file.path !== 'string') {
          errors.push(`estimated_files[${i}].path must be a string`);
        }

        if (!['create', 'modify', 'delete'].includes(file.action)) {
          errors.push(
            `estimated_files[${i}].action must be one of: create, modify, delete`
          );
        }

        if (typeof file.description !== 'string') {
          errors.push(`estimated_files[${i}].description must be a string`);
        }
      }
    }
  }

  // Actual files validation
  if (data.actual_files !== undefined) {
    if (!Array.isArray(data.actual_files)) {
      errors.push('actual_files must be an array');
    } else {
      for (let i = 0; i < data.actual_files.length; i++) {
        const file = data.actual_files[i];
        if (typeof file !== 'object') {
          errors.push(`actual_files[${i}] must be an object`);
          continue;
        }

        if (typeof file.path !== 'string') {
          errors.push(`actual_files[${i}].path must be a string`);
        }

        if (!['create', 'modify', 'delete'].includes(file.action)) {
          errors.push(
            `actual_files[${i}].action must be one of: create, modify, delete`
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate entire task list and cross-references
 */
export function validateTaskList(prs: PRData[]): ValidationResult {
  const errors: string[] = [];
  const prIds = new Set<string>();

  // Check for duplicate PR IDs
  for (const pr of prs) {
    if (prIds.has(pr.pr_id)) {
      errors.push(`Duplicate PR ID: ${pr.pr_id}`);
    }
    prIds.add(pr.pr_id);
  }

  // Validate each PR with cross-references
  for (const pr of prs) {
    const result = validatePR(pr, prIds);
    if (!result.valid) {
      errors.push(`PR ${pr.pr_id}: ${result.errors.join(', ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
