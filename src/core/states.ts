/**
 * State Definitions and Type Guards
 *
 * Defines hot and cold states with metadata and provides type guard functions
 * for runtime validation.
 */

import { HotState, ColdState } from '../types/pr';

/**
 * All hot states (ephemeral, Redis-only).
 * These represent active work and are lost if Redis crashes.
 */
export const HOT_STATES: readonly HotState[] = [
  'investigating',
  'planning',
  'in-progress',
  'under-review'
] as const;

/**
 * All cold states (durable, committed to git).
 * These represent stable milestones that survive crashes.
 */
export const COLD_STATES: readonly ColdState[] = [
  'new',
  'ready',
  'blocked',
  'planned',
  'completed',
  'approved',
  'broken'
] as const;

/**
 * Type guard to check if a state is a hot state.
 */
export function isHotState(state: string): state is HotState {
  return HOT_STATES.includes(state as HotState);
}

/**
 * Type guard to check if a state is a cold state.
 */
export function isColdState(state: string): state is ColdState {
  return COLD_STATES.includes(state as ColdState);
}

/**
 * Type guard to check if a state is valid (hot or cold).
 */
export function isValidState(state: string): state is HotState | ColdState {
  return isHotState(state) || isColdState(state);
}

/**
 * Metadata about a state for documentation and UI display.
 */
export interface StateMetadata {
  /** State value */
  state: HotState | ColdState;
  /** State category */
  category: 'hot' | 'cold';
  /** Human-readable description */
  description: string;
  /** Whether this state represents active work */
  is_active_work: boolean;
  /** Whether this state represents completion */
  is_terminal: boolean;
}

/**
 * Metadata for all states.
 * Used for documentation, UI display, and validation context.
 */
export const STATE_METADATA: Record<HotState | ColdState, StateMetadata> = {
  // Hot States
  investigating: {
    state: 'investigating',
    category: 'hot',
    description: 'Agent is analyzing requirements and planning approach',
    is_active_work: true,
    is_terminal: false
  },
  planning: {
    state: 'planning',
    category: 'hot',
    description: 'Agent is creating detailed implementation plan',
    is_active_work: true,
    is_terminal: false
  },
  'in-progress': {
    state: 'in-progress',
    category: 'hot',
    description: 'Agent is actively implementing code',
    is_active_work: true,
    is_terminal: false
  },
  'under-review': {
    state: 'under-review',
    category: 'hot',
    description: 'Code review agent is examining implementation',
    is_active_work: true,
    is_terminal: false
  },

  // Cold States
  new: {
    state: 'new',
    category: 'cold',
    description: 'PR just created, not yet started',
    is_active_work: false,
    is_terminal: false
  },
  ready: {
    state: 'ready',
    category: 'cold',
    description: 'Dependencies met, ready for agent assignment',
    is_active_work: false,
    is_terminal: false
  },
  blocked: {
    state: 'blocked',
    category: 'cold',
    description: 'Dependencies not met, cannot proceed',
    is_active_work: false,
    is_terminal: false
  },
  planned: {
    state: 'planned',
    category: 'cold',
    description: 'Implementation plan complete and committed',
    is_active_work: false,
    is_terminal: false
  },
  completed: {
    state: 'completed',
    category: 'cold',
    description: 'Implementation done, awaiting QC',
    is_active_work: false,
    is_terminal: false
  },
  approved: {
    state: 'approved',
    category: 'cold',
    description: 'QC passed, ready to merge',
    is_active_work: false,
    is_terminal: true
  },
  broken: {
    state: 'broken',
    category: 'cold',
    description: 'QC failed or regression detected, needs fix',
    is_active_work: false,
    is_terminal: false
  }
};

/**
 * Get metadata for a state.
 * @throws Error if state is invalid
 */
export function getStateMetadata(state: HotState | ColdState): StateMetadata {
  const metadata = STATE_METADATA[state];
  if (!metadata) {
    throw new Error(`Invalid state: ${state}`);
  }
  return metadata;
}

/**
 * Get category (hot or cold) for a state.
 */
export function getStateCategory(state: HotState | ColdState): 'hot' | 'cold' {
  return getStateMetadata(state).category;
}
