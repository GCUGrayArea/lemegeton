# Option A: Claude Code Subagents Architecture

**Status:** Design Proposal
**Created:** 2025-11-23
**Purpose:** Design notes for reimplementing Lemegeton agents as Claude Code subagents

---

## Executive Summary

Option A reimplements Lemegeton's agent system using **Claude Code subagents** - specialized instances of Claude with isolated contexts and pre-configured capabilities. This approach:

- ✅ **Solves authentication** - Automatic session auth inheritance
- ✅ **Native parallelism** - Built-in concurrent execution (max 10)
- ✅ **Cleaner architecture** - Declarative YAML-based agent definitions
- ⚠️ **Claude-specific** - Deep dependency on Claude Code/Agent SDK
- ❌ **Limited portability** - Requires rewrite for non-Claude environments
- ❌ **No agent nesting** - Flat architecture only, no hierarchies

**Critical Trade-off:** This approach **tightly couples Lemegeton to the Claude ecosystem**. While it provides excellent UX within Claude Code, it sacrifices the tool-agnosticism design goal.

---

## What Are Claude Code Subagents?

### Definition

**Subagents** are pre-configured, specialized instances of Claude that can be spawned and delegated complex tasks. Think of them as "AI workers" with:

- **Isolated contexts** - Each subagent has its own conversation thread
- **Custom system prompts** - Specialized personalities/instructions
- **Tool restrictions** - Can limit access to specific capabilities
- **Automatic auth** - Inherits parent session credentials

### Key Characteristics

**vs. Child Processes (Current Lemegeton Approach):**

| Aspect | Child Process (Current) | Claude Subagents |
|--------|------------------------|------------------|
| **Execution** | Separate OS process | Logical agent instance (API calls) |
| **Management** | Your code manages lifecycle | Claude Code manages lifecycle |
| **Communication** | IPC via MessageBus/Redis | Unidirectional (task completion only) |
| **Auth** | Must pass env vars manually | Automatic session inheritance |
| **Parallelism** | Unlimited (resource-constrained) | Max 10 concurrent |
| **Monitoring** | Full visibility (stdout/stderr) | No visibility until completion |
| **Nesting** | Unlimited depth | **Cannot nest** (flat only) |

**How They Actually Work:**

```
Parent Claude Code Session
  ↓ (uses Task tool)
Claude API creates isolated instance
  ↓ (loads agent definition)
Subagent executes with own context (~20K token overhead)
  ↓ (completes work)
Results compressed and returned to parent
  ↓
Subagent instance terminates
```

**Important:** Subagents are **not separate OS processes**. They're isolated conversation threads via Claude API, similar to opening multiple Claude.ai chat windows with different system prompts.

---

## Claude-Specificity Analysis

### What's Claude-Specific (Non-Portable)

❌ **Deeply Locked In:**

1. **Task Tool Execution**
   - Subagents use Claude's Task tool (not available outside Claude ecosystem)
   - No equivalent in OpenAI, Anthropic raw API, or other providers
   - Cannot be emulated without reimplementing the entire orchestration layer

2. **Agent Definition Format**
   - While YAML is portable, the *interpretation* is Claude-specific
   - Fields like `tools: "inherit"` only work in Claude Code
   - Tool naming conventions are Claude Code-specific

3. **Authentication Flow**
   - Session auth inheritance is Claude Code-specific
   - Other tools (Cursor, Copilot) have different auth models
   - No standard protocol for subagent authentication

4. **Lifecycle Management**
   - Claude Code manages agent spawning, execution, termination
   - No API to manage this lifecycle externally
   - Cannot run without Claude Code runtime

5. **Tool Access Model**
   - Tool inheritance (`tools: "inherit"`) is Claude-specific
   - MCP server integration is Claude-specific
   - File system access uses Claude Code's sandboxing model

### What's Portable (Could Be Migrated)

✅ **Potentially Portable:**

1. **Agent Definitions (Markdown Files)**
   ```markdown
   ---
   name: "WorkerAgent"
   description: "Implements PRs based on PRDs"
   ---
   You are an expert TypeScript developer...
   ```
   - Can be converted to other formats (JSON, config files)
   - System prompts are plain text
   - Conceptually portable to any LLM system

2. **Business Logic**
   - Core Lemegeton logic (Hub, Scheduler, Redis) stays unchanged
   - Agent *behavior* can be replicated in other systems
   - State management is already tool-agnostic

3. **Data Structures**
   - PR definitions in task-list.md
   - Redis state storage
   - PRD files in docs/plans/
   - All tool-agnostic

### Portability Reality Check

**Can Lemegeton run outside Claude Code if built with subagents?**

**Short answer: No, not without significant rewrites.**

**To run in other environments, you'd need to:**

1. **Reimplement orchestration layer**
   - Replace Task tool with your own agent spawning
   - Manage agent lifecycle manually
   - Handle auth explicitly (API keys)

2. **Convert agent definitions**
   - Parse YAML frontmatter
   - Map to provider-specific formats
   - Rebuild tool access controls

3. **Build communication layer**
   - Subagents can't use MessageBus/Redis directly
   - Would need to reimplement inter-agent communication
   - No parent visibility during execution

4. **Rebuild monitoring**
   - No stdout/stderr capture from subagents
   - Must poll for completion
   - No progress reporting

**Effort estimate:** 2-3 weeks to rebuild portability that currently exists.

### Comparison: Option A vs Option C Lock-In

| Aspect | Option A (Subagents) | Option C (MCP Bridge) |
|--------|---------------------|----------------------|
| **Claude Code** | ✅ Native, perfect fit | ✅ Supported via MCP |
| **Cursor** | ❌ Not compatible | ✅ MCP supported |
| **Windsurf** | ❌ Not compatible | ✅ MCP supported |
| **VS Code** | ⚠️ Via Agent SDK (complex) | ✅ MCP extension |
| **Standalone CLI** | ❌ Requires full rewrite | ✅ Works (API key fallback) |
| **CI/CD** | ⚠️ Via Agent SDK (API key) | ✅ Works (API key) |
| **GitHub Actions** | ⚠️ Requires Agent SDK setup | ✅ Standard CLI |

**Verdict:** Option A is **significantly more Claude-specific** than Option C.

---

## How Lemegeton Maps to Subagents

### Current Architecture

```
CLI Command
  ↓
HubClient (in-process or daemon)
  ↓
Hub (orchestrator)
  ↓
AgentSpawner
  ↓
Child Processes (OS)
  ├── PlanningAgent.js
  ├── WorkerAgent.js
  ├── QCAgent.js
  └── ReviewAgent.js
```

### Subagent Architecture

```
User in Claude Code Session
  ↓
Lemegeton Orchestrator Agent (parent)
  ↓
Task Tool (spawns subagents)
  ├── @planning-agent (subagent)
  ├── @worker-agent (subagent)
  ├── @qc-agent (subagent)
  └── @review-agent (subagent)
```

**Key Difference:** The "parent orchestrator" is no longer your code - it's a Claude instance with a custom system prompt that *uses your code* as tools.

### Conceptual Mapping

| Lemegeton Concept | Subagent Equivalent | Notes |
|------------------|--------------------|----|
| **AgentSpawner** | Task tool | Built-in to Claude |
| **ProcessManager** | Claude Code lifecycle mgmt | Automatic |
| **MessageBus** | Task tool params/results | Simplified (no pub/sub) |
| **Agent types** | Subagent definitions | `.claude/agents/*.md` files |
| **Hub** | Orchestrator agent | Parent Claude instance |
| **Redis state** | Orchestrator context | Or keep Redis for persistence |
| **Work assignment** | Task tool invocation | Pass via prompt/params |
| **Completion reporting** | Task tool return value | Compressed summary |

### Agent Definitions

**Current: TypeScript Classes**
```typescript
// src/agents/worker.ts
export class WorkerAgent extends BaseAgent {
  async doWork(assignment: Assignment): Promise<WorkResult> {
    // Implementation...
  }
}
```

**Subagent: YAML + System Prompt**
```markdown
<!-- .claude/agents/worker-agent.md -->
---
name: "WorkerAgent"
description: "Implements PRs based on PRD specifications"
tools: "file-read,file-write,bash"
model: "sonnet"
---

# Worker Agent System Prompt

You are an expert TypeScript developer implementing features for the Lemegeton
agent orchestration system.

## Your Task

When assigned a PR:
1. Read the PRD from docs/plans/PR-{id}-*.md
2. Read the PR metadata from Redis (use provided tools)
3. Generate implementation code following the PRD
4. Write files to disk
5. Run `npm run build` to verify compilation
6. Update PR state to 'implemented'
7. Report files modified and build status

## Guidelines

- Follow existing code patterns in the codebase
- Use TypeScript with strict mode
- Write clear, self-documenting code
- Handle errors gracefully
- Report progress at each step

## Output Format

Return a JSON summary:
{
  "success": true/false,
  "filesModified": ["path1", "path2"],
  "buildStatus": "passed/failed",
  "error": "error message if failed"
}
```

**Key Change:** Business logic moves from TypeScript code to natural language instructions that guide Claude's behavior.

---

## Proposed Implementation

### Phase 1: Agent Definition Files

**Create `.claude/agents/` directory:**

```
lemegeton/
├── .claude/
│   └── agents/
│       ├── orchestrator.md      # Parent agent (Hub replacement)
│       ├── planning-agent.md    # Planning work
│       ├── worker-agent.md      # Implementation work
│       ├── qc-agent.md          # Testing & validation
│       └── review-agent.md      # Code review
└── src/                         # Keep existing code as tools
    ├── hub/
    ├── scheduler/
    └── ...
```

### Phase 2: Orchestrator Agent

**Role:** Replaces the Hub as the central coordinator.

**File: `.claude/agents/orchestrator.md`**
```markdown
---
name: "LemegetonOrchestrator"
description: "Coordinates PR work across specialized agents"
tools: "inherit"  # Access to all tools
model: "opus"     # Use most capable model for coordination
---

# Lemegeton Orchestrator

You coordinate work on PRs by delegating to specialized agents.

## Available Agents

- `@planning-agent` - Creates PRDs for new PRs
- `@worker-agent` - Implements code based on PRDs
- `@qc-agent` - Runs tests and validates implementations
- `@review-agent` - Reviews code quality and provides feedback

## Your Workflow

When the user asks to run a PR:

1. **Check PR state** (read from Redis)
   - new → delegate to @planning-agent
   - planned → delegate to @worker-agent
   - implemented → delegate to @qc-agent
   - testing → delegate to @review-agent

2. **Spawn appropriate agent** using Task tool
   - Pass PR ID and relevant context
   - Wait for completion

3. **Update state** based on results
   - Update Redis with new state
   - Report outcome to user

4. **Handle failures**
   - If agent fails, mark PR as 'failed'
   - Report error details
   - Suggest next steps

## Redis Access

Use these tools to interact with state:
- `get_pr_data(prId)` - Fetch PR metadata
- `update_pr_state(prId, newState)` - Update state
- `list_prs()` - Get all PRs

## Example Invocation

User: "Run PR-017"
You:
1. Call `get_pr_data("PR-017")` → state is "planned"
2. Use Task tool: `@worker-agent PR-017`
3. Wait for worker completion
4. Call `update_pr_state("PR-017", "implemented")`
5. Report: "PR-017 implemented successfully. Modified X files."
```

### Phase 3: Tool Bridge Layer

**Problem:** Subagents need access to Lemegeton's business logic (Redis, Hub, Scheduler).

**Solution:** Expose existing functionality as MCP tools that subagents can call.

**Create: `mcp-server/lemegeton-tools.js`**

```javascript
// MCP tools that bridge to Lemegeton core functionality
import { RedisClient } from '../src/redis/client.js';
import { Scheduler } from '../src/scheduler/index.js';

export function registerLemegetonTools(server) {
  // Tool: Get PR data from Redis
  server.addTool({
    name: 'get_pr_data',
    description: 'Fetch PR metadata from Redis state',
    parameters: z.object({
      prId: z.string().describe('PR identifier (e.g., PR-017)')
    }),
    execute: async ({ prId }) => {
      const client = await RedisClient.getInstance();
      const prsData = await client.get('state:prs');
      const prs = JSON.parse(prsData || '{}');
      return prs[prId] || { error: 'PR not found' };
    }
  });

  // Tool: Update PR state
  server.addTool({
    name: 'update_pr_state',
    description: 'Update PR state in Redis',
    parameters: z.object({
      prId: z.string(),
      newState: z.enum(['new', 'planned', 'implemented', 'testing', 'done', 'failed'])
    }),
    execute: async ({ prId, newState }) => {
      const client = await RedisClient.getInstance();
      const prsData = await client.get('state:prs');
      const prs = JSON.parse(prsData || '{}');

      if (!prs[prId]) {
        return { error: 'PR not found' };
      }

      prs[prId].cold_state = newState;
      await client.set('state:prs', JSON.stringify(prs));

      return { success: true, prId, newState };
    }
  });

  // Tool: List all PRs
  server.addTool({
    name: 'list_prs',
    description: 'Get all PRs with their current states',
    parameters: z.object({}),
    execute: async () => {
      const client = await RedisClient.getInstance();
      const prsData = await client.get('state:prs');
      const prs = JSON.parse(prsData || '{}');

      return Object.values(prs).map(pr => ({
        id: pr.id,
        title: pr.title,
        state: pr.cold_state,
        complexity: pr.complexity?.level
      }));
    }
  });

  // Tool: Get next available PR
  server.addTool({
    name: 'next_pr',
    description: 'Get the next PR that should be worked on',
    parameters: z.object({}),
    execute: async () => {
      // Use Scheduler to find next PR
      const scheduler = await Scheduler.getInstance();
      const nextPR = await scheduler.getNextAvailablePR();
      return nextPR || { message: 'No PRs available' };
    }
  });
}
```

**Configuration: `settings.json`**

```json
{
  "mcpServers": {
    "lemegeton-tools": {
      "command": "node",
      "args": ["mcp-server/lemegeton-tools.js"],
      "env": {
        "REDIS_URL": "redis://localhost:6379"
      }
    }
  }
}
```

### Phase 4: Specialized Agent Definitions

**File: `.claude/agents/planning-agent.md`**

```markdown
---
name: "PlanningAgent"
description: "Creates detailed PRDs for new PRs"
tools: "file-read,file-write,get_pr_data,update_pr_state"
model: "sonnet"
---

# Planning Agent

You create implementation plans (PRDs) for new PRs.

## Input

You'll receive a PR ID as your task. Example: "PR-017"

## Workflow

1. Use `get_pr_data(prId)` to fetch PR details
2. Analyze the PR title and description
3. Generate a comprehensive PRD covering:
   - Overview and objectives
   - Dependencies (other PRs, external libraries)
   - Files to create/modify
   - Implementation steps
   - Testing strategy
   - Acceptance criteria
4. Write PRD to `docs/plans/PR-{id}-{slug}.md`
5. Use `update_pr_state(prId, "planned")`
6. Return summary with PRD path

## Output Format

{
  "success": true,
  "prdPath": "docs/plans/PR-017-cost-controller.md",
  "estimatedComplexity": "medium",
  "filesAffected": 5
}
```

**File: `.claude/agents/worker-agent.md`**

```markdown
---
name: "WorkerAgent"
description: "Implements code based on PRD specifications"
tools: "file-read,file-write,bash,get_pr_data,update_pr_state"
model: "sonnet"
---

# Worker Agent

You implement code following PRD specifications.

## Input

PR ID for a "planned" PR. Example: "PR-017"

## Workflow

1. Use `get_pr_data(prId)` to fetch metadata
2. Read PRD from `docs/plans/PR-{id}-*.md`
3. Generate implementation code:
   - Follow existing code patterns
   - Use TypeScript strict mode
   - Handle errors properly
4. Write files (create/modify as needed)
5. Run `npm run build` via bash tool
6. If build succeeds: `update_pr_state(prId, "implemented")`
7. If build fails: report errors, don't update state

## Output Format

{
  "success": true/false,
  "filesModified": ["src/hub/foo.ts", "src/agents/bar.ts"],
  "buildStatus": "passed",
  "linesAdded": 150,
  "linesDeleted": 20
}
```

**File: `.claude/agents/qc-agent.md`**

```markdown
---
name: "QCAgent"
description: "Runs tests and validates implementations"
tools: "file-read,bash,get_pr_data,update_pr_state"
model: "haiku"  # Cheaper model for testing tasks
---

# QC Agent

You validate implementations by running tests.

## Input

PR ID for an "implemented" PR.

## Workflow

1. Use `get_pr_data(prId)` to get context
2. Run test suite: `npm test` via bash tool
3. Parse test results
4. If all pass: `update_pr_state(prId, "done")`
5. If any fail: `update_pr_state(prId, "testing")` and report failures

## Output Format

{
  "success": true/false,
  "testsPassed": 45,
  "testsFailed": 2,
  "failures": [
    {
      "test": "WorkerAgent should generate code",
      "error": "Expected 3 files, got 2"
    }
  ]
}
```

### Phase 5: User Interaction Model

**How users interact with Lemegeton:**

**Option 5A: Direct Mention (Simple)**

```
User in Claude Code chat:
> @lemegeton-orchestrator run PR-017

Claude (as orchestrator):
1. Reads PR-017 state → "planned"
2. Invokes: @worker-agent PR-017
3. Waits for completion
4. Updates state
5. Reports: "PR-017 implemented. Modified 3 files, build passed."
```

**Option 5B: Slash Command (Better UX)**

```
User:
> /run-pr PR-017

# Slash command handler (.claude/commands/run-pr.md):
Use @lemegeton-orchestrator to run the specified PR.
Pass the PR ID to the orchestrator and report results.
```

**Option 5C: Hybrid (Best of Both)**

- Slash commands for common operations
- Direct orchestrator mention for complex queries
- Keep CLI for CI/CD and standalone use

---

## Architecture Comparison

### Current (Child Processes)

**Strengths:**
- ✅ Tool-agnostic (works anywhere)
- ✅ Full process control and monitoring
- ✅ Unlimited concurrency
- ✅ Direct IPC via MessageBus
- ✅ Hierarchical architecture possible

**Weaknesses:**
- ❌ Auth is manual (Option B token passing)
- ❌ Process management complexity
- ❌ Security (spawned processes inherit env)
- ❌ Resource overhead (OS processes)

### Subagent Approach (Option A)

**Strengths:**
- ✅ Automatic auth inheritance
- ✅ Cleaner architecture (declarative)
- ✅ Claude manages lifecycle
- ✅ Native parallelism (up to 10)
- ✅ Production-proven (Anthropic's design)

**Weaknesses:**
- ❌ **Claude-specific** (deep lock-in)
- ❌ No agent nesting (flat only)
- ❌ No visibility into subagent work
- ❌ Unidirectional communication
- ❌ Max 10 concurrent agents
- ❌ Token overhead (~20-40K per agent)
- ❌ Requires rewrite for portability

---

## Implementation Roadmap

### Step 1: MCP Tool Bridge (3-5 days)

**Goal:** Expose Lemegeton core as MCP tools

- [ ] Create `mcp-server/lemegeton-tools.js`
- [ ] Implement core tools: `get_pr_data`, `update_pr_state`, `list_prs`, `next_pr`
- [ ] Configure in `settings.json`
- [ ] Test tools work in Claude Code
- [ ] Document tool usage

**Success Criteria:** Can call `get_pr_data("PR-017")` in Claude Code and get Redis data

### Step 2: Orchestrator Agent (2-3 days)

**Goal:** Build parent agent that coordinates work

- [ ] Create `.claude/agents/orchestrator.md`
- [ ] Define workflow logic (state → agent mapping)
- [ ] Test manual invocation: `@lemegeton-orchestrator list PRs`
- [ ] Verify tool access works
- [ ] Document orchestrator capabilities

**Success Criteria:** Orchestrator can read PR state and route to correct agent type

### Step 3: Specialized Agents (5-7 days)

**Goal:** Implement worker agents as subagents

- [ ] Create `planning-agent.md` (PRD generation)
- [ ] Create `worker-agent.md` (code implementation)
- [ ] Create `qc-agent.md` (test execution)
- [ ] Test each agent individually
- [ ] Verify tool restrictions work

**Success Criteria:** Each agent completes its specialized task successfully

### Step 4: End-to-End Integration (3-4 days)

**Goal:** Full workflow from new → done

- [ ] Test: Orchestrator delegates to planning agent
- [ ] Test: Planning agent creates PRD, updates state
- [ ] Test: Orchestrator delegates to worker agent
- [ ] Test: Worker implements code, runs build
- [ ] Test: Orchestrator delegates to QC agent
- [ ] Test: QC runs tests, updates state
- [ ] Fix issues, tune prompts

**Success Criteria:** Complete PR lifecycle works end-to-end

### Step 5: UX Polish (2-3 days)

**Goal:** Make it easy to use

- [ ] Create slash commands (`/run-pr`, `/list-prs`, `/next-pr`)
- [ ] Add progress reporting
- [ ] Improve error messages
- [ ] Add usage documentation
- [ ] Create user guide

**Success Criteria:** Non-technical users can run PRs easily

**Total Estimate:** 15-22 days (3-4 weeks)

---

## Critical Limitations

### 1. No Agent Nesting

**Problem:** Subagents **cannot spawn other subagents**.

**Impact on Lemegeton:**
```
❌ Cannot do:
Orchestrator
  ↓
WorkerAgent (subagent)
  ↓
HelperAgent (sub-subagent) ← NOT ALLOWED
```

**Workaround:** All coordination must happen at the orchestrator level.

```
✅ Must do:
Orchestrator
  ├── PlanningAgent
  ├── WorkerAgent
  ├── QCAgent
  └── ReviewAgent
```

**Implication:** Flat architecture only. Cannot build hierarchical multi-agent systems.

### 2. No Real-Time Visibility

**Problem:** Parent has **no visibility** into subagent activities until completion.

**Impact:**
- Can't monitor progress
- Can't see intermediate results
- Can't abort mid-execution
- Must wait for full completion

**Workaround:** Design agents for task completion, not ongoing communication.

### 3. Unidirectional Communication

**Problem:** Subagents can't query parent state during execution.

**Impact:**
- All context must be passed upfront
- Can't request additional info mid-task
- Can't coordinate with other agents
- Can't adapt to dynamic changes

**Workaround:** Pass comprehensive context in initial Task tool invocation.

### 4. Result Compression

**Problem:** Subagents **compress results** before returning.

**Impact:**
- Critical details may be lost
- Large outputs get summarized
- File contents not returned in full

**Workaround:** Explicit instructions to preserve important data. Write critical results to files.

### 5. Concurrency Limit

**Problem:** Max **10 parallel agents** at once.

**Impact:**
- Bottleneck for high parallelism
- Additional tasks queue automatically
- No control over priority

**Workaround:** Design for sequential or small-batch parallel execution.

### 6. Claude-Specific Ecosystem

**Problem:** Deep dependency on Claude Code/Agent SDK.

**Impact:**
- Can't run on Cursor, VS Code (without major work)
- Can't run standalone CLI easily
- CI/CD requires Agent SDK setup
- Migration to other tools requires rewrite

**Workaround:** Accept Claude lock-in, or maintain dual architecture (see below).

---

## Dual Architecture Strategy

If you need **both** Claude integration AND portability, consider:

### Architecture

```
Lemegeton Core (Tool-Agnostic)
├── Hub, Scheduler, Agents (existing code)
├── Redis, MessageBus, State management
└── Shared business logic

Execution Modes:
├── Mode A: Claude Code Subagents
│   ├── .claude/agents/*.md
│   ├── MCP tool bridge
│   └── Orchestrator agent
│
├── Mode B: Standalone CLI
│   ├── src/cli/hubClient.ts (existing)
│   ├── Child process spawning (existing)
│   └── API key auth (Option B)
│
└── Mode C: MCP Bridge (Option C)
    ├── mcp-server/ (from Option C design)
    └── Tool exposure layer
```

### Mode Detection

```javascript
// Auto-detect execution environment
const executionMode = detectMode();

function detectMode() {
  if (process.env.CLAUDE_CODE_SESSION) return 'claude-subagents';
  if (process.env.MCP_SERVER) return 'mcp-bridge';
  return 'standalone-cli';
}

// Route to appropriate execution path
switch (executionMode) {
  case 'claude-subagents':
    // Use Task tool to spawn subagents
    break;
  case 'mcp-bridge':
    // Run as MCP server
    break;
  case 'standalone-cli':
    // Use child_process.spawn (current approach)
    break;
}
```

### Effort

**Additional complexity:** +30-40% development time
**Benefit:** Maintain portability while getting Claude native integration
**Trade-off:** More code to maintain, more testing surface area

---

## Comparison: Option A vs Option C

### Feature Comparison

| Feature | Option A (Subagents) | Option C (MCP Bridge) |
|---------|---------------------|----------------------|
| **Claude Code** | ✅ Best experience | ✅ Good experience |
| **Cursor** | ❌ Not compatible | ✅ Works |
| **Windsurf** | ❌ Not compatible | ✅ Works |
| **VS Code** | ⚠️ Complex (Agent SDK) | ✅ MCP extension |
| **Standalone CLI** | ❌ Requires rewrite | ✅ Works (API key) |
| **CI/CD** | ⚠️ Agent SDK only | ✅ Standard CLI |
| **Authentication** | ✅ Automatic | ✅ Automatic (in-session) |
| **Parallelism** | ⚠️ Max 10 | ✅ Unlimited |
| **Monitoring** | ❌ No visibility | ⚠️ Partial (tool calls) |
| **Agent Nesting** | ❌ Flat only | ✅ Possible |
| **Tool-Agnostic** | ❌ Claude-specific | ✅ MCP is standard |
| **Implementation** | 3-4 weeks | 6-9 days |

### Architecture Philosophy

**Option A (Subagents):**
- "All-in on Claude Code"
- Accept deep integration for best UX
- Sacrifice portability for simplicity
- Natural language-first approach

**Option C (MCP Bridge):**
- "Best of both worlds"
- MCP as universal protocol
- Keep code-based architecture
- Tool-agnostic by design

### When to Choose Option A

Choose subagents if:
- ✅ You're committed to Claude Code long-term
- ✅ UX in Claude Code is highest priority
- ✅ You don't need standalone/CI/CD capabilities
- ✅ You want declarative (YAML) agent definitions
- ✅ You prefer natural language over code
- ✅ Flat agent architecture is sufficient

### When to Choose Option C

Choose MCP bridge if:
- ✅ Tool-agnosticism is a core design goal
- ✅ You need to support multiple AI tools
- ✅ Standalone CLI/CI/CD is important
- ✅ You want unlimited concurrency
- ✅ You need agent nesting/hierarchies
- ✅ You prefer code-first approach

---

## Recommendation

### Short-Term (Validation)

**Keep Option B (OAuth token passing)**
- Proves coordination core works
- Minimal implementation (already done)
- Buys time to decide architecture

### Long-Term Decision

**If staying Claude-only:**
→ **Option A (Subagents)** provides best UX, cleanest code, automatic auth

**If maintaining tool-agnosticism:**
→ **Option C (MCP Bridge)** preserves portability, supports multiple tools, keeps code-based architecture

**Hybrid Approach:**
→ Implement **both**, use mode detection to route execution
- More complex but maximum flexibility
- Best Claude experience + portable foundation

### My Recommendation

**Choose Option C (MCP Bridge)** for these reasons:

1. **Aligns with design goals** - Lemegeton aims to be tool-agnostic
2. **Future-proof** - MCP is becoming industry standard (Cursor, Windsurf, VS Code)
3. **Lower risk** - Don't lock into single vendor
4. **Comparable UX** - MCP tools provide similar experience to subagents
5. **Preserves architecture** - Keep code-based system (easier to debug/test)
6. **Flexibility** - Can always add subagent mode later if needed

**Option A is excellent** if you're building *specifically* for Claude Code power users and don't need portability. But given Lemegeton's broader vision, **Option C is more strategically sound**.

---

## Open Questions

1. **Agent SDK Portability:** Can the Claude Agent SDK run on Cursor/VS Code? (Research needed)

2. **Subagent Costs:** Do subagent API calls count against Claude Code subscription or require separate billing?

3. **Token Overhead:** Is 20-40K tokens per subagent spawn acceptable for Lemegeton's use case?

4. **Debugging:** How do you debug subagent failures without visibility into execution?

5. **Testing:** How do you write automated tests for subagent-based architecture?

6. **Migration Path:** If we build with subagents now, how hard is it to migrate away later?

---

## References

### Official Documentation
- [Claude Code Subagents](https://docs.claude.com/en/docs/claude-code/sub-agents)
- [Agent SDK Subagents](https://docs.claude.com/en/docs/agent-sdk/subagents)
- [Building Agents with Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)

### Community Resources
- [Task Tool vs Subagents](https://www.icodewith.ai/blog/task-tool-vs-subagents-how-agents-work-in-claude-code/)
- [Multi-Agent Orchestration Patterns](https://dev.to/bredmond1019/multi-agent-orchestration-running-10-plus-claude-instances-in-parallel-part-3-29da)
- [Best Practices for Subagents](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)

### Related Lemegeton Documents
- `/docs/design/option-c-mcp-bridge.md` - MCP Bridge design
- `/DOGFOODING_STATUS.md` - Current implementation status
- `/docs/architecture.md` - Core architecture (if exists)

---

**Document Status:** Complete - Ready for evaluation
**Decision Point:** Compare with Option C, choose based on tool-agnosticism priority
**Next Steps:** User evaluates both options, makes architectural decision
