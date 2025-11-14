/**
 * State Transition Rules and Validation
 *
 * Defines all valid state transitions and provides validation logic.
 * Focus on structural validation only - business logic (e.g., "only QC agents
 * can transition approved→broken") is enforced by Hub/agents, not here.
 */

import { HotState, ColdState } from '../types/pr';
import { isHotState, isColdState, getStateCategory } from './states';

/**
 * Transition rule definition with metadata.
 */
export interface TransitionRule {
  /** Source state */
  from: HotState | ColdState;
  /** Target state */
  to: HotState | ColdState;
  /** Human-readable description */
  description: string;
  /** Whether this transition triggers a git commit */
  requires_commit: boolean;
  /** Business logic notes (not enforced here) */
  business_logic_note?: string;
}

/**
 * All valid state transitions.
 * This is the authoritative list of allowed transitions.
 */
export const VALID_TRANSITIONS: readonly TransitionRule[] = [
  // ========================================================================
  // COLD → COLD (git commit triggered)
  // ========================================================================
  {
    from: 'new',
    to: 'ready',
    description: 'Dependencies resolved, ready for assignment',
    requires_commit: true
  },
  {
    from: 'new',
    to: 'blocked',
    description: 'Dependencies not met',
    requires_commit: true
  },
  {
    from: 'blocked',
    to: 'ready',
    description: 'Dependencies now satisfied',
    requires_commit: true
  },
  {
    from: 'ready',
    to: 'blocked',
    description: 'New dependency added or dependency broke',
    requires_commit: true
  },
  {
    from: 'planned',
    to: 'blocked',
    description: 'Dependency broke after planning',
    requires_commit: true
  },
  {
    from: 'completed',
    to: 'approved',
    description: 'QC passed',
    requires_commit: true,
    business_logic_note: 'QC agent should perform this transition'
  },
  {
    from: 'completed',
    to: 'broken',
    description: 'QC failed',
    requires_commit: true,
    business_logic_note: 'QC agent should perform this transition'
  },
  {
    from: 'approved',
    to: 'broken',
    description: 'Regression discovered after approval',
    requires_commit: true,
    business_logic_note: 'IMPORTANT: Only QC agents should perform this transition. Enforcement in Hub (PR-007) or QC Agent (PR-023), not here.'
  },
  {
    from: 'broken',
    to: 'planned',
    description: 'Fix planned and documented',
    requires_commit: true
  },

  // ========================================================================
  // HOT → HOT (no commit)
  // ========================================================================
  {
    from: 'investigating',
    to: 'planning',
    description: 'Analysis complete, moving to planning',
    requires_commit: false
  },
  {
    from: 'planning',
    to: 'in-progress',
    description: 'Planning complete, starting implementation',
    requires_commit: false
  },
  {
    from: 'in-progress',
    to: 'under-review',
    description: 'Implementation done, review requested',
    requires_commit: false
  },

  // ========================================================================
  // COLD → HOT (work starts, no commit)
  // ========================================================================
  {
    from: 'ready',
    to: 'investigating',
    description: 'Agent assigned, starting analysis',
    requires_commit: false
  },
  {
    from: 'ready',
    to: 'in-progress',
    description: 'Agent assigned, starting direct implementation',
    requires_commit: false
  },
  {
    from: 'planned',
    to: 'in-progress',
    description: 'Resuming from plan, starting implementation',
    requires_commit: false
  },
  {
    from: 'planned',
    to: 'investigating',
    description: 'Re-analyzing before implementation',
    requires_commit: false
  },
  {
    from: 'completed',
    to: 'under-review',
    description: 'QC review process starting',
    requires_commit: false
  },
  {
    from: 'broken',
    to: 'investigating',
    description: 'Investigating fix for broken PR',
    requires_commit: false
  },

  // ========================================================================
  // HOT → COLD (milestone reached, git commit)
  // ========================================================================
  {
    from: 'investigating',
    to: 'planned',
    description: 'Analysis complete, plan documented',
    requires_commit: true
  },
  {
    from: 'planning',
    to: 'planned',
    description: 'Planning complete, plan documented',
    requires_commit: true
  },
  {
    from: 'in-progress',
    to: 'completed',
    description: 'Implementation finished',
    requires_commit: true
  },
  {
    from: 'under-review',
    to: 'approved',
    description: 'Review approved',
    requires_commit: true
  },
  {
    from: 'under-review',
    to: 'broken',
    description: 'Review found issues',
    requires_commit: true
  }
] as const;

/**
 * Build transition map for fast lookup.
 * Key format: "from:to"
 */
const TRANSITION_MAP = new Map<string, TransitionRule>();
for (const rule of VALID_TRANSITIONS) {
  const key = `${rule.from}:${rule.to}`;
  TRANSITION_MAP.set(key, rule);
}

/**
 * Check if a transition is valid (structurally allowed).
 *
 * @param from - Source state
 * @param to - Target state
 * @returns true if transition is structurally valid
 */
export function isValidTransition(
  from: HotState | ColdState,
  to: HotState | ColdState
): boolean {
  // Same state transition is always valid (idempotent)
  if (from === to) {
    return true;
  }

  const key = `${from}:${to}`;
  return TRANSITION_MAP.has(key);
}

/**
 * Get transition rule for a specific transition.
 *
 * @param from - Source state
 * @param to - Target state
 * @returns TransitionRule if valid, undefined if invalid
 */
export function getTransitionRule(
  from: HotState | ColdState,
  to: HotState | ColdState
): TransitionRule | undefined {
  // Same state is valid but has no explicit rule
  if (from === to) {
    return {
      from,
      to,
      description: 'No-op transition (already in target state)',
      requires_commit: false
    };
  }

  const key = `${from}:${to}`;
  return TRANSITION_MAP.get(key);
}

/**
 * Get all valid transitions from a given state.
 *
 * @param from - Source state
 * @returns Array of valid target states
 */
export function getAvailableTransitions(
  from: HotState | ColdState
): Array<HotState | ColdState> {
  const transitions: Array<HotState | ColdState> = [from]; // Can always stay in same state

  for (const rule of VALID_TRANSITIONS) {
    if (rule.from === from) {
      transitions.push(rule.to);
    }
  }

  return transitions;
}

/**
 * Check if a transition requires a git commit.
 *
 * @param from - Source state
 * @param to - Target state
 * @returns true if git commit should be triggered
 */
export function requiresCommit(
  from: HotState | ColdState,
  to: HotState | ColdState
): boolean {
  // Same state = no commit needed
  if (from === to) {
    return false;
  }

  const rule = getTransitionRule(from, to);
  return rule?.requires_commit ?? false;
}

/**
 * Validation result for a transition attempt.
 */
export interface ValidationResult {
  /** Whether transition is valid */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
  /** Transition rule if valid */
  rule?: TransitionRule;
}

/**
 * Validate a state transition and provide detailed result.
 *
 * @param from - Source state
 * @param to - Target state
 * @returns Validation result with details
 */
export function validateTransition(
  from: HotState | ColdState,
  to: HotState | ColdState
): ValidationResult {
  // Validate states are recognized
  if (!isHotState(from) && !isColdState(from)) {
    return {
      valid: false,
      error: `Invalid source state: ${from}`
    };
  }

  if (!isHotState(to) && !isColdState(to)) {
    return {
      valid: false,
      error: `Invalid target state: ${to}`
    };
  }

  // Check if transition is allowed
  const rule = getTransitionRule(from, to);
  if (!rule) {
    const fromCategory = getStateCategory(from);
    const toCategory = getStateCategory(to);

    return {
      valid: false,
      error: `Invalid transition: ${from} (${fromCategory}) → ${to} (${toCategory}). This transition is not allowed.`
    };
  }

  return {
    valid: true,
    rule
  };
}
