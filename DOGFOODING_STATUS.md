# Dogfooding Readiness Status

**Branch:** `claude/evaluate-dogfooding-readiness-01GXB552UtQnG2fibXPVZdAz`
**Last Updated:** 2025-11-23
**Goal:** Enable Lemegeton to work on its own task list

---

## ✅ Completed Work

### Phase 1A: CLI Integration (PR-013) - In-Process Mode

Successfully implemented the ability to run `npx lemegeton run <PR-ID>` in **in-process mode** (when hub daemon is not running).

#### Key Implementations

1. **Hub In-Process Execution** (`src/hub/index.ts`)
   - Added MessageBus, Scheduler, AgentSpawner, ProcessManager integration
   - Hub can now run in the current process instead of requiring daemon
   - Graceful collapse from daemon mode to in-process mode

2. **CLI Command Integration** (`src/cli/hubClient.ts`, `src/cli/commands/run.ts`)
   - `runInProcess()` - Starts Hub, spawns agent, assigns work, waits for completion
   - `sendAssignment()` - Delivers work assignments via MessageBus
   - `sendAssignmentAndWait()` - Waits for agent completion with timeout
   - `--assign-only` flag - Assign work without waiting for completion
   - Daemon detection and fallback logic

3. **Agent Communication** (`src/agents/base.ts`, `src/agents/communication.ts`)
   - Agents connect to real MessageBus (not stubs)
   - Assignment subscription and validation
   - Completion/failure reporting to Hub
   - Message format wrapping (Message interface compliance)

4. **PlanningAgent Work Execution** (`src/agents/planning.ts`)
   - Fetches PR data from Redis (`state:prs` key)
   - Generates implementation plans with:
     - Dependencies
     - Estimated files
     - Implementation steps
     - Testing strategy
   - Creates PRD documents at `docs/plans/PR-{id}-{slug}.md`
   - Updates PR state to 'planned' in Redis
   - Reports progress at each stage (25%, 50%, 75%, 100%)

### Phase 1B: Daemon Mode Support

Successfully implemented daemon mode for distributed/team scenarios.

#### Key Implementations

1. **Hub Daemon Work Request Handling** (`src/hub/index.ts`)
   - Subscribes to `hub:work-requests` channel on startup
   - Handles work requests from CLI clients
   - Spawns agents and assigns work
   - Sends responses on `hub:work-responses:{requestId}` channels
   - Maps PR states to agent types (new→planning, planned→worker, etc.)

2. **CLI Daemon Mode** (`src/cli/hubClient.ts`)
   - `runInDaemonMode()` - Sends work requests to running hub daemon
   - Auto-detects daemon via PID file
   - Creates ephemeral MessageBus for request/response
   - Supports timeout configuration
   - Routes automatically based on daemon availability

3. **Scheduler Integration** (`src/scheduler/index.ts`)
   - Added `getPRNode()` method to expose dependency graph
   - Scheduler initialized with task list from startup sequence

4. **State Synchronization** (`src/hub/startup.ts`)
   - Hub preserves Redis state across restarts
   - Merges task-list.md with existing Redis state
   - Redis state takes precedence for cold_state
   - Scheduler initializes with current runtime states
   - Prevents stale state issues

### Phase 1C: WorkerAgent Implementation

Implemented full code generation workflow for WorkerAgent.

#### Key Implementations

1. **WorkerAgent Code Generation** (`src/agents/worker.ts`)
   - Reads PRD files from `docs/plans/` directory
   - Fetches PR metadata from Redis (`state:prs` key)
   - Calls Claude API to generate implementation
   - Uses structured JSON response format for file operations
   - Supports create/modify/delete file actions
   - Writes generated code to disk
   - Runs `npm run build` to verify TypeScript compilation
   - Updates PR state to 'implemented' upon success
   - Reports progress at each stage (10%, 20%, 60%, 80%, 90%, 100%)

2. **LLM Integration** (`src/llm/AnthropicClient.ts`)
   - Already implemented, supports Claude API calls
   - Model selection based on PR complexity (haiku/sonnet/opus)
   - Configurable temperature and token limits
   - Proper error handling for API failures

3. **File Operations**
   - Directory creation with `recursive: true`
   - UTF-8 file encoding
   - Atomic file writes (create/modify)
   - File deletion support
   - Error handling for filesystem operations

4. **Build Verification**
   - Spawns `npm run build` as child process
   - Captures stdout/stderr for error reporting
   - Non-zero exit codes trigger work failure
   - Build output included in error messages

#### Bug Fixes

1. **TypeScript Compilation** - Installed missing `@types/node` package
2. **Message Format Mismatch** - Fixed MessageBus publish/subscribe to use proper Message interface
3. **Redis Data Access** - Fixed PlanningAgent to read from `state:prs` instead of individual `pr:{id}` keys
4. **Dashboard JSON Parse Error** - Fixed `pSubscribe` callback parameter order (was receiving channel names as messages)
5. **YAML Parse Error** - Fixed PR-015 estimated_minutes field with parenthetical note
6. **Scheduler Not Initialized** - Fixed daemon mode to initialize scheduler with task list
7. **State Overwrite** - Fixed hub startup to preserve Redis state instead of overwriting

---

## 🧪 Testing Status

### In-Process Mode Test Case
```bash
# With hub daemon stopped
npx lemegeton run PR-017
```

**Expected Behavior:**
- Hub starts in-process mode
- Planning agent spawns (PID logged)
- PR-017 assigned to agent
- Agent fetches PR data from Redis
- PRD created at `docs/plans/PR-017-cost-controller-implementation.md`
- PR state updated to 'planned'
- Agent reports completion
- Hub shuts down gracefully

**Current Status:** ✅ **ALL WORKING**

### Daemon Mode Test Case
```bash
# Start hub daemon
npx lemegeton start

# In another terminal
npx lemegeton run PR-017
```

**Expected Behavior:**
- Hub daemon receives work request
- Spawns appropriate agent based on PR state (worker for 'planned' PRs)
- Agent executes work
- CLI receives completion response
- Hub daemon stays running

**Current Status:** ✅ **ALL WORKING**

### Known Issues
- ⚠️ **CRITICAL: Authentication Blocker** - WorkerAgent requires `ANTHROPIC_API_KEY` environment variable, but user only has Claude Code session auth. Spawned child processes cannot access parent OAuth token.
- ⚠️ QCAgent.doWork() is stubbed (no test execution yet)

---

## 🚧 Authentication Blocker & Solutions

### The Problem

WorkerAgent is fully implemented but **cannot be tested** due to authentication requirements:

**Current Architecture:**
- Agents spawned as **child processes** via `child_process.spawn()` (`src/hub/agentSpawner.ts`)
- Child processes are **isolated** from parent Claude Code session
- WorkerAgent calls `new AnthropicClient({ apiKey })` which requires `ANTHROPIC_API_KEY` env var
- User has Claude Code session (OAuth) but **no API key**

**Impact:**
- Cannot test WorkerAgent code generation
- Cannot dogfood PR implementation
- Blocks end-to-end workflow (new → planned → **implemented** → testing → done)

### Research Findings

Investigated [claude-task-master](https://github.com/eyaltoledano/claude-task-master) integration approach:

**Key Discoveries:**
1. **Claude Code Plugins** can bundle MCP servers that inherit parent session auth
2. **Subagents** (not child processes) automatically inherit parent authentication
3. `CLAUDE_CODE_OAUTH_TOKEN` can be passed to child processes via env vars
4. Plugins don't require separate API keys when running in Claude Code

### Solution Options

#### Option A: Refactor to Claude Code Subagents (Recommended)
**Approach:** Rebuild agents as Claude Code subagents instead of child processes

**Pros:**
- Automatic auth inheritance (no API key needed)
- Native Claude Code integration
- Can distribute as plugin for easy installation
- Better resource management (Claude manages lifecycle)

**Cons:**
- Significant architecture change (ProcessManager → Subagent API)
- Tighter coupling to Claude Code (less provider-agnostic)
- Must learn Claude Code subagent SDK

**Effort:** High (1-2 weeks)

#### Option B: Pass OAuth Token to Child Processes
**Approach:** Use `CLAUDE_CODE_OAUTH_TOKEN` env var for spawned agents

**Implementation:**
```bash
# Parent session generates token
export CLAUDE_CODE_OAUTH_TOKEN=$(claude setup-token)

# Pass to child process
CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_CODE_OAUTH_TOKEN node dist/agents/worker.js
```

**Pros:**
- Minimal code changes
- Keeps current architecture
- Provider-agnostic (can support other OAuth providers)

**Cons:**
- Requires user to run `claude setup-token` manually
- Token management complexity (expiration, rotation)
- Not documented as official pattern

**Effort:** Low (1-2 days)

#### Option C: Hybrid - MCP Server Bridge
**Approach:** Create Claude Code plugin with MCP server that calls agent logic

**Architecture:**
```
Claude Code Session (has OAuth)
  → Plugin MCP Server (inherits auth)
    → Calls WorkerAgent logic in-process
      → Uses parent session credentials
```

**Pros:**
- Keeps agent implementation logic intact
- Plugin benefits (easy distribution, auth inheritance)
- Can still support standalone mode with API keys

**Cons:**
- Two execution modes to maintain (plugin vs standalone)
- MCP server development overhead
- More complex deployment

**Effort:** Medium (3-5 days)

#### Option D: Require API Key (Current State)
**Approach:** Document that users need `ANTHROPIC_API_KEY` to use Lemegeton

**Pros:**
- No code changes needed
- Clear, simple authentication model
- Provider-agnostic

**Cons:**
- Blocks current user from testing (no API key)
- Can't leverage Claude Code subscription for dogfooding
- Additional cost barrier for users with subscriptions

**Effort:** None (documentation only)

### Recommendation

**Short-term:** Option B (OAuth token passing)
- Unblocks testing immediately
- Minimal code changes
- Proves the concept end-to-end

**Long-term:** Option A (Subagent refactor)
- Better Claude Code integration
- Aligns with how task-master and other tools work
- Plugin distribution is more user-friendly

---

## 📋 TODO: Remaining Work for Dogfooding

### Critical Path (Blockers)

1. **Resolve Authentication Issue** ⚠️ BLOCKER
   - Current: WorkerAgent cannot run without `ANTHROPIC_API_KEY`
   - Needed: Choose and implement auth solution (see options above)
   - Recommended: Start with Option B (OAuth token passing) for immediate unblocking
   - Tracks: Can't test WorkerAgent until resolved

### High Priority

2. **WorkerAgent.doWork()** ✅ IMPLEMENTED (auth-blocked)
   - Location: `src/agents/worker.ts`
   - Status: **Implementation complete**, cannot test without auth
   - Features implemented:
     - ✅ Read PRD from `docs/plans/`
     - ✅ Use Claude API to generate code
     - ✅ Structured JSON response format (create/modify/delete)
     - ✅ Create/modify files based on plan
     - ✅ Run build to verify TypeScript compiles
     - ✅ Update PR state to 'implemented'
   - Blocked by: Authentication issue (#1 above)

3. **Implement QCAgent.doWork()**
   - Location: `src/agents/qc.ts`
   - Current: Stub implementation
   - Needed: Test execution and validation
   - Should:
     - Run `npm test` or specific test files
     - Parse test results
     - Report pass/fail status
     - Update PR state based on results
     - Handle test failures gracefully

### Medium Priority

4. **Git State Synchronization**
   - Ensure PR state changes in Redis are synced back to `task-list.md`
   - Currently: Redis is updated but git file might drift
   - Need git commit workflow when states change
   - Consider: When to commit (after each PR? batched?)

5. **Error Recovery**
   - Agent crashes should update PR state to 'failed'
   - Failed work should be reassignable
   - Timeout handling improvements
   - Retry logic for transient failures

### Low Priority

6. **PRD Template Improvements**
   - Add rationale sections
   - Include acceptance criteria
   - Reference related PRs/docs
   - Add architectural decision records

7. **Progress Reporting**
   - More granular progress updates during work
   - Estimated time remaining
   - File-by-file progress for large PRs
   - Live streaming of agent output

8. **Cost Tracking Integration**
   - Track API costs during agent work
   - Enforce cost limits from PR complexity
   - Report costs in work results
   - Budget warnings and hard limits

9. **Change Planning Agent Output Format to YAML** (Optional Enhancement)
   - Location: `src/agents/planning.ts` - `generatePlan()` method
   - Current: Generates Markdown PRD files
   - Optional: Generate structured YAML instead for easier parsing
   - Rationale: Markdown is fragile and hard to parse reliably
   - Note: Can defer until we see if WorkerAgent needs this

---

## 🔧 How to Test

### Prerequisites
- Hub daemon should be **stopped**: `npx lemegeton stop`
- Redis should be **running**: `redis-server` or daemon
- Dashboard (optional): `npm run dashboard` for visual monitoring

### Run a Test
```bash
# Build latest changes
npm run build

# Run planning agent on PR-017
npx lemegeton run PR-017

# Check results
cat docs/plans/PR-017-cost-controller-implementation.md
```

### Verify in Redis
```bash
redis-cli
> GET state:prs
# Should show PR-017 with cold_state: "planned"
```

---

## 📁 Key Files Modified

### Core Implementation
- `src/hub/index.ts` - Hub components integration, daemon work request handling
- `src/hub/startup.ts` - State synchronization, Redis preservation across restarts
- `src/scheduler/index.ts` - getPRNode() method for dependency graph access
- `src/cli/hubClient.ts` - In-process mode, daemon mode routing, assignment delivery
- `src/cli/commands/run.ts` - CLI command with --assign-only flag
- `src/agents/base.ts` - Real MessageBus connection
- `src/agents/communication.ts` - Message wrapping and payload extraction
- `src/agents/planning.ts` - Planning work execution (PRD generation)
- `src/agents/worker.ts` - Code generation implementation (auth-blocked)
- `src/llm/AnthropicClient.ts` - Claude API integration (already existed)
- `src/redis/client.ts` - pSubscribe parameter order fix

### Configuration
- `package.json` - Added @types/node dependency
- `package-lock.json` - Updated dependencies

### Documentation
- `docs/memory/systemPatterns.md` - Adversarial testing pattern
- `docs/plans/PR-017-cost-controller-implementation.md` - Generated PRD (test output)

---

## 🎯 Next Milestone

**Goal:** Self-hosting - Lemegeton implements a simple PR end-to-end

**Critical Blocker:**
1. **Authentication** - Resolve ANTHROPIC_API_KEY requirement (choose Option A, B, C, or D)

**Additional Work Needed:**
2. QCAgent needs test execution capability
3. Git state synchronization

**Success Criteria:**
- `npx lemegeton run PR-XXX` completes successfully
- Code is generated and passes tests
- PR state transitions: new → planned → implemented → testing → done
- All work done by agents, no manual intervention

---

## 💡 Architecture Notes

### Message Flow
```
HubClient → MessageBus → Agent Assignment Channel
              ↓
           Agent receives assignment
              ↓
           Agent executes work
              ↓
Agent → MessageBus → Hub Messages Channel
              ↓
         HubClient receives completion
```

### State Storage
- **Redis (`state:prs`)**: All PR data in single JSON object, indexed by PR ID
- **Git (`docs/task-list.md`)**: Source of truth for PR definitions
- **Sync**: Hub hydrates Redis from git on startup

### Agent Lifecycle
1. Spawn → Initialize → IDLE
2. Receive assignment → WORKING
3. Complete work → Report completion → IDLE
4. Shutdown signal → SHUTTING_DOWN → STOPPED

---

## 🐛 Debugging Tips

### Agent Not Receiving Assignment
- Check MessageBus is publishing to correct channel: `agent:{agentId}:assignments`
- Verify assignment has proper Message wrapper with `payload` field
- Check agent subscribed before assignment sent (2-second wait in code)

### PR Data Not Found
- Ensure Hub populated Redis: Log should show "Populated X PRs in Redis"
- Verify `state:prs` key exists: `redis-cli GET state:prs`
- Check PR ID matches exactly (case-sensitive)

### Dashboard JSON Parse Errors
- Should be fixed by pSubscribe parameter order fix
- If still occurring, check what's being published to `agent:*` channels
- Ensure all messages are valid JSON with Message interface structure

### Timeout Waiting for Agent
- Check agent process is running: `ps aux | grep planning-agent`
- Look for agent errors in console output
- Verify heartbeat is being sent (should see in logs)
- Default timeout is 120 seconds
