# PR-015: Terminal UI (TUI) Implementation - Detailed Plan

**Status:** Planning  
**Complexity:** 7/10  
**Estimated Time:** 70 minutes  
**Dependencies:** PR-014 (CLI), PR-013 (Message Bus)  
**Created:** 2025-11-15

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Technology Choice](#technology-choice)
3. [Architecture Overview](#architecture-overview)
4. [Component Design](#component-design)
5. [Integration Points](#integration-points)
6. [File Structure](#file-structure)
7. [Implementation Details](#implementation-details)
8. [Key Challenges & Solutions](#key-challenges--solutions)
9. [Testing Strategy](#testing-strategy)
10. [Acceptance Criteria](#acceptance-criteria)

---

## Executive Summary

Implement a single-shell Terminal UI (TUI) that provides real-time visibility into the Lemegeton orchestration system. The TUI will display active agents, their status, activity logs, and coordination mode while routing user input to appropriate agents.

**Key Requirements:**
- Real-time agent status display
- Live activity log with agent actions
- User input routing to correct agent
- Coordination mode indicator
- Clean terminal handling and graceful shutdown

---

## Technology Choice

### Recommendation: **blessed** with **blessed-contrib**

**Rationale:**

1. **Mature & Stable**
   - 10+ years of production use
   - 17k+ GitHub stars
   - Extensive documentation
   - Active maintenance

2. **Feature Complete**
   - Full widget library (boxes, lists, tables, logs)
   - Mouse support (optional)
   - Comprehensive styling system
   - Excellent event handling

3. **Terminal Compatibility**
   - Works on all major terminals (xterm, iTerm2, Windows Terminal)
   - Proper ANSI escape sequence handling
   - Auto-detects terminal capabilities

4. **Performance**
   - Efficient screen updates (diff-based rendering)
   - Handles high-frequency updates well
   - Low memory footprint

**Alternatives Considered:**

| Library | Pros | Cons | Decision |
|---------|------|------|----------|
| **ink** | React-like API, modern | Requires React knowledge, larger bundle | Rejected - unnecessary complexity |
| **terminal-kit** | Good docs, feature-rich | Less mature than blessed, smaller community | Rejected - blessed more proven |
| **cli-ux** | Simple API | Too basic for our needs | Rejected - insufficient features |
| **neo-blessed** | blessed fork with updates | Smaller community, less stable | Rejected - blessed main branch is fine |

**Dependencies:**
```json
{
  "dependencies": {
    "blessed": "^0.1.81",
    "blessed-contrib": "^4.11.0",
    "chalk": "^5.3.0"  // For color utilities
  },
  "devDependencies": {
    "@types/blessed": "^0.1.21"
  }
}
```

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                         TUI Manager                             │
│  - Initialize blessed screen                                   │
│  - Coordinate all components                                   │
│  - Handle lifecycle (start/stop)                               │
└────────────────────────────────────────────────────────────────┘
                              │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ Status Bar   │   │ Activity Log │   │ Input Router │
│              │   │              │   │              │
│ - Agent list │   │ - Live feed  │   │ - Parse cmd  │
│ - Mode badge │   │ - Filter by  │   │ - Route msg  │
│ - Stats      │   │   agent      │   │ - Handle /   │
└──────────────┘   └──────────────┘   └──────────────┘
        │                    │                    │
        └────────────────────┼────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  Render Loop   │
                    │  - Smart diff  │
                    │  - Throttle    │
                    │  - Screen sync │
                    └────────────────┘
```

**Key Design Principles:**

1. **Event-Driven Architecture**
   - MessageBus provides agent activity events
   - CoordinationModeManager provides mode change events
   - AgentRegistry provides agent status events

2. **Component Isolation**
   - Each UI component is independent
   - Components communicate via events
   - Easy to test and modify

3. **Performance-First**
   - Throttled updates (max 10 FPS)
   - Diff-based rendering (only update changed regions)
   - Efficient data structures

4. **Graceful Degradation**
   - Works in minimal terminals (80x24)
   - Mouse support is optional
   - Falls back to simpler UI if terminal doesn't support features

---

## Component Design

### 1. TUI Manager (`src/tui/index.ts`)

**Responsibilities:**
- Initialize blessed screen
- Create and coordinate UI components
- Subscribe to system events (MessageBus, AgentRegistry, CoordinationModeManager)
- Handle graceful shutdown
- Manage keyboard shortcuts

**Interface:**
```typescript
export interface TUIConfig {
  // Display settings
  refreshRate?: number;         // Max FPS (default: 10)
  logHistorySize?: number;      // Max log entries (default: 1000)
  enableMouse?: boolean;        // Enable mouse support (default: false)
  
  // Filter settings
  showAllMessages?: boolean;    // Show system messages (default: false)
  filterByAgent?: string;       // Filter log by agent ID
  
  // Color scheme
  theme?: 'dark' | 'light' | 'auto';  // Terminal theme (default: 'auto')
}

export class TUIManager {
  private screen: blessed.Widgets.Screen;
  private statusBar: StatusBar;
  private activityLog: ActivityLog;
  private inputRouter: InputRouter;
  private renderLoop: RenderLoop;
  
  // Event sources
  private messageBus: IMessageBus;
  private agentRegistry: AgentRegistry;
  private coordinationMode: CoordinationModeManager;
  
  constructor(
    messageBus: IMessageBus,
    agentRegistry: AgentRegistry,
    coordinationMode: CoordinationModeManager,
    config: TUIConfig = {}
  );
  
  async start(): Promise<void>;
  async stop(): Promise<void>;
  
  // Internal methods
  private setupScreen(): void;
  private setupComponents(): void;
  private setupEventListeners(): void;
  private setupKeyBindings(): void;
  private handleResize(): void;
}
```

**Key Methods:**
```typescript
async start(): Promise<void> {
  // 1. Initialize blessed screen
  this.setupScreen();
  
  // 2. Create UI components
  this.setupComponents();
  
  // 3. Subscribe to system events
  this.setupEventListeners();
  
  // 4. Setup keyboard shortcuts
  this.setupKeyBindings();
  
  // 5. Start render loop
  await this.renderLoop.start();
  
  // 6. Initial render
  this.screen.render();
}

async stop(): Promise<void> {
  // 1. Stop render loop
  await this.renderLoop.stop();
  
  // 2. Unsubscribe from events
  this.messageBus.unsubscribeAll();
  
  // 3. Destroy blessed screen (restore terminal)
  this.screen.destroy();
}
```

---

### 2. Status Bar (`src/tui/statusBar.ts`)

**Responsibilities:**
- Display active agents with their status
- Show coordination mode badge
- Display system statistics (agents, PRs, costs)
- Update in real-time based on AgentRegistry changes

**Layout:**
```
┌───────────────────────────────────────────────────────────────┐
│ Mode: DISTRIBUTED │ Agents: 4/10 │ Active PRs: 7 │ Cost: $2.34 │
├───────────────────────────────────────────────────────────────┤
│ worker-1 [WORKING] PR-005 │ worker-2 [IDLE] │ qc-1 [WORKING] │
└───────────────────────────────────────────────────────────────┘
```

**Interface:**
```typescript
export interface StatusBarConfig {
  height: number;              // Lines (default: 3)
  showCosts?: boolean;         // Show cost tracking (default: true)
  updateInterval?: number;     // Update frequency (default: 1000ms)
}

export class StatusBar {
  private container: blessed.Widgets.BoxElement;
  private modeBox: blessed.Widgets.BoxElement;
  private statsBox: blessed.Widgets.BoxElement;
  private agentsBox: blessed.Widgets.BoxElement;
  
  constructor(
    screen: blessed.Widgets.Screen,
    agentRegistry: AgentRegistry,
    coordinationMode: CoordinationModeManager,
    config: StatusBarConfig = {}
  );
  
  update(agents: AgentInfo[], mode: CoordinationMode): void;
  render(): void;
  
  private formatAgentStatus(agent: AgentInfo): string;
  private getModeBadge(mode: CoordinationMode): string;
  private getStatsLine(): string;
}
```

**Implementation Details:**
```typescript
private formatAgentStatus(agent: AgentInfo): string {
  const statusColors = {
    active: '{green-fg}',
    idle: '{yellow-fg}',
    working: '{cyan-fg}',
    crashed: '{red-fg}'
  };
  
  const color = statusColors[agent.status];
  const badge = agent.assignedPR 
    ? `[${agent.status.toUpperCase()}] ${agent.assignedPR}`
    : `[${agent.status.toUpperCase()}]`;
  
  return `${color}${agent.id} ${badge}{/}`;
}

private getModeBadge(mode: CoordinationMode): string {
  const badges = {
    distributed: '{green-fg}{bold}✓ DISTRIBUTED{/}',
    degraded: '{yellow-fg}{bold}⚠ DEGRADED{/}',
    isolated: '{red-fg}{bold}⨯ ISOLATED{/}'
  };
  return badges[mode];
}
```

---

### 3. Activity Log (`src/tui/activityLog.ts`)

**Responsibilities:**
- Display live feed of agent activities
- Show messages from MessageBus
- Support filtering by agent or message type
- Auto-scroll to bottom
- Searchable history

**Layout:**
```
┌─────────────────── Activity Log ──────────────────────────────┐
│ [10:23:45] worker-1: Acquired lease for src/auth/login.ts     │
│ [10:23:46] worker-1: Starting work on PR-005                  │
│ [10:23:50] qc-1: Testing PR-004 (12 tests)                    │
│ [10:23:52] worker-2: Requesting work assignment               │
│ [10:23:53] hub: Assigned PR-006 to worker-2                   │
│ [10:23:55] worker-1: Committed changes for PR-005             │
│ [10:23:56] qc-1: All tests passed for PR-004                  │
│ [Auto-scrolling] Filter: [all] | Search: /pattern             │
└───────────────────────────────────────────────────────────────┘
```

**Interface:**
```typescript
export interface ActivityLogConfig {
  maxLines: number;            // Max entries (default: 1000)
  autoScroll?: boolean;        // Auto-scroll to bottom (default: true)
  showTimestamps?: boolean;    // Show timestamps (default: true)
  timestampFormat?: string;    // Timestamp format (default: 'HH:mm:ss')
  filterTypes?: MessageType[]; // Filter message types
}

export interface LogEntry {
  timestamp: number;
  agentId: string;
  message: string;
  type: MessageType;
  level: 'info' | 'warn' | 'error' | 'debug';
}

export class ActivityLog {
  private log: blessed.Widgets.Log;
  private entries: LogEntry[] = [];
  private filterAgent: string | null = null;
  private searchPattern: string | null = null;
  
  constructor(
    screen: blessed.Widgets.Screen,
    messageBus: IMessageBus,
    config: ActivityLogConfig = {}
  );
  
  addEntry(entry: LogEntry): void;
  filter(agentId: string | null): void;
  search(pattern: string | null): void;
  clear(): void;
  
  private formatEntry(entry: LogEntry): string;
  private shouldDisplay(entry: LogEntry): boolean;
}
```

**Message Formatting:**
```typescript
private formatEntry(entry: LogEntry): string {
  const timestamp = new Date(entry.timestamp)
    .toLocaleTimeString('en-US', { hour12: false });
  
  const levelColors = {
    info: '{white-fg}',
    warn: '{yellow-fg}',
    error: '{red-fg}',
    debug: '{gray-fg}'
  };
  
  const color = levelColors[entry.level];
  const prefix = `[${timestamp}] {cyan-fg}${entry.agentId}{/}:`;
  
  return `${prefix} ${color}${entry.message}{/}`;
}
```

**Event Subscription:**
```typescript
constructor(
  screen: blessed.Widgets.Screen,
  messageBus: IMessageBus,
  config: ActivityLogConfig = {}
) {
  this.messageBus = messageBus;
  this.config = { ...DEFAULT_LOG_CONFIG, ...config };
  
  // Create blessed log widget
  this.log = blessed.log({
    parent: screen,
    label: ' Activity Log ',
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '█',
      style: { fg: 'blue' }
    },
    tags: true,  // Enable {color-fg} tags
    border: 'line'
  });
  
  // Subscribe to message bus events
  messageBus.on('messageReceived', this.handleMessage.bind(this));
  messageBus.on('published', this.handlePublished.bind(this));
}

private handleMessage(event: { channel: string; message: Message }): void {
  const entry: LogEntry = {
    timestamp: event.message.timestamp,
    agentId: event.message.from,
    message: this.extractMessageText(event.message),
    type: event.message.type,
    level: this.getLogLevel(event.message.type)
  };
  
  this.addEntry(entry);
}
```

---

### 4. Input Router (`src/tui/inputRouter.ts`)

**Responsibilities:**
- Parse user input from terminal
- Route messages to appropriate agents
- Handle special commands (/, /help, /quit, /filter)
- Provide command completion

**Commands:**
```
/help              - Show help message
/quit              - Exit TUI
/filter <agent>    - Filter log by agent
/clear             - Clear activity log
/stats             - Show detailed statistics
/agent <id> <msg>  - Send message to specific agent
<message>          - Broadcast to all agents
```

**Interface:**
```typescript
export interface InputRouterConfig {
  enableCommandHistory?: boolean;  // Arrow up/down for history (default: true)
  maxHistorySize?: number;         // Max command history (default: 100)
  commandPrefix?: string;          // Command prefix (default: '/')
}

export class InputRouter {
  private input: blessed.Widgets.TextboxElement;
  private messageBus: IMessageBus;
  private commandHistory: string[] = [];
  private historyIndex: number = -1;
  
  constructor(
    screen: blessed.Widgets.Screen,
    messageBus: IMessageBus,
    config: InputRouterConfig = {}
  );
  
  private handleInput(value: string): void;
  private handleCommand(command: string, args: string[]): void;
  private routeMessage(message: string): void;
  
  // Command handlers
  private handleHelp(): void;
  private handleQuit(): void;
  private handleFilter(agentId: string): void;
  private handleClear(): void;
  private handleStats(): void;
  private handleAgentMessage(agentId: string, message: string): void;
}
```

**Implementation:**
```typescript
private handleInput(value: string): void {
  if (!value.trim()) return;
  
  // Add to history
  this.commandHistory.push(value);
  this.historyIndex = this.commandHistory.length;
  
  // Parse input
  if (value.startsWith(this.config.commandPrefix)) {
    // Command
    const parts = value.slice(1).split(' ');
    const command = parts[0];
    const args = parts.slice(1);
    this.handleCommand(command, args);
  } else {
    // Regular message - broadcast to all agents
    this.routeMessage(value);
  }
  
  // Clear input
  this.input.clearValue();
  this.screen.render();
}

private handleCommand(command: string, args: string[]): void {
  switch (command) {
    case 'help':
      this.handleHelp();
      break;
    case 'quit':
    case 'q':
    case 'exit':
      this.handleQuit();
      break;
    case 'filter':
      this.handleFilter(args[0] || null);
      break;
    case 'clear':
      this.handleClear();
      break;
    case 'stats':
      this.handleStats();
      break;
    case 'agent':
      this.handleAgentMessage(args[0], args.slice(1).join(' '));
      break;
    default:
      this.activityLog.addEntry({
        timestamp: Date.now(),
        agentId: 'system',
        message: `Unknown command: /${command}. Type /help for available commands.`,
        type: MessageType.CUSTOM,
        level: 'warn'
      });
  }
}

private async routeMessage(message: string): Promise<void> {
  // Create message object
  const msg: Message = {
    id: MessageIdGenerator.generate(),
    timestamp: Date.now(),
    type: MessageType.CUSTOM,
    from: 'user',
    payload: { text: message }
  };
  
  // Broadcast to all agents
  await this.messageBus.broadcast(msg);
  
  // Log to activity log
  this.activityLog.addEntry({
    timestamp: Date.now(),
    agentId: 'user',
    message: `Broadcast: ${message}`,
    type: MessageType.CUSTOM,
    level: 'info'
  });
}
```

---

### 5. Render Loop (`src/tui/render.ts`)

**Responsibilities:**
- Manage screen refresh cycles
- Throttle updates to max FPS
- Batch component updates
- Handle screen resizing

**Interface:**
```typescript
export interface RenderLoopConfig {
  maxFPS?: number;           // Max frames per second (default: 10)
  minUpdateInterval?: number; // Min ms between updates (default: 100)
}

export class RenderLoop {
  private screen: blessed.Widgets.Screen;
  private components: Renderable[] = [];
  private timer: NodeJS.Timeout | null = null;
  private isDirty: boolean = false;
  private lastRenderTime: number = 0;
  
  constructor(
    screen: blessed.Widgets.Screen,
    config: RenderLoopConfig = {}
  );
  
  addComponent(component: Renderable): void;
  markDirty(): void;
  
  async start(): Promise<void>;
  async stop(): Promise<void>;
  
  private tick(): void;
  private shouldRender(): boolean;
}
```

**Renderable Interface:**
```typescript
export interface Renderable {
  /**
   * Update component state (data processing)
   */
  update(): void;
  
  /**
   * Render component to screen
   */
  render(): void;
  
  /**
   * Check if component needs re-render
   */
  isDirty(): boolean;
}
```

**Render Loop Logic:**
```typescript
private tick(): void {
  const now = Date.now();
  
  // Check if we should render
  if (!this.shouldRender()) {
    return;
  }
  
  // Update all components
  for (const component of this.components) {
    if (component.isDirty()) {
      component.update();
    }
  }
  
  // Render screen (blessed does diff internally)
  this.screen.render();
  
  this.lastRenderTime = now;
  this.isDirty = false;
}

private shouldRender(): boolean {
  const now = Date.now();
  const elapsed = now - this.lastRenderTime;
  
  // Respect min update interval
  if (elapsed < this.config.minUpdateInterval) {
    return false;
  }
  
  // Check if any component is dirty
  return this.isDirty || this.components.some(c => c.isDirty());
}
```

---

## Integration Points

### 1. Message Bus Integration

**Event Subscriptions:**
```typescript
// In TUIManager.setupEventListeners()

// Subscribe to all message activity
this.messageBus.on('published', (event) => {
  this.activityLog.addEntry({
    timestamp: event.message.timestamp,
    agentId: event.message.from,
    message: `Published to ${event.channel}: ${event.message.type}`,
    type: event.message.type,
    level: 'debug'
  });
});

this.messageBus.on('messageReceived', (event) => {
  this.activityLog.addEntry({
    timestamp: event.message.timestamp,
    agentId: event.message.to || 'broadcast',
    message: this.formatMessage(event.message),
    type: event.message.type,
    level: 'info'
  });
});

// Subscribe to mode changes
this.messageBus.on('modeChanged', (event) => {
  this.statusBar.updateMode(event.newMode);
  this.activityLog.addEntry({
    timestamp: Date.now(),
    agentId: 'system',
    message: `Coordination mode changed to ${event.newMode}`,
    type: MessageType.MODE_CHANGE,
    level: 'warn'
  });
});
```

### 2. Agent Registry Integration

**Polling for Agent Status:**
```typescript
// In TUIManager.setupEventListeners()

// Poll agent registry for updates
this.agentUpdateTimer = setInterval(async () => {
  const agents = await this.agentRegistry.getAllAgents();
  this.statusBar.update(agents, this.coordinationMode.getMode());
  this.renderLoop.markDirty();
}, 1000);  // 1 second polling
```

**Event-Based Updates (if AgentRegistry emits events):**
```typescript
// Better approach if we add events to AgentRegistry
this.agentRegistry.on('agentRegistered', (agent) => {
  this.activityLog.addEntry({
    timestamp: Date.now(),
    agentId: 'system',
    message: `Agent ${agent.id} registered (${agent.type})`,
    type: MessageType.REGISTRATION,
    level: 'info'
  });
  this.statusBar.update(
    this.agentRegistry.getAllAgents(),
    this.coordinationMode.getMode()
  );
});

this.agentRegistry.on('agentStatusChanged', (agentId, status) => {
  this.activityLog.addEntry({
    timestamp: Date.now(),
    agentId: 'system',
    message: `Agent ${agentId} status changed to ${status}`,
    type: MessageType.CUSTOM,
    level: 'info'
  });
  this.statusBar.update(
    this.agentRegistry.getAllAgents(),
    this.coordinationMode.getMode()
  );
});
```

### 3. Coordination Mode Manager Integration

**Mode Change Handling:**
```typescript
// In TUIManager.setupEventListeners()

this.coordinationMode.on('modeChanged', (from, to) => {
  // Update status bar
  this.statusBar.updateMode(to);
  
  // Log the transition
  this.activityLog.addEntry({
    timestamp: Date.now(),
    agentId: 'system',
    message: `Coordination mode: ${from} → ${to}`,
    type: MessageType.MODE_CHANGE,
    level: 'warn'
  });
  
  // Mark for re-render
  this.renderLoop.markDirty();
});

this.coordinationMode.on('transitionStarted', (from, to) => {
  this.activityLog.addEntry({
    timestamp: Date.now(),
    agentId: 'system',
    message: `Starting transition: ${from} → ${to}...`,
    type: MessageType.MODE_CHANGE,
    level: 'info'
  });
});

this.coordinationMode.on('transitionFailed', (error) => {
  this.activityLog.addEntry({
    timestamp: Date.now(),
    agentId: 'system',
    message: `Mode transition failed: ${error.message}`,
    type: MessageType.MODE_CHANGE,
    level: 'error'
  });
});
```

### 4. CLI Integration

**New Command: `lemegeton tui`**

```typescript
// src/cli/commands/tui.ts

import { Command } from 'commander';
import { TUIManager } from '../../tui';
import { MessageBus } from '../../communication/messageBus';
import { AgentRegistry } from '../../hub/agentRegistry';
import { CoordinationModeManager } from '../../core/coordinationMode';
import { RedisClient } from '../../redis/client';

export function createTUICommand(): Command {
  const command = new Command('tui')
    .description('Start the Terminal UI for monitoring agents')
    .option('-r, --refresh-rate <fps>', 'Max refresh rate (FPS)', '10')
    .option('-m, --enable-mouse', 'Enable mouse support', false)
    .option('--theme <theme>', 'Color theme (dark|light|auto)', 'auto')
    .action(async (options) => {
      try {
        // Initialize dependencies
        const redis = await RedisClient.connect();
        const agentRegistry = new AgentRegistry();
        await agentRegistry.initialize(redis);
        
        const coordinationMode = new CoordinationModeManager(redis, null);
        await coordinationMode.start();
        
        const messageBus = new MessageBus(redis, coordinationMode);
        await messageBus.start();
        
        // Start TUI
        const tui = new TUIManager(messageBus, agentRegistry, coordinationMode, {
          refreshRate: parseInt(options.refreshRate, 10),
          enableMouse: options.enableMouse,
          theme: options.theme
        });
        
        await tui.start();
        
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
          await tui.stop();
          await messageBus.stop();
          await coordinationMode.stop();
          await redis.disconnect();
          process.exit(0);
        });
        
      } catch (error) {
        console.error('Failed to start TUI:', error);
        process.exit(1);
      }
    });
  
  return command;
}
```

**Update CLI Index:**
```typescript
// src/cli/index.ts

import { createTUICommand } from './commands/tui';

// In main()
program.addCommand(createTUICommand());
```

---

## File Structure

```
src/tui/
├── index.ts                 # TUIManager (main entry point)
├── statusBar.ts             # Status bar component
├── activityLog.ts           # Activity log component
├── inputRouter.ts           # Input router component
├── render.ts                # Render loop
├── types.ts                 # TUI-specific types
├── themes.ts                # Color themes
└── utils.ts                 # Helper utilities

src/cli/commands/
└── tui.ts                   # New TUI command

tests/tui/
├── statusBar.test.ts
├── activityLog.test.ts
├── inputRouter.test.ts
├── render.test.ts
└── integration.test.ts      # Full TUI integration test
```

---

## Implementation Details

### Key Interfaces

```typescript
// src/tui/types.ts

import { CoordinationMode } from '../types/coordination';
import { AgentInfo } from '../hub/agentRegistry';
import { Message, MessageType } from '../communication/types';

/**
 * TUI configuration
 */
export interface TUIConfig {
  refreshRate?: number;
  logHistorySize?: number;
  enableMouse?: boolean;
  showAllMessages?: boolean;
  filterByAgent?: string;
  theme?: 'dark' | 'light' | 'auto';
}

/**
 * Log entry for activity log
 */
export interface LogEntry {
  timestamp: number;
  agentId: string;
  message: string;
  type: MessageType;
  level: 'info' | 'warn' | 'error' | 'debug';
}

/**
 * Renderable component interface
 */
export interface Renderable {
  update(): void;
  render(): void;
  isDirty(): boolean;
}

/**
 * TUI state snapshot
 */
export interface TUIState {
  mode: CoordinationMode;
  agents: AgentInfo[];
  recentLogs: LogEntry[];
  stats: {
    totalAgents: number;
    activeAgents: number;
    activePRs: number;
    totalCost: number;
  };
}
```

### Screen Layout

**Layout Dimensions (80x24 minimum):**
```typescript
// src/tui/index.ts

private setupScreen(): void {
  this.screen = blessed.screen({
    smartCSR: true,         // Smart cursor movement
    title: 'Lemegeton TUI',
    fullUnicode: true,
    dockBorders: true,
    autoPadding: true,
    warnings: false
  });
  
  // Handle resize
  this.screen.on('resize', this.handleResize.bind(this));
  
  // Handle Ctrl+C gracefully
  this.screen.key(['C-c'], async () => {
    await this.stop();
    process.exit(0);
  });
}

private setupComponents(): void {
  const { width, height } = this.screen;
  
  // Status bar (top 3 lines)
  this.statusBar = new StatusBar(this.screen, this.agentRegistry, 
    this.coordinationMode, {
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    border: 'line'
  });
  
  // Activity log (middle, expandable)
  this.activityLog = new ActivityLog(this.screen, this.messageBus, {
    top: 3,
    left: 0,
    width: '100%',
    height: height - 6,  // Leave room for status bar + input
    border: 'line'
  });
  
  // Input box (bottom 3 lines)
  this.inputRouter = new InputRouter(this.screen, this.messageBus, {
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    border: 'line'
  });
}

private handleResize(): void {
  const { height } = this.screen;
  
  // Resize activity log to fill space
  this.activityLog.height = height - 6;
  
  // Mark for re-render
  this.renderLoop.markDirty();
  
  // Force immediate render
  this.screen.render();
}
```

### Theme System

```typescript
// src/tui/themes.ts

export interface Theme {
  name: string;
  statusBar: {
    border: string;
    background: string;
    foreground: string;
    modeBadge: {
      distributed: string;
      degraded: string;
      isolated: string;
    };
  };
  activityLog: {
    border: string;
    background: string;
    levels: {
      info: string;
      warn: string;
      error: string;
      debug: string;
    };
  };
  input: {
    border: string;
    background: string;
    foreground: string;
  };
}

export const DARK_THEME: Theme = {
  name: 'dark',
  statusBar: {
    border: 'blue',
    background: 'black',
    foreground: 'white',
    modeBadge: {
      distributed: 'green',
      degraded: 'yellow',
      isolated: 'red'
    }
  },
  activityLog: {
    border: 'blue',
    background: 'black',
    levels: {
      info: 'white',
      warn: 'yellow',
      error: 'red',
      debug: 'gray'
    }
  },
  input: {
    border: 'blue',
    background: 'black',
    foreground: 'white'
  }
};

export const LIGHT_THEME: Theme = {
  name: 'light',
  statusBar: {
    border: 'black',
    background: 'white',
    foreground: 'black',
    modeBadge: {
      distributed: 'green',
      degraded: 'yellow',
      isolated: 'red'
    }
  },
  activityLog: {
    border: 'black',
    background: 'white',
    levels: {
      info: 'black',
      warn: 'yellow',
      error: 'red',
      debug: 'gray'
    }
  },
  input: {
    border: 'black',
    background: 'white',
    foreground: 'black'
  }
};

export function autoDetectTheme(): Theme {
  // Check terminal background color (if supported)
  const bgColor = process.env.COLORFGBG?.split(';')[1];
  
  // Dark terminal has bg color 0-6, light has 7-15
  if (bgColor && parseInt(bgColor, 10) >= 7) {
    return LIGHT_THEME;
  }
  
  return DARK_THEME;  // Default to dark
}
```

---

## Key Challenges & Solutions

### Challenge 1: Real-Time Updates Without Blocking

**Problem:** Real-time message bus events could flood the TUI, causing slowdowns.

**Solution:** Event debouncing + render throttling
```typescript
// In ActivityLog
private pendingEntries: LogEntry[] = [];
private flushTimer: NodeJS.Timeout | null = null;

addEntry(entry: LogEntry): void {
  // Add to pending queue
  this.pendingEntries.push(entry);
  
  // Debounce flush
  if (this.flushTimer) {
    clearTimeout(this.flushTimer);
  }
  
  this.flushTimer = setTimeout(() => {
    this.flushPending();
  }, 100);  // Flush every 100ms max
}

private flushPending(): void {
  if (this.pendingEntries.length === 0) return;
  
  // Batch add entries
  for (const entry of this.pendingEntries) {
    if (this.shouldDisplay(entry)) {
      const formatted = this.formatEntry(entry);
      this.log.log(formatted);
    }
  }
  
  // Clear queue
  this.pendingEntries = [];
  this.isDirty = true;
}
```

### Challenge 2: Terminal Compatibility

**Problem:** Different terminals support different features (colors, Unicode, mouse).

**Solution:** Progressive enhancement with feature detection
```typescript
// In TUIManager
private detectTerminalCapabilities(): TerminalCapabilities {
  const term = process.env.TERM || 'unknown';
  
  return {
    colors: this.detectColorSupport(),
    unicode: term.includes('256color') || term.includes('truecolor'),
    mouse: term !== 'dumb' && !process.env.CI,
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 24
  };
}

private detectColorSupport(): number {
  if (process.env.COLORTERM === 'truecolor') return 16777216;
  if (process.env.TERM?.includes('256color')) return 256;
  if (process.env.TERM?.includes('color')) return 16;
  return 2;  // Monochrome fallback
}
```

### Challenge 3: Input Routing to Correct Agent

**Problem:** User wants to send messages to specific agents, not just broadcast.

**Solution:** Special command syntax + agent ID completion
```typescript
// In InputRouter

private handleInput(value: string): void {
  // Special syntax: @agent-id message
  const agentMatch = value.match(/^@([\w-]+)\s+(.+)$/);
  
  if (agentMatch) {
    const [, agentId, message] = agentMatch;
    this.routeToAgent(agentId, message);
    return;
  }
  
  // Regular command or broadcast
  if (value.startsWith('/')) {
    this.handleCommand(value.slice(1).split(' '));
  } else {
    this.routeMessage(value);
  }
}

private async routeToAgent(agentId: string, message: string): Promise<void> {
  // Validate agent exists
  const agent = await this.agentRegistry.getAgent(agentId);
  if (!agent) {
    this.activityLog.addEntry({
      timestamp: Date.now(),
      agentId: 'system',
      message: `Unknown agent: ${agentId}`,
      type: MessageType.CUSTOM,
      level: 'error'
    });
    return;
  }
  
  // Create and route message
  const msg: Message = {
    id: MessageIdGenerator.generate(),
    timestamp: Date.now(),
    type: MessageType.CUSTOM,
    from: 'user',
    to: agentId,
    payload: { text: message }
  };
  
  await this.messageBus.publishToAgent(agentId, msg);
  
  this.activityLog.addEntry({
    timestamp: Date.now(),
    agentId: 'user',
    message: `To ${agentId}: ${message}`,
    type: MessageType.CUSTOM,
    level: 'info'
  });
}
```

### Challenge 4: Graceful Shutdown

**Problem:** Need to restore terminal state properly on exit.

**Solution:** Comprehensive cleanup + signal handling
```typescript
// In TUIManager

async stop(): Promise<void> {
  try {
    // 1. Stop render loop
    await this.renderLoop.stop();
    
    // 2. Unsubscribe from all events
    this.messageBus.removeAllListeners();
    this.coordinationMode.removeAllListeners();
    
    // 3. Clear intervals
    if (this.agentUpdateTimer) {
      clearInterval(this.agentUpdateTimer);
    }
    
    // 4. Destroy blessed screen (restores terminal)
    this.screen.destroy();
    
    // 5. Final message
    console.log('TUI stopped gracefully');
    
  } catch (error) {
    console.error('Error during TUI shutdown:', error);
    // Force destroy screen
    try {
      this.screen.destroy();
    } catch {}
  }
}

// Setup signal handlers
private setupSignalHandlers(): void {
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
  
  for (const signal of signals) {
    process.on(signal, async () => {
      await this.stop();
      process.exit(0);
    });
  }
  
  // Handle unexpected errors
  process.on('uncaughtException', async (error) => {
    console.error('Uncaught exception:', error);
    await this.stop();
    process.exit(1);
  });
  
  process.on('unhandledRejection', async (reason, promise) => {
    console.error('Unhandled rejection:', reason);
    await this.stop();
    process.exit(1);
  });
}
```

### Challenge 5: Performance with High Message Volume

**Problem:** Hundreds of messages per second could overwhelm the log.

**Solution:** Circular buffer + sampling
```typescript
// In ActivityLog

export class ActivityLog {
  private entries: LogEntry[] = [];
  private maxEntries: number;
  private messageCounter: Map<string, number> = new Map();
  private samplingRate: number = 1;  // Show every Nth message
  
  constructor(/* ... */) {
    this.maxEntries = config.maxLines || 1000;
  }
  
  addEntry(entry: LogEntry): void {
    // Check if we should sample this entry
    if (this.shouldSample(entry)) {
      // Add to circular buffer
      this.entries.push(entry);
      
      // Trim if exceeded max
      if (this.entries.length > this.maxEntries) {
        this.entries.shift();  // Remove oldest
      }
      
      // Display
      if (this.shouldDisplay(entry)) {
        this.log.log(this.formatEntry(entry));
      }
    }
    
    // Update message counter
    this.updateMessageCounter(entry.agentId);
    
    // Adjust sampling rate based on load
    this.adjustSamplingRate();
  }
  
  private shouldSample(entry: LogEntry): boolean {
    // Always show errors and warnings
    if (entry.level === 'error' || entry.level === 'warn') {
      return true;
    }
    
    // Sample debug messages
    if (entry.level === 'debug') {
      return Math.random() < (1 / this.samplingRate);
    }
    
    // Show all info messages
    return true;
  }
  
  private adjustSamplingRate(): void {
    const recentCount = this.getRecentMessageCount(5000);  // Last 5 seconds
    
    if (recentCount > 500) {
      this.samplingRate = 10;  // Show 1 in 10
    } else if (recentCount > 100) {
      this.samplingRate = 5;   // Show 1 in 5
    } else {
      this.samplingRate = 1;   // Show all
    }
  }
}
```

---

## Testing Strategy

### Unit Tests

**1. Status Bar Tests (`tests/tui/statusBar.test.ts`)**
```typescript
describe('StatusBar', () => {
  let statusBar: StatusBar;
  let mockScreen: any;
  let mockAgentRegistry: any;
  let mockCoordinationMode: any;
  
  beforeEach(() => {
    // Setup mocks
  });
  
  it('displays agent count correctly', () => {
    const agents = [
      { id: 'worker-1', status: 'working', type: 'worker' },
      { id: 'worker-2', status: 'idle', type: 'worker' }
    ];
    
    statusBar.update(agents, CoordinationMode.DISTRIBUTED);
    
    expect(statusBar.getStatsLine()).toContain('Agents: 2');
  });
  
  it('shows correct mode badge', () => {
    statusBar.updateMode(CoordinationMode.DEGRADED);
    
    const badge = statusBar.getModeBadge(CoordinationMode.DEGRADED);
    expect(badge).toContain('DEGRADED');
    expect(badge).toContain('yellow');
  });
  
  it('formats agent status with colors', () => {
    const agent: AgentInfo = {
      id: 'worker-1',
      status: 'working',
      assignedPR: 'PR-005',
      type: 'worker',
      /* ... */
    };
    
    const formatted = statusBar.formatAgentStatus(agent);
    expect(formatted).toContain('worker-1');
    expect(formatted).toContain('WORKING');
    expect(formatted).toContain('PR-005');
  });
});
```

**2. Activity Log Tests (`tests/tui/activityLog.test.ts`)**
```typescript
describe('ActivityLog', () => {
  let activityLog: ActivityLog;
  
  it('adds entries in correct format', () => {
    const entry: LogEntry = {
      timestamp: Date.now(),
      agentId: 'worker-1',
      message: 'Starting work',
      type: MessageType.CUSTOM,
      level: 'info'
    };
    
    activityLog.addEntry(entry);
    
    const entries = activityLog.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(entry);
  });
  
  it('filters by agent ID', () => {
    activityLog.addEntry({ agentId: 'worker-1', /* ... */ });
    activityLog.addEntry({ agentId: 'worker-2', /* ... */ });
    
    activityLog.filter('worker-1');
    
    const displayed = activityLog.getDisplayedEntries();
    expect(displayed).toHaveLength(1);
    expect(displayed[0].agentId).toBe('worker-1');
  });
  
  it('maintains circular buffer size', () => {
    const maxEntries = 100;
    const log = new ActivityLog(mockScreen, mockMessageBus, { maxLines: maxEntries });
    
    // Add more than max
    for (let i = 0; i < 150; i++) {
      log.addEntry({ timestamp: i, /* ... */ });
    }
    
    expect(log.getEntries()).toHaveLength(maxEntries);
  });
});
```

**3. Input Router Tests (`tests/tui/inputRouter.test.ts`)**
```typescript
describe('InputRouter', () => {
  let inputRouter: InputRouter;
  let mockMessageBus: any;
  
  it('routes broadcast messages', async () => {
    await inputRouter.handleInput('Hello agents');
    
    expect(mockMessageBus.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { text: 'Hello agents' }
      })
    );
  });
  
  it('routes messages to specific agent', async () => {
    await inputRouter.handleInput('@worker-1 Do task X');
    
    expect(mockMessageBus.publishToAgent).toHaveBeenCalledWith(
      'worker-1',
      expect.objectContaining({
        payload: { text: 'Do task X' }
      })
    );
  });
  
  it('handles /help command', () => {
    inputRouter.handleCommand('help', []);
    
    // Should display help in activity log
    expect(mockActivityLog.addEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Available commands')
      })
    );
  });
  
  it('handles /filter command', () => {
    inputRouter.handleCommand('filter', ['worker-1']);
    
    expect(mockActivityLog.filter).toHaveBeenCalledWith('worker-1');
  });
});
```

### Integration Tests

**Full TUI Integration Test (`tests/tui/integration.test.ts`)**
```typescript
describe('TUI Integration', () => {
  let tui: TUIManager;
  let redis: RedisClient;
  let messageBus: MessageBus;
  let agentRegistry: AgentRegistry;
  let coordinationMode: CoordinationModeManager;
  
  beforeAll(async () => {
    // Setup real dependencies (with Docker Redis for testing)
    redis = await RedisClient.connect('redis://localhost:6379');
    agentRegistry = new AgentRegistry();
    await agentRegistry.initialize(redis);
    
    coordinationMode = new CoordinationModeManager(redis, null);
    await coordinationMode.start();
    
    messageBus = new MessageBus(redis, coordinationMode);
    await messageBus.start();
  });
  
  afterAll(async () => {
    await messageBus.stop();
    await coordinationMode.stop();
    await redis.disconnect();
  });
  
  it('starts and stops cleanly', async () => {
    tui = new TUIManager(messageBus, agentRegistry, coordinationMode);
    
    await tui.start();
    expect(tui.isRunning()).toBe(true);
    
    await tui.stop();
    expect(tui.isRunning()).toBe(false);
  });
  
  it('displays agent registration', async () => {
    tui = new TUIManager(messageBus, agentRegistry, coordinationMode);
    await tui.start();
    
    // Register an agent
    await agentRegistry.registerAgent({
      id: 'worker-1',
      type: 'worker',
      status: 'idle',
      pid: process.pid,
      /* ... */
    });
    
    // Wait for update
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    // Check status bar
    const state = tui.getState();
    expect(state.agents).toHaveLength(1);
    expect(state.agents[0].id).toBe('worker-1');
    
    await tui.stop();
  });
  
  it('displays mode changes', async () => {
    tui = new TUIManager(messageBus, agentRegistry, coordinationMode);
    await tui.start();
    
    // Trigger mode change
    await coordinationMode.switchMode(
      CoordinationMode.DEGRADED,
      'Test mode change'
    );
    
    // Wait for update
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Check state
    const state = tui.getState();
    expect(state.mode).toBe(CoordinationMode.DEGRADED);
    
    // Check log entry
    const logs = state.recentLogs;
    expect(logs.some(l => l.message.includes('DEGRADED'))).toBe(true);
    
    await tui.stop();
  });
});
```

### Manual Testing Checklist

```markdown
## Manual TUI Testing

### Basic Functionality
- [ ] TUI starts without errors
- [ ] Status bar displays correctly
- [ ] Activity log shows messages
- [ ] Input box accepts input
- [ ] Can type and send messages
- [ ] Can exit with Ctrl+C

### Agent Display
- [ ] Agents appear when registered
- [ ] Agent status updates (idle → working)
- [ ] Agent count is correct
- [ ] Crashed agents shown in red

### Mode Display
- [ ] DISTRIBUTED mode shows green badge
- [ ] DEGRADED mode shows yellow badge
- [ ] ISOLATED mode shows red badge
- [ ] Mode transitions logged correctly

### Input Routing
- [ ] Broadcast messages work
- [ ] @agent-id messages route correctly
- [ ] /help shows help message
- [ ] /filter works
- [ ] /clear clears log
- [ ] /quit exits cleanly

### Performance
- [ ] No lag with 10 agents
- [ ] No lag with 100 messages/sec
- [ ] Screen updates smoothly
- [ ] Memory usage stays reasonable

### Terminal Compatibility
- [ ] Works in iTerm2 (macOS)
- [ ] Works in Terminal.app (macOS)
- [ ] Works in GNOME Terminal (Linux)
- [ ] Works in Windows Terminal
- [ ] Works in tmux
- [ ] Works in screen
- [ ] Works over SSH

### Edge Cases
- [ ] Handles terminal resize correctly
- [ ] Recovers from Redis disconnect
- [ ] Handles long messages (wrap/truncate)
- [ ] Handles Unicode characters
- [ ] Handles rapid agent registration/removal
```

---

## Acceptance Criteria

**From task-list.md:**

1. ✅ **Status bar shows all active agents**
   - Display agent ID, type, status, and assigned PR
   - Update in real-time (1s polling)
   - Color-coded by status

2. ✅ **Real-time updates via Redis pub/sub**
   - Subscribe to MessageBus events
   - Display published and received messages
   - Throttle updates to prevent flooding

3. ✅ **Activity log displays agent actions**
   - Show timestamped entries
   - Filter by agent or message type
   - Searchable history
   - Auto-scroll to bottom

4. ✅ **Input routing to agents works**
   - Broadcast to all agents
   - Direct message to specific agent (@agent-id syntax)
   - Special commands (/help, /quit, /filter, etc.)

5. ✅ **Coordination mode displayed**
   - Visual badge (green/yellow/red)
   - Mode transitions logged
   - Clear indicator in status bar

6. ✅ **Clean terminal handling**
   - Proper blessed screen initialization
   - Graceful shutdown (restore terminal state)
   - Handle SIGINT, SIGTERM correctly
   - No residual escape sequences

**Additional Success Criteria:**

7. ✅ **Performance**
   - Max 100ms render time
   - Handles 100+ messages/sec
   - <50MB memory usage

8. ✅ **Compatibility**
   - Works in 80x24 terminal minimum
   - Compatible with major terminals
   - Works over SSH

9. ✅ **Usability**
   - Intuitive commands
   - Helpful error messages
   - Clear visual hierarchy

---

## Implementation Timeline

**Total Estimated Time: 70 minutes**

### Phase 1: Core Structure (15 min)
- [ ] Create file structure
- [ ] Implement TUIManager skeleton
- [ ] Setup blessed screen
- [ ] Basic layout (status bar, log, input)

### Phase 2: Status Bar (10 min)
- [ ] Implement StatusBar component
- [ ] Agent display logic
- [ ] Mode badge rendering
- [ ] Stats calculation

### Phase 3: Activity Log (15 min)
- [ ] Implement ActivityLog component
- [ ] Message formatting
- [ ] Filtering logic
- [ ] Circular buffer

### Phase 4: Input Router (15 min)
- [ ] Implement InputRouter component
- [ ] Command parsing
- [ ] Message routing
- [ ] Command handlers

### Phase 5: Integration (10 min)
- [ ] Connect to MessageBus
- [ ] Connect to AgentRegistry
- [ ] Connect to CoordinationModeManager
- [ ] Event subscriptions

### Phase 6: Polish & Testing (5 min)
- [ ] Add CLI command
- [ ] Test basic functionality
- [ ] Fix any issues
- [ ] Update documentation

---

## Next Steps

1. **Create PR branch**: `git checkout -b feature/pr-015-tui`
2. **Install dependencies**: `npm install blessed blessed-contrib chalk`
3. **Implement Phase 1**: Core structure
4. **Iterate through phases**: Complete each phase before moving to next
5. **Test incrementally**: Test each component as it's built
6. **Integration test**: Full TUI test with live agents
7. **Create PR**: Submit for review with demo video/screenshots

---

**End of Implementation Plan**
