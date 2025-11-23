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
 * Uses unknown type since we're validating untrusted input data
 */
export function validatePR(data: unknown, allPRIds?: Set<string>): ValidationResult {
  const errors: string[] = [];

  // Type guard: ensure data is an object
  if (typeof data !== 'object' || data === null) {
    return {
      valid: false,
      errors: ['Data must be an object'],
    };
  }

  // Cast to record for property access
  const record = data as Record<string, unknown>;

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in record) || record[field] === undefined || record[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Type validation
  if (record.pr_id !== undefined && typeof record.pr_id !== 'string') {
    errors.push('pr_id must be a string');
  }

  if (record.title !== undefined && typeof record.title !== 'string') {
    errors.push('title must be a string');
  }

  // Cold state validation
  if (record.cold_state !== undefined && record.cold_state !== null) {
    if (typeof record.cold_state !== 'string' || !VALID_COLD_STATES.includes(record.cold_state as ColdState)) {
      errors.push(
        `Invalid cold_state "${record.cold_state}". ` +
        `Must be one of: ${VALID_COLD_STATES.join(', ')}`
      );
    }
  }

  // Priority validation
  if (record.priority !== undefined && record.priority !== null) {
    if (typeof record.priority !== 'string' || !VALID_PRIORITIES.includes(record.priority as Priority)) {
      errors.push(
        `Invalid priority "${record.priority}". ` +
        `Must be one of: ${VALID_PRIORITIES.join(', ')}`
      );
    }
  }

  // Complexity validation
  if (record.complexity !== undefined && record.complexity !== null) {
    if (typeof record.complexity !== 'object') {
      errors.push('complexity must be an object');
    } else {
      // Cast to record for property access
      const complexity = record.complexity as Record<string, unknown>;

      if (typeof complexity.score !== 'number') {
        errors.push('complexity.score must be a number');
      } else if (complexity.score < 1 || complexity.score > 10) {
        errors.push('complexity.score must be between 1 and 10');
      }

      if (typeof complexity.estimated_minutes !== 'number') {
        errors.push('complexity.estimated_minutes must be a number');
      } else if (complexity.estimated_minutes < 1 || complexity.estimated_minutes > 600) {
        errors.push('complexity.estimated_minutes must be between 1 and 600');
      }

      if (complexity.suggested_model !== undefined) {
        if (typeof complexity.suggested_model !== 'string' || !VALID_MODELS.includes(complexity.suggested_model)) {
          errors.push(
            `Invalid complexity.suggested_model "${complexity.suggested_model}". ` +
            `Must be one of: ${VALID_MODELS.join(', ')}`
          );
        }
      }

      if (typeof complexity.rationale !== 'string') {
        errors.push('complexity.rationale must be a string');
      }
    }
  }

  // Dependencies validation
  if (record.dependencies !== undefined) {
    if (!Array.isArray(record.dependencies)) {
      errors.push('dependencies must be an array');
    } else {
      for (const dep of record.dependencies) {
        if (typeof dep !== 'string') {
          errors.push(`Invalid dependency: ${dep} (must be string)`);
        } else if (allPRIds && dep !== '' && !allPRIds.has(dep)) {
          errors.push(`Dependency "${dep}" references non-existent PR`);
        }
      }
    }
  }

  // File estimates validation
  if (record.estimated_files !== undefined) {
    if (!Array.isArray(record.estimated_files)) {
      errors.push('estimated_files must be an array');
    } else {
      for (let i = 0; i < record.estimated_files.length; i++) {
        const fileEntry = record.estimated_files[i];
        if (typeof fileEntry !== 'object' || fileEntry === null) {
          errors.push(`estimated_files[${i}] must be an object`);
          continue;
        }

        // Cast to record for property access
        const file = fileEntry as Record<string, unknown>;

        if (typeof file.path !== 'string') {
          errors.push(`estimated_files[${i}].path must be a string`);
        }

        if (typeof file.action !== 'string' || !['create', 'modify', 'delete'].includes(file.action)) {
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
  if (record.actual_files !== undefined) {
    if (!Array.isArray(record.actual_files)) {
      errors.push('actual_files must be an array');
    } else {
      for (let i = 0; i < record.actual_files.length; i++) {
        const fileEntry = record.actual_files[i];
        if (typeof fileEntry !== 'object' || fileEntry === null) {
          errors.push(`actual_files[${i}] must be an object`);
          continue;
        }

        // Cast to record for property access
        const file = fileEntry as Record<string, unknown>;

        if (typeof file.path !== 'string') {
          errors.push(`actual_files[${i}].path must be a string`);
        }

        if (typeof file.action !== 'string' || !['create', 'modify', 'delete'].includes(file.action)) {
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
