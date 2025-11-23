/**
 * Hub Daemon Process
 *
 * Central orchestrator that coordinates all agents, manages state synchronization,
 * and handles the overall system lifecycle. The Hub is responsible for:
 * - Starting as a background daemon
 * - Parsing task-list.md and hydrating Redis
 * - Monitoring agent heartbeats
 * - Coordinating work assignment
 * - Managing graceful shutdown
 */

import { EventEmitter } from 'events';
import { RedisClient } from '../redis/client';
import { CoordinationMode } from '../core/coordinationMode';
import { StateMachine } from '../core/stateMachine';
import { LeaseManager } from '../core/leaseManager';
import { DaemonManager } from './daemon';
import { StartupSequence } from './startup';
import { ShutdownHandler } from './shutdown';
import { AgentRegistry, AgentInfo } from './agentRegistry';
import { ConnectionManager } from './connectionManager';
import { CoordinationSetup } from './coordinationSetup';
import { StateMachineSetup } from './stateMachineSetup';
import { HeartbeatMonitor } from './heartbeatMonitor';
import { mergeConfig } from '../utils/config';
import { Clock, ProcessHandlers, getSystemClock, getSystemProcessHandlers } from '../utils/testability';

/**
 * Hub configuration
 */
export interface HubConfig {
  redis?: {
    url?: string;
    autoSpawn?: boolean;
  };
  daemon?: {
    pidFile?: string;
    logFile?: string;
    workDir?: string;
  };
  heartbeat?: {
    interval?: number;
    timeout?: number;
  };
  shutdown?: {
    timeout?: number;
    graceful?: boolean;
  };
  /** Injectable clock for testability (defaults to system clock) */
  clock?: Clock;
  /** Injectable process handlers for testability (defaults to system handlers) */
  processHandlers?: ProcessHandlers;
}

/**
 * Default hub configuration
 */
export const DEFAULT_HUB_CONFIG: Required<HubConfig> = {
  redis: {
    url: 'redis://localhost:6379',
    autoSpawn: true,
  },
  daemon: {
    pidFile: '.lemegeton/hub.pid',
    logFile: '.lemegeton/hub.log',
    workDir: process.cwd(),
  },
  heartbeat: {
    interval: 30000, // 30 seconds
    timeout: 90000,  // 90 seconds (3 missed heartbeats)
  },
  shutdown: {
    timeout: 30000,  // 30 seconds
    graceful: true,
  },
};

/**
 * Hub events
 */
export interface HubEvents {
  'started': () => void;
  'stopped': () => void;
  'agent-registered': (agent: AgentInfo) => void;
  'agent-crashed': (agentId: string) => void;
  'work-assigned': (agentId: string, prId: string) => void;
  'work-completed': (agentId: string, prId: string) => void;
  'mode-changed': (from: CoordinationMode, to: CoordinationMode) => void;
  'error': (error: Error) => void;
}

/**
 * Main Hub orchestrator
 */
export class Hub extends EventEmitter {
  private config: Required<HubConfig>;

  // Managers using composition
  private connectionManager: ConnectionManager;
  private coordinationSetup: CoordinationSetup;
  private stateMachineSetup: StateMachineSetup;
  private heartbeatMonitor: HeartbeatMonitor;
  private daemonManager: DaemonManager;
  private shutdownHandler: ShutdownHandler;
  private agentRegistry: AgentRegistry;
  private startupSequence: StartupSequence | null = null;

  // Shared resources
  private leaseManager: LeaseManager | null = null;

  // Injectable dependencies for testability
  private clock: Clock;
  private processHandlers: ProcessHandlers;

  // State
  private isRunning: boolean = false;
  private shutdownPromise: Promise<void> | null = null;
  private acceptingWork: boolean = true;

  // Signal handlers for cleanup
  private signalHandlers = new Map<NodeJS.Signals, () => void>();
  private exceptionHandler: ((error: Error) => void) | null = null;
  private rejectionHandler: ((reason: unknown, promise: Promise<unknown>) => void) | null = null;

  constructor(config: HubConfig = {}) {
    super();
    this.config = mergeConfig(DEFAULT_HUB_CONFIG, config);

    // Initialize injectable dependencies (defaults to system implementations)
    this.clock = config.clock ?? getSystemClock();
    this.processHandlers = config.processHandlers ?? getSystemProcessHandlers();

    // Initialize managers
    this.connectionManager = new ConnectionManager({
      url: this.config.redis.url as string,
      autoSpawn: this.config.redis.autoSpawn as boolean,
    });

    this.coordinationSetup = new CoordinationSetup();
    this.stateMachineSetup = new StateMachineSetup(this);
    this.daemonManager = new DaemonManager(this.config.daemon);
    this.shutdownHandler = new ShutdownHandler(this.config.shutdown);
    this.agentRegistry = new AgentRegistry(this.config.heartbeat);

    this.heartbeatMonitor = new HeartbeatMonitor(
      this.agentRegistry,
      {
        interval: this.config.heartbeat.interval as number,
        timeout: this.config.heartbeat.timeout as number,
      }
    );

    // Setup event forwarding
    this.setupEventForwarding();
  }

  /**
   * Setup event forwarding from managers
   */
  private setupEventForwarding(): void {
    // Forward coordination mode changes
    this.coordinationSetup.on('modeChanged', (from, to) => {
      console.log(`[Hub] Coordination mode changed: ${from} → ${to}`);
      this.emit('mode-changed', from, to);
    });

    // Forward agent crash events
    this.heartbeatMonitor.on('agentCrashed', async (agentId) => {
      console.log(`[Hub] Agent crashed: ${agentId}`);
      this.emit('agent-crashed', agentId);
      await this.reclaimWorkFromAgent(agentId);
    });
  }

  /**
   * Start the hub
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Hub already running');
    }

    try {
      console.log('[Hub] Starting...');

      // Initialize Redis connection
      const redisClient = await this.connectionManager.connect();

      // Initialize coordination mode and health checking
      await this.coordinationSetup.initialize(redisClient);

      // Initialize state machine
      this.stateMachineSetup.initialize();

      // Initialize lease manager
      this.leaseManager = new LeaseManager(redisClient);

      // Create startup sequence
      this.startupSequence = new StartupSequence(
        redisClient,
        this.config.daemon.workDir
      );

      // Parse task list and hydrate state
      await this.startupSequence.hydrateFromGit();

      // Initialize agent registry
      await this.agentRegistry.initialize(redisClient);

      // Start heartbeat monitoring
      this.heartbeatMonitor.start();

      // Set up shutdown handlers
      this.setupShutdownHandlers();

      this.isRunning = true;
      this.emit('started');

      console.log('[Hub] Started successfully');
    } catch (error) {
      console.error('[Hub] Startup failed:', error);
      await this.cleanup();
      throw error;
    }
  }

  /**
   * Start as daemon
   */
  async startDaemon(): Promise<void> {
    await this.daemonManager.start(this);
  }

  /**
   * Stop the hub
   */
  async stop(): Promise<void> {
    // Always return the same promise for multiple stop calls
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    if (!this.isRunning) {
      // Store a resolved promise for consistency
      this.shutdownPromise = Promise.resolve();
      return this.shutdownPromise;
    }

    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  /**
   * Perform shutdown
   */
  private async performShutdown(): Promise<void> {
    console.log('[Hub] Shutting down...');

    this.isRunning = false;
    this.acceptingWork = false;

    // Stop heartbeat monitoring
    this.heartbeatMonitor.stop();

    // Perform graceful shutdown
    if (this.config.shutdown.graceful) {
      await this.shutdownHandler.gracefulShutdown(this);
    }

    // Clean up resources
    await this.cleanup();

    // Remove PID file
    await this.daemonManager.cleanup();

    this.emit('stopped');
    console.log('[Hub] Stopped');
  }

  /**
   * Setup shutdown handlers
   */
  private setupShutdownHandlers(): void {
    // Skip in test environment to avoid listener accumulation
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    const shutdownSignals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];

    // Store signal handlers for cleanup
    for (const signal of shutdownSignals) {
      const handler = async () => {
        try {
          console.log(`[Hub] Received ${signal}`);
          await this.stop();
          process.exit(0);
        } catch (error) {
          console.error(`[Hub] Error during ${signal} shutdown:`, error);
          process.exit(1);
        }
      };

      this.signalHandlers.set(signal, handler);
      this.processHandlers.on(signal, handler);
    }

    // Store exception handler
    this.exceptionHandler = async (error: Error) => {
      try {
        console.error('[Hub] Uncaught exception:', error);
        this.emit('error', error);
        await this.stop();
        process.exit(1);
      } catch (stopError) {
        console.error('[Hub] Failed to stop after uncaught exception:', stopError);
        process.exit(1);
      }
    };
    this.processHandlers.onException(this.exceptionHandler);

    // Store rejection handler
    this.rejectionHandler = async (reason: unknown, promise: Promise<unknown>) => {
      try {
        console.error('[Hub] Unhandled rejection:', reason);
        this.emit('error', new Error(`Unhandled rejection: ${reason}`));
        await this.stop();
        process.exit(1);
      } catch (stopError) {
        console.error('[Hub] Failed to stop after unhandled rejection:', stopError);
        process.exit(1);
      }
    };
    this.processHandlers.onRejection(this.rejectionHandler);
  }

  /**
   * Remove shutdown handlers to prevent memory leaks
   * This method never throws - it logs errors and continues cleanup
   */
  private removeShutdownHandlers(): void {
    try {
      // Remove signal handlers
      for (const [signal, handler] of this.signalHandlers) {
        try {
          this.processHandlers.off(signal, handler);
        } catch (error) {
          console.error(`[Hub] Failed to remove signal handler for ${signal}:`, error);
        }
      }
      this.signalHandlers.clear();
    } catch (error) {
      console.error('[Hub] Failed to clear signal handlers:', error);
    }

    try {
      // Remove exception handler
      if (this.exceptionHandler) {
        this.processHandlers.offException(this.exceptionHandler);
        this.exceptionHandler = null;
      }
    } catch (error) {
      console.error('[Hub] Failed to remove exception handler:', error);
    }

    try {
      // Remove rejection handler
      if (this.rejectionHandler) {
        this.processHandlers.offRejection(this.rejectionHandler);
        this.rejectionHandler = null;
      }
    } catch (error) {
      console.error('[Hub] Failed to remove rejection handler:', error);
    }
  }

  /**
   * Clean up resources
   */
  private async cleanup(): Promise<void> {
    // Helper to safely execute cleanup operations
    const safeCleanup = async (operation: string, fn: () => void | Promise<void>): Promise<void> => {
      try {
        await fn();
      } catch (error) {
        console.error(`[Hub] Cleanup error (${operation}):`, error);
      }
    };

    // Remove shutdown handlers to prevent memory leaks
    await safeCleanup('removeShutdownHandlers', () => this.removeShutdownHandlers());

    // Stop lease manager (doesn't have a stop method, just cleanup heartbeats)
    if (this.leaseManager) {
      this.leaseManager = null;
    }

    // Stop coordination setup (includes mode manager and health checker)
    await safeCleanup('coordinationSetup', async () => {
      await this.coordinationSetup.stop();
    });

    // Disconnect Redis and cleanup
    await safeCleanup('connectionManager', async () => {
      await this.connectionManager.disconnect();
    });
  }

  /**
   * Register an agent
   */
  async registerAgent(agent: AgentInfo): Promise<void> {
    await this.agentRegistry.registerAgent(agent);
    this.emit('agent-registered', agent);
  }

  /**
   * Handle agent heartbeat
   */
  async handleHeartbeat(agentId: string): Promise<void> {
    await this.agentRegistry.handleHeartbeat(agentId);
  }

  /**
   * Reclaim work from crashed agent
   */
  private async reclaimWorkFromAgent(agentId: string): Promise<void> {
    const agent = await this.agentRegistry.getAgent(agentId);
    if (!agent || !agent.assignedPR) {
      return;
    }

    console.log(`[Hub] Reclaiming PR ${agent.assignedPR} from crashed agent ${agentId}`);

    // Release file leases
    if (this.leaseManager) {
      // Release all leases for this agent
      await this.leaseManager.releaseLease(null, agentId);
    }

    // Update PR state (transition to 'available' or appropriate state)
    const stateMachine = this.stateMachineSetup.getStateMachine();
    if (stateMachine) {
      // TODO: Implement state transition logic
    }

    // Remove agent
    await this.agentRegistry.removeAgent(agentId);
  }

  // Public getters for testing and integration

  /**
   * Check if hub is running
   */
  isHubRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Check if accepting work
   */
  isAcceptingWork(): boolean {
    return this.acceptingWork;
  }

  /**
   * Stop accepting work (for shutdown)
   */
  stopAcceptingWork(): void {
    this.acceptingWork = false;
  }

  /**
   * Get active agents
   */
  async getActiveAgents(): Promise<AgentInfo[]> {
    return this.agentRegistry.getActiveAgents();
  }

  /**
   * Check if has active agents
   */
  async hasActiveAgents(): Promise<boolean> {
    const agents = await this.getActiveAgents();
    return agents.length > 0;
  }

  /**
   * Notify agents of shutdown
   */
  async notifyAgentsOfShutdown(): Promise<void> {
    // TODO: Implement via message bus (PR-013)
    console.log('[Hub] Notifying agents of shutdown...');
  }

  /**
   * Sync final state
   */
  async syncFinalState(): Promise<void> {
    // TODO: Implement state sync (PR-010)
    console.log('[Hub] Syncing final state...');
  }

  /**
   * Release all leases
   */
  async releaseAllLeases(): Promise<void> {
    if (this.leaseManager) {
      // TODO: Add method to release all leases
      console.log('[Hub] Releasing all leases...');
    }
  }

  /**
   * Get Redis client (for testing)
   */
  getRedisClient(): RedisClient | null {
    return this.connectionManager.getClient();
  }

  /**
   * Get coordination mode
   */
  getCoordinationMode(): CoordinationMode | null {
    return this.coordinationSetup.getMode();
  }

  /**
   * Get state machine (for testing)
   */
  getStateMachine(): StateMachine | null {
    return this.stateMachineSetup.getStateMachine();
  }
}

export default Hub;