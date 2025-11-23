/**
 * Type Guards for Runtime Type Checking
 *
 * Provides type-safe runtime validation for discriminated unions
 * and other TypeScript types throughout the application.
 */

import { HotState, ColdState } from './pr';
import { CoordinationMode } from './coordination';

/**
 * Check if a state is a hot state
 */
export function isHotState(state: unknown): state is HotState {
  const hotStates: HotState[] = ['investigating', 'planning', 'in-progress', 'under-review'];
  return typeof state === 'string' && hotStates.includes(state as HotState);
}

/**
 * Check if a state is a cold state
 */
export function isColdState(state: unknown): state is ColdState {
  const coldStates: ColdState[] = ['new', 'ready', 'blocked', 'planned', 'completed', 'approved', 'broken'];
  return typeof state === 'string' && coldStates.includes(state as ColdState);
}

/**
 * Check if a state is either hot or cold
 */
export function isValidState(state: unknown): state is HotState | ColdState {
  return isHotState(state) || isColdState(state);
}

/**
 * Assert that a value is a cold state (throws if not)
 */
export function assertColdState(state: unknown): asserts state is ColdState {
  if (!isColdState(state)) {
    throw new Error(`Expected cold state, got: ${state}`);
  }
}

/**
 * Assert that a value is a hot state (throws if not)
 */
export function assertHotState(state: unknown): asserts state is HotState {
  if (!isHotState(state)) {
    throw new Error(`Expected hot state, got: ${state}`);
  }
}

/**
 * Check if a value is a valid coordination mode
 */
export function isCoordinationMode(value: unknown): value is CoordinationMode {
  return (
    value === CoordinationMode.DISTRIBUTED ||
    value === CoordinationMode.DEGRADED ||
    value === CoordinationMode.ISOLATED
  );
}

/**
 * Type guard for Node.js errors with code property
 */
export interface NodeError extends Error {
  code?: string;
  errno?: number;
  syscall?: string;
  path?: string;
}

/**
 * Check if an error has a code property
 */
export function isNodeError(error: unknown): error is NodeError {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof (error as NodeError).code === 'string'
  );
}

/**
 * Type guard for errors with stack traces
 */
export function hasStack(error: unknown): error is Error & { stack: string } {
  return error instanceof Error && typeof error.stack === 'string';
}

/**
 * Safe error message extraction
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}

/**
 * Safe error code extraction
 */
export function getErrorCode(error: unknown): string | undefined {
  if (isNodeError(error)) {
    return error.code;
  }
  return undefined;
}
