/**
 * TUI Manager
 *
 * Main Terminal UI class that orchestrates all components
 */

import * as blessed from 'blessed';
import { Widgets } from 'blessed';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { TUIConfig, ActivityLogEntry, StatusBarState, InputCommand } from './types';
import { StatusBar } from './statusBar';
import { ActivityLog } from './activityLog';
import { InputRouter } from './inputRouter';
import { RenderLoop } from './render';
import { ProgressTracker, ProgressState } from './progress';
import { DependencyGraph } from './dependencies';
import { MetricsCalculator } from './metrics';
import { getTheme } from './themes';
import { debounce } from './utils';
import { MessageBus } from '../communication/messageBus';
import { MessageType } from '../communication/types';
import { AgentRegistry } from '../hub/agentRegistry';
import { CoordinationModeManager } from '../core/coordinationMode';
import { RedisClient } from '../redis/client';
import { TaskListParser } from '../parser/taskList';
import { PRData } from '../parser/types';
import { PRState } from '../types/pr';
import { loadConfig } from '../config';

/**
 * Default TUI configuration
 */
const DEFAULT_CONFIG: Required<TUIConfig> = {
  refreshInterval: 1000,
  maxFPS: 10,
  logBufferSize: 1000,
  debug: false,
  theme: 'auto',
  redisUrl: 'redis://localhost:6379',
  taskListPath: 'docs/task-list.md',
  showProgress: true,
};

/**
 * TUI Manager
 */
export class TUIManager extends EventEmitter {
  private config: Required<TUIConfig>;
  private screen!: Widgets.Screen;
  private statusBar!: StatusBar;
  private activityLog!: ActivityLog;
  private inputRouter!: InputRouter;
  private renderLoop!: RenderLoop;
  private progressTracker!: ProgressTracker;
  private messageBus!: MessageBus;
  private agentRegistry!: AgentRegistry;
  private coordModeManager!: CoordinationModeManager;
  private redisClient!: RedisClient;
  private taskListParser!: TaskListParser;
  private dependencyGraph!: DependencyGraph;
  private metricsCalculator!: MetricsCalculator;
  private taskList: PRData[] = [];
  private progressVisible: boolean = true;
  private expandedPRs: Set<string> = new Set();
  private running: boolean = false;
  private updateInterval: NodeJS.Timeout | null = null;

  constructor(config: TUIConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize TUI
   */
  async init(): Promise<void> {
    // Initialize Redis client
    this.redisClient = new RedisClient(this.config.redisUrl);
    await this.redisClient.connect();

    // Initialize services
    this.agentRegistry = new AgentRegistry();
    await this.agentRegistry.initialize(this.redisClient);
    const healthChecker = new (await import('../redis/health')).RedisHealthChecker(this.redisClient);
    this.coordModeManager = new CoordinationModeManager(this.redisClient, healthChecker);
    await this.coordModeManager.start();
    this.messageBus = new MessageBus(this.redisClient, this.coordModeManager);
    await this.messageBus.start();

    // Create blessed screen
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Lemegeton TUI',
      cursor: {
        artificial: true,
        shape: 'line',
        blink: true,
        color: 'white',
      },
      dockBorders: true,
      fullUnicode: true,
      grabKeys: true, // Ensure keyboard events are captured
      warnings: false, // Suppress warnings
      sendFocus: true,
      ignoreLocked: ['C-c'], // Don't let widgets lock Ctrl+C
    });

    // Get theme
    const theme = getTheme(this.config.theme);

    // Initialize components
    this.statusBar = new StatusBar(theme);
    this.statusBar.init(this.screen);

    this.activityLog = new ActivityLog(this.config.logBufferSize, theme);
    this.activityLog.init(this.screen);

    this.inputRouter = new InputRouter(theme);
    this.inputRouter.init(this.screen);

    // Initialize task list parser and load task list
    this.taskListParser = new TaskListParser();
    try {
      const parsed = await this.taskListParser.parse(this.config.taskListPath);
      this.taskList = parsed.prs;
      this.dependencyGraph = new DependencyGraph(this.taskList);
      this.metricsCalculator = new MetricsCalculator(this.taskList, new Map());
    } catch (error) {
      this.log('warning', 'tui', `Failed to load task list: ${error}`);
      // Continue without task list
    }

    // Initialize progress tracker
    this.progressTracker = new ProgressTracker(theme);
    this.progressTracker.init(this.screen);
    this.progressVisible = this.config.showProgress;
    this.progressTracker.setVisible(this.progressVisible);

    // Initialize render loop
    this.renderLoop = new RenderLoop(this.screen, this.config.maxFPS);

    // Set up event handlers
    this.setupEventHandlers();

    // Set up key bindings
    this.setupKeyBindings();

    // Set up initial layout
    this.updateLayout();

    // Log initialization
    this.log('info', 'hub', 'TUI initialized');
  }

  /**
   * Start TUI
   */
  async start(): Promise<void> {
    if (this.running) return;

    this.running = true;

    // Start render loop
    this.renderLoop.start();

    // Start periodic updates
    this.updateInterval = setInterval(() => {
      this.updateStatus();
    }, this.config.refreshInterval);

    // Subscribe to message bus
    await this.messageBus.subscribe('hub-broadcast', (msg) => this.handleMessage(msg));
    await this.messageBus.subscribe('tui-updates', (msg) => this.handleMessage(msg));

    // Initial status update
    await this.updateStatus();

    // Log startup
    this.log('success', 'hub', 'TUI started');

    this.emit('started');
  }

  /**
   * Stop TUI
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;

    // Stop updates
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    // Stop render loop
    this.renderLoop.stop();

    // Unsubscribe from message bus
    await this.messageBus.unsubscribe('hub-broadcast');
    await this.messageBus.unsubscribe('tui-updates');

    // Clean up components
    this.statusBar.destroy();
    this.activityLog.destroy();
    this.inputRouter.destroy();
    this.progressTracker.destroy();

    // Destroy screen
    this.screen.destroy();

    // Disconnect Redis
    await this.redisClient.disconnect();

    this.log('info', 'hub', 'TUI stopped');

    this.emit('stopped');
  }

  /**
   * Set up event handlers
   */
  private setupEventHandlers(): void {
    // Input router events
    this.inputRouter.on('command', (command: InputCommand) => {
      this.handleCommand(command);
    });

    // Message bus events
    this.messageBus.on('messageReceived', (message: any) => {
      this.handleMessage(message);
    });

    // Coordination mode change events
    this.coordModeManager.on('modeChanged', (mode: any) => {
      this.log('warning', 'hub', `Coordination mode changed to ${mode}`);
      this.updateStatus();
    });

    // Screen events
    this.screen.on('resize', debounce(() => {
      this.updateLayout();
      this.renderLoop.forceRender();
    }, 100));
  }

  /**
   * Set up key bindings
   */
  private setupKeyBindings(): void {
    // Quit on Ctrl+C or q
    this.screen.key(['C-c', 'q'], async () => {
      this.log('info', 'tui', 'Shutting down...');
      await this.stop();
      process.exit(0);
    });

    // Additional fallback for Ctrl+C (works better on Windows)
    this.screen.key(['escape', 'escape'], async () => {
      this.log('info', 'tui', 'Double-ESC detected, shutting down...');
      await this.stop();
      process.exit(0);
    });

    // Clear log on Ctrl+L
    this.screen.key(['C-l'], () => {
      this.activityLog.clear();
      this.log('info', 'tui', 'Log cleared');
    });

    // Help on ?
    this.screen.key(['?'], () => {
      this.showHelp();
    });

    // Focus input on i or Enter
    this.screen.key(['i', 'enter'], () => {
      this.inputRouter.focus();
    });

    // Escape to blur input
    this.screen.key(['escape'], () => {
      this.screen.focusNext();
    });

    // Toggle progress panel on 'p'
    this.screen.key(['p'], () => {
      this.progressVisible = !this.progressVisible;
      this.progressTracker.setVisible(this.progressVisible);
      this.updateLayout();
      this.log('info', 'tui', `Progress panel ${this.progressVisible ? 'shown' : 'hidden'}`);
    });

    // Expand/collapse dependency tree on 'e'
    this.screen.key(['e'], () => {
      const focusedPR = this.progressTracker.getFocusedPR();
      if (focusedPR) {
        this.progressTracker.toggleExpansion(focusedPR);
      }
    });
  }

  /**
   * Handle command from input router
   */
  private async handleCommand(command: InputCommand): Promise<void> {
    switch (command.type) {
      case 'system':
        await this.handleSystemCommand(command.payload);
        break;

      case 'direct':
        if (command.target) {
          await this.sendDirectMessage(command.target, command.payload);
        }
        break;

      case 'broadcast':
        await this.sendBroadcastMessage(command.payload);
        break;
    }
  }

  /**
   * Handle system command
   */
  private async handleSystemCommand(cmd: string): Promise<void> {
    const parts = cmd.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (command) {
      case 'help':
        this.showHelp();
        break;

      case 'quit':
      case 'exit':
        await this.stop();
        process.exit(0);
        break;

      case 'clear':
        this.activityLog.clear();
        this.log('info', 'tui', 'Log cleared');
        break;

      case 'filter':
        if (args.length === 0) {
          this.activityLog.clearFilter();
          this.log('info', 'tui', 'Filter cleared');
        } else if (args[0] === 'agent' && args[1]) {
          this.activityLog.setFilter({ agent: args[1] });
          this.log('info', 'tui', `Filtering by agent: ${args[1]}`);
        } else if (args[0] === 'type' && args[1]) {
          this.activityLog.setFilter({ type: args[1] as any });
          this.log('info', 'tui', `Filtering by type: ${args[1]}`);
        }
        break;

      case 'stats':
        await this.showStats();
        break;

      default:
        this.log('error', 'tui', `Unknown command: ${command}`);
    }
  }

  /**
   * Send direct message to agent
   */
  private async sendDirectMessage(agentId: string, message: string): Promise<void> {
    try {
      await this.messageBus.publishToAgent(agentId, {
        id: `tui-${Date.now()}`,
        timestamp: Date.now(),
        type: MessageType.CUSTOM,
        from: 'tui',
        to: agentId,
        payload: { content: message },
      });
      this.log('info', 'tui', `→ @${agentId}: ${message}`);
    } catch (error) {
      this.log('error', 'tui', `Failed to send message to ${agentId}: ${error}`);
    }
  }

  /**
   * Send broadcast message to all agents
   */
  private async sendBroadcastMessage(message: string): Promise<void> {
    try {
      await this.messageBus.broadcast({
        id: `tui-${Date.now()}`,
        timestamp: Date.now(),
        type: MessageType.CUSTOM,
        from: 'tui',
        payload: { content: message },
      });
      this.log('info', 'tui', `→ [broadcast]: ${message}`);
    } catch (error) {
      this.log('error', 'tui', `Failed to broadcast message: ${error}`);
    }
  }

  /**
   * Handle message from message bus
   */
  private handleMessage(message: any): void {
    const entry: ActivityLogEntry = {
      timestamp: new Date(message.timestamp || Date.now()),
      source: message.from || 'unknown',
      type: message.level || 'info',
      message: message.content || message.message || JSON.stringify(message),
      metadata: message,
    };

    this.activityLog.addEntry(entry);
  }

  /**
   * Timeout wrapper for async operations
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    defaultValue: T
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((resolve) =>
        setTimeout(() => {
          if (this.config.debug) {
            this.log('warning', 'tui', `Operation timed out after ${timeoutMs}ms`);
          }
          resolve(defaultValue);
        }, timeoutMs)
      ),
    ]);
  }

  /**
   * Update status bar
   */
  private async updateStatus(): Promise<void> {
    try {
      // Use timeouts for all async operations to prevent freeze when hub stops
      const agents = await this.withTimeout(
        this.agentRegistry.getActiveAgents(),
        2000,
        []
      );
      const mode = this.coordModeManager.getMode();
      const activePRs = await this.withTimeout(
        this.getActivePRCount(),
        2000,
        0
      );

      // Check hub daemon status (most likely to block)
      const { hubRunning, hubPid, hubLocation } = await this.withTimeout(
        this.checkHubStatus(),
        2000,
        { hubRunning: false }
      );

      const state: StatusBarState = {
        mode,
        agents,
        activePRs,
        maxAgents: 10, // TODO: Get from config
        connected: this.redisClient.isConnected(),
        hubRunning,
        hubPid,
        hubLocation,
      };

      this.statusBar.update(state);

      // Update progress tracker if task list is loaded
      if (this.taskList.length > 0) {
        await this.withTimeout(
          this.updateProgress(),
          2000,
          undefined
        );
      }
    } catch (error) {
      if (this.config.debug) {
        this.log('error', 'tui', `Failed to update status: ${error}`);
      }
    }
  }

  /**
   * Update progress tracker
   */
  private async updateProgress(): Promise<void> {
    try {
      const prStates = await this.getAllPRStates();

      // Update metrics calculator
      if (this.metricsCalculator) {
        this.metricsCalculator.updateStates(prStates);
      }

      // Update progress tracker
      const progressState: ProgressState = {
        allPRs: this.taskList,
        prStates,
        dependencies: this.dependencyGraph.getDependencyMap(),
        expandedPRs: this.expandedPRs,
        scrollOffset: 0,
      };

      this.progressTracker.update(progressState);
    } catch (error) {
      if (this.config.debug) {
        this.log('error', 'tui', `Failed to update progress: ${error}`);
      }
    }
  }

  /**
   * Update layout (split-pane or full-width)
   */
  private updateLayout(): void {
    if (!this.screen) {
      return;
    }

    // Simply show/hide the progress panel
    // The widgets maintain their original positioning which is more stable
    // and doesn't cause circular dependency issues in blessed's coordinate system
    this.progressTracker.setVisible(this.progressVisible);

    this.renderLoop.forceRender();
  }

  /**
   * Get active PR count
   */
  private async getActivePRCount(): Promise<number> {
    // TODO: Implement actual PR counting from state sync
    const agents = await this.agentRegistry.getActiveAgents();
    const prSet = new Set<string>();

    for (const agent of agents) {
      if (agent.assignedPR) {
        prSet.add(agent.assignedPR);
      }
    }

    return prSet.size;
  }

  /**
   * Check hub daemon status
   */
  private async checkHubStatus(): Promise<{ hubRunning: boolean; hubPid?: number; hubLocation?: 'local' | 'remote' }> {
    try {
      const pidFile = path.join(process.cwd(), '.lemegeton', 'hub.pid');
      const pidContent = await fs.readFile(pidFile, 'utf-8');
      const pid = parseInt(pidContent.trim(), 10);

      if (isNaN(pid)) {
        return { hubRunning: false };
      }

      // Check if process is running
      try {
        process.kill(pid, 0);
        // Process exists, it's local
        return { hubRunning: true, hubPid: pid, hubLocation: 'local' };
      } catch {
        // Process doesn't exist, clean up stale PID file
        await fs.unlink(pidFile).catch(() => {});
        return { hubRunning: false };
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // No PID file, check if hub might be remote by checking Redis
        // If we're connected to Redis but no local PID, assume remote
        if (this.redisClient.isConnected()) {
          const config = loadConfig();
          const isRemoteRedis = config.redis?.url && !config.redis.url.includes('localhost') && !config.redis.url.includes('127.0.0.1');
          if (isRemoteRedis) {
            // Remote Redis suggests remote hub - check if hub is actually running by trying to read hub status from Redis
            try {
              const hubStatus = await this.redisClient.execute(client => client.get('hub:status'));
              if (hubStatus) {
                return { hubRunning: true, hubLocation: 'remote' };
              }
            } catch {
              // Can't check remote hub status
            }
          }
        }
      }
      return { hubRunning: false };
    }
  }

  /**
   * Get all PR states from Redis
   */
  private async getAllPRStates(): Promise<Map<string, PRState>> {
    const states = new Map<string, PRState>();

    // Get PR states from task list and Redis
    for (const pr of this.taskList) {
      // For now, use the cold state from task list
      // In a real implementation, this would query Redis/StateSync
      const state: PRState = {
        pr_id: pr.pr_id,
        cold_state: pr.cold_state,
        dependencies: pr.dependencies || [],
        files_locked: [],
        last_transition: new Date().toISOString(),
      };

      states.set(pr.pr_id, state);
    }

    return states;
  }

  /**
   * Show help
   */
  private showHelp(): void {
    const help = [
      'Lemegeton TUI Help',
      '',
      'System Commands:',
      '  /help              Show this help',
      '  /quit, /exit       Exit TUI',
      '  /clear             Clear activity log',
      '  /filter agent <id> Filter by agent',
      '  /filter type <type> Filter by message type',
      '  /filter            Clear filter',
      '  /stats             Show statistics',
      '',
      'Messaging:',
      '  @agent-id message  Send direct message to agent',
      '  message            Broadcast to all agents',
      '',
      'Keyboard Shortcuts:',
      '  Ctrl+C, q         Quit TUI',
      '  ESC ESC           Quit TUI (fallback for Windows)',
      '  Ctrl+L            Clear log',
      '  ?                  Show help',
      '  p                  Toggle progress panel',
      '  e                  Expand/collapse dependencies',
      '  i, Enter           Focus input',
      '  Escape             Unfocus input',
      '  ↑↓                 Scroll log or command history',
      '  PageUp/PageDown    Scroll progress panel',
    ];

    for (const line of help) {
      this.log('info', 'help', line);
    }
  }

  /**
   * Show statistics
   */
  private async showStats(): Promise<void> {
    const logStats = this.activityLog.getStats();
    const renderStats = this.renderLoop.getStats();
    const agents = await this.agentRegistry.getActiveAgents();

    const stats = [
      'Statistics:',
      `  Active Agents: ${agents.length}`,
      `  Log Entries: ${logStats.total} (${logStats.filtered} filtered)`,
      `  Render FPS: ${renderStats.fps.toFixed(1)}`,
      `  Render Count: ${renderStats.renderCount}`,
    ];

    for (const stat of stats) {
      this.log('info', 'stats', stat);
    }
  }

  /**
   * Log message to activity log
   */
  private log(
    type: ActivityLogEntry['type'],
    source: string,
    message: string
  ): void {
    this.activityLog.addEntry({
      timestamp: new Date(),
      source,
      type,
      message,
    });
  }

  /**
   * Check if TUI is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get configuration
   */
  getConfig(): Required<TUIConfig> {
    return { ...this.config };
  }
}

/**
 * Export components for testing
 */
export { StatusBar } from './statusBar';
export { ActivityLog } from './activityLog';
export { InputRouter } from './inputRouter';
export { RenderLoop } from './render';
export { ProgressTracker } from './progress';
export { DependencyGraph } from './dependencies';
export { MetricsCalculator, MetricsFormatter } from './metrics';
export * from './types';
