# PR-015: Terminal UI (TUI) Implementation Plan

**Version:** 1.0
**Date:** 2025-11-14
**Status:** Ready for Implementation
**Dependencies:** PR-014 (CLI Command Structure) ✅, PR-013 (Message Bus) ✅

---

## Overview

Implement a single-shell Terminal UI (TUI) that displays real-time agent status, activity logs, and routes user input to the appropriate agents. This provides a unified interface for monitoring and interacting with multiple parallel agents without context-switching between terminal sessions.

## Goals

1. Create comprehensive TUI showing all system activity
2. Display real-time agent status and coordination mode
3. Implement activity log with filtering capabilities
4. Route user input to correct agent automatically
5. Provide clean, responsive terminal interface
6. Support both interactive and non-interactive modes

## Background

From the PRD:
> **Single Shell UX**: Unified TUI for monitoring all agents and routing user input

Currently, users would need to manage multiple terminal sessions to interact with different agents. This TUI provides a single interface that:
- Shows status of all active agents
- Displays real-time activity from all agents
- Routes user questions/input to the agent that needs it
- Eliminates context-switching overhead

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────┐
│                    TUI Main                              │
│  - Screen management                                     │
│  - Layout coordination                                   │
│  - Event routing                                         │
└────────┬────────────────────────────────┬───────────────┘
         │                                │
         ▼                                ▼
┌──────────────────────┐      ┌──────────────────────────┐
│   Status Bar         │      │   Activity Log           │
│  - Agent list        │      │  - Scrollable log        │
│  - Coordination mode │      │  - Filtering             │
│  - Progress %        │      │  - Agent highlighting    │
└──────────────────────┘      └──────────────────────────┘
         │                                │
         └────────────┬───────────────────┘
                      ▼
         ┌──────────────────────┐
         │   Input Router       │
         │  - Parse input       │
         │  - Route to agent    │
         │  - Show responses    │
         └──────────────────────┘
                      │
                      ▼
         ┌──────────────────────┐
         │   Message Bus        │
         │  (from PR-013)       │
         └──────────────────────┘
```

### Technology Choice

**Library: Blessed**
- Mature, well-tested TUI library for Node.js
- Rich widget system (boxes, lists, logs, inputs)
- Event-driven architecture
- Good documentation and examples
- Supports colors, borders, scrolling, focus management

**Alternative considered: Ink**
- React-based (heavier, more complex)
- Better for complex UIs, overkill for our needs
- Blessed is more established for this use case

### Screen Layout

```
┌────────────────────────────────────────────────────────────────┐
│ Lemegeton - Multi-Agent Orchestration  │  Mode: DISTRIBUTED   │
│────────────────────────────────────────────────────────────────│
│ Agents (3 active):                                             │
│  ● worker-1 [PR-025] Implementing incremental tests   [Sonnet] │
│  ● qc-1     [PR-024] Running tests                     [Haiku] │
│  ● planning [idle]   Awaiting work                    [Sonnet] │
│────────────────────────────────────────────────────────────────│
│ Activity Log:                                                  │
│ [14:23:15] worker-1   │ Created src/agents/qc/incremental.ts  │
│ [14:23:16] worker-1   │ Added test selection logic            │
│ [14:23:18] qc-1       │ Running tests for PR-024              │
│ [14:23:20] qc-1       │ ✓ 45 tests passed                     │
│ [14:23:21] worker-1   │ Need clarification: Which framework?  │
│ >                                                              │
│────────────────────────────────────────────────────────────────│
│ Progress: 24/50 PRs complete (48%)  │  Blocked: 3  │  Ready: 8│
└────────────────────────────────────────────────────────────────┘
```

## Implementation Strategy

### Phase 1: Core TUI Framework (15 minutes)

**File:** `src/tui/index.ts`

Set up Blessed screen and basic layout:

```typescript
import blessed from 'blessed';
import { MessageBus } from '../communication/messageBus';
import { RedisClient } from '../redis/client';

export class TUI {
  private screen: blessed.Widgets.Screen;
  private statusBar: blessed.Widgets.BoxElement;
  private activityLog: blessed.Widgets.Log;
  private inputBox: blessed.Widgets.TextboxElement;
  private messageBus: MessageBus;

  constructor(messageBus: MessageBus, redis: RedisClient) {
    this.messageBus = messageBus;
    this.initScreen();
    this.setupComponents();
    this.setupEventHandlers();
  }

  private initScreen(): void {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Lemegeton - Multi-Agent Orchestration',
      fullUnicode: true,
    });

    // Quit on Escape, q, or Control-C
    this.screen.key(['escape', 'q', 'C-c'], () => {
      return process.exit(0);
    });
  }

  async start(): Promise<void> {
    this.render();
    await this.subscribeToUpdates();
  }

  stop(): void {
    this.screen.destroy();
  }

  render(): void {
    this.screen.render();
  }
}
```

### Phase 2: Status Bar Component (10 minutes)

**File:** `src/tui/statusBar.ts`

Display agent status and coordination mode:

```typescript
import blessed from 'blessed';
import { AgentInfo } from '../types/agent';
import { CoordinationMode } from '../types/coordination';

export class StatusBar {
  private box: blessed.Widgets.BoxElement;
  private agents: AgentInfo[] = [];
  private mode: CoordinationMode = CoordinationMode.DISTRIBUTED;

  constructor(parent: blessed.Widgets.Screen) {
    this.box = blessed.box({
      parent,
      top: 0,
      left: 0,
      width: '100%',
      height: 5,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'cyan',
        },
      },
    });
  }

  updateAgents(agents: AgentInfo[]): void {
    this.agents = agents;
    this.render();
  }

  updateMode(mode: CoordinationMode): void {
    this.mode = mode;
    this.render();
  }

  private render(): void {
    const header = `Lemegeton - Multi-Agent Orchestration  │  Mode: ${this.mode.toUpperCase()}`;
    const agentLines = this.agents.map(a =>
      `${a.status === 'active' ? '●' : '○'} ${a.id} [${a.currentPR || 'idle'}] ${a.activity || 'Awaiting work'}  [${a.model || 'N/A'}]`
    );

    this.box.setContent([
      header,
      '─'.repeat(60),
      `Agents (${this.agents.filter(a => a.status === 'active').length} active):`,
      ...agentLines,
    ].join('\n'));
  }
}
```

### Phase 3: Activity Log Component (10 minutes)

**File:** `src/tui/activityLog.ts`

Scrollable activity log with filtering:

```typescript
import blessed from 'blessed';
import { ActivityEvent } from '../types/activity';

export class ActivityLog {
  private log: blessed.Widgets.Log;
  private filter: string | null = null;

  constructor(parent: blessed.Widgets.Screen) {
    this.log = blessed.log({
      parent,
      top: 5,
      left: 0,
      width: '100%',
      height: '100%-7',
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'green',
        },
      },
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: ' ',
        bg: 'blue',
      },
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
    });

    // Enable scrolling with arrow keys
    this.log.focus();
  }

  addEvent(event: ActivityEvent): void {
    if (this.filter && !event.agentId.includes(this.filter)) {
      return;
    }

    const timestamp = new Date(event.timestamp).toLocaleTimeString();
    const color = this.getColorForAgent(event.agentId);
    const line = `{${color}-fg}[${timestamp}] ${event.agentId.padEnd(12)}│{/} ${event.message}`;

    this.log.log(line);
  }

  setFilter(filter: string | null): void {
    this.filter = filter;
  }

  private getColorForAgent(agentId: string): string {
    // Color code by agent type
    if (agentId.includes('worker')) return 'cyan';
    if (agentId.includes('qc')) return 'green';
    if (agentId.includes('planning')) return 'yellow';
    if (agentId.includes('review')) return 'magenta';
    return 'white';
  }
}
```

### Phase 4: Input Router (15 minutes)

**File:** `src/tui/inputRouter.ts`

Route user input to appropriate agent:

```typescript
import blessed from 'blessed';
import { MessageBus } from '../communication/messageBus';
import { ActivityLog } from './activityLog';

export class InputRouter {
  private inputBox: blessed.Widgets.TextboxElement;
  private messageBus: MessageBus;
  private activityLog: ActivityLog;
  private currentContext: string | null = null; // Which agent is asking for input

  constructor(
    parent: blessed.Widgets.Screen,
    messageBus: MessageBus,
    activityLog: ActivityLog
  ) {
    this.messageBus = messageBus;
    this.activityLog = activityLog;

    this.inputBox = blessed.textbox({
      parent,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'yellow',
        },
      },
      inputOnFocus: true,
      keys: true,
      mouse: true,
    });

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.inputBox.on('submit', async (value: string) => {
      if (!value.trim()) return;

      // Parse commands
      if (value.startsWith('/')) {
        await this.handleCommand(value);
      } else if (this.currentContext) {
        // Send to agent waiting for input
        await this.sendToAgent(this.currentContext, value);
      } else {
        // Broadcast or show help
        this.activityLog.addEvent({
          timestamp: Date.now(),
          agentId: 'system',
          message: `No active context. Use /help for commands.`,
        });
      }

      this.inputBox.clearValue();
      this.inputBox.focus();
    });

    // Focus input on key press
    this.inputBox.on('focus', () => {
      this.inputBox.readInput();
    });
  }

  async handleCommand(command: string): Promise<void> {
    const [cmd, ...args] = command.slice(1).split(' ');

    switch (cmd) {
      case 'filter':
        // Filter log by agent
        this.activityLog.setFilter(args[0] || null);
        break;
      case 'help':
        this.showHelp();
        break;
      case 'status':
        await this.showStatus();
        break;
      default:
        this.activityLog.addEvent({
          timestamp: Date.now(),
          agentId: 'system',
          message: `Unknown command: ${cmd}. Use /help for commands.`,
        });
    }
  }

  async sendToAgent(agentId: string, message: string): Promise<void> {
    await this.messageBus.publish(`agent-${agentId}`, {
      type: 'user-input',
      payload: { input: message },
      timestamp: Date.now(),
    });

    this.activityLog.addEvent({
      timestamp: Date.now(),
      agentId: 'user',
      message: `→ ${agentId}: ${message}`,
    });

    this.currentContext = null;
  }

  setContext(agentId: string): void {
    this.currentContext = agentId;
    this.activityLog.addEvent({
      timestamp: Date.now(),
      agentId: 'system',
      message: `Waiting for input for ${agentId}. Type your response and press Enter.`,
    });
    this.inputBox.focus();
  }

  private showHelp(): void {
    const help = [
      'Available commands:',
      '  /filter <agent-id>  - Filter log by agent',
      '  /filter             - Clear filter',
      '  /status             - Show system status',
      '  /help               - Show this help',
    ];
    help.forEach(line => {
      this.activityLog.addEvent({
        timestamp: Date.now(),
        agentId: 'system',
        message: line,
      });
    });
  }

  async showStatus(): Promise<void> {
    // Query Hub for status via message bus
    await this.messageBus.publish('hub-status-request', {
      type: 'status-request',
      timestamp: Date.now(),
    });
  }
}
```

### Phase 5: Real-time Updates (10 minutes)

**File:** `src/tui/render.ts`

Subscribe to message bus for real-time updates:

```typescript
import { TUI } from './index';
import { MessageBus, Message } from '../communication/messageBus';
import { ActivityEvent } from '../types/activity';

export class TUIRenderer {
  constructor(
    private tui: TUI,
    private messageBus: MessageBus
  ) {}

  async subscribeToUpdates(): Promise<void> {
    // Subscribe to system-wide activity channel
    await this.messageBus.subscribe('hub-broadcast', (message: Message) => {
      this.handleHubMessage(message);
    });

    // Subscribe to coordination mode changes
    await this.messageBus.subscribe('coordination:mode-change', (message: Message) => {
      this.handleModeChange(message);
    });

    // Subscribe to agent status updates
    await this.messageBus.subscribe('system:agent-status', (message: Message) => {
      this.handleAgentStatus(message);
    });

    // Subscribe to input requests
    await this.messageBus.subscribe('system:input-request', (message: Message) => {
      this.handleInputRequest(message);
    });
  }

  private handleHubMessage(message: Message): void {
    const event: ActivityEvent = {
      timestamp: message.timestamp,
      agentId: message.payload.agentId || 'hub',
      message: message.payload.message,
    };
    this.tui.activityLog.addEvent(event);
    this.tui.render();
  }

  private handleModeChange(message: Message): void {
    this.tui.statusBar.updateMode(message.payload.mode);
    this.tui.activityLog.addEvent({
      timestamp: message.timestamp,
      agentId: 'system',
      message: `Coordination mode changed to: ${message.payload.mode}`,
    });
    this.tui.render();
  }

  private handleAgentStatus(message: Message): void {
    this.tui.statusBar.updateAgents(message.payload.agents);
    this.tui.render();
  }

  private handleInputRequest(message: Message): void {
    // Agent is requesting user input
    this.tui.inputRouter.setContext(message.payload.agentId);
    this.tui.render();
  }
}
```

### Phase 6: CLI Integration (10 minutes)

**File:** `src/cli/commands/tui.ts`

Integrate TUI with CLI:

```typescript
import { Command } from 'commander';
import { TUI } from '../../tui';
import { MessageBus } from '../../communication/messageBus';
import { RedisClient } from '../../redis/client';
import { ConfigLoader } from '../../config';

export function createTUICommand(): Command {
  return new Command('tui')
    .description('Launch Terminal UI for monitoring agents')
    .option('--no-color', 'Disable colors')
    .option('--filter <agent>', 'Filter by agent ID')
    .action(async (options) => {
      await launchTUI(options);
    });
}

async function launchTUI(options: any): Promise<void> {
  // Load configuration
  const config = ConfigLoader.load();

  // Connect to Redis
  const redis = new RedisClient(config.redis);
  await redis.connect();

  // Initialize message bus
  const messageBus = new MessageBus(redis, config.coordinationMode);
  await messageBus.initialize();

  // Launch TUI
  const tui = new TUI(messageBus, redis);

  if (options.filter) {
    tui.activityLog.setFilter(options.filter);
  }

  try {
    await tui.start();
  } catch (error) {
    console.error('TUI error:', error);
    process.exit(1);
  } finally {
    tui.stop();
    await messageBus.close();
    await redis.disconnect();
  }
}
```

## File Structure

```
src/tui/
├── index.ts              # Main TUI class
├── statusBar.ts          # Status bar component
├── activityLog.ts        # Activity log component
├── inputRouter.ts        # Input routing logic
├── render.ts             # Real-time update handling
└── types.ts              # TUI-specific types

src/cli/commands/
└── tui.ts                # TUI CLI command

tests/
└── tui.test.ts           # TUI component tests
```

## Dependencies

### New Package Dependencies

Add to `package.json`:
```json
{
  "dependencies": {
    "blessed": "^0.1.81",
    "@types/blessed": "^0.1.21"
  }
}
```

### Internal Dependencies

- `src/communication/messageBus.ts` (PR-013) - For pub/sub
- `src/redis/client.ts` (PR-004) - For Redis connection
- `src/cli/index.ts` (PR-014) - For CLI integration
- `src/types/agent.ts` (PR-002) - For agent types
- `src/types/coordination.ts` (PR-002) - For coordination mode types

## Integration Points

### Hub Integration

Hub publishes events to channels that TUI subscribes to:

```typescript
// In Hub class
async publishActivity(agentId: string, message: string): Promise<void> {
  await this.messageBus.publish('hub-broadcast', {
    type: 'activity',
    payload: { agentId, message },
    timestamp: Date.now(),
  });
}

async publishAgentStatus(): Promise<void> {
  const agents = this.agentRegistry.getAllAgents();
  await this.messageBus.publish('system:agent-status', {
    type: 'agent-status',
    payload: { agents },
    timestamp: Date.now(),
  });
}
```

### Agent Integration

Agents can request user input:

```typescript
// In BaseAgent class
async requestUserInput(prompt: string): Promise<string> {
  // Publish request
  await this.messageBus.publish('system:input-request', {
    type: 'input-request',
    payload: { agentId: this.id, prompt },
    timestamp: Date.now(),
  });

  // Wait for response on agent channel
  return new Promise((resolve) => {
    this.messageBus.subscribe(`agent-${this.id}`, (message) => {
      if (message.type === 'user-input') {
        resolve(message.payload.input);
      }
    });
  });
}
```

## Testing Strategy

### Unit Tests

**File:** `tests/tui.test.ts`

```typescript
describe('TUI', () => {
  describe('StatusBar', () => {
    test('displays agent status correctly', () => {
      // Mock agents
      // Verify rendering
    });

    test('updates coordination mode', () => {
      // Change mode
      // Verify display update
    });
  });

  describe('ActivityLog', () => {
    test('adds events in chronological order', () => {
      // Add events
      // Verify order
    });

    test('filters by agent ID', () => {
      // Set filter
      // Add events
      // Verify only filtered shown
    });
  });

  describe('InputRouter', () => {
    test('routes input to correct agent', async () => {
      // Set context
      // Submit input
      // Verify message sent
    });

    test('handles commands', async () => {
      // Send /filter command
      // Verify filter applied
    });
  });
});
```

### Integration Tests

```typescript
describe('TUI Integration', () => {
  test('receives real-time updates from Hub', async () => {
    // Start mock Hub
    // Launch TUI
    // Publish event
    // Verify TUI displays event
  });

  test('sends input to agent', async () => {
    // Start mock agent
    // Launch TUI
    // Agent requests input
    // User provides input
    // Verify agent receives
  });
});
```

### Manual Testing

```bash
# Test full workflow
npm run build
npx lemegeton hub start
npx lemegeton tui

# In TUI:
# - Verify agents display
# - Check real-time updates
# - Test /filter command
# - Test input routing
# - Verify colors and formatting
```

## Configuration

### Environment Variables

```bash
# TUI settings
TUI_ENABLED=true
TUI_COLORS=true
TUI_REFRESH_RATE=100  # milliseconds

# Activity log settings
TUI_LOG_MAX_LINES=1000
TUI_LOG_TIMESTAMP_FORMAT=HH:mm:ss
```

### Configuration File

`config/tui.json`:
```json
{
  "enabled": true,
  "colors": true,
  "refreshRate": 100,
  "log": {
    "maxLines": 1000,
    "timestampFormat": "HH:mm:ss",
    "colorByAgent": true
  },
  "statusBar": {
    "showModel": true,
    "showProgress": true
  },
  "input": {
    "historySize": 50,
    "enableAutocomplete": false
  }
}
```

## Performance Considerations

### Rendering Optimization

- **Debounced rendering:** Limit screen.render() calls to max 10/second
- **Event batching:** Batch multiple events before rendering
- **Selective updates:** Only re-render changed components
- **Memory limits:** Cap activity log at configurable max lines

### Resource Usage

- **Minimal CPU:** Blessed is efficient, should use <1% CPU
- **Memory:** ~10-20MB for TUI itself
- **Network:** Subscribes to Redis channels, minimal bandwidth

## Error Handling

### Connection Failures

```typescript
class TUI {
  private async handleConnectionLoss(): Promise<void> {
    this.activityLog.addEvent({
      timestamp: Date.now(),
      agentId: 'system',
      message: '⚠️  Connection to Hub lost. Attempting to reconnect...',
    });

    // Try to reconnect
    try {
      await this.messageBus.reconnect();
      this.activityLog.addEvent({
        timestamp: Date.now(),
        agentId: 'system',
        message: '✓ Reconnected to Hub',
      });
    } catch (error) {
      this.activityLog.addEvent({
        timestamp: Date.now(),
        agentId: 'system',
        message: `✗ Reconnection failed: ${error.message}`,
      });
    }
  }
}
```

### Terminal Resize

```typescript
this.screen.on('resize', () => {
  this.statusBar.resize();
  this.activityLog.resize();
  this.inputBox.resize();
  this.screen.render();
});
```

## Success Criteria

- [ ] Status bar shows all active agents in real-time
- [ ] Activity log displays events from all agents
- [ ] Input routing sends messages to correct agent
- [ ] Coordination mode displayed and updates
- [ ] Real-time updates work via Redis pub/sub
- [ ] Commands (/filter, /help, /status) work correctly
- [ ] Colors and formatting render properly
- [ ] Scrolling works with keyboard and mouse
- [ ] Clean terminal handling (no artifacts on exit)
- [ ] Test coverage >85%
- [ ] Works on macOS, Linux, and Windows (WSL)

## Future Enhancements

### Post-PR Improvements

1. **Progress Visualization**
   - Visual dependency graph
   - Gantt chart of PR execution
   - Blocking/ready PR counts

2. **Advanced Filtering**
   - Filter by PR ID
   - Filter by message type (error, info, debug)
   - Regex filtering

3. **Interactive Commands**
   - `/retry <pr-id>` - Retry failed PR
   - `/pause <agent-id>` - Pause agent
   - `/spawn <type>` - Spawn new agent

4. **Keyboard Shortcuts**
   - Tab: Switch focus between components
   - Ctrl-P: Toggle progress view
   - Ctrl-F: Quick filter
   - Ctrl-L: Clear log

5. **Multiple Views**
   - Split screen: agents on left, log on right
   - Tabbed interface: status, logs, metrics
   - Agent detail view

## Risk Mitigation

### Risk: Terminal Compatibility Issues

**Mitigation:**
- Test on major terminal emulators (iTerm2, Terminal.app, WSL, Windows Terminal)
- Provide `--no-color` flag for basic terminals
- Graceful degradation for limited terminal support
- Clear documentation of terminal requirements

### Risk: Performance with Many Agents

**Mitigation:**
- Event batching to reduce render calls
- Configurable log line limits
- Lazy rendering (only visible components)
- Performance monitoring and optimization

### Risk: Message Bus Latency

**Mitigation:**
- Local buffering of messages
- Optimistic UI updates
- Clear indicators when updates are delayed
- Reconnection logic for Redis failures

## Timeline

- **Phase 1:** Core TUI framework (15 min)
- **Phase 2:** Status bar component (10 min)
- **Phase 3:** Activity log component (10 min)
- **Phase 4:** Input router (15 min)
- **Phase 5:** Real-time updates (10 min)
- **Phase 6:** CLI integration (10 min)

**Total:** 70 minutes (as estimated in task list)

## Acceptance Criteria

From task list (PR-015):
- [ ] Status bar shows all active agents
- [ ] Real-time updates via Redis pub/sub
- [ ] Activity log displays agent actions
- [ ] Input routing to agents works
- [ ] Coordination mode displayed
- [ ] Clean terminal handling

## References

- [Blessed Documentation](https://github.com/chjj/blessed)
- [Blessed Examples](https://github.com/chjj/blessed/tree/master/example)
- [Terminal UI Best Practices](https://github.com/rothgar/awesome-tuis)
- PRD Section: Single Shell TUI (Feature #8)
