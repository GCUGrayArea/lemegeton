# PR-014: CLI Command Structure Implementation Plan

## Overview
Implement comprehensive CLI command structure for `lemegeton` using a command-line parser, providing intuitive commands for hub management (`hub start/stop`), work execution (`run`), and other essential operations.

## Dependencies
- **PR-007**: Hub Daemon Process ✅ (completed)

## Goals
1. Create intuitive CLI command hierarchy
2. Implement hub management commands (start, stop, status)
3. Add work execution command (run)
4. Provide clear help text and error messages
5. Support both `npx lemegeton` and installed usage
6. Enable agent-friendly programmatic commands for blanket approval

## Architecture

### Command Structure

```
lemegeton
├── hub
│   ├── start      # Start hub daemon
│   ├── stop       # Stop hub daemon
│   ├── status     # Check hub status
│   └── restart    # Restart hub
├── run            # Execute work (single PR or full task list)
├── status         # Show overall system status
├── plan           # Run planning agent (from PR-003a prompts)
├── prompt         # Access prompts (implemented in PR-003a)
│   ├── get        # Get specific prompt
│   └── list       # List available prompts
├── version        # Show version
└── help           # Show help
```

### Command Details

#### Hub Commands

**`lemegeton hub start`**
- Starts the Hub daemon process
- Initializes Redis (or auto-spawns if needed)
- Parses task-list.md
- Hydrates Redis from git state
- Returns immediately with daemon PID

**Options:**
```
--config <path>     # Custom config file
--detach           # Run in background (default: true)
--foreground       # Run in foreground with logs
--verbose          # Enable verbose logging
```

**`lemegeton hub stop`**
- Gracefully shuts down Hub daemon
- Stops all running agents
- Flushes state to git
- Cleans up resources

**Options:**
```
--force            # Force stop without graceful shutdown
--timeout <ms>     # Shutdown timeout (default: 5000)
```

**`lemegeton hub status`**
- Shows Hub daemon status
- Lists running agents
- Shows coordination mode
- Displays current work assignments

**Output Format:**
```
Hub Status: Running (PID: 12345)
Coordination Mode: Distributed
Agents: 3 active
  - planning-agent-001: Working on PR-009
  - worker-agent-002: Working on PR-011
  - qc-agent-003: Idle

Task Progress: 8/50 PRs complete (16%)
```

**`lemegeton hub restart`**
- Gracefully stops then starts Hub
- Preserves Redis state
- Reconnects agents

#### Run Command

**`lemegeton run [pr-id]`**
- Without PR-ID: Runs full task list execution
- With PR-ID: Runs specific PR only
- Blocks until completion or failure
- Shows progress updates

**Options:**
```
--watch            # Watch mode - continuous execution
--agent <type>     # Specific agent type to use
--model <tier>     # Force specific model tier
--budget <amount>  # Cost budget limit
--dry-run          # Simulate without executing
```

**Examples:**
```bash
lemegeton run                  # Run full task list
lemegeton run PR-009          # Run specific PR
lemegeton run --watch         # Continuous mode
lemegeton run PR-011 --model opus  # Force Opus
```

#### Status Command

**`lemegeton status`**
- Shows comprehensive system status
- Displays task list progress
- Shows running agents
- Coordination mode
- Recent activity

**Options:**
```
--json             # Output as JSON
--watch            # Continuous updates
```

#### Plan Command (Foundation for PR-020)

**`lemegeton plan <spec-file>`**
- Runs planning agent on spec file
- Generates PRD and task list
- Returns structured output

**Options:**
```
--output <path>    # Output path for generated files
--interactive      # Ask clarifying questions
--mcp              # Enable MCP queries for tech decisions
```

**Note:** Full implementation in PR-020, but CLI structure established here.

### Implementation Components

#### 1. Main CLI Entry Point (`src/cli/index.ts`)

```typescript
import { Command } from 'commander';

async function main() {
  const program = new Command();

  program
    .name('lemegeton')
    .description('Multi-agent task orchestration system')
    .version(getVersion());

  // Add command groups
  program.addCommand(createHubCommands());
  program.addCommand(createRunCommand());
  program.addCommand(createStatusCommand());
  program.addCommand(createPlanCommand());
  program.addCommand(createPromptCommands()); // From PR-003a

  await program.parseAsync(process.argv);
}
```

#### 2. Hub Commands (`src/cli/commands/hub.ts`)

```typescript
function createHubCommands(): Command {
  const hub = new Command('hub')
    .description('Hub daemon management');

  hub.command('start')
    .description('Start hub daemon')
    .option('--config <path>', 'Config file path')
    .option('--foreground', 'Run in foreground')
    .option('--verbose', 'Verbose logging')
    .action(async (options) => {
      await startHub(options);
    });

  hub.command('stop')
    .description('Stop hub daemon')
    .option('--force', 'Force stop')
    .option('--timeout <ms>', 'Shutdown timeout', '5000')
    .action(async (options) => {
      await stopHub(options);
    });

  hub.command('status')
    .description('Show hub status')
    .option('--json', 'JSON output')
    .action(async (options) => {
      await showHubStatus(options);
    });

  hub.command('restart')
    .description('Restart hub daemon')
    .action(async () => {
      await restartHub();
    });

  return hub;
}
```

#### 3. Run Command (`src/cli/commands/run.ts`)

```typescript
function createRunCommand(): Command {
  return new Command('run')
    .description('Execute work')
    .argument('[pr-id]', 'Specific PR to run')
    .option('--watch', 'Watch mode')
    .option('--agent <type>', 'Agent type')
    .option('--model <tier>', 'Model tier (haiku|sonnet|opus)')
    .option('--budget <amount>', 'Cost budget')
    .option('--dry-run', 'Simulate only')
    .action(async (prId, options) => {
      await runWork(prId, options);
    });
}
```

#### 4. Status Command (`src/cli/commands/status.ts`)

```typescript
function createStatusCommand(): Command {
  return new Command('status')
    .description('Show system status')
    .option('--json', 'JSON output')
    .option('--watch', 'Continuous updates')
    .action(async (options) => {
      await showStatus(options);
    });
}
```

#### 5. Hub Client (`src/cli/hubClient.ts`)

```typescript
class HubClient {
  private redis: RedisClient;

  // Hub lifecycle
  async startHub(options: HubStartOptions): Promise<HubStartResult>
  async stopHub(options: HubStopOptions): Promise<void>
  async getStatus(): Promise<HubStatus>

  // Work execution
  async runPR(prId: string, options: RunOptions): Promise<WorkResult>
  async runAll(options: RunOptions): Promise<WorkResult[]>

  // State queries
  async getAgents(): Promise<AgentInfo[]>
  async getTaskProgress(): Promise<TaskProgress>
  async getCoordinationMode(): Promise<CoordinationMode>

  // Daemon management
  private async spawnDaemon(options: HubStartOptions): Promise<number>
  private async findDaemonPid(): Promise<number | null>
  private async killDaemon(pid: number, signal: string): Promise<void>
}
```

#### 6. Output Formatters (`src/cli/formatters.ts`)

```typescript
class OutputFormatter {
  // Status formatters
  formatHubStatus(status: HubStatus, json: boolean): string
  formatAgentList(agents: AgentInfo[], json: boolean): string
  formatTaskProgress(progress: TaskProgress, json: boolean): string

  // Error formatters
  formatError(error: Error): string
  formatValidationErrors(errors: ValidationError[]): string

  // Table formatters
  createTable(headers: string[], rows: string[][]): string

  // Progress bars
  createProgressBar(current: number, total: number): string
}
```

#### 7. Error Handling (`src/cli/errors.ts`)

```typescript
class CLIError extends Error {
  constructor(
    message: string,
    public exitCode: number,
    public suggestions?: string[]
  ) {
    super(message);
  }
}

// Common CLI errors
class HubNotRunningError extends CLIError {
  constructor() {
    super(
      'Hub daemon is not running',
      1,
      ['Run `lemegeton hub start` to start the daemon']
    );
  }
}

class InvalidPRError extends CLIError {
  constructor(prId: string) {
    super(
      `PR "${prId}" not found in task list`,
      1,
      ['Check task-list.md for valid PR IDs']
    );
  }
}
```

### CLI Entry Point (`bin/lemegeton`)

```javascript
#!/usr/bin/env node
require('../dist/cli/index.js');
```

**Requirements:**
- Must be executable (`chmod +x`)
- Shebang for Node.js
- Points to compiled CLI

### Package.json Configuration

```json
{
  "name": "lemegeton",
  "version": "0.1.0",
  "bin": {
    "lemegeton": "./bin/lemegeton"
  },
  "scripts": {
    "build": "tsc",
    "cli": "node dist/cli/index.js"
  }
}
```

## Implementation Strategy

### Phase 1: CLI Framework Setup
1. Install Commander.js
2. Set up main CLI entry point
3. Create bin/lemegeton executable
4. Configure package.json bin field
5. Test basic command parsing

### Phase 2: Hub Commands
1. Implement `hub start` command
2. Add daemon spawning logic
3. Implement `hub stop` command
4. Add `hub status` command
5. Implement `hub restart` command

### Phase 3: Run Command
1. Implement basic `run` command
2. Add PR-specific execution
3. Add full task list execution
4. Implement watch mode
5. Add dry-run support

### Phase 4: Status Display
1. Implement status command
2. Create output formatters
3. Add JSON output support
4. Implement watch mode
5. Add progress visualization

### Phase 5: Error Handling
1. Create custom CLI error types
2. Implement error formatters
3. Add helpful error suggestions
4. Set correct exit codes
5. Add error recovery hints

### Phase 6: Polish
1. Add command aliases
2. Improve help text
3. Add examples to help
4. Implement shell completion (future)
5. Add verbose logging support

## Testing Strategy

### Unit Tests (`tests/cli.test.ts`)

**Command Parsing Tests:**
- Parse hub commands correctly
- Parse run command with options
- Parse status command
- Handle unknown commands
- Validate option values

**Output Formatting Tests:**
- Format status output correctly
- JSON output valid
- Table formatting works
- Progress bars render
- Error messages clear

**Hub Client Tests:**
- Start hub successfully
- Stop hub gracefully
- Get status correctly
- Handle daemon not running
- Handle Redis connection errors

### Integration Tests
- End-to-end: start hub → run PR → stop hub
- Daemon lifecycle management
- Error recovery flows
- Output formatting with real data

### Manual Testing
```bash
# Test full workflow
npm run build
./bin/lemegeton hub start
./bin/lemegeton status
./bin/lemegeton run PR-001
./bin/lemegeton hub stop
```

## Dependencies

```json
{
  "dependencies": {
    "commander": "^11.1.0",
    "chalk": "^4.1.2",
    "ora": "^5.4.1",
    "cli-table3": "^0.6.3"
  },
  "devDependencies": {
    "@types/node": "^20.0.0"
  }
}
```

## File Structure

```
src/cli/
├── index.ts              # Main CLI entry point
├── commands/
│   ├── hub.ts           # Hub commands
│   ├── run.ts           # Run command
│   ├── status.ts        # Status command
│   ├── plan.ts          # Plan command (stub for PR-020)
│   └── prompt.ts        # Prompt commands (from PR-003a)
├── hubClient.ts         # Hub client
├── formatters.ts        # Output formatters
└── errors.ts            # CLI errors

bin/
└── lemegeton            # CLI executable

tests/
└── cli.test.ts          # CLI tests
```

## Success Criteria

- ✅ `lemegeton hub start` starts daemon successfully
- ✅ `lemegeton hub stop` gracefully shuts down
- ✅ `lemegeton hub status` shows accurate information
- ✅ `lemegeton run` executes work correctly
- ✅ `lemegeton run PR-XXX` runs specific PR
- ✅ All commands have clear help text
- ✅ Error messages are helpful with suggestions
- ✅ Exit codes correct (0 success, 1+ failure)
- ✅ Works with `npx lemegeton`
- ✅ Works when installed globally
- ✅ Test coverage >90%

## User Experience

### Help Output Example

```bash
$ lemegeton --help

lemegeton - Multi-agent task orchestration system

Usage: lemegeton [command] [options]

Commands:
  hub <command>        Hub daemon management
    start              Start hub daemon
    stop               Stop hub daemon
    status             Show hub status
    restart            Restart hub daemon
  run [pr-id]          Execute work
  status               Show system status
  plan <spec-file>     Run planning agent (stub)
  prompt <command>     Access prompts
  version              Show version
  help [command]       Show help

Options:
  -h, --help          Show help
  -v, --version       Show version

Examples:
  lemegeton hub start           Start the hub daemon
  lemegeton run                Run all available work
  lemegeton run PR-009         Run specific PR
  lemegeton status --watch     Watch status continuously
```

### Error Message Examples

```bash
$ lemegeton hub stop
Error: Hub daemon is not running

Suggestions:
  • Run `lemegeton hub start` to start the daemon
  • Check if Redis is running

$ lemegeton run PR-999
Error: PR "PR-999" not found in task list

Suggestions:
  • Check docs/task-list.md for valid PR IDs
  • Run `lemegeton status` to see available work
```

## Integration with Existing Code

### PR-003a Integration (Prompts)
- Reuse existing `src/cli/commands/prompt.ts`
- Ensure compatibility with PromptLoader
- Maintain CLI-based prompt access

### PR-007 Integration (Hub)
- Import Hub class for daemon management
- Use Hub's startup/shutdown methods
- Access Hub's state via Redis

## Risk Mitigation

### Risk: Daemon Process Management
**Mitigation:**
- Use robust process spawning (child_process.spawn)
- PID file for tracking daemon
- Timeout on stop with force option
- Signal handling (SIGTERM, SIGKILL)

### Risk: Cross-Platform Compatibility
**Mitigation:**
- Use cross-platform path handling
- Test on Windows, macOS, Linux
- Use cross-spawn for process spawning
- Handle Windows service management

### Risk: User Experience Issues
**Mitigation:**
- Clear error messages with suggestions
- Consistent command structure
- Comprehensive help text
- Examples in documentation

### Risk: Breaking Changes
**Mitigation:**
- Semantic versioning
- Changelog for command changes
- Deprecation warnings
- Backward compatibility where possible

## Future Enhancements (Post-PR)
- Shell completion (bash, zsh, fish)
- Interactive mode for complex workflows
- Configuration wizard (`lemegeton init`)
- Log viewing (`lemegeton logs`)
- Agent management (`lemegeton agents list/kill`)
- Task list editing (`lemegeton pr add/edit`)
- Cost tracking (`lemegeton cost`)
- Metrics dashboard (`lemegeton metrics`)

## Agent-Friendly Commands (Foundation for PR-049a)

The CLI structure should support programmatic agent use:

```typescript
// Commands safe for blanket approval
const AGENT_SAFE_COMMANDS = [
  'status',        // Read-only
  'plan',          // Generates files only
  'prompt get',    // Read-only
  'prompt list',   // Read-only
  'run --dry-run', // Simulation only
];

// Commands requiring user approval
const USER_APPROVAL_REQUIRED = [
  'hub start',     // System modification
  'hub stop',      // System modification
  'run',           // Code execution
];
```

All commands should return structured, parseable output when `--json` flag is used, enabling agents to programmatically consume results.
