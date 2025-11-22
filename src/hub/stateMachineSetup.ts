/**
 * State Machine Setup Manager
 *
 * Manages state machine initialization and git commit integration.
 * Extracted from Hub to follow Single Responsibility Principle.
 */

import { EventEmitter } from 'events';
import { StateMachine } from '../core/stateMachine';

/**
 * Git committer interface for state transitions
 */
export interface GitCommitter {
  commit(message: string, metadata: any): Promise<void>;
}

/**
 * Manages state machine initialization
 */
export class StateMachineSetup {
  private stateMachine: StateMachine | null = null;
  private eventEmitter: EventEmitter;

  constructor(eventEmitter: EventEmitter) {
    this.eventEmitter = eventEmitter;
  }

  /**
   * Initialize state machine with git integration
   */
  initialize(gitCommitter?: GitCommitter): StateMachine {
    // Create default git committer if not provided
    const defaultGitCommitter = gitCommitter || {
      commit: async (message: string, metadata: any) => {
        console.log(`[StateMachineSetup] Would commit: ${message}`);
        console.log(`[StateMachineSetup] Metadata:`, metadata);
        // TODO: Implement actual git operations in PR-010
      }
    };

    // Create state event emitter wrapper
    const stateEventEmitter = {
      emit: (event: string, ...args: any[]) => {
        this.eventEmitter.emit(event, ...args);
      }
    };

    this.stateMachine = new StateMachine(defaultGitCommitter, stateEventEmitter);
    return this.stateMachine;
  }

  /**
   * Get the state machine
   */
  getStateMachine(): StateMachine | null {
    return this.stateMachine;
  }
}
