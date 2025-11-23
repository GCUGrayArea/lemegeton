/**
 * Base Agent Class
 *
 * Foundation class for all agent types with lifecycle management,
 * Hub communication, heartbeat system, and error recovery.
 */

import { EventEmitter } from 'events';
import {
  AgentState,
  Assignment,
  WorkResult,
  ProgressUpdate,
  AgentMessage,
  AgentRegistration,
  AgentComplete,
  AgentFailed,
  AgentProgress,
  ErrorInfo,
  ErrorCategory,
  MessageHandler,
  AgentStats,
} from './types';
import { LifecycleManager } from './lifecycle';
import { HeartbeatManager, HeartbeatConfig } from './heartbeat';
import { CommunicationManager } from './communication';
import { RecoveryManager } from './recovery';
import { isNodeError, getErrorCode } from '../types';
import { Clock, getSystemClock } from '../utils/testability';

export interface AgentConfig {
  agentType: string;
  redisUrl?: string;
  heartbeatInterval?: number;
  heartbeatTimeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  shutdownTimeout?: number;
  /** Injectable clock for testability (defaults to system clock) */
  clock?: Clock;
}

/**
 * Base Agent abstract class
 */
export abstract class BaseAgent extends EventEmitter {
  // Identity
  protected agentId: string;
  protected agentType: string;
  protected prId: string | null = null;

  // Lifecycle
  protected lifecycle: LifecycleManager;
  protected heartbeat: HeartbeatManager;
  protected communication: CommunicationManager | null = null;
  protected recovery: RecoveryManager;

  // Configuration
  protected config: AgentConfig;

  // Injectable dependencies for testability
  private clock: Clock;

  // Timing
  protected startTime: number = 0;
  protected workStartTime: number = 0;

  // Resource cleanup
  private shutdownTimer: NodeJS.Timeout | null = null;

  /**
   * Abstract methods - must be implemented by subclasses
   */
  abstract doWork(assignment: Assignment): Promise<WorkResult>;
  abstract validateAssignment(assignment: Assignment): Promise<boolean>;

  constructor(agentId: string, config: AgentConfig) {
    super();
    this.agentId = agentId;
    this.agentType = config.agentType;
    this.config = config;

    // Initialize injectable dependencies (defaults to system implementations)
    this.clock = config.clock ?? getSystemClock();

    // Initialize lifecycle
    this.lifecycle = new LifecycleManager();

    // Initialize recovery
    this.recovery = new RecoveryManager({
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000,
    });

    // Initialize heartbeat (actual communication setup deferred to start())
    this.heartbeat = new HeartbeatManager(
      this.agentId,
      () => this.lifecycle.getState(),
      () => this.prId,
      async (message) => await this.sendToHub(message),
      {
        interval: config.heartbeatInterval || 30000,
        timeout: config.heartbeatTimeout || 90000,
      }
    );

    this.setupEventListeners();
  }

  /**
   * Start the agent
   */
  async start(): Promise<void> {
    this.startTime = Date.now();

    try {
      // Initialize communication (stub for now - will be connected in PR-013)
      await this.initializeCommunication();

      // Register with Hub
      await this.registerWithHub();

      // Start heartbeat
      await this.heartbeat.start();

      // Transition to IDLE
      await this.lifecycle.transition(AgentState.IDLE);

      // Subscribe to assignments
      if (this.communication) {
        await this.communication.subscribeToAssignments(async (assignment) => {
          await this.handleAssignment(assignment);
        });
      }

      this.emit('started');
    } catch (error) {
      await this.lifecycle.transition(AgentState.FAILED);
      throw error;
    }
  }

  /**
   * Stop the agent
   */
  async stop(): Promise<void> {
    const timeout = this.config.shutdownTimeout || 5000;

    // Clear any existing shutdown timer
    if (this.shutdownTimer) {
      this.clock.clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
    }

    try {
      // Transition to shutting down
      await this.lifecycle.transition(AgentState.SHUTTING_DOWN);

      // Stop heartbeat
      await this.heartbeat.stop();

      // Cleanup communication
      if (this.communication) {
        await this.communication.unsubscribeAll();
      }

      // Transition to stopped
      await this.lifecycle.transition(AgentState.STOPPED);

      this.emit('stopped');
    } catch (error) {
      // Store timer reference for proper cleanup
      this.shutdownTimer = this.clock.setTimeout(() => {
        this.lifecycle.forceState(AgentState.STOPPED);
        this.emit('forceStopped');
        this.shutdownTimer = null;  // Clear reference after firing
      }, timeout);

      throw error;
    }
  }

  /**
   * Handle work assignment from Hub
   */
  async handleAssignment(assignment: Assignment): Promise<void> {
    try {
      // Validate assignment
      const isValid = await this.validateAssignment(assignment);
      if (!isValid) {
        await this.reportFailure(
          assignment.prId,
          new Error('Invalid assignment'),
          ErrorCategory.ASSIGNMENT,
          false
        );
        return;
      }

      // Transition to working
      await this.lifecycle.transition(AgentState.WORKING);
      this.prId = assignment.prId;
      this.workStartTime = Date.now();

      // Do the work
      const result = await this.doWork(assignment);

      // Report result
      if (result.success) {
        await this.reportComplete(result);
        await this.lifecycle.transition(AgentState.COMPLETING);
        await this.lifecycle.transition(AgentState.IDLE);
      } else {
        await this.reportFailure(
          assignment.prId,
          new Error(result.error || 'Work failed'),
          ErrorCategory.EXECUTION,
          true
        );
        await this.lifecycle.transition(AgentState.FAILED);
        await this.recovery.recover();
        await this.lifecycle.transition(AgentState.IDLE);
      }

      this.prId = null;
    } catch (error) {
      await this.handleError(error as Error);
    }
  }

  /**
   * Report progress update
   */
  async reportProgress(progress: ProgressUpdate): Promise<void> {
    const message: AgentProgress = {
      type: 'progress',
      agentId: this.agentId,
      prId: progress.prId,
      percentComplete: progress.percentComplete,
      message: progress.message,
      timestamp: progress.timestamp,
    };

    await this.sendToHub(message);
  }

  /**
   * Send message to Hub
   */
  async sendToHub(message: AgentMessage): Promise<void> {
    if (this.communication) {
      await this.communication.publishToHub(message);
    } else {
      // Stub for testing - emit event
      this.emit('hubMessage', message);
    }
  }

  /**
   * Get current state
   */
  getState(): AgentState {
    return this.lifecycle.getState();
  }

  /**
   * Get agent statistics
   */
  getStats(): AgentStats {
    return {
      agentId: this.agentId,
      agentType: this.agentType,
      state: this.lifecycle.getState(),
      uptime: Date.now() - this.startTime,
      currentPR: this.prId,
      heartbeat: this.heartbeat.getStats(),
      recovery: this.recovery.getStats(),
    };
  }

  /**
   * Initialize communication (stub for PR-013)
   */
  private async initializeCommunication(): Promise<void> {
    // Stub implementation - will be replaced in PR-013 with Redis pub/sub
    // For testing, we can skip creating the communication manager
    // and use direct event emission via sendToHub
    if (process.env.NODE_ENV === 'test' || !this.config.redisUrl) {
      // Leave this.communication as null for testing
      this.communication = null;
    } else {
      this.communication = new CommunicationManager(
        this.agentId,
        async (channel: string, message: any) => {
          this.emit('publish', { channel, message });
        },
        async (channel: string, handler: MessageHandler) => {
          this.emit('subscribe', { channel });
        }
      );
    }
  }

  /**
   * Register with Hub
   */
  private async registerWithHub(): Promise<void> {
    const registration: AgentRegistration = {
      type: 'registration',
      agentId: this.agentId,
      agentType: this.agentType,
      capabilities: {
        maxComplexity: 10,
        preferredModel: 'sonnet',
      },
      timestamp: Date.now(),
    };

    await this.sendToHub(registration);
  }

  /**
   * Report work completion
   */
  private async reportComplete(result: WorkResult): Promise<void> {
    const message: AgentComplete = {
      type: 'complete',
      agentId: this.agentId,
      prId: result.prId,
      result,
      timestamp: Date.now(),
    };

    await this.sendToHub(message);
  }

  /**
   * Report work failure
   */
  private async reportFailure(
    prId: string,
    error: Error,
    category: ErrorCategory,
    recoverable: boolean
  ): Promise<void> {
    const errorInfo: ErrorInfo = {
      message: error.message,
      stack: error.stack,
      code: getErrorCode(error),
      category,
    };

    const message: AgentFailed = {
      type: 'failed',
      agentId: this.agentId,
      prId,
      error: errorInfo,
      recoverable,
      timestamp: Date.now(),
    };

    await this.sendToHub(message);
  }

  /**
   * Handle errors during work
   */
  protected async handleError(error: Error): Promise<void> {
    this.emit('error', error);

    const category = this.categorizeError(error);
    const action = await this.recovery.handleError(error, category);

    switch (action.action) {
      case 'retry':
        // Retry will be handled by recovery manager
        break;

      case 'report':
        if (this.prId) {
          await this.reportFailure(this.prId, error, category, true);
        }
        break;

      case 'fail':
        if (this.prId) {
          await this.reportFailure(this.prId, error, category, false);
        }
        await this.lifecycle.transition(AgentState.FAILED);
        if (action.cleanup) {
          await this.recovery.recover();
        }
        await this.lifecycle.transition(AgentState.IDLE);
        this.prId = null;
        break;

      case 'shutdown':
        await this.stop();
        break;
    }
  }

  /**
   * Categorize error for recovery
   */
  protected categorizeError(error: Error): ErrorCategory {
    // Network errors are transient
    const errorCode = getErrorCode(error);
    if (errorCode === 'ECONNREFUSED' ||
        errorCode === 'ETIMEDOUT' ||
        error.message.includes('network')) {
      return ErrorCategory.TRANSIENT;
    }

    // Out of memory is fatal
    if (error.message.includes('out of memory')) {
      return ErrorCategory.FATAL;
    }

    // Default to execution error
    return ErrorCategory.EXECUTION;
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    this.lifecycle.on('stateChanged', (event) => {
      this.emit('stateChanged', event);
    });

    this.heartbeat.on('timeout', (event) => {
      this.emit('heartbeatTimeout', event);
    });

    this.recovery.on('error', (error) => {
      this.emit('recoveryError', error);
    });
  }

  /**
   * Cleanup resources to prevent memory leaks
   * Should be called when agent is being destroyed
   */
  async cleanup(): Promise<void> {
    // Clear shutdown timer if exists
    if (this.shutdownTimer) {
      this.clock.clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
    }

    // Stop the agent if not already stopped
    const currentState = this.lifecycle.getState();
    if (currentState !== AgentState.STOPPED) {
      try {
        await this.stop();
      } catch (error) {
        // Cleanup should not throw - log error but continue
        console.warn(`[Agent ${this.agentId}] Cleanup error during stop:`, error);
      }
    }

    // Remove all event listeners to prevent memory leaks
    this.removeAllListeners();
  }
}
