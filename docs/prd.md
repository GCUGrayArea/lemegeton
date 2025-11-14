# Lemegeton - Product Requirements Document

**Version:** 1.1.0
**Date:** 2025-11-13
**Status:** Updated with Technical Review Feedback

---

## Table of Contents

1. [Product Overview](#product-overview)
2. [Core Concepts](#core-concepts)
3. [User Stories](#user-stories)
4. [Feature Requirements](#feature-requirements)
5. [Stretch Goals](#stretch-goals)
6. [Technical Architecture](#technical-architecture)
7. [Modularity Requirements](#modularity-requirements)
8. [Performance Targets](#performance-targets)
9. [Testing Strategy](#testing-strategy)
10. [Definition of Done](#definition-of-done)
11. [Risks & Mitigation](#risks--mitigation)
12. [Implementation Timeline](#implementation-timeline)
13. [Success Metrics](#success-metrics)
14. [Key Principles](#key-principles)
15. [Next Steps](#next-steps)

---

## Product Overview

### Problem Statement

AI-assisted development with tools like Claude Code enables unprecedented productivity gains (20-50x speedups demonstrated in real projects). However, coordinating multiple AI agents working in parallel is challenging, and mature organizations face additional problems with knowledge transfer and tech stack flexibility.

**Solo Developer Problems:**
- Race conditions when agents claim the same work
- Merge conflicts when agents modify the same files
- Clunky UX managing multiple terminal sessions
- Manual coordination required to prevent conflicts
- Lost context when agents crash or timeout
- Uncontrolled costs from inefficient LLM usage

**Team Problems (v1.0):**
- Context switching costs 2+ weeks when rotating developers between products
- Knowledge silos form (Rails team vs Node team vs Go team)
- Bus factor = 1 for many products (only one person knows the codebase)
- Can't flexibly reassign capacity (developers locked to their stack)
- Language barriers prevent cross-product work
- Institutional knowledge lives only in people's heads

### Solution

**Lemegeton** is a production-grade orchestration system for parallel AI development agents. It provides:

**For Solo Developers (v0.1-0.3):**
1. **Atomic Coordination**: Redis-based file leases prevent conflicts by design
2. **Intelligent Scheduling**: MIS scheduler assigns work based on dependencies and conflicts
3. **Single Shell UX**: Unified TUI for monitoring all agents and routing user input
4. **Planning Automation**: Transforms specs into executable task lists with AI assistance and speculative optimization
5. **State Management**: Hot/cold state model preserves progress through crashes
6. **Quality Assurance**: Automated QC agent tests completions with incremental testing
7. **MCP Integration**: Agents query documentation and code examples for accuracy
8. **Cost Control**: Token budgets, API limits, and heterogeneous agent pools for optimization
9. **Graceful Degradation**: Fallback to local Redis and branch-based work during network issues

**For Product Teams (v1.0):**
1. **Institutional Memory**: Memory bank captures all architectural knowledge per product
2. **Zero Ramp-Up**: Agents explain any codebase in minutes, regardless of language
3. **Stack Agnostic**: Developers rotate freely between Rails/Node/Go/Rust products
4. **Pattern Continuity**: Planning Agent enforces consistency across sprints
5. **Knowledge Codification**: Architecture decisions persist beyond individual developers
6. **Flexible Capacity**: Reassign developers to any product instantly

**Key Innovation:** Combines pessimistic file locking (prevents conflicts) with optimistic fallback modes (branch-based work during degradation), treats Redis as ephemeral cache (not critical database), implements tool-agnostic cost controls, and provides hidden complexity with simple UX.

### Coordination Modes

The system operates in three coordination modes:

```typescript
enum CoordinationMode {
  DISTRIBUTED = "distributed",    // Normal: shared Redis, file leases
  DEGRADED = "degraded",          // Fallback: local Redis + git branches
  ISOLATED = "isolated"           // Emergency: pure local work, accept conflicts
}
```

This dual-mode approach ensures productivity continues even during infrastructure issues, prioritizing work preservation over perfect coordination when necessary.

### Target Users

**Primary (v0.1-0.3): Solo AI-Augmented Developer**
- Uses Claude Code/Cursor/Codex/OpenCode daily
- Builds MVPs in days instead of weeks
- Wants 20x+ speedup but struggles with coordination
- Comfortable with command-line tools
- Values clean git history and code quality
- Needs to context-switch between multiple agents
- May use self-hosted models for cost/privacy reasons

**Secondary (v1.0): Product Team with Sprint Rotation**
- 5-10 developers managing 3-5 products
- Each product gets 1-2 developers per sprint (2-4 weeks)
- Products use different tech stacks (Rails, Node, Go, Rust, Python, etc.)
- Developers rotate products every 1-4 sprints
- Knowledge transfer is current bottleneck (2+ weeks lost per handoff)
- Want to eliminate stack-specific hiring constraints

**Tertiary (v2.0+): Larger Teams with Simultaneous Work**
- 10-50 developers on complex multi-repo projects
- Need real-time coordination across multiple humans + agents
- Requires advanced features (semantic conflict detection, federated hubs)

### Success Criteria

**Quantitative (v0.1-0.3):**
- Zero merge conflicts across 100+ PR completions
- <3 seconds to assign next available PR
- 20x+ development speedup maintained (validated via case studies)
- Planning phase <4 hours (spec → executable tasks)
- Support 4-10 agents in parallel without degradation
- MCP accuracy >90% (correct API signatures first try)
- Cost reduction >30% via heterogeneous agent pools (Haiku vs Sonnet)

**Quantitative (v1.0):**
- Ramp-up time <30 minutes (vs 2+ weeks traditional)
- Developers productive on sprint day 1 (vs day 10+ traditional)
- Pattern consistency >90% (new sprints follow previous sprint conventions)
- Stack flexibility: 1 developer can rotate across 3+ different stacks

**Qualitative:**
- Users prefer single shell over multi-terminal workflow
- "It just works" - minimal debugging of coordination issues
- Clear understanding of what's happening (observable system)
- Confidence in state persistence (no lost work)
- Seamless fallback during network issues
- New developers feel productive immediately (v1.0)

---

## Distribution Model

**Lemegeton is distributed as an npm package**, not a repository template. This is a key architectural difference from Picatrix.

**Installation (Recommended: Local per-project):**
```bash
# In your project directory
cd my-project
npm install lemegeton

# Run with npx (no global installation needed)
npx lemegeton init
npx lemegeton plan ./spec.md
npx lemegeton hub start
npx lemegeton run --agents=4
```

**Why local installation is recommended:**
- **Version pinning**: Each project can use different Lemegeton versions
- **Tracked in package.json**: Team members get same version automatically
- **No permission issues**: No need for `sudo` or admin rights
- **CI/CD friendly**: Installs automatically in build pipelines
- **Cleaner global namespace**: Doesn't clutter global npm binaries

**Zero Operational Complexity:**
- Redis auto-spawns in Docker if not present
- Graceful fallback to local Redis if Docker unavailable
- No manual infrastructure setup required
- Works identically to Picatrix from user perspective

---

## Core Concepts

### Hot vs Cold State Model

Lemegeton tracks two state layers for each PR:

**Cold States (Durable):**
- Persisted in `docs/task-list.md` via git commits
- Represent milestone checkpoints
- Survive agent crashes, Hub restarts, system reboots
- Examples: `ready`, `blocked`, `planned`, `completed`, `approved`, `broken`

**Hot States (Ephemeral):**
- Tracked in Redis with heartbeat validation
- Represent active work-in-progress
- Cleared on timeout (5 min no heartbeat)
- Examples: `investigating`, `planning`, `in-progress`, `under-review`

**Key Rule:** Cold state transitions trigger git commits. Hot state transitions update Redis only.

### Redis as Ephemeral Cache

**Important Design Decision:** Redis is treated as a cache, not a database:
- Can be fully reconstructed from `docs/task-list.md`
- Loss of Redis = temporary inconvenience, not data loss
- Hub validates and rebuilds Redis on startup
- This addresses the "single point of failure" concern

### File Lease System

**Problem:** Agents modifying the same file simultaneously causes merge conflicts.

**Solution:** Pessimistic locking via Redis with atomic lease acquisition in normal mode, optimistic branch-based work in degraded mode.

**Dual-Mode Operation:**
- **Normal Mode**: Atomic file leases prevent all conflicts
- **Degraded Mode**: Agents work on branches, accept merge conflicts
- **Benefit**: Best of both worlds - safety when possible, productivity always

### Agent Lifecycle

**Agents are ephemeral processes:**
- Spawned by Hub on demand
- Identified by `{user}-agent-{N}` (e.g., `alice-agent-1`)
- Communicate via Redis pub/sub (normal) or file-based (degraded)
- Send heartbeats every 30 seconds
- Reclaimed by Hub if heartbeat stops

### MCP Integration

**Model Context Protocol (MCP)** enables agents to query external data sources during planning and implementation:

**Documentation Queries:**
- MDN for web APIs (accurate signatures)
- npm/PyPI/crates.io for package docs (latest versions)
- Framework docs (React, Rails, Express, Django)

**Benefits:**
- Correct API signatures first try (no backtracking)
- Latest package versions (not stale training data)
- 2-3x speedup (fewer mistakes, fewer user questions)

---

## User Stories

### Primary User: Solo AI-Augmented Developer (v0.1-0.3)
- As a solo developer, I want to run 4+ AI agents in parallel so that I can build MVPs in days instead of weeks
- As a solo developer, I want zero merge conflicts so that I never waste time debugging git issues
- As a solo developer, I want a single shell to monitor all agents so that I can track progress without context-switching
- As a solo developer, I want agents to survive crashes so that I don't lose work when my laptop goes to sleep
- As a solo developer, I want planning to take <4 hours so that I can start building the same day I have an idea
- As a solo developer, I want to use my preferred AI tool (Claude Code, Cursor, OpenCode) so that I'm not locked into one vendor
- As a solo developer, I want agents to use accurate documentation so that I don't waste time fixing wrong API usage
- As a solo developer, I want to control costs by using cheaper models for simple tasks
- As a solo developer, I want the system to work offline or with network issues so that I'm never blocked

### Secondary User: Rotation Engineer (v1.0)
- As a rotation engineer, I want to understand a new codebase in <30 minutes so that I can start sprint work on day 1
- As a rotation engineer, I want agents to handle language-specific details so that I can work on Rust products without being a Rust expert
- As a rotation engineer, I want new features to follow existing patterns so that codebases stay consistent across sprints
- As a rotation engineer, I want institutional knowledge preserved so that I don't have to reverse-engineer previous decisions

### System Requirements
- As the system, I need to prevent file conflicts atomically in normal mode and handle conflicts gracefully in degraded mode
- As the system, I need to track both durable and ephemeral state to survive crashes while showing live progress
- As the system, I need to validate dependencies before assigning work to avoid blocked PRs
- As the system, I need to route user input to the correct agent to handle questions without manual terminal switching
- As the system, I need to commit only milestone checkpoints to keep git history clean and meaningful
- As the system, I need to query external documentation sources to provide agents accurate current information
- As the system, I need to control costs by routing tasks to appropriate model tiers

---

## Feature Requirements

### 1. Hub Daemon (Priority: Critical - Phase 0.1a)

- **Process Management**
  - Starts as background daemon with `npx lemegeton hub start`
  - Auto-spawns Redis in Docker if not present (zero config)
  - Falls back to local Redis if Docker unavailable
  - Manages Redis connection with automatic recovery
  - Parses `docs/task-list.md` on startup to hydrate Redis state
  - Spawns agent processes on demand
  - Monitors agent heartbeats (30s interval)
  - Graceful shutdown with `npx lemegeton hub stop`

- **State Synchronization**
  - Updates `docs/task-list.md` YAML frontmatter on cold state transitions (immediate, event-driven)
  - Updates hot state displays in markdown for human visibility (30s sync cycle)
  - Ensures Redis and git stay synchronized
  - Handles crash recovery by clearing orphaned hot states
  - Can fully reconstruct Redis from git (Redis as cache, not database)

- **Work Assignment**
  - Implements MIS (Minimum Input Set) scheduling algorithm
  - Calculates available PRs based on dependencies + file conflicts
  - Publishes work assignments to agent channels via Redis pub/sub
  - Prevents assignment of blocked PRs (dependencies not met or file conflicts)
  - In Phase 0.3+: Considers PR complexity for heterogeneous agent routing

### 2. File Lease System (Priority: Critical - Phase 0.1a)

- **Atomic Lease Acquisition (Normal Mode)**
  - Uses Redis MULTI/EXEC for atomic multi-file lease requests
  - Leases have 5-minute TTL, renewed via heartbeat
  - Paired locking: `AuthService.ts` → also locks `AuthService.test.ts`
  - Returns conflict details if acquisition fails (which files, which PRs hold them)

- **Branch-Based Work (Degraded Mode)**
  - When Redis unavailable or network partitioned
  - Each agent works on separate git branch
  - Accepts potential merge conflicts
  - Prioritizes work preservation over perfect coordination

### 3. Planning Agent with Speculative Execution (Priority: High - Phase 0.2)

- **Spec Analysis**
  - Reads project spec from `./spec.md` or provided path
  - Interactive tech stack clarification (asks user to resolve ambiguities)
  - Uses MCP for tech stack decisions: Queries docs for latest versions
  - Generates comprehensive PRD with all architectural decisions

- **Speculative Execution**
  - Pre-analyzes task patterns for optimization
  - Identifies likely file conflicts and bottlenecks
  - Pre-fetches documentation for complex PRs
  - Suggests optimal agent allocation and model mix
  - Example:
    ```typescript
    const speculation = await this.analyzeWorkPatterns(tasks);
    // Pre-identify conflicts, suggest agent count, recommend model tiers
    ```

- **Task List Generation**
  - Breaks PRD into 30-60 minute PRs
  - Organizes PRs into dependency blocks for parallel work
  - Uses MCP to estimate files: Searches GitHub for similar projects
  - Assigns initial cold states: `ready` for roots, `blocked` for dependents
  - Includes complexity scores for future heterogeneous routing

### 4. Cost Control System (Priority: High - Phase 0.2)

- **Tool-Agnostic Design**
  - Works with any LLM provider (Anthropic, OpenAI, self-hosted)
  - Special support for OpenCode and local models
  - Configuration:
    ```typescript
    interface CostConfig {
      provider: 'anthropic' | 'openai' | 'self-hosted' | 'opencode';
      limits?: {
        max_tokens_per_pr?: number;
        max_tokens_per_hour?: number;
        max_api_calls_per_pr?: number;
      };
      models?: {
        simple_tasks?: string;  // e.g., 'claude-3-haiku' or local model
        complex_tasks?: string; // e.g., 'claude-3-sonnet'
        review_tasks?: string;  // e.g., 'claude-3-opus'
      };
      fallback_behavior: 'pause' | 'degrade' | 'continue';
    }
    ```

- **Budget Enforcement**
  - Track token usage per PR and globally
  - Automatic degradation when approaching limits
  - Alert thresholds for cost warnings
  - Support for self-hosted models with zero marginal cost

### 5. Incremental Testing (Priority: High - Phase 0.2/0.3)

- **Simple Approach (Phase 0.2)**
  - QC Agent identifies changed files
  - Runs only related tests using framework features:
    - Jest: `--findRelatedTests`
    - Pytest: custom test selection
    - Go: package-level testing
  - Example:
    ```typescript
    const testFiles = await this.findRelatedTests(changedFiles);
    await this.runTests(testFiles); // Much faster than full suite
    ```

- **Advanced Approach (Phase 0.3/1.0)**
  - Integration with build tools (Nx, Turborepo, Bazel)
  - Dependency graph analysis
  - Distributed test caching
  - Only run affected integration tests

### 6. Heterogeneous Agent Pools (Priority: Medium - Phase 0.3)

- **Model Tier Optimization**
  - Use Haiku for simple tasks (file creation, simple CRUD)
  - Use Sonnet for complex tasks (architecture, algorithms)
  - Use Opus for review tasks (if needed)
  - PR complexity scoring determines routing:
    ```typescript
    scorePRComplexity(pr): number {
      // Factors: file count, dependencies, keywords
      // Returns 1-10 complexity score
    }
    ```

- **Dynamic Allocation**
  - Hub matches agent capabilities to PR complexity
  - Automatic fallback if preferred model unavailable
  - Significant cost savings (30%+ expected)

### 7. Automated Rollback Patterns (Priority: Medium - Phase 0.3+)

- **Smart Recovery from Failures**
  - When QC marks PR as `broken`:
    1. Automatically create revert PR
    2. Generate fix PR with targeted improvements
    3. Re-run with different approach if needed
  - Maintains forward momentum
  - Learns from failures for future planning

### 8. Single Shell TUI (Priority: High - Phase 0.1b)

- **Status Bar (Top)**
  - Shows all active agents with model tier (when heterogeneous)
  - Real-time updates via Redis pub/sub
  - Coordination mode indicator (distributed/degraded/isolated)

- **Main Area (Center)**
  - Activity log with MCP query visibility
  - Cost tracking display (tokens used, estimated cost)
  - Shows speculative execution hints from Planning Agent

### 9. Quality Control Agent (Priority: High - Phase 0.1a)

- **Automated Testing**
  - Spawns automatically when PR transitions to `completed`
  - Phase 0.2: Implements incremental test selection
  - Runs only affected tests, not full suite
  - Checks test coverage (target >80%)
  - Marks PR as `broken` with detailed notes if tests fail

### 10. Code Review Agent (Priority: Medium - Phase 1.0)

- **Periodic Quality Review**
  - Runs daily batch: reviews all PRs approved in last 24 hours
  - Does NOT block PR completion (advisory only)
  - Creates follow-up PRs for issues found
  - Updates memory bank with patterns and anti-patterns

---

## Technical Architecture Updates

### Graceful Degradation Architecture

```typescript
class Hub {
  private coordinationMode: CoordinationMode = CoordinationMode.DISTRIBUTED;

  async detectAndHandleFailure() {
    if (!this.redis.isHealthy()) {
      // Try local Redis
      if (await this.tryLocalRedis()) {
        this.coordinationMode = CoordinationMode.DEGRADED;
        this.notifyAgents('SWITCH_TO_BRANCHES');
      } else {
        this.coordinationMode = CoordinationMode.ISOLATED;
        this.notifyAgents('WORK_LOCALLY');
      }
    }
  }

  async tryLocalRedis(): boolean {
    try {
      await this.spawnLocalRedisDocker();
      await this.hydrateFromGit();
      return true;
    } catch {
      return false;
    }
  }
}
```

### PR Complexity Scoring

```typescript
interface PRComplexity {
  score: number;           // 1-10
  estimated_minutes: number;
  file_count: number;
  dependency_count: number;
  suggested_model: 'haiku' | 'sonnet' | 'opus';
  rationale: string;
}

class ComplexityScorer {
  score(pr: PR): PRComplexity {
    let score = 0;

    // File-based scoring
    score += pr.estimated_files * 0.5;
    score += pr.dependencies.length * 1;

    // Keyword-based scoring
    if (pr.description.match(/complex|architect|refactor/i)) score += 3;
    if (pr.description.match(/simple|basic|trivial/i)) score -= 2;
    if (pr.description.match(/algorithm|optimize|performance/i)) score += 2;

    // Normalize to 1-10
    score = Math.max(1, Math.min(10, score));

    return {
      score,
      estimated_minutes: score * 10,
      file_count: pr.estimated_files,
      dependency_count: pr.dependencies.length,
      suggested_model: score < 3 ? 'haiku' : score < 7 ? 'sonnet' : 'opus',
      rationale: this.explainScore(pr, score)
    };
  }
}
```

---

## Implementation Timeline (Revised)

### Phase 0.1: Core Foundation (Weeks 1-4)
**0.1a - Core Coordination (Weeks 1-2)**
- Hub daemon with auto-spawning Redis
- State machine (hot/cold model)
- File lease system (atomic acquisition)
- MIS scheduler implementation
- Agent process spawning and heartbeat
- Basic CLI commands
- QC Agent (basic testing)

**0.1b - UX & Integration (Weeks 3-4)**
- Single shell TUI
- MCP infrastructure and adapters
- Input routing system
- Graceful degradation handling

### Phase 0.2: Intelligence & Optimization (Weeks 5-6)
- Planning Agent with speculative execution
- Cost control architecture (tool-agnostic)
- Simple incremental test selection
- PR complexity scoring
- Basic heterogeneous pool support (prepare for 0.3)

### Phase 0.3: Advanced Features (Week 7)
- Full heterogeneous agent pools (Haiku/Sonnet routing)
- Automated rollback patterns
- Advanced cost optimization
- Refined degradation modes

### Phase 0.4: Validation (Week 8)
- Dog-fooding (build Lemegeton features with Lemegeton)
- Performance optimization
- Bug fixes from real usage
- Documentation polish

### Phase 1.0: Team Features (Weeks 9-10)
- Memory bank for team rotation
- Code Review Agent
- Pattern extraction and enforcement
- Advanced incremental builds (Nx/Turborepo)
- Version comparison tools

### Phase 2.0+: Future Enhancements
- Semantic conflict detection (AST-based locking)
- Multi-repo coordination
- Federated hubs
- Vector database for dynamic memory
- ML-based scheduling optimization
- **Prompt format optimizations**:
  - JSON format support (`npx lemegeton prompt get --format json`) for faster parsing
  - TOON format support (`npx lemegeton prompt get --format toon`) for ultra-compact transmission
  - Rationale: YAML human-readable for development, JSON for fast parsing, TOON for optimized network transmission

---

## Risks & Mitigation (Updated)

### Addressed Risks:

1. **Redis dependency complexity**
   - ✅ Mitigated: Auto-spawn Docker, fallback to local, hidden from user

2. **Single point of failure**
   - ✅ Mitigated: Redis as cache not database, reconstructible from git

3. **Network partition handling**
   - ✅ Mitigated: Degraded mode with branch-based work

4. **Operational complexity**
   - ✅ Mitigated: NPM package with zero-config startup

### Remaining Risks:

1. **MCP rate limits and costs**
   - Mitigation: Aggressive caching, cost caps, degradation to no-MCP mode

2. **File lease granularity**
   - Mitigation: Start with file-level, measure blocking rate, refine if >20% unnecessary blocks
   - Semantic locking deferred to v2.0 (complexity not justified yet)

3. **Planning Agent quality**
   - Mitigation: User reviews task-list.md before execution
   - Speculative execution helps identify issues early

4. **Cross-platform compatibility**
   - Mitigation: Primary target macOS/Linux, explicit WSL testing
   - Docker auto-spawn tested on all platforms

5. **Cost awareness in planning phase**
   - Note: Deliberate cost awareness deferred to future implementation
   - Current: Complexity scoring provides implicit cost signals
   - Future: Explicit cost estimates and budget-aware PR generation

### Security Model

**Important:** Lemegeton's initial design explicitly relies on the security model of the underlying AI tool (Claude Code, Cursor, Cody, etc.).

- **No Direct API Keys**: Lemegeton does NOT have direct access to LLM API keys
- **Tool-Mediated Access**: All LLM interactions go through the user's chosen AI tool
- **Security Boundary**: The AI tool handles authentication, rate limiting, and API security
- **User Control**: Users maintain control through their AI tool's permission system
- **Cost Control**: Budget enforcement happens at the AI tool level, not Lemegeton

This design choice:
1. Reduces Lemegeton's attack surface (no sensitive credentials to leak)
2. Leverages existing security infrastructure of mature AI tools
3. Allows users to switch AI tools without reconfiguring Lemegeton
4. Maintains clear security boundaries between orchestration and execution

Future versions may support direct API integration as an optional feature, but the core design assumes tool-mediated access for security and simplicity.

---

## Success Metrics (Updated)

**Must Achieve (v0.2):**
- Zero merge conflicts in 100 PR completions
- Support 4+ agents without degradation
- Graceful degradation during network issues
- Cost reduction >30% with heterogeneous pools
- Incremental testing reduces QC time >50%
- Planning with speculative execution <4 hours

**Must Achieve (v1.0):**
- Onboarding time <30 minutes
- Pattern consistency >90%
- Works with 3+ different tech stacks
- Memory bank accuracy >85%
- Code quality maintained across rotations

---

## Key Principles (Updated)

1. **Pessimistic Locking with Optimistic Fallback** - Prevent conflicts normally, accept them when degraded
2. **Redis as Cache, Not Database** - Everything reconstructible from git
3. **Hidden Complexity** - User sees simple commands, system handles complexity
4. **Tool Agnostic** - Support Claude, OpenCode, self-hosted models equally
5. **Cost Conscious** - Automatic optimization via model tiers and limits
6. **Fail Gracefully** - Degraded productivity better than no productivity
7. **Incremental Value** - Each phase delivers working improvements
8. **File-Level is Good Enough** - Semantic locking only when proven necessary (v2.0+)

---

## Next Steps

1. **Review & Approve** this updated PRD
2. **Update ARCHITECTURE.md** with technical details for new features
3. **Create implementation plan** for Phase 0.1a
4. **Begin Hub daemon** implementation with Redis auto-spawn
5. **Dog-food immediately** - Use early versions to build later features

---

**End of Product Requirements Document v1.1.0**