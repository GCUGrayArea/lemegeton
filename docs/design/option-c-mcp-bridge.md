# Option C: MCP Bridge Architecture

**Status:** Design Document
**Created:** 2025-11-23
**Purpose:** Design notes for implementing Lemegeton as an MCP server (Option C) based on Taskmaster's architecture

---

## Executive Summary

Option C implements Lemegeton as an **MCP (Model Context Protocol) server** that bridges between AI coding tools (Claude Code, Cursor, etc.) and Lemegeton's agent orchestration system. This approach:

- **Preserves tool-agnosticism** - Works with any MCP-compatible AI tool
- **Inherits session auth automatically** - No API keys needed when running in-session
- **Keeps agent logic intact** - MCP server is a thin bridge layer
- **Supports standalone mode** - Falls back to API keys for CLI usage

This document analyzes **Taskmaster's MCP implementation** and proposes how to apply those patterns to Lemegeton.

---

## Taskmaster Architecture Analysis

### Overview

Taskmaster is an AI-powered task management system that runs as an MCP server within AI coding tools. Key insights:

**Project Structure:**
```
claude-task-master/
├── mcp-server/          # MCP server implementation
│   ├── server.js        # Entry point, bootstrap
│   └── src/
│       ├── index.js     # TaskMasterMCPServer class
│       └── tools/       # Individual tool modules (40+ files)
│           ├── tool-registry.js   # Tool organization and modes
│           ├── next-task.js       # Example tool
│           ├── parse-prd.js       # Example tool
│           └── ...
├── packages/            # Core business logic (reusable)
└── apps/               # CLI and other interfaces
```

**Key Design Decision:** The MCP server is a **thin wrapper** that exposes core business logic as MCP tools. Business logic lives in reusable packages, not in the MCP server itself.

### MCP Server Implementation Pattern

**1. Server Class Structure**

```javascript
class TaskMasterMCPServer {
  constructor() {
    this.server = null;
    this.toolMode = 'standard'; // core | standard | all
  }

  async init() {
    // Create FastMCP instance
    this.server = new FastMCP({
      name: 'taskmaster-ai',
      version: '1.0.0'
    });

    // Register tools based on mode
    const result = registerTaskMasterTools(this.server, this.toolMode);

    // Handle connection events
    this.server.on('connect', (session) => {
      // Validate session capabilities
      // Register providers
    });
  }

  async start() {
    await this.server.start({ transport: 'stdio', timeout: 120000 });
  }
}
```

**2. Tool Definition Pattern**

Each tool is a self-contained module following this pattern:

```javascript
// tools/next-task.js
import { z } from 'zod';

export function registerNextTask(server) {
  server.addTool({
    name: 'next_task',
    description: 'Get the next task to work on',

    // Zod schema for parameter validation
    parameters: z.object({
      file: z.string().optional().describe('Path to tasks file'),
      projectRoot: z.string().describe('Absolute path to project')
    }),

    // Execution handler
    execute: async (args, context) => {
      try {
        // Call core business logic
        const result = await taskService.getNextTask(args);

        // Return structured result
        return handleApiResult(result);
      } catch (error) {
        return createErrorResponse(error.message);
      }
    }
  });
}
```

**Key Patterns:**
- **Declarative schema** - Zod schemas for automatic validation
- **Middleware wrapping** - Path normalization, error handling
- **Structured responses** - Consistent result/error format
- **Thin wrapper** - Tools delegate to core services

**3. Tool Registry and Modes**

```javascript
// tools/tool-registry.js

// Tool organization
const CORE_TOOLS = [
  'get_tasks', 'next_task', 'set_task_status',
  'parse_prd', 'expand_task', 'update_subtask', 'get_task'
]; // 7 essential tools

const STANDARD_TOOLS = [
  ...CORE_TOOLS,
  'initialize_project', 'analyze_project_complexity',
  'expand_all', 'add_subtask', 'remove_task',
  'add_task', 'complexity_report', 'update_task'
]; // 15 common tools

const ALL_TOOLS = [
  ...STANDARD_TOOLS,
  'add_dependency', 'remove_dependency', 'validate_dependencies',
  'add_tag', 'remove_tag', 'list_tags', 'research',
  // ... 29 more advanced tools
]; // 44 total tools

// Dynamic tool loading based on mode
export function registerTaskMasterTools(server, mode) {
  const tools = getToolsForMode(mode);
  const registered = [];
  const failed = [];

  for (const toolName of tools) {
    try {
      const registerFn = toolRegistry[toolName];
      registerFn(server);
      registered.push(toolName);
    } catch (error) {
      failed.push({ tool: toolName, error: error.message });
    }
  }

  return { registered, failed, mode };
}
```

**Benefits of Mode System:**
- **Core mode (7 tools)** - Minimal context (~5K tokens)
- **Standard mode (15 tools)** - Balanced features (~10K tokens)
- **All mode (44 tools)** - Complete functionality (~21K tokens)

Users can optimize for context window vs. feature set.

**4. Authentication Model**

```javascript
// Session-based auth (no API keys needed)
this.server.on('connect', (session) => {
  // Validate session has required capabilities
  if (!session.clientCapabilities?.sampling) {
    throw new Error('Client must support sampling');
  }

  // Register provider with session auth
  const provider = new MCPProvider({
    session,  // Session contains auth context
    config: this.config
  });

  ProviderRegistry.register(provider);
});
```

**Key Insight:** MCP server runs **in-process** within the AI tool's session. It automatically inherits the parent session's authentication. No need to pass API keys.

---

## Mapping Taskmaster Patterns to Lemegeton

### Conceptual Mapping

| Taskmaster Concept | Lemegeton Equivalent | Notes |
|-------------------|---------------------|-------|
| Task | PR (Pull Request) | Atomic unit of work |
| Subtask | PR dependencies | Relationships between PRs |
| Tags | PR states, complexity levels | Categorization |
| `next_task` | `next_pr` | Get next available work |
| `set_task_status` | `update_pr_state` | State transitions |
| `parse_prd` | Already have PRD parsing | Planning agent creates PRDs |
| `initialize_project` | Already have startup sequence | Hub initialization |
| Tool modes (core/standard/all) | Agent modes (planning/worker/qc) | Different capability levels |

### Architecture Translation

**Taskmaster:**
```
AI Tool Session
  ↓
MCP Server (in-process)
  ↓
Tool Functions (thin wrappers)
  ↓
Core Business Logic (packages/)
  ↓
File System, APIs
```

**Lemegeton Option C:**
```
AI Tool Session (Claude Code, Cursor, etc.)
  ↓
Lemegeton MCP Server (new, thin layer)
  ↓
MCP Tool Functions (new, expose existing functionality)
  ↓
Existing Core System (Hub, Scheduler, Agents, MessageBus)
  ↓
Redis, Git, File System
```

**Key Difference:** Lemegeton already has a sophisticated orchestration system (Hub, MessageBus, Agents). The MCP server just **exposes existing functionality** as MCP tools.

---

## Proposed Implementation

### Phase 1: MCP Server Foundation

**Create `mcp-server/` directory structure:**

```
lemegeton/
├── mcp-server/
│   ├── server.js              # Entry point
│   ├── package.json           # MCP-specific dependencies
│   └── src/
│       ├── index.js           # LemegetonMCPServer class
│       ├── tools/             # MCP tool definitions
│       │   ├── index.js       # Tool registration
│       │   ├── run-pr.js      # Main tool: run a PR
│       │   ├── list-prs.js    # List available PRs
│       │   ├── get-pr-status.js
│       │   ├── next-pr.js
│       │   └── ...
│       ├── bridge/            # Bridge to core Lemegeton
│       │   ├── hub-client.js  # Reuses src/cli/hubClient.ts
│       │   └── redis-client.js
│       └── utils/
│           ├── auth.js        # Auth detection (API key vs OAuth)
│           └── responses.js   # Structured result format
└── src/                       # Existing core system (unchanged)
    ├── hub/
    ├── agents/
    ├── scheduler/
    └── ...
```

### Phase 2: Core MCP Tools

**Tool Set Design:**

```javascript
// Minimal viable tool set (Core mode)
const CORE_TOOLS = [
  'list_prs',        // List all PRs with states
  'next_pr',         // Get next PR to work on
  'run_pr',          // Execute work on a PR (main tool)
  'get_pr_status',   // Check PR state and progress
  'stop_hub'         // Graceful shutdown
];

// Standard tool set
const STANDARD_TOOLS = [
  ...CORE_TOOLS,
  'start_hub',       // Start hub daemon
  'assign_pr',       // Assign PR to specific agent
  'get_pr_details',  // Full PR metadata
  'list_agents',     // Show active agents
  'kill_agent'       // Terminate specific agent
];

// Advanced tool set
const ALL_TOOLS = [
  ...STANDARD_TOOLS,
  'create_pr',       // Add new PR to task list
  'update_pr',       // Modify PR metadata
  'set_pr_state',    // Manual state override
  'get_dependencies',// Show dependency graph
  'validate_deps',   // Check for circular deps
  'complexity_estimate' // Analyze PR complexity
];
```

**Core Tool Implementation Example:**

```javascript
// mcp-server/src/tools/run-pr.js
import { z } from 'zod';
import { HubClient } from '../../bridge/hub-client.js';

export function registerRunPR(server) {
  server.addTool({
    name: 'run_pr',
    description: 'Execute work on a PR (planning, implementation, QC, or review)',

    parameters: z.object({
      prId: z.string().describe('PR identifier (e.g., PR-017)'),
      mode: z.enum(['in-process', 'daemon']).optional()
        .describe('Execution mode: in-process (blocking) or daemon (async)'),
      timeout: z.number().optional()
        .describe('Timeout in seconds (default: 120)')
    }),

    execute: async (args, context) => {
      try {
        const hubClient = new HubClient({
          redisUrl: process.env.REDIS_URL,
          // MCP session auth is inherited automatically
        });

        // Call existing HubClient.runPR() method
        const result = await hubClient.runPR(args.prId, {
          timeout: (args.timeout || 120) * 1000
        });

        return {
          success: true,
          prId: args.prId,
          state: result.state,
          filesModified: result.filesModified,
          output: result.output,
          agentType: result.agentType
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          prId: args.prId
        };
      }
    }
  });
}
```

**Key Insight:** Tools are **thin wrappers** around existing `HubClient` methods. Most business logic already exists!

### Phase 3: Authentication Bridge

**Support both MCP session auth and API keys:**

```javascript
// mcp-server/src/utils/auth.js

export function getAuthConfig() {
  // Priority order:
  // 1. MCP session auth (inherited automatically)
  // 2. ANTHROPIC_API_KEY env var
  // 3. CLAUDE_CODE_OAUTH_TOKEN env var
  // 4. Error if none available

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;

  return {
    hasSessionAuth: true,  // MCP session provides this
    apiKey: apiKey || null,
    oauthToken: oauthToken || null,
    authType: apiKey ? 'api_key' :
              oauthToken ? 'oauth_token' :
              'session'
  };
}
```

**Multi-Tool Auth Adapter:**

```javascript
// mcp-server/src/utils/multi-tool-auth.js

/**
 * Adapts authentication for different AI tools
 */
export class MultiToolAuthAdapter {
  constructor(session) {
    this.session = session;
    this.detectedTool = this.detectTool();
  }

  detectTool() {
    // Heuristics to detect which AI tool we're running in
    if (process.env.CLAUDE_CODE_SESSION) return 'claude-code';
    if (process.env.CURSOR_SESSION) return 'cursor';
    if (process.env.GH_TOKEN) return 'copilot';
    return 'unknown';
  }

  async getCredentials() {
    switch (this.detectedTool) {
      case 'claude-code':
        return this.getClaudeCodeAuth();
      case 'cursor':
        return this.getCursorAuth();
      case 'copilot':
        return this.getCopilotAuth();
      default:
        return this.getFallbackAuth();
    }
  }

  async getClaudeCodeAuth() {
    // Try session auth first, fall back to env vars
    if (this.session?.auth) {
      return { type: 'session', token: this.session.auth };
    }
    const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    if (token) {
      return { type: 'oauth', token };
    }
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      return { type: 'api_key', key: apiKey };
    }
    throw new Error('No auth available for Claude Code');
  }

  async getCursorAuth() {
    // Similar pattern for Cursor
    const apiKey = process.env.CURSOR_API_KEY;
    if (apiKey) {
      return { type: 'api_key', key: apiKey };
    }
    throw new Error('No auth available for Cursor');
  }

  async getCopilotAuth() {
    // Use GitHub token
    const token = process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN;
    if (token) {
      return { type: 'github_token', token };
    }
    throw new Error('No auth available for Copilot');
  }

  async getFallbackAuth() {
    // Try API key as universal fallback
    const apiKey = process.env.ANTHROPIC_API_KEY ||
                   process.env.OPENAI_API_KEY;
    if (apiKey) {
      return { type: 'api_key', key: apiKey };
    }
    throw new Error('No authentication credentials found');
  }
}
```

### Phase 4: Dual-Mode Support

**Support both MCP server mode and standalone CLI mode:**

```javascript
// Detect execution mode
const isMCPMode = process.env.LEMEGETON_MCP === 'true' ||
                  process.argv.includes('--mcp-server');

if (isMCPMode) {
  // Start MCP server
  const mcpServer = new LemegetonMCPServer();
  await mcpServer.init();
  await mcpServer.start();
} else {
  // Run standalone CLI
  const cli = new CLI();
  await cli.run(process.argv);
}
```

**Benefits:**
- Users can choose: MCP plugin (easy, session auth) or CLI (flexible, API keys)
- Same core logic, different interfaces
- Gradual migration path

---

## Implementation Roadmap

### Step 1: Proof of Concept (1-2 days)
- [ ] Create `mcp-server/` directory structure
- [ ] Implement basic `LemegetonMCPServer` class using FastMCP
- [ ] Add single tool: `run_pr` (wraps existing `HubClient.runPR`)
- [ ] Test with Claude Code using `claude mcp add`
- [ ] Validate session auth works

**Success Criteria:** Can run `run_pr` tool from Claude Code session without API key

### Step 2: Core Tool Set (2-3 days)
- [ ] Implement 5 core tools: `list_prs`, `next_pr`, `run_pr`, `get_pr_status`, `stop_hub`
- [ ] Add tool registry with mode support (core/standard/all)
- [ ] Implement structured response format
- [ ] Add error handling and logging

**Success Criteria:** Can orchestrate full PR workflow using MCP tools

### Step 3: Multi-Tool Auth Adapter (1-2 days)
- [ ] Implement `MultiToolAuthAdapter` class
- [ ] Add support for Claude Code, Cursor, Copilot auth patterns
- [ ] Test with multiple tools (if available)
- [ ] Document auth configuration per tool

**Success Criteria:** MCP server detects and adapts to different AI tools

### Step 4: Plugin Packaging (1 day)
- [ ] Create plugin manifest for Claude Code
- [ ] Add installation instructions
- [ ] Test plugin installation flow
- [ ] Document user setup process

**Success Criteria:** Users can install with one command: `/plugin add lemegeton`

### Step 5: Documentation & Testing (1 day)
- [ ] Write MCP server documentation
- [ ] Add tool usage examples
- [ ] Create troubleshooting guide
- [ ] Test end-to-end workflows

**Total Estimate:** 6-9 days (aligns with "Medium effort: 3-5 days" from status doc, accounting for unknowns)

---

## Comparison with Other Options

### Option A: Claude Code Subagents

**Pros of Subagents:**
- Even tighter integration (agents managed by Claude)
- Potentially simpler auth (fully automatic)

**Cons of Subagents:**
- **Tighter coupling** - Only works with Claude Code
- **More invasive** - Requires rewriting agent architecture
- **Less portable** - Can't support Cursor, Copilot, etc.

**Why Option C is better:** MCP is a **standard protocol** that works across tools. Subagents lock us into Claude Code only.

### Option B: OAuth Token Passing (Current Implementation)

**Pros of Option B:**
- Already implemented ✅
- Works for validation
- Minimal code changes

**Cons of Option B:**
- **Manual token management** (user must run `claude setup-token`)
- **Token expiration issues** (unclear lifetime)
- **Security concerns** (tokens in env vars)
- **Not a long-term solution** (undocumented pattern)

**Why Option C is better:** MCP session auth is **automatic, secure, and officially supported**.

### Option D: Require API Keys

**Pros of Option D:**
- Simple, well-documented
- Universal (works with all tools)

**Cons of Option D:**
- **Additional cost** (separate billing from subscriptions)
- **Worse UX** (users must manage keys)
- **Blocks dogfooding** (current user has no API key)

**Why Option C is better:** Users with subscriptions (Claude Max, Cursor Pro, Copilot) can use Lemegeton **without additional API costs**.

---

## Tool-Agnosticism Strategy

### MCP Compatibility Matrix

| Tool | MCP Support | Auth Method | Installation |
|------|-------------|-------------|--------------|
| **Claude Code** | ✅ Native | Session (automatic) | `/plugin add lemegeton` |
| **Cursor** | ✅ Yes | API key or session | `cursor mcp add lemegeton` |
| **Windsurf** | ✅ Yes | Session (automatic) | Plugin marketplace |
| **VS Code** | ✅ Via extension | API key | Extension settings |
| **Copilot** | ❓ Unclear | GitHub token | Not applicable |
| **Standalone CLI** | N/A | API key | `npm install -g lemegeton` |

### Fallback Strategy

**For tools without MCP support:**
1. Detect execution environment
2. If MCP not available, fall back to standalone CLI mode
3. Require API key configuration
4. Document tool-specific setup

**Example:**
```javascript
if (!isMCPCompatible()) {
  console.log('MCP not detected. Running in standalone mode.');
  console.log('Set ANTHROPIC_API_KEY to authenticate.');
  // Run CLI mode
}
```

---

## Open Questions

1. **Session auth details:** How exactly does MCP session auth work? Need to test with real MCP session to understand credential flow.

2. **Tool detection:** Is there a standard way to detect which AI tool is hosting the MCP server? Or do we need heuristics?

3. **Cursor MCP status:** Does Cursor fully support MCP session auth, or only API keys? Need to test.

4. **Long-running operations:** How do MCP servers handle long-running tools (e.g., WorkerAgent generating code)? Does the session timeout? Need streaming support?

5. **Multi-user coordination:** If multiple users run the same MCP server (shared Redis), how do we handle concurrent work assignments? Need to test collision scenarios.

6. **Plugin distribution:** What's the official way to distribute Lemegeton as a plugin? NPM package? Git repo? Plugin marketplace?

---

## Next Steps

**After Option B validation succeeds:**

1. **Decide:** Formally choose Option C as the long-term architecture
2. **Prototype:** Implement Step 1 (proof of concept) to validate feasibility
3. **Test:** Verify session auth works with Claude Code MCP
4. **Iterate:** Expand to full core tool set
5. **Document:** Write user guides for installation and usage
6. **Distribute:** Package as Claude Code plugin

**Decision Criteria for Moving Forward:**
- ✅ Option B validation passes (coordination core works)
- ✅ MCP session auth actually works (needs testing)
- ✅ FastMCP SDK is stable and well-documented
- ✅ Effort estimate aligns with available time budget

---

## References

### Taskmaster
- GitHub: https://github.com/eyaltoledano/claude-task-master
- MCP Provider Guide: `/docs/mcp-provider-guide.md`
- Tool Registry: `/mcp-server/src/tools/tool-registry.js`

### MCP Protocol
- Specification: https://modelcontextprotocol.io/
- FastMCP SDK: https://github.com/jlowin/fastmcp
- Claude Code MCP Docs: https://docs.anthropic.com/claude-code/mcp

### Related Documents
- `/DOGFOODING_STATUS.md` - Current implementation status
- `/docs/architecture.md` - Core Lemegeton architecture
- `/docs/design/agent-architecture.md` - Agent system design (if exists)

---

**Document Status:** Draft - Ready for review
**Next Review:** After Option B validation completes
**Owner:** Lemegeton core team
