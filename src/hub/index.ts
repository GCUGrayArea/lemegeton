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
import { RedisClient, RedisConnectionState } from '../redis/client';
import { RedisAutoSpawner } from '../redis/autoSpawn';
import { CoordinationModeManager, CoordinationMode } from '../core/coordinationMode';
import { StateMachine } from '../core/stateMachine';
import { LeaseManager } from '../core/leaseManager';
import { RedisHealthChecker } from '../redis/health';
import { loadConfig, LemegetonConfig } from '../config';
import { DaemonManager } from './daemon';
import { StartupSequence } from './startup';
import { ShutdownHandler } from './shutdown';
import { AgentRegistry, AgentInfo, AgentType } from './agentRegistry';
import { MessageBus } from '../communication/messageBus';
import { Scheduler } from '../scheduler';
import { AgentSpawner } from './agentSpawner';
import { ProcessManager } from './processManager';

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
  private redisClient: RedisClient | null = null;
  private redisAutoSpawner: RedisAutoSpawner | null = null;
  private healthChecker: RedisHealthChecker | null = null;
  private coordinationMode: CoordinationModeManager | null = null;
  private stateMachine: StateMachine | null = null;
  private leaseManager: LeaseManager | null = null;
  private daemonManager: DaemonManager;
  private startupSequence: StartupSequence | null = null;
  private shutdownHandler: ShutdownHandler;
  private agentRegistry: AgentRegistry;
  private messageBus: MessageBus | null = null;
  private scheduler: Scheduler | null = null;
  private agentSpawner: AgentSpawner | null = null;
  private processManager: ProcessManager | null = null;
  private isRunning: boolean = false;
  private shutdownPromise: Promise<void> | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private acceptingWork: boolean = true;

  constructor(config: HubConfig = {}) {
    super();
    this.config = {
      ...DEFAULT_HUB_CONFIG,
      redis: { ...DEFAULT_HUB_CONFIG.redis, ...config.redis },
      daemon: { ...DEFAULT_HUB_CONFIG.daemon, ...config.daemon },
      heartbeat: { ...DEFAULT_HUB_CONFIG.heartbeat, ...config.heartbeat },
      shutdown: { ...DEFAULT_HUB_CONFIG.shutdown, ...config.shutdown },
    };

    this.daemonManager = new DaemonManager(this.config.daemon);
    this.shutdownHandler = new ShutdownHandler(this.config.shutdown);
    this.agentRegistry = new AgentRegistry(this.config.heartbeat);
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
      await this.initializeRedis();

      // Initialize coordination mode manager
      await this.initializeCoordination();

      // Initialize state machine
      await this.initializeStateMachine();

      // Initialize lease manager
      await this.initializeLeaseManager();

      // Initialize message bus
      await this.initializeMessageBus();

      // Initialize scheduler
      await this.initializeScheduler();

      // Initialize agent spawner and process manager
      await this.initializeProcessManager();

      // Create startup sequence
      this.startupSequence = new StartupSequence(
        this.redisClient!,
        this.config.daemon.workDir
      );

      // Parse task list and hydrate state
      await this.startupSequence.hydrateFromGit();

      // Initialize agent registry
      await this.agentRegistry.initialize(this.redisClient!);

      // Start heartbeat monitoring
      this.startHeartbeatMonitoring();

      // Subscribe to work requests (for daemon mode)
      await this.subscribeToWorkRequests();

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
    this.stopHeartbeatMonitoring();

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
   * Initialize Redis connection
   */
  private async initializeRedis(): Promise<void> {
    const appConfig = loadConfig();

    // Use singleton Redis client
    this.redisClient = new RedisClient(
      appConfig.redis?.url || this.config.redis.url
    );

    // If autoSpawn is enabled, try to spawn Redis Docker container if needed
    if (this.config.redis.autoSpawn) {
      this.redisAutoSpawner = new RedisAutoSpawner(this.redisClient);

      try {
        console.log('[Hub] Attempting to connect to Redis (with auto-spawn if needed)...');
        await this.redisAutoSpawner.connectWithFallback(this.redisClient);
        console.log('[Hub] Redis connection established');
      } catch (error) {
        console.error('[Hub] Failed to connect to Redis even with auto-spawn:', error);
        throw error;
      }
    } else {
      // Connect normally without auto-spawn
      if (this.redisClient.getState() !== RedisConnectionState.CONNECTED) {
        await this.redisClient.connect();
      }
    }
  }

  /**
   * Initialize coordination mode manager
   */
  private async initializeCoordination(): Promise<void> {
    // Create health checker
    this.healthChecker = new RedisHealthChecker(this.redisClient!);
    this.healthChecker.start();

    // Create coordination mode manager
    this.coordinationMode = new CoordinationModeManager(
      this.redisClient!,
      this.healthChecker
    );

    // Start coordination mode manager
    await this.coordinationMode.start();

    // Listen for mode changes
    this.coordinationMode.on('modeChanged', (from, to) => {
      console.log(`[Hub] Coordination mode changed: ${from} → ${to}`);
      this.emit('mode-changed', from, to);
    });
  }

  /**
   * Initialize state machine
   */
  private async initializeStateMachine(): Promise<void> {
    // Create git committer (simplified for now)
    const gitCommitter = {
      commit: async (message: string, metadata: any) => {
        console.log(`[Hub] Would commit: ${message}`);
        console.log(`[Hub] Metadata:`, metadata);
        // TODO: Implement actual git operations in PR-010
      }
    };

    // Create state event emitter (uses hub's event emitter)
    const stateEventEmitter = {
      emit: (event: string, ...args: any[]) => {
        this.emit(event, ...args);
      }
    };

    this.stateMachine = new StateMachine(gitCommitter, stateEventEmitter);
  }

  /**
   * Initialize lease manager
   */
  private async initializeLeaseManager(): Promise<void> {
    this.leaseManager = new LeaseManager(this.redisClient!);
    // LeaseManager doesn't have a start method - it's ready to use immediately
  }

  /**
   * Initialize message bus
   */
  private async initializeMessageBus(): Promise<void> {
    this.messageBus = new MessageBus(
      this.redisClient!,
      this.coordinationMode!
    );
    await this.messageBus.start();
  }

  /**
   * Initialize scheduler
   */
  private async initializeScheduler(): Promise<void> {
    this.scheduler = new Scheduler();
    // Scheduler will be initialized with task list from startup sequence
  }

  /**
   * Initialize agent spawner and process manager
   */
  private async initializeProcessManager(): Promise<void> {
    this.agentSpawner = new AgentSpawner({
      redisUrl: this.redisClient!.getClient() ? this.config.redis.url : undefined,
      workDir: this.config.daemon.workDir,
    });

    this.processManager = new ProcessManager(
      this.agentSpawner,
      this.agentRegistry,
      {
        maxAgents: 10,
        autoRestart: true,
      }
    );
  }

  /**
   * Start heartbeat monitoring
   */
  private startHeartbeatMonitoring(): void {
    this.heartbeatTimer = setInterval(async () => {
      try {
        // Check for crashed agents
        const crashed = await this.agentRegistry.checkForCrashedAgents();

        for (const agentId of crashed) {
          console.log(`[Hub] Agent crashed: ${agentId}`);
          this.emit('agent-crashed', agentId);

          // Reclaim work from crashed agent
          await this.reclaimWorkFromAgent(agentId);
        }
      } catch (error) {
        console.error('[Hub] Heartbeat monitoring error:', error);
      }
    }, this.config.heartbeat.interval);
  }

  /**
   * Stop heartbeat monitoring
   */
  private stopHeartbeatMonitoring(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Subscribe to work requests from CLI
   */
  private async subscribeToWorkRequests(): Promise<void> {
    if (!this.messageBus) {
      return;
    }

    const channel = 'hub:work-requests';
    await this.messageBus.subscribe(channel, async (message: any) => {
      try {
        console.log('[Hub] Received work request:', message.payload?.prId || message.prId);
        await this.handleWorkRequest(message);
      } catch (error) {
        console.error('[Hub] Error handling work request:', error);
      }
    });

    console.log('[Hub] Subscribed to work requests on:', channel);
  }

  /**
   * Handle work request from CLI
   */
  private async handleWorkRequest(message: any): Promise<void> {
    const payload = message.payload || message;
    const { prId, requestId, options = {} } = payload;

    if (!prId || !requestId) {
      console.error('[Hub] Invalid work request: missing prId or requestId');
      return;
    }

    // Check if accepting work
    if (!this.acceptingWork) {
      await this.sendWorkResponse(requestId, {
        success: false,
        prId,
        error: 'Hub is shutting down',
      });
      return;
    }

    try {
      // Get PR from scheduler
      const prNode = this.scheduler?.getPRNode(prId);
      if (!prNode) {
        await this.sendWorkResponse(requestId, {
          success: false,
          prId,
          error: `PR ${prId} not found`,
        });
        return;
      }

      // Determine agent type based on PR state
      const agentType = this.getAgentTypeForState(prNode.state);
      if (!agentType) {
        await this.sendWorkResponse(requestId, {
          success: false,
          prId,
          error: `No agent type for state: ${prNode.state}`,
        });
        return;
      }

      // Spawn agent
      const spawnedAgent = await this.agentSpawner!.spawnAgent({ agentType });
      const agentId = spawnedAgent.agentId;
      console.log(`[Hub] Spawned ${agentType} agent: ${agentId}`);

      // Wait for agent to initialize (2 seconds)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Send assignment to agent
      const { MessageType } = await import('../communication/types');
      const assignmentChannel = `agent:${agentId}:assignments`;
      const assignment = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        timestamp: Date.now(),
        type: MessageType.ASSIGNMENT,
        from: 'hub',
        to: agentId,
        payload: {
          prId: prNode.id,
          assignedAt: Date.now(),
          priority: prNode.priority,
          complexity: prNode.complexity,
          estimatedDuration: prNode.estimatedMinutes,
          files: Array.from(prNode.files),
        },
      };

      await this.messageBus!.publish(assignmentChannel, assignment);
      console.log(`[Hub] Assigned ${prId} to ${agentId}`);

      // Subscribe to completion
      const hubChannel = 'hub:messages';
      const completionHandler = async (completionMessage: any) => {
        const agentMsg = completionMessage.payload || completionMessage;

        if (agentMsg.agentId === agentId) {
          if (agentMsg.type === 'complete') {
            await this.sendWorkResponse(requestId, agentMsg.result);
          } else if (agentMsg.type === 'failed') {
            await this.sendWorkResponse(requestId, {
              success: false,
              prId,
              error: agentMsg.error?.message || 'Agent failed',
            });
          }
        }
      };

      await this.messageBus!.subscribe(hubChannel, completionHandler);

      // Set timeout
      const timeout = options.timeout || 120000; // 2 minutes default
      setTimeout(async () => {
        await this.sendWorkResponse(requestId, {
          success: false,
          prId,
          error: 'Timeout waiting for completion',
        });
      }, timeout);
    } catch (error) {
      console.error('[Hub] Error processing work request:', error);
      await this.sendWorkResponse(requestId, {
        success: false,
        prId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Send work response back to CLI
   */
  private async sendWorkResponse(requestId: string, result: any): Promise<void> {
    if (!this.messageBus) {
      return;
    }

    const responseChannel = `hub:work-responses:${requestId}`;
    const { MessageType } = await import('../communication/types');

    const message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      timestamp: Date.now(),
      type: MessageType.CUSTOM,
      from: 'hub',
      payload: result,
    };

    await this.messageBus.publish(responseChannel, message);
    console.log(`[Hub] Sent work response for request ${requestId}`);
  }

  /**
   * Get agent type for PR state
   */
  private getAgentTypeForState(state: string): AgentType | null {
    switch (state) {
      case 'new':
        return 'planning';
      case 'planned':
        return 'worker';
      case 'implemented':
        return 'qc';
      case 'testing':
        return 'review';
      default:
        return null;
    }
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

    for (const signal of shutdownSignals) {
      process.on(signal, async () => {
        console.log(`[Hub] Received ${signal}`);
        await this.stop();
        process.exit(0);
      });
    }

    // Handle uncaught errors
    process.on('uncaughtException', async (error) => {
      console.error('[Hub] Uncaught exception:', error);
      this.emit('error', error);
      await this.stop();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason, promise) => {
      console.error('[Hub] Unhandled rejection:', reason);
      this.emit('error', new Error(`Unhandled rejection: ${reason}`));
      await this.stop();
      process.exit(1);
    });
  }

  /**
   * Clean up resources
   */
  private async cleanup(): Promise<void> {
    try {
      // Stop process manager and agents
      if (this.processManager) {
        await this.processManager.shutdownAll();
      }

      // Stop message bus
      if (this.messageBus) {
        await this.messageBus.stop();
      }

      // Stop lease manager (doesn't have a stop method, just cleanup heartbeats)
      if (this.leaseManager) {
        // LeaseManager will be garbage collected
      }

      // Stop coordination mode manager
      if (this.coordinationMode) {
        await this.coordinationMode.stop();
      }

      // Stop health checker
      if (this.healthChecker) {
        this.healthChecker.stop();
      }

      // Disconnect Redis
      if (this.redisClient) {
        await this.redisClient.disconnect();
      }

      // Clean up auto-spawned Redis container
      if (this.redisAutoSpawner) {
        await this.redisAutoSpawner.cleanup();
      }
    } catch (error) {
      console.error('[Hub] Cleanup error:', error);
    }
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
    if (this.stateMachine) {
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
    return this.redisClient;
  }

  /**
   * Get coordination mode
   */
  getCoordinationMode(): CoordinationMode | null {
    return this.coordinationMode?.getMode() || null;
  }

  /**
   * Get message bus
   */
  getMessageBus(): MessageBus | null {
    return this.messageBus;
  }

  /**
   * Get scheduler
   */
  getScheduler(): Scheduler | null {
    return this.scheduler;
  }

  /**
   * Get agent spawner
   */
  getAgentSpawner(): AgentSpawner | null {
    return this.agentSpawner;
  }

  /**
   * Get process manager
   */
  getProcessManager(): ProcessManager | null {
    return this.processManager;
  }

  /**
   * Get state machine
   */
  getStateMachine(): StateMachine | null {
    return this.stateMachine;
  }

  /**
   * Get lease manager
   */
  getLeaseManager(): LeaseManager | null {
    return this.leaseManager;
  }
}

export default Hub;