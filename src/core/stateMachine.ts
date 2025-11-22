/**
 * State Machine Core Logic
 *
 * Implements the state machine for PR lifecycle management with hot/cold
 * state separation, git commit triggering, and event emission.
 *
 * This state machine performs STRUCTURAL validation only. Business logic
 * (e.g., "only QC agents can transition approved→broken") is enforced by
 * the Hub or agents, not here.
 */

import { HotState, ColdState, PRState, PRTransition, isColdState } from '../types';
import {
  isValidTransition,
  validateTransition,
  getTransitionRule,
  getAvailableTransitions as getAvailableTransitionsFromRules,
  requiresCommit as requiresCommitFromRules,
  ValidationResult
} from './transitions';

/**
 * Metadata for git commits triggered by cold transitions.
 */
export interface CommitMetadata {
  /** PR identifier */
  pr_id: string;
  /** Source state */
  from_state: ColdState | HotState;
  /** Target state (always cold for commits) */
  to_state: ColdState;
  /** Timestamp of transition */
  timestamp: Date;
  /** Agent performing transition */
  agent_id?: string;
  /** Reason for transition */
  reason?: string;
}

/**
 * Git committer interface for dependency injection.
 * Implementation provided by PR-010 (State Synchronization System).
 */
export interface IGitCommitter {
  /**
   * Commit state change to git.
   * @param message - Commit message
   * @param metadata - Commit metadata
   */
  commit(message: string, metadata: CommitMetadata): Promise<void>;
}

/**
 * State transition event data.
 */
export interface StateTransitionEvent {
  /** PR identifier */
  pr_id: string;
  /** Source state */
  from: ColdState | HotState;
  /** Target state */
  to: ColdState | HotState;
  /** Agent performing transition */
  agent_id?: string;
  /** Timestamp of transition */
  timestamp: Date;
  /** Whether git commit was triggered */
  committed: boolean;
  /** Reason for transition */
  reason?: string;
}

/**
 * Event emitter interface for state change notifications.
 * Implementation provided by PR-013 (Message Bus).
 */
export interface IStateEventEmitter {
  /**
   * Emit state transition event.
   * @param event - Event type
   * @param data - Event data
   */
  emit(event: 'state_transition', data: StateTransitionEvent): void;
}

/**
 * Result of a transition attempt.
 */
export interface TransitionResult {
  /** Whether transition succeeded */
  success: boolean;
  /** New state after transition */
  new_state: HotState | ColdState;
  /** Error message if failed */
  error?: string;
  /** Whether git commit was triggered */
  committed: boolean;
  /** Transition metadata */
  transition: PRTransition;
}

/**
 * State Machine for PR lifecycle management.
 *
 * Responsibilities:
 * - Validate state transitions (structural rules only)
 * - Trigger git commits for cold transitions
 * - Emit events for state changes
 * - Track transition history
 * - Provide state queries
 *
 * The state machine is stateless - it operates on PRState objects passed in.
 * This makes it easy to test and enables crash recovery.
 */
export class StateMachine {
  private gitCommitter?: IGitCommitter;
  private eventEmitter?: IStateEventEmitter;

  /**
   * Create a new state machine.
   *
   * @param gitCommitter - Git committer for cold transitions (optional, stub for PR-003)
   * @param eventEmitter - Event emitter for notifications (optional, stub for PR-003)
   */
  constructor(
    gitCommitter?: IGitCommitter,
    eventEmitter?: IStateEventEmitter
  ) {
    this.gitCommitter = gitCommitter;
    this.eventEmitter = eventEmitter;
  }

  /**
   * Transition a PR to a new state.
   *
   * This is the primary method for state changes. It:
   * 1. Validates the transition
   * 2. Triggers git commit if needed (cold transition)
   * 3. Emits state change event
   * 4. Returns updated state
   *
   * @param prId - PR identifier
   * @param currentState - Current PR state
   * @param toState - Target state
   * @param agentId - Agent performing transition (optional)
   * @param reason - Reason for transition (optional)
   * @returns Transition result with updated state
   */
  async transition(
    prId: string,
    currentState: PRState,
    toState: HotState | ColdState,
    agentId?: string,
    reason?: string
  ): Promise<TransitionResult> {
    const timestamp = new Date();
    const fromState = currentState.hot_state || currentState.cold_state;

    // Validate transition
    const validation = validateTransition(fromState, toState);
    if (!validation.valid) {
      const transition: PRTransition = {
        from: fromState,
        to: toState,
        timestamp,
        agent_id: agentId,
        reason: reason || validation.error
      };

      console.error(`[StateMachine] Invalid transition for ${prId}: ${validation.error}`);

      return {
        success: false,
        new_state: fromState,
        error: validation.error,
        committed: false,
        transition
      };
    }

    // Check if commit is needed
    const needsCommit = requiresCommitFromRules(fromState, toState);

    // Create transition record
    const transition: PRTransition = {
      from: fromState,
      to: toState,
      timestamp,
      agent_id: agentId,
      reason
    };

    // Emit event (before commit for observability)
    if (this.eventEmitter) {
      try {
        this.eventEmitter.emit('state_transition', {
          pr_id: prId,
          from: fromState,
          to: toState,
          agent_id: agentId,
          timestamp,
          committed: needsCommit,
          reason
        });
      } catch (error) {
        console.warn(`[StateMachine] Failed to emit event for ${prId}:`, error);
        // Don't fail transition if event emission fails
      }
    }

    // Trigger git commit if needed
    if (needsCommit && this.gitCommitter) {
      // Verify toState is actually a cold state (type-safe runtime check)
      if (!isColdState(toState)) {
        console.error(`[StateMachine] needsCommit is true but toState is not cold: ${toState}`);
        return {
          success: false,
          new_state: fromState,
          error: `Invalid state: needsCommit requires cold state, got ${toState}`,
          committed: false,
          transition
        };
      }

      try {
        // TypeScript now knows toState is ColdState
        const commitMessage = this.generateCommitMessage(prId, fromState, toState, reason);
        const metadata: CommitMetadata = {
          pr_id: prId,
          from_state: fromState,
          to_state: toState,
          timestamp,
          agent_id: agentId,
          reason
        };

        await this.gitCommitter.commit(commitMessage, metadata);
        console.log(`[StateMachine] Committed ${prId}: ${fromState} → ${toState}`);
      } catch (error) {
        console.error(`[StateMachine] Git commit failed for ${prId}:`, error);
        return {
          success: false,
          new_state: fromState,
          error: `Git commit failed: ${error}`,
          committed: false,
          transition
        };
      }
    }

    // Log successful transition
    console.log(`[StateMachine] ${prId}: ${fromState} → ${toState}${needsCommit ? ' (committed)' : ''}`);

    return {
      success: true,
      new_state: toState,
      committed: needsCommit,
      transition
    };
  }

  /**
   * Validate a transition without performing it.
   *
   * @param from - Source state
   * @param to - Target state
   * @returns Validation result
   */
  validateTransition(
    from: HotState | ColdState,
    to: HotState | ColdState
  ): ValidationResult {
    return validateTransition(from, to);
  }

  /**
   * Check if a transition is valid.
   *
   * @param from - Source state
   * @param to - Target state
   * @returns true if transition is allowed
   */
  isValidTransition(
    from: HotState | ColdState,
    to: HotState | ColdState
  ): boolean {
    return isValidTransition(from, to);
  }

  /**
   * Get all states that can be transitioned to from a given state.
   *
   * @param from - Source state
   * @returns Array of valid target states
   */
  getAvailableTransitions(
    from: HotState | ColdState
  ): Array<HotState | ColdState> {
    return getAvailableTransitionsFromRules(from);
  }

  /**
   * Check if a transition requires a git commit.
   *
   * @param from - Source state
   * @param to - Target state
   * @returns true if git commit will be triggered
   */
  requiresCommit(
    from: HotState | ColdState,
    to: HotState | ColdState
  ): boolean {
    return requiresCommitFromRules(from, to);
  }

  /**
   * Generate a git commit message for a state transition.
   * Should only be called when toState is cold (commit is needed).
   *
   * @param prId - PR identifier
   * @param from - Source state
   * @param to - Target state (must be cold)
   * @param reason - Reason for transition (optional)
   * @returns Formatted commit message
   */
  private generateCommitMessage(
    prId: string,
    from: HotState | ColdState,
    to: ColdState,
    reason?: string
  ): string {
    const rule = getTransitionRule(from, to);
    const description = rule?.description || 'State transition';

    let message = `${prId}: ${from} → ${to}\n\n${description}`;

    if (reason) {
      message += `\n\nReason: ${reason}`;
    }

    return message;
  }
}
