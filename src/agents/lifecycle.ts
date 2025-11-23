/**
 * Agent Lifecycle Management
 */

import { AgentState } from './types';
import { EventEmitter } from 'events';

/**
 * Valid state transitions
 */
const VALID_TRANSITIONS: Map<AgentState, AgentState[]> = new Map([
  [AgentState.INITIALIZING, [AgentState.IDLE, AgentState.FAILED, AgentState.SHUTTING_DOWN]],
  [AgentState.IDLE, [AgentState.WORKING, AgentState.SHUTTING_DOWN]],
  [AgentState.WORKING, [AgentState.COMPLETING, AgentState.FAILED, AgentState.SHUTTING_DOWN]],
  [AgentState.COMPLETING, [AgentState.IDLE, AgentState.SHUTTING_DOWN]],
  [AgentState.FAILED, [AgentState.IDLE, AgentState.SHUTTING_DOWN]],
  [AgentState.SHUTTING_DOWN, [AgentState.STOPPED]],
  [AgentState.STOPPED, []],
]);

/**
 * Maximum number of state transitions to keep in history
 * Prevents unbounded memory growth for long-running agents
 */
const MAX_STATE_HISTORY = 100;

export class LifecycleManager extends EventEmitter {
  private currentState: AgentState = AgentState.INITIALIZING;
  private stateHistory: Array<{ state: AgentState; timestamp: number }> = [];

  constructor() {
    super();
    this.recordState(AgentState.INITIALIZING);
  }

  /**
   * Get current state
   */
  getState(): AgentState {
    return this.currentState;
  }

  /**
   * Check if transition is valid
   */
  canTransition(from: AgentState, to: AgentState): boolean {
    const validTargets = VALID_TRANSITIONS.get(from);
    return validTargets ? validTargets.includes(to) : false;
  }

  /**
   * Transition to new state
   */
  async transition(to: AgentState): Promise<void> {
    const from = this.currentState;

    if (!this.canTransition(from, to)) {
      throw new Error(
        `Invalid state transition: ${from} → ${to}. ` +
        `Valid transitions from ${from}: ${VALID_TRANSITIONS.get(from)?.join(', ') || 'none'}`
      );
    }

    this.currentState = to;
    this.recordState(to);
    this.emit('stateChanged', { from, to, timestamp: Date.now() });
  }

  /**
   * Force state change (for recovery scenarios)
   */
  forceState(state: AgentState): void {
    const from = this.currentState;
    this.currentState = state;
    this.recordState(state);
    this.emit('stateForced', { from, to: state, timestamp: Date.now() });
  }

  /**
   * Record state in history
   */
  private recordState(state: AgentState): void {
    this.stateHistory.push({
      state,
      timestamp: Date.now(),
    });

    // Keep only recent state transitions
    if (this.stateHistory.length > MAX_STATE_HISTORY) {
      this.stateHistory.shift();
    }
  }

  /**
   * Get state history
   */
  getHistory(): Array<{ state: AgentState; timestamp: number }> {
    return [...this.stateHistory];
  }

  /**
   * Get time in current state
   */
  getTimeInCurrentState(): number {
    const currentStateEntry = this.stateHistory[this.stateHistory.length - 1];
    if (!currentStateEntry) {
      return 0;
    }
    return Date.now() - currentStateEntry.timestamp;
  }
}
