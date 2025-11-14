# Task List for Lemegeton

## Orchestration Metadata
**Generated for:** Lemegeton v1.0+
**Estimated Total Complexity:** 286
**Recommended Agent Configuration:**
- Haiku agents: 28 (for complexity 1-3)
- Sonnet agents: 19 (for complexity 4-7)
- Opus agents: 4 (for complexity 8-10)

### Version Milestones
- **Phase 0.1a (Core Coordination)**: PR-001 to PR-013 + PR-003a - Hub, Redis, file leases, MIS scheduler, prompts
- **Phase 0.1b (UX & Integration)**: PR-014 to PR-016 - CLI, TUI, MCP foundation
- **Phase 0.2 (Intelligence & Optimization)**: PR-017 to PR-025 - Planning agent, cost control, incremental testing
- **Phase 0.3 (Advanced Features)**: PR-026 to PR-031 - Heterogeneous pools, degradation, rollback
- **Phase 0.4 (Validation)**: PR-032 to PR-036 - Testing, documentation, dog-fooding
- **Phase 1.0 (Team Features)**: PR-037 to PR-050 + PR-049a - NPM distribution, memory bank, production polish

---

## ═══════════════════════════════════════════════════════════════
## PHASE 0.1a - CORE COORDINATION (PR-001 to PR-013 + PR-003a)
## Goal: Hub daemon, Redis, file leases, MIS scheduler, agent spawning, prompts
##
## Testable at Phase End:
## - Hub starts and auto-spawns Redis
## - Agents can be spawned and tracked
## - File leases prevent conflicts
## - Basic work assignment works
## - State machine transitions correctly
## ═══════════════════════════════════════════════════════════════

## Block 1: Core Foundation

### PR-001: Project Scaffolding and Initial Setup

---
pr_id: PR-001
title: Project Scaffolding and Initial Setup
cold_state: new
priority: high
complexity:
  score: 3
  estimated_minutes: 30
  suggested_model: haiku
  rationale: Basic project structure setup with TypeScript configuration
dependencies: []
estimated_files:
  - path: src/index.ts
    action: create
    description: main entry point
  - path: tsconfig.json
    action: create
    description: TypeScript configuration
  - path: package.json
    action: modify
    description: add core dependencies
  - path: .npmignore
    action: create
    description: npm publish configuration
  - path: README.md
    action: create
    description: basic project documentation
---

**Description:**
Set up the basic TypeScript project structure with configuration files and directory layout for the Lemegeton npm package.

**Acceptance Criteria:**
- [ ] TypeScript configured properly
- [ ] Basic build scripts work
- [ ] Project structure follows npm package best practices
- [ ] Can run `npm run build` successfully

**Notes:**
Simple scaffolding task suitable for Haiku model. Establishes the foundation for all subsequent development.

### PR-002: Core Data Models and Interfaces

---
pr_id: PR-002
title: Core Data Models and Interfaces
cold_state: new
priority: high
complexity:
  score: 4
  estimated_minutes: 40
  suggested_model: sonnet
  rationale: Important architectural decisions for data structures
dependencies: [PR-001]
estimated_files:
  - path: src/types/index.ts
    action: create
    description: main types export
  - path: src/types/pr.ts
    action: create
    description: PR state interfaces
  - path: src/types/agent.ts
    action: create
    description: agent interfaces
  - path: src/types/coordination.ts
    action: create
    description: coordination mode types
  - path: src/types/cost.ts
    action: create
    description: cost control interfaces
---

**Description:**
Define all TypeScript interfaces and types for PR states, agents, coordination modes, and cost tracking as specified in the architecture.

**Acceptance Criteria:**
- [ ] All interfaces from architecture document implemented
- [ ] Types properly exported and organized
- [ ] JSDoc comments for all interfaces
- [ ] Supports hot/cold state model
- [ ] Includes complexity scoring types

**Notes:**
Moderate complexity due to architectural importance. Sets the foundation for type safety throughout the codebase.

### PR-003: State Machine Implementation

---
pr_id: PR-003
title: State Machine Implementation
cold_state: new
priority: high
complexity:
  score: 6
  estimated_minutes: 60
  suggested_model: sonnet
  rationale: Complex state transitions with hot/cold model
dependencies: [PR-002]
estimated_files:
  - path: src/core/stateMachine.ts
    action: create
    description: state machine logic
  - path: src/core/states.ts
    action: create
    description: state definitions
  - path: src/core/transitions.ts
    action: create
    description: valid state transitions
  - path: tests/stateMachine.test.ts
    action: create
    description: comprehensive state tests
---

**Description:**
Implement the hot/cold state machine with proper transition validation, ensuring cold states trigger git commits and hot states remain ephemeral.

**Acceptance Criteria:**
- [ ] Hot and cold states properly separated
- [ ] Valid transitions enforced
- [ ] Cold transitions trigger git commits
- [ ] State recovery from crashes works
- [ ] All transitions logged properly

**Notes:**
Critical component requiring careful implementation of state transition rules and persistence logic.

### PR-003a: Translate Picatrix Prompts to Lemegeton Architecture

---
pr_id: PR-003a
title: Translate Picatrix Prompts to Lemegeton Architecture
cold_state: new
priority: high
complexity:
  score: 4
  estimated_minutes: 40
  suggested_model: sonnet
  rationale: Requires understanding both systems and careful translation
dependencies: [PR-002]
estimated_files:
  - path: src/prompts/commitPolicy.ts
    action: create
    description: adapted commit policy for hot/cold states
  - path: src/prompts/qcGuidelines.ts
    action: create
    description: QC agent guidelines with incremental testing
  - path: src/prompts/memoryBank.ts
    action: create
    description: memory bank for team rotation
  - path: src/prompts/codingStandards.ts
    action: create
    description: coding standards and limits
  - path: src/prompts/costGuidelines.ts
    action: create
    description: cost control and model selection
  - path: docs/prompts/README.md
    action: create
    description: prompt system documentation
---

**Description:**
Translate valuable Picatrix prompts to Lemegeton conventions, including PR implementation planning prompts, removing file-based coordination in favor of Redis, adapting to hot/cold state model, and integrating new features like cost control and speculative execution.

**Acceptance Criteria:**
- [ ] PR implementation planning prompts translated from Picatrix agent-planning.md
- [ ] Commit policy adapted to hot/cold state transitions
- [ ] QC guidelines include incremental testing
- [ ] Memory bank supports team rotation
- [ ] Coding standards enforced programmatically
- [ ] Cost guidelines integrated with heterogeneous pools
- [ ] All prompts accessible to agents via Hub

**Notes:**
This establishes the behavioral guidelines for agents while removing Picatrix's file-based coordination limitations. Includes critical PR-level planning prompts that agents use when implementing individual PRs.

---

## Block 2: Redis and Coordination (Depends on: Block 1)

### PR-004: Redis Client with Configuration and Auto-spawn

---
pr_id: PR-004
title: Redis Client with Configuration and Auto-spawn
cold_state: new
priority: critical
complexity:
  score: 8
  estimated_minutes: 80
  suggested_model: opus
  rationale: Critical configuration management, Docker integration, and smart fallback logic
dependencies: [PR-001, PR-002]
estimated_files:
  - path: src/config/index.ts
    action: create
    description: main configuration module
  - path: src/config/schema.ts
    action: create
    description: configuration validation
  - path: .env.example
    action: create
    description: example environment configuration
  - path: src/redis/client.ts
    action: create
    description: Redis client wrapper
  - path: src/redis/autoSpawn.ts
    action: create
    description: Docker auto-spawn logic
  - path: src/redis/health.ts
    action: create
    description: health checking
  - path: src/utils/docker.ts
    action: create
    description: Docker utilities
  - path: tests/config.test.ts
    action: create
    description: configuration tests
  - path: tests/redis.test.ts
    action: create
    description: Redis tests with mocking
---

**Description:**
Implement configuration management and Redis client with automatic Docker container spawning when no external Redis is configured OR when configured Redis is unavailable, including health checks and connection recovery.

**Acceptance Criteria:**
- [ ] Reads configuration from .env file using dotenv
- [ ] Provides secure defaults (localhost, no auth)
- [ ] Auto-spawns Redis in Docker when: no REDIS_URL configured OR configured REDIS_URL connection fails
- [ ] Falls back gracefully if Docker unavailable
- [ ] Health checks work correctly
- [ ] Connection recovery implemented
- [ ] Configuration follows security model (no API keys, only infrastructure config)
- [ ] Works on Windows, macOS, Linux

**Notes:**
Critical component requiring careful configuration management and fallback logic. Auto-spawn triggers on missing config OR failed connection to ensure system always tries to work.

### PR-005: File Lease System

---
pr_id: PR-005
title: File Lease System
cold_state: new
priority: critical
complexity:
  score: 8
  estimated_minutes: 80
  suggested_model: opus
  rationale: Critical atomic locking mechanism with complex edge cases
dependencies: [PR-004]
estimated_files:
  - path: src/core/leaseManager.ts
    action: create
    description: lease management logic
  - path: src/core/atomicOps.ts
    action: create
    description: atomic Redis operations
  - path: src/core/pairedLocking.ts
    action: create
    description: test file pairing logic
  - path: tests/leaseManager.test.ts
    action: create
    description: comprehensive lease tests
---

**Description:**
Implement atomic file lease acquisition using Redis MULTI/EXEC, with paired locking for test files and proper TTL management.

**Acceptance Criteria:**
- [ ] Atomic multi-file lease acquisition works
- [ ] Paired locking (file + test) implemented
- [ ] 5-minute TTL with heartbeat renewal
- [ ] Conflict details returned on failure
- [ ] Race conditions properly handled
- [ ] Lease cleanup on agent crash

**Notes:**
Critical system component requiring careful attention to atomicity and edge cases. Opus recommended for thoroughness.

### PR-006: Coordination Mode Manager

---
pr_id: PR-006
title: Coordination Mode Manager
cold_state: new
priority: high
complexity:
  score: 7
  estimated_minutes: 70
  suggested_model: sonnet
  rationale: Complex mode detection and transition logic
dependencies: [PR-004, PR-005]
estimated_files:
  - path: src/core/coordinationMode.ts
    action: create
    description: mode detection and switching
  - path: src/core/degradedMode.ts
    action: create
    description: branch-based degraded mode
  - path: src/core/isolatedMode.ts
    action: create
    description: isolated mode handling
  - path: tests/coordinationMode.test.ts
    action: create
    description: mode transition tests
---

**Description:**
Implement coordination mode detection and switching between distributed, degraded, and isolated modes with proper state transitions.

**Acceptance Criteria:**
- [ ] Detects Redis availability correctly
- [ ] Switches modes seamlessly
- [ ] Degraded mode uses git branches
- [ ] Isolated mode works without Redis
- [ ] Agent notification system works
- [ ] Mode transitions are logged

**Notes:**
Complex state management across different operational modes. Critical for resilience.

---

## Block 3: Hub Core Implementation (Depends on: Blocks 1, 2)

### PR-007: Hub Daemon Process

---
pr_id: PR-007
title: Hub Daemon Process
cold_state: new
priority: critical
complexity:
  score: 8
  estimated_minutes: 80
  suggested_model: opus
  rationale: Central orchestrator requiring careful architecture
dependencies: [PR-003, PR-004, PR-006]
estimated_files:
  - path: src/hub/index.ts
    action: create
    description: main hub class
  - path: src/hub/daemon.ts
    action: create
    description: daemon process management
  - path: src/hub/startup.ts
    action: create
    description: startup sequence
  - path: src/hub/shutdown.ts
    action: create
    description: graceful shutdown
  - path: tests/hub.test.ts
    action: create
    description: hub integration tests
---

**Description:**
Implement the Hub daemon process that coordinates all agents, manages state synchronization, and handles process lifecycle.

**Acceptance Criteria:**
- [ ] Starts as background daemon
- [ ] Parses task-list.md on startup
- [ ] Hydrates Redis from git
- [ ] Monitors agent heartbeats
- [ ] Graceful shutdown implemented
- [ ] Process management robust

**Notes:**
Core system component requiring careful architecture. Opus recommended for system design.

### PR-008: MIS Scheduler Implementation

---
pr_id: PR-008
title: MIS Scheduler Implementation
cold_state: new
priority: high
complexity:
  score: 9
  estimated_minutes: 90
  suggested_model: opus
  rationale: Complex scheduling algorithm with dependency resolution
dependencies: [PR-007]
estimated_files:
  - path: src/scheduler/mis.ts
    action: create
    description: MIS algorithm implementation
  - path: src/scheduler/dependencies.ts
    action: create
    description: dependency graph analysis
  - path: src/scheduler/conflicts.ts
    action: create
    description: file conflict detection
  - path: src/scheduler/assignment.ts
    action: create
    description: work assignment logic
  - path: tests/scheduler.test.ts
    action: create
    description: scheduler algorithm tests
---

**Description:**
Implement the Minimum Input Set (MIS) scheduling algorithm that assigns work based on dependencies and file conflicts.

**Acceptance Criteria:**
- [ ] Calculates available PRs correctly
- [ ] Respects dependency constraints
- [ ] Detects file conflicts
- [ ] Assigns work optimally
- [ ] Handles complex dependency graphs
- [ ] Performance acceptable for 100+ PRs

**Notes:**
Complex algorithm requiring careful implementation and optimization. Critical for parallel work coordination.

### PR-009: Task List Parser

---
pr_id: PR-009
title: Task List Parser
cold_state: new
priority: high
complexity:
  score: 5
  estimated_minutes: 50
  suggested_model: sonnet
  rationale: YAML frontmatter parsing with error handling
dependencies: [PR-007]
estimated_files:
  - path: src/parser/taskList.ts
    action: create
    description: YAML frontmatter parser
  - path: src/parser/validation.ts
    action: create
    description: task list validation
  - path: src/parser/errors.ts
    action: create
    description: parsing error handling
  - path: tests/parser.test.ts
    action: create
    description: parser tests
---

**Description:**
Implement robust YAML frontmatter parser for task-list.md that extracts PR metadata and validates structure.

**Acceptance Criteria:**
- [ ] Parses YAML frontmatter correctly
- [ ] Validates required fields
- [ ] Handles malformed YAML gracefully
- [ ] Preserves markdown content
- [ ] Updates only frontmatter on changes
- [ ] Performance good for large files

**Notes:**
Important for reliable task list processing. Needs robust error handling.

### PR-010: State Synchronization System

---
pr_id: PR-010
title: State Synchronization System
cold_state: new
priority: high
complexity:
  score: 6
  estimated_minutes: 60
  suggested_model: sonnet
  rationale: Complex bidirectional sync between Redis and git
dependencies: [PR-007, PR-009]
estimated_files:
  - path: src/sync/stateSync.ts
    action: create
    description: main sync logic
  - path: src/sync/gitOps.ts
    action: create
    description: git operations
  - path: src/sync/redisOps.ts
    action: create
    description: Redis operations
  - path: src/sync/reconciliation.ts
    action: create
    description: conflict reconciliation
  - path: tests/sync.test.ts
    action: create
    description: sync system tests
---

**Description:**
Implement bidirectional state synchronization between Redis (hot state) and git (cold state) with proper reconciliation.

**Acceptance Criteria:**
- [ ] Cold state changes commit to git
- [ ] Hot state updates Redis only
- [ ] 30-second sync cycle works
- [ ] Reconciliation handles conflicts
- [ ] Git history stays clean
- [ ] Crash recovery works

**Notes:**
Critical for maintaining state consistency across system boundaries.

---

## Block 4: Agent Infrastructure (Depends on: Block 3)

### PR-011: Base Agent Class

---
pr_id: PR-011
title: Base Agent Class
cold_state: new
priority: high
complexity:
  score: 5
  estimated_minutes: 50
  suggested_model: sonnet
  rationale: Foundation class for all agent types
dependencies: [PR-007]
estimated_files:
  - path: src/agents/base.ts
    action: create
    description: base agent class
  - path: src/agents/lifecycle.ts
    action: create
    description: agent lifecycle management
  - path: src/agents/communication.ts
    action: create
    description: hub communication
  - path: src/agents/heartbeat.ts
    action: create
    description: heartbeat system
  - path: tests/baseAgent.test.ts
    action: create
    description: base agent tests
---

**Description:**
Implement base agent class with lifecycle management, hub communication, and heartbeat system that all agent types will extend.

**Acceptance Criteria:**
- [ ] Agent lifecycle properly managed
- [ ] Heartbeat every 30 seconds
- [ ] Hub communication via Redis pub/sub
- [ ] Graceful shutdown handling
- [ ] Error recovery implemented
- [ ] Extensible for agent types

**Notes:**
Foundation for all agent implementations. Important to get the abstraction right. Should incorporate PR implementation planning behaviors from prompts translated in PR-003a.

### PR-012: Agent Process Spawning

---
pr_id: PR-012
title: Agent Process Spawning
cold_state: new
priority: high
complexity:
  score: 6
  estimated_minutes: 60
  suggested_model: sonnet
  rationale: Complex process management with different agent types
dependencies: [PR-007, PR-011]
estimated_files:
  - path: src/hub/agentSpawner.ts
    action: create
    description: agent spawning logic
  - path: src/hub/processManager.ts
    action: create
    description: process lifecycle management
  - path: src/hub/agentRegistry.ts
    action: create
    description: agent tracking
  - path: tests/agentSpawning.test.ts
    action: create
    description: spawning tests
---

**Description:**
Implement agent process spawning with support for different agent types and proper process management.

**Acceptance Criteria:**
- [ ] Spawns agent processes on demand
- [ ] Tracks running agents
- [ ] Monitors agent health
- [ ] Reclaims crashed agents
- [ ] Supports different agent types
- [ ] Clean process termination

**Notes:**
Important for reliable agent management and system stability.

### PR-013: Message Bus Implementation

---
pr_id: PR-013
title: Message Bus Implementation
cold_state: new
priority: high
complexity:
  score: 5
  estimated_minutes: 50
  suggested_model: sonnet
  rationale: Redis pub/sub with fallback to file-based messaging
dependencies: [PR-004, PR-011]
estimated_files:
  - path: src/communication/messageBus.ts
    action: create
    description: message bus abstraction
  - path: src/communication/redisPubSub.ts
    action: create
    description: Redis pub/sub implementation
  - path: src/communication/fileMessaging.ts
    action: create
    description: file-based fallback
  - path: tests/messageBus.test.ts
    action: create
    description: messaging tests
---

**Description:**
Implement message bus for hub-agent communication using Redis pub/sub with file-based fallback for degraded mode.

**Acceptance Criteria:**
- [ ] Redis pub/sub works in normal mode
- [ ] File-based messaging in degraded mode
- [ ] Message routing correct
- [ ] Broadcast capabilities work
- [ ] Message persistence for recovery
- [ ] Performance acceptable

**Notes:**
Critical for agent coordination and mode-agnostic communication.

---

## ═══════════════════════════════════════════════════════════════
## PHASE 0.1b - UX & INTEGRATION (PR-014 to PR-016)
## Goal: Single shell TUI, input routing, MCP infrastructure
##
## Testable at Phase End:
## - CLI commands work (hub start/stop, run)
## - Single shell TUI displays agent status
## - User input routes to correct agent
## - Progress tracking visible
## - Real-time updates working
## ═══════════════════════════════════════════════════════════════

## Block 5: CLI and User Interface (Depends on: Block 3)

### PR-014: CLI Command Structure

---
pr_id: PR-014
title: CLI Command Structure
cold_state: new
priority: high
complexity:
  score: 3
  estimated_minutes: 30
  suggested_model: haiku
  rationale: Standard CLI setup with commander or yargs
dependencies: [PR-007]
estimated_files:
  - path: src/cli/index.ts
    action: create
    description: main CLI entry point
  - path: src/cli/commands.ts
    action: create
    description: command definitions
  - path: src/cli/hub.ts
    action: create
    description: hub commands
  - path: src/cli/run.ts
    action: create
    description: run commands
  - path: bin/lemegeton.js
    action: create
    description: CLI executable
---

**Description:**
Implement CLI command structure for `lemegeton hub start/stop`, `lemegeton run`, and other commands.

**Acceptance Criteria:**
- [ ] Basic commands work (hub start/stop, run)
- [ ] Help text clear and useful
- [ ] Error messages helpful
- [ ] Exit codes correct
- [ ] Works with npx

**Notes:**
Straightforward CLI implementation. Important for user experience.

### PR-015: Terminal UI (TUI) Implementation

---
pr_id: PR-015
title: Terminal UI (TUI) Implementation
cold_state: new
priority: high
complexity:
  score: 7
  estimated_minutes: 70
  suggested_model: sonnet
  rationale: Complex terminal UI with real-time updates
dependencies: [PR-014, PR-013]
estimated_files:
  - path: src/tui/index.ts
    action: create
    description: main TUI class
  - path: src/tui/statusBar.ts
    action: create
    description: status bar component
  - path: src/tui/activityLog.ts
    action: create
    description: activity log display
  - path: src/tui/inputRouter.ts
    action: create
    description: user input routing
  - path: src/tui/render.ts
    action: create
    description: rendering logic
---

**Description:**
Implement single shell Terminal UI showing agent status, activity logs, and routing user input to appropriate agents.

**Acceptance Criteria:**
- [ ] Status bar shows all active agents
- [ ] Real-time updates via Redis pub/sub
- [ ] Activity log displays agent actions
- [ ] Input routing to agents works
- [ ] Coordination mode displayed
- [ ] Clean terminal handling

**Notes:**
Complex UI requiring careful terminal handling and real-time updates. Use blessed or ink.

### PR-016: Progress Tracking Display

---
pr_id: PR-016
title: Progress Tracking Display
cold_state: new
priority: medium
complexity:
  score: 4
  estimated_minutes: 40
  suggested_model: sonnet
  rationale: Progress visualization with dependency tracking
dependencies: [PR-015]
estimated_files:
  - path: src/tui/progress.ts
    action: create
    description: progress tracking component
  - path: src/tui/dependencies.ts
    action: create
    description: dependency visualization
  - path: src/tui/metrics.ts
    action: create
    description: metrics display
  - path: tests/tui.test.ts
    action: create
    description: TUI component tests
---

**Description:**
Add progress tracking visualization to TUI showing PR completion status, dependencies, and metrics.

**Acceptance Criteria:**
- [ ] Shows completed/in-progress/blocked PRs
- [ ] Dependency chains visible
- [ ] Completion percentage displayed
- [ ] Time estimates shown
- [ ] Updates in real-time

**Notes:**
Enhances user visibility into system progress.

---

## ═══════════════════════════════════════════════════════════════
## PHASE 0.2 - INTELLIGENCE & OPTIMIZATION (PR-017 to PR-025)
## Goal: Planning agent, cost control, incremental testing
##
## Testable at Phase End:
## - Planning agent generates PRD and task list from spec
## - Cost tracking and limits enforced
## - Complexity scoring works correctly
## - Speculative execution provides optimization hints
## - QC agent runs incremental tests
## - MCP documentation queries work
## ═══════════════════════════════════════════════════════════════

## Block 6: Cost Control System (Depends on: Block 4)

### PR-017: Cost Controller Implementation

---
pr_id: PR-017
title: Cost Controller Implementation
cold_state: new
priority: high
complexity:
  score: 6
  estimated_minutes: 60
  suggested_model: sonnet
  rationale: Tool-agnostic cost control with multiple providers
dependencies: [PR-002, PR-007]
estimated_files:
  - path: src/cost/controller.ts
    action: create
    description: main cost controller
  - path: src/cost/providers.ts
    action: create
    description: provider configurations
  - path: src/cost/tracking.ts
    action: create
    description: usage tracking
  - path: src/cost/limits.ts
    action: create
    description: limit enforcement
  - path: tests/cost.test.ts
    action: create
    description: cost control tests
---

**Description:**
Implement tool-agnostic cost controller supporting Anthropic, OpenAI, self-hosted, and OpenCode models with budget enforcement.

**Acceptance Criteria:**
- [ ] Tracks token usage per PR
- [ ] Enforces daily/hourly limits
- [ ] Supports multiple providers
- [ ] Fallback behavior configurable
- [ ] Zero-cost for self-hosted models
- [ ] Real-time cost tracking

**Notes:**
Important for cost management across different LLM providers.

### PR-018: Complexity Scorer

---
pr_id: PR-018
title: Complexity Scorer
cold_state: new
priority: high
complexity:
  score: 5
  estimated_minutes: 50
  suggested_model: sonnet
  rationale: PR complexity analysis for model routing
dependencies: [PR-009]
estimated_files:
  - path: src/cost/complexityScorer.ts
    action: create
    description: complexity scoring logic
  - path: src/cost/keywords.ts
    action: create
    description: keyword analysis
  - path: src/cost/modelSelection.ts
    action: create
    description: model tier selection
  - path: tests/complexity.test.ts
    action: create
    description: scoring tests
---

**Description:**
Implement PR complexity scoring (1-10) based on file count, dependencies, and keywords to enable intelligent model routing.

**Acceptance Criteria:**
- [ ] Scores PRs from 1-10
- [ ] Considers file count
- [ ] Analyzes dependencies
- [ ] Keyword analysis works
- [ ] Model recommendations accurate
- [ ] Scoring consistent and predictable

**Notes:**
Enables cost optimization through intelligent model selection.

### PR-019: Heterogeneous Agent Pool Manager

---
pr_id: PR-019
title: Heterogeneous Agent Pool Manager
cold_state: new
priority: medium
complexity:
  score: 6
  estimated_minutes: 60
  suggested_model: sonnet
  rationale: Managing different agent tiers with fallback
dependencies: [PR-012, PR-017, PR-018]
estimated_files:
  - path: src/agents/poolManager.ts
    action: create
    description: agent pool management
  - path: src/agents/pools.ts
    action: create
    description: pool implementations
  - path: src/agents/allocation.ts
    action: create
    description: agent allocation logic
  - path: src/agents/fallback.ts
    action: create
    description: fallback strategies
  - path: tests/agentPool.test.ts
    action: create
    description: pool management tests
---

**Description:**
Implement agent pool manager that maintains separate pools for Haiku, Sonnet, and Opus agents with intelligent allocation.

**Acceptance Criteria:**
- [ ] Maintains separate agent pools
- [ ] Routes by PR complexity
- [ ] Fallback to other tiers works
- [ ] Pool sizing configurable
- [ ] Agent availability tracked
- [ ] Load balancing implemented

**Notes:**
Enables significant cost savings through optimized model usage.

---

## Block 7: Planning and MCP Integration (Depends on: Block 4)

### PR-020: Planning Agent Automation and Enhancement

---
pr_id: PR-020
title: Planning Agent Automation and Enhancement
cold_state: new
priority: high
complexity:
  score: 6
  estimated_minutes: 60
  suggested_model: sonnet
  rationale: Automating existing planning prompt and adding MCP integration
dependencies: [PR-011, PR-009, PR-022]
estimated_files:
  - path: src/agents/planning/index.ts
    action: create
    description: planning agent automation class
  - path: src/agents/planning/promptRunner.ts
    action: create
    description: executes lemegeton-planning.md prompt
  - path: src/agents/planning/mcpQueries.ts
    action: create
    description: MCP integration for tech decisions
  - path: src/agents/planning/interactive.ts
    action: create
    description: user interaction for clarifications
  - path: src/hub/planningIntegration.ts
    action: create
    description: hub integration for planning workflow
  - path: tests/planning.test.ts
    action: create
    description: planning agent tests
---

**Description:**
Automate and enhance the existing planning agent prompt (lemegeton-planning.md) to be callable programmatically by the Hub, adding MCP queries for tech stack decisions and documentation lookups.

**Acceptance Criteria:**
- [ ] Existing planning prompt callable programmatically
- [ ] Integrated into Hub workflow (npx lemegeton plan)
- [ ] MCP queries for tech stack verification
- [ ] Interactive clarifications automated
- [ ] Task list generation validated
- [ ] Complexity scoring consistent

**Notes:**
The planning prompt already exists and works (used to generate this task list). This PR automates it and adds enhancements like MCP integration for better tech decisions.

### PR-021: Speculative Execution Engine

---
pr_id: PR-021
title: Speculative Execution Engine
cold_state: new
priority: medium
complexity:
  score: 7
  estimated_minutes: 70
  suggested_model: sonnet
  rationale: Advanced pattern analysis and optimization
dependencies: [PR-020]
estimated_files:
  - path: src/agents/planning/speculation.ts
    action: create
    description: speculative analysis engine
  - path: src/agents/planning/patterns.ts
    action: create
    description: pattern recognition
  - path: src/agents/planning/conflicts.ts
    action: create
    description: conflict prediction
  - path: src/agents/planning/optimization.ts
    action: create
    description: task optimization
  - path: tests/speculation.test.ts
    action: create
    description: speculation tests
---

**Description:**
Implement speculative execution that analyzes task patterns, predicts conflicts, and suggests optimal agent allocation and model mix.

**Acceptance Criteria:**
- [ ] Analyzes task patterns
- [ ] Predicts likely file conflicts
- [ ] Calculates parallelization potential
- [ ] Suggests optimal agent count
- [ ] Recommends model tier mix
- [ ] Pre-fetches documentation needs

**Notes:**
Advanced optimization feature that improves planning quality and execution efficiency.

### PR-022: MCP Server Integration

---
pr_id: PR-022
title: MCP Server Integration
cold_state: new
priority: medium
complexity:
  score: 6
  estimated_minutes: 60
  suggested_model: sonnet
  rationale: External service integration with multiple providers
dependencies: [PR-011]
estimated_files:
  - path: src/mcp/client.ts
    action: create
    description: MCP client implementation
  - path: src/mcp/servers.ts
    action: create
    description: server configurations
  - path: src/mcp/adapters/github.ts
    action: create
    description: GitHub MCP adapter
  - path: src/mcp/adapters/npm.ts
    action: create
    description: npm MCP adapter
  - path: tests/mcp.test.ts
    action: create
    description: MCP integration tests
---

**Description:**
Implement MCP (Model Context Protocol) client for querying documentation from MDN, npm, GitHub, and other sources.

**Acceptance Criteria:**
- [ ] MCP client connects to servers
- [ ] GitHub documentation queries work
- [ ] npm package info retrieval works
- [ ] MDN web API queries work
- [ ] Caching implemented
- [ ] Fallback for unavailable servers

**Notes:**
Improves agent accuracy by providing real-time documentation access.

---

## Block 8: Quality Control and Testing (Depends on: Block 4)

### PR-023: QC Agent Implementation

---
pr_id: PR-023
title: QC Agent Implementation
cold_state: new
priority: high
complexity:
  score: 6
  estimated_minutes: 60
  suggested_model: sonnet
  rationale: Automated testing with incremental selection
dependencies: [PR-011]
estimated_files:
  - path: src/agents/qc/index.ts
    action: create
    description: QC agent main class
  - path: src/agents/qc/testRunner.ts
    action: create
    description: test execution logic
  - path: src/agents/qc/coverage.ts
    action: create
    description: coverage checking
  - path: src/agents/qc/reporting.ts
    action: create
    description: test reporting
  - path: tests/qc.test.ts
    action: create
    description: QC agent tests
---

**Description:**
Implement QC Agent that automatically tests completed PRs, checks coverage, and marks PRs as broken if tests fail.

**Acceptance Criteria:**
- [ ] Spawns when PR marked completed
- [ ] Runs appropriate tests
- [ ] Checks test coverage
- [ ] Marks PR broken on failure
- [ ] Detailed failure reports
- [ ] Works with multiple test frameworks

**Notes:**
Critical for maintaining code quality in parallel development.

### PR-024: Incremental Test Selection

---
pr_id: PR-024
title: Incremental Test Selection
cold_state: new
priority: medium
complexity:
  score: 6
  estimated_minutes: 60
  suggested_model: sonnet
  rationale: Framework-specific test selection logic
dependencies: [PR-023]
estimated_files:
  - path: src/agents/qc/incremental.ts
    action: create
    description: incremental test logic
  - path: src/agents/qc/frameworks/jest.ts
    action: create
    description: Jest adapter
  - path: src/agents/qc/frameworks/pytest.ts
    action: create
    description: pytest adapter
  - path: src/agents/qc/frameworks/go.ts
    action: create
    description: Go test adapter
  - path: tests/incremental.test.ts
    action: create
    description: incremental testing tests
---

**Description:**
Implement incremental test selection that runs only tests related to changed files, with framework-specific adapters.

**Acceptance Criteria:**
- [ ] Identifies related tests correctly
- [ ] Jest --findRelatedTests works
- [ ] pytest selection works
- [ ] Go package-level testing works
- [ ] Significant time savings achieved
- [ ] Falls back to full suite when needed

**Notes:**
Important optimization that speeds up QC cycles significantly.

### PR-025: Advanced Build Tool Integration

---
pr_id: PR-025
title: Advanced Build Tool Integration
cold_state: new
priority: low
complexity:
  score: 5
  estimated_minutes: 50
  suggested_model: sonnet
  rationale: Integration with Nx, Turborepo, Bazel
dependencies: [PR-024]
estimated_files:
  - path: src/agents/qc/buildTools/nx.ts
    action: create
    description: Nx integration
  - path: src/agents/qc/buildTools/turbo.ts
    action: create
    description: Turborepo integration
  - path: src/agents/qc/buildTools/bazel.ts
    action: create
    description: Bazel integration
  - path: tests/buildTools.test.ts
    action: create
    description: build tool tests
---

**Description:**
Add support for advanced build tools (Nx, Turborepo, Bazel) that understand project dependencies for optimal incremental testing.

**Acceptance Criteria:**
- [ ] Nx affected commands work
- [ ] Turborepo caching utilized
- [ ] Bazel incremental builds work
- [ ] Dependency graph analysis correct
- [ ] Cache hit rates high

**Notes:**
Advanced feature for monorepo and large project support.

---

## ═══════════════════════════════════════════════════════════════
## PHASE 0.3 - ADVANCED FEATURES (PR-026 to PR-031)
## Goal: Degradation modes, rollback patterns, heterogeneous pools
##
## Testable at Phase End:
## - Heterogeneous agent pools (Haiku/Sonnet/Opus) working
## - Degraded mode with git branches functions
## - Isolated mode works without Redis
## - State recovery from crashes successful
## - Automated rollback creates fix PRs
## - Code review agent provides insights
## ═══════════════════════════════════════════════════════════════

## Block 9: Degradation and Recovery (Depends on: Block 2)

### PR-026: Branch-Based Degraded Mode

---
pr_id: PR-026
title: Branch-Based Degraded Mode
cold_state: new
priority: high
complexity:
  score: 6
  estimated_minutes: 60
  suggested_model: sonnet
  rationale: Git branch management for degraded operation
dependencies: [PR-006]
estimated_files:
  - path: src/degraded/branchMode.ts
    action: create
    description: branch-based work logic
  - path: src/degraded/gitOps.ts
    action: create
    description: git operations
  - path: src/degraded/merging.ts
    action: create
    description: branch merge logic
  - path: tests/degraded.test.ts
    action: create
    description: degraded mode tests
---

**Description:**
Implement branch-based work mode for degraded operation where each agent works on separate git branches when Redis is unavailable.

**Acceptance Criteria:**
- [ ] Creates PR-specific branches
- [ ] Commits work to branches
- [ ] Pushes branches to origin
- [ ] Handles merge conflicts
- [ ] Reconciles when returning to normal
- [ ] Clean branch management

**Notes:**
Ensures productivity continues even during infrastructure issues.

### PR-027: Isolated Mode Implementation

---
pr_id: PR-027
title: Isolated Mode Implementation
cold_state: new
priority: medium
complexity:
  score: 5
  estimated_minutes: 50
  suggested_model: sonnet
  rationale: Pure local work without any coordination
dependencies: [PR-006]
estimated_files:
  - path: src/isolated/index.ts
    action: create
    description: isolated mode logic
  - path: src/isolated/fileState.ts
    action: create
    description: file-based state storage
  - path: src/isolated/recovery.ts
    action: create
    description: recovery mechanisms
  - path: tests/isolated.test.ts
    action: create
    description: isolated mode tests
---

**Description:**
Implement isolated mode for pure local work when both Redis and Docker are unavailable, using file-based state storage.

**Acceptance Criteria:**
- [ ] Works without Redis or Docker
- [ ] State persisted to files
- [ ] Agents work independently
- [ ] Recovery when infrastructure returns
- [ ] Conflict resolution handled
- [ ] User warned about limitations

**Notes:**
Last-resort fallback ensuring work can continue in any environment.

### PR-028: State Recovery System

---
pr_id: PR-028
title: State Recovery System
cold_state: new
priority: high
complexity:
  score: 6
  estimated_minutes: 60
  suggested_model: sonnet
  rationale: Complex state reconstruction from crashes
dependencies: [PR-010, PR-026, PR-027]
estimated_files:
  - path: src/recovery/index.ts
    action: create
    description: main recovery logic
  - path: src/recovery/gitRecovery.ts
    action: create
    description: recover from git
  - path: src/recovery/orphans.ts
    action: create
    description: orphaned state cleanup
  - path: src/recovery/validation.ts
    action: create
    description: state validation
  - path: tests/recovery.test.ts
    action: create
    description: recovery tests
---

**Description:**
Implement comprehensive state recovery that reconstructs system state from git after crashes or mode transitions.

**Acceptance Criteria:**
- [ ] Recovers from hub crashes
- [ ] Cleans orphaned hot states
- [ ] Validates state consistency
- [ ] Reconciles Redis with git
- [ ] Handles partial commits
- [ ] Recovery time < 10 seconds

**Notes:**
Critical for system resilience and data integrity.

---

## Block 10: Advanced Features (Depends on: Blocks 7, 8)

### PR-029: Code Review Agent

---
pr_id: PR-029
title: Code Review Agent
cold_state: new
priority: low
complexity:
  score: 6
  estimated_minutes: 60
  suggested_model: sonnet
  rationale: Batch code review with follow-up PR generation
dependencies: [PR-011, PR-023]
estimated_files:
  - path: src/agents/review/index.ts
    action: create
    description: review agent main class
  - path: src/agents/review/batch.ts
    action: create
    description: batch review logic
  - path: src/agents/review/analysis.ts
    action: create
    description: code analysis
  - path: src/agents/review/followup.ts
    action: create
    description: follow-up PR generation
  - path: tests/review.test.ts
    action: create
    description: review agent tests
---

**Description:**
Implement Code Review Agent that performs daily batch reviews of completed PRs and creates follow-up PRs for issues found.

**Acceptance Criteria:**
- [ ] Reviews PRs in batches
- [ ] Non-blocking (advisory only)
- [ ] Creates follow-up PRs
- [ ] Updates memory bank
- [ ] Pattern recognition works
- [ ] Quality insights generated

**Notes:**
Future enhancement for continuous quality improvement.

### PR-030: Automated Rollback System

---
pr_id: PR-030
title: Automated Rollback System
cold_state: new
priority: low
complexity:
  score: 7
  estimated_minutes: 70
  suggested_model: sonnet
  rationale: Complex failure analysis and recovery
dependencies: [PR-023]
estimated_files:
  - path: src/rollback/index.ts
    action: create
    description: rollback manager
  - path: src/rollback/analysis.ts
    action: create
    description: failure analysis
  - path: src/rollback/revert.ts
    action: create
    description: revert PR generation
  - path: src/rollback/fix.ts
    action: create
    description: fix PR generation
  - path: tests/rollback.test.ts
    action: create
    description: rollback tests
---

**Description:**
Implement automated rollback that creates revert and fix PRs when QC marks a PR as broken, with intelligent failure analysis.

**Acceptance Criteria:**
- [ ] Automatically creates revert PR
- [ ] Analyzes failure reasons
- [ ] Generates targeted fix PR
- [ ] Prioritizes fix appropriately
- [ ] Maintains forward momentum
- [ ] Learning from failures

**Notes:**
Advanced feature for resilient development workflow.

### PR-031: Memory Bank System

---
pr_id: PR-031
title: Memory Bank System
cold_state: new
priority: low
complexity:
  score: 5
  estimated_minutes: 50
  suggested_model: sonnet
  rationale: Institutional knowledge persistence
dependencies: [PR-029]
estimated_files:
  - path: src/memory/index.ts
    action: create
    description: memory bank manager
  - path: src/memory/storage.ts
    action: create
    description: knowledge storage
  - path: src/memory/retrieval.ts
    action: create
    description: knowledge retrieval
  - path: src/memory/patterns.ts
    action: create
    description: pattern extraction
  - path: tests/memory.test.ts
    action: create
    description: memory bank tests
---

**Description:**
Implement memory bank for storing architectural decisions, patterns, and institutional knowledge for team rotation scenarios.

**Acceptance Criteria:**
- [ ] Stores architectural decisions
- [ ] Captures coding patterns
- [ ] Retrieval by context works
- [ ] Updates from code reviews
- [ ] Pattern consistency enforced
- [ ] Knowledge persists across sprints

**Notes:**
Foundation for v1.0 team rotation features.

---

## ═══════════════════════════════════════════════════════════════
## PHASE 0.4 - VALIDATION (PR-032 to PR-036)
## Goal: Testing, documentation, dog-fooding preparation
##
## Testable at Phase End:
## - Comprehensive test coverage >90%
## - Performance benchmarks pass
## - User guide documentation complete
## - API documentation generated
## - Example projects work
## - Ready for dog-fooding
## ═══════════════════════════════════════════════════════════════

## Block 11: Testing and Documentation (Depends on: All blocks)

### PR-032: Unit Tests for Core Components

---
pr_id: PR-032
title: Unit Tests for Core Components
cold_state: new
priority: high
complexity:
  score: 4
  estimated_minutes: 40
  suggested_model: haiku
  rationale: Standard unit test implementation
dependencies: [PR-003, PR-005, PR-008]
estimated_files:
  - path: tests/unit/stateMachine.test.ts
    action: create
    description: state machine tests
  - path: tests/unit/leaseManager.test.ts
    action: create
    description: lease manager tests
  - path: tests/unit/scheduler.test.ts
    action: create
    description: scheduler tests
  - path: tests/unit/parser.test.ts
    action: create
    description: parser tests
---

**Description:**
Write comprehensive unit tests for core components including state machine, lease manager, scheduler, and parser.

**Acceptance Criteria:**
- [ ] >90% code coverage for core modules
- [ ] Edge cases covered
- [ ] Mocking properly implemented
- [ ] Tests run quickly
- [ ] Clear test descriptions

**Notes:**
Essential for maintaining code quality and catching regressions.

### PR-033: Integration Tests

---
pr_id: PR-033
title: Integration Tests
cold_state: new
priority: high
complexity:
  score: 5
  estimated_minutes: 50
  suggested_model: sonnet
  rationale: Complex multi-component testing
dependencies: [PR-007, PR-011, PR-013]
estimated_files:
  - path: tests/integration/hub.test.ts
    action: create
    description: hub integration tests
  - path: tests/integration/agents.test.ts
    action: create
    description: agent coordination tests
  - path: tests/integration/modes.test.ts
    action: create
    description: coordination mode tests
  - path: tests/integration/endToEnd.test.ts
    action: create
    description: end-to-end scenarios
---

**Description:**
Write integration tests covering hub-agent interaction, coordination mode transitions, and end-to-end workflows.

**Acceptance Criteria:**
- [ ] Hub-agent communication tested
- [ ] Mode transitions verified
- [ ] End-to-end scenarios work
- [ ] Redis mocking appropriate
- [ ] Docker interactions tested

**Notes:**
Critical for verifying system-level behavior.

### PR-034: Performance Tests

---
pr_id: PR-034
title: Performance Tests
cold_state: new
priority: medium
complexity:
  score: 4
  estimated_minutes: 40
  suggested_model: haiku
  rationale: Performance benchmarking and optimization
dependencies: [PR-008, PR-024]
estimated_files:
  - path: tests/performance/scheduler.bench.ts
    action: create
    description: scheduler benchmarks
  - path: tests/performance/parser.bench.ts
    action: create
    description: parser benchmarks
  - path: tests/performance/lease.bench.ts
    action: create
    description: lease acquisition benchmarks
  - path: tests/performance/scenarios.ts
    action: create
    description: real-world scenarios
---

**Description:**
Implement performance tests and benchmarks for critical components to ensure acceptable performance at scale.

**Acceptance Criteria:**
- [ ] Scheduler handles 100+ PRs
- [ ] Parser handles large files
- [ ] Lease acquisition < 100ms
- [ ] Memory usage acceptable
- [ ] Performance regression detection

**Notes:**
Important for ensuring scalability.

### PR-035: API Documentation

---
pr_id: PR-035
title: API Documentation
cold_state: new
priority: medium
complexity:
  score: 3
  estimated_minutes: 30
  suggested_model: haiku
  rationale: Documentation generation with TypeDoc
dependencies: [PR-001, PR-002]
estimated_files:
  - path: typedoc.json
    action: create
    description: TypeDoc configuration
  - path: docs/api/README.md
    action: create
    description: API documentation index
  - path: scripts/docs.sh
    action: create
    description: documentation build script
  - path: .github/workflows/docs.yml
    action: create
    description: docs CI workflow
---

**Description:**
Set up automated API documentation generation using TypeDoc with proper configuration and CI integration.

**Acceptance Criteria:**
- [ ] TypeDoc configured properly
- [ ] All public APIs documented
- [ ] Documentation builds automatically
- [ ] GitHub Pages deployment works
- [ ] Examples included

**Notes:**
Important for developer adoption and usage.

### PR-036: User Guide Documentation

---
pr_id: PR-036
title: User Guide Documentation
cold_state: new
priority: high
complexity:
  score: 3
  estimated_minutes: 30
  suggested_model: haiku
  rationale: User-facing documentation
dependencies: [PR-014, PR-015]
estimated_files:
  - path: docs/guide/quickstart.md
    action: create
    description: quick start guide
  - path: docs/guide/commands.md
    action: create
    description: command reference
  - path: docs/guide/configuration.md
    action: create
    description: configuration guide
  - path: docs/guide/troubleshooting.md
    action: create
    description: troubleshooting guide
---

**Description:**
Write comprehensive user guide documentation covering installation, usage, configuration, and troubleshooting.

**Acceptance Criteria:**
- [ ] Quick start guide complete
- [ ] All commands documented
- [ ] Configuration options explained
- [ ] Common issues covered
- [ ] Examples provided

**Notes:**
Essential for user onboarding and self-service support.

---

## ═══════════════════════════════════════════════════════════════
## PHASE 1.0 - TEAM FEATURES & DISTRIBUTION (PR-037 to PR-050)
## Goal: NPM package, memory bank, production polish
##
## Testable at Phase End:
## - NPM package publishes successfully
## - CI/CD pipeline fully automated
## - Cross-platform support verified (Windows/macOS/Linux)
## - Memory bank stores institutional knowledge
## - Error handling comprehensive
## - Monitoring and metrics available
## - Dog-fooding proves system works
## - Production-ready for teams
## ═══════════════════════════════════════════════════════════════

## Block 12: NPM Package and Distribution (Depends on: Block 11)

### PR-037: NPM Package Configuration

---
pr_id: PR-037
title: NPM Package Configuration
cold_state: new
priority: critical
complexity:
  score: 3
  estimated_minutes: 30
  suggested_model: haiku
  rationale: Standard npm package setup
dependencies: [PR-001]
estimated_files:
  - path: package.json
    action: modify
    description: npm package metadata
  - path: .npmrc
    action: create
    description: npm configuration
  - path: LICENSE
    action: create
    description: license file
  - path: CHANGELOG.md
    action: create
    description: changelog
---

**Description:**
Configure npm package with proper metadata, scripts, and publishing configuration for distribution.

**Acceptance Criteria:**
- [ ] Package.json properly configured
- [ ] Main and bin fields correct
- [ ] Dependencies vs devDependencies split
- [ ] Publish scripts work
- [ ] License specified

**Notes:**
Essential for npm distribution model.

### PR-038: Build and Bundle Configuration

---
pr_id: PR-038
title: Build and Bundle Configuration
cold_state: new
priority: high
complexity:
  score: 4
  estimated_minutes: 40
  suggested_model: sonnet
  rationale: Build pipeline with optimization
dependencies: [PR-037]
estimated_files:
  - path: rollup.config.js
    action: create
    description: Rollup bundler config
  - path: scripts/build.ts
    action: create
    description: build script
  - path: scripts/prepublish.ts
    action: create
    description: prepublish script
  - path: .github/workflows/build.yml
    action: create
    description: build CI workflow
---

**Description:**
Set up build pipeline using Rollup or esbuild for optimized bundle generation with proper externals handling.

**Acceptance Criteria:**
- [ ] TypeScript compilation works
- [ ] Bundle size optimized
- [ ] Externals properly configured
- [ ] Source maps generated
- [ ] Multiple output formats if needed

**Notes:**
Important for package size and performance.

### PR-039: CI/CD Pipeline

---
pr_id: PR-039
title: CI/CD Pipeline
cold_state: new
priority: high
complexity:
  score: 4
  estimated_minutes: 40
  suggested_model: sonnet
  rationale: GitHub Actions CI/CD setup
dependencies: [PR-032, PR-033, PR-038]
estimated_files:
  - path: .github/workflows/ci.yml
    action: create
    description: main CI workflow
  - path: .github/workflows/release.yml
    action: create
    description: release workflow
  - path: .github/workflows/publish.yml
    action: create
    description: npm publish workflow
  - path: scripts/release.sh
    action: create
    description: release automation script
---

**Description:**
Set up GitHub Actions CI/CD pipeline for testing, building, and publishing to npm with semantic versioning.

**Acceptance Criteria:**
- [ ] Tests run on every PR
- [ ] Build verification works
- [ ] Semantic versioning automated
- [ ] npm publish on release
- [ ] Tag creation automated

**Notes:**
Essential for maintaining quality and automating releases.

---

## Block 13: Examples and Templates (Depends on: Block 12)

### PR-040: Example Projects

---
pr_id: PR-040
title: Example Projects
cold_state: new
priority: medium
complexity:
  score: 3
  estimated_minutes: 30
  suggested_model: haiku
  rationale: Simple example creation
dependencies: [PR-036]
estimated_files:
  - path: examples/simple-app/spec.md
    action: create
    description: example spec
  - path: examples/simple-app/README.md
    action: create
    description: example documentation
  - path: examples/monorepo/spec.md
    action: create
    description: monorepo example
  - path: examples/api-service/spec.md
    action: create
    description: API service example
---

**Description:**
Create example projects demonstrating Lemegeton usage with different project types and configurations.

**Acceptance Criteria:**
- [ ] Simple app example works
- [ ] Monorepo example included
- [ ] API service example included
- [ ] Clear instructions provided
- [ ] Demonstrates key features

**Notes:**
Helpful for user onboarding and showcasing capabilities.

### PR-041: Project Templates

---
pr_id: PR-041
title: Project Templates
cold_state: new
priority: low
complexity:
  score: 2
  estimated_minutes: 20
  suggested_model: haiku
  rationale: Template file creation
dependencies: [PR-040]
estimated_files:
  - path: templates/task-list.md.template
    action: create
    description: task list template
  - path: templates/prd.md.template
    action: create
    description: PRD template
  - path: templates/spec.md.template
    action: create
    description: spec template
  - path: templates/config.json.template
    action: create
    description: config template
---

**Description:**
Create starter templates for common Lemegeton files to help users get started quickly.

**Acceptance Criteria:**
- [ ] Task list template with examples
- [ ] PRD template comprehensive
- [ ] Spec template clear
- [ ] Config template documented
- [ ] Templates well-commented

**Notes:**
Reduces friction for new users.

---

## Block 14: Monitoring and Debugging (Depends on: Block 7)

### PR-042: Debug Logging System

---
pr_id: PR-042
title: Debug Logging System
cold_state: new
priority: medium
complexity:
  score: 3
  estimated_minutes: 30
  suggested_model: haiku
  rationale: Standard logging implementation
dependencies: [PR-007]
estimated_files:
  - path: src/utils/logger.ts
    action: create
    description: logger implementation
  - path: src/utils/debug.ts
    action: create
    description: debug utilities
  - path: src/config/logging.ts
    action: create
    description: logging configuration
  - path: tests/logger.test.ts
    action: create
    description: logger tests
---

**Description:**
Implement comprehensive debug logging system with configurable levels and output formats for troubleshooting.

**Acceptance Criteria:**
- [ ] Multiple log levels supported
- [ ] Configurable via environment
- [ ] File and console output
- [ ] Structured logging format
- [ ] Performance acceptable

**Notes:**
Essential for debugging production issues.

### PR-043: Metrics and Telemetry

---
pr_id: PR-043
title: Metrics and Telemetry
cold_state: new
priority: low
complexity:
  score: 4
  estimated_minutes: 40
  suggested_model: sonnet
  rationale: Metrics collection and reporting
dependencies: [PR-017, PR-042]
estimated_files:
  - path: src/metrics/collector.ts
    action: create
    description: metrics collection
  - path: src/metrics/reporter.ts
    action: create
    description: metrics reporting
  - path: src/metrics/dashboard.ts
    action: create
    description: metrics dashboard
  - path: tests/metrics.test.ts
    action: create
    description: metrics tests
---

**Description:**
Implement metrics collection for performance monitoring, cost tracking, and usage analytics with optional reporting.

**Acceptance Criteria:**
- [ ] Performance metrics collected
- [ ] Cost metrics tracked
- [ ] Usage patterns captured
- [ ] Optional telemetry (privacy-respecting)
- [ ] Local dashboard available

**Notes:**
Helpful for optimization and understanding usage patterns.

### PR-044: Error Handling and Recovery

---
pr_id: PR-044
title: Error Handling and Recovery
cold_state: new
priority: high
complexity:
  score: 5
  estimated_minutes: 50
  suggested_model: sonnet
  rationale: Comprehensive error handling across system
dependencies: [PR-028, PR-042]
estimated_files:
  - path: src/errors/index.ts
    action: create
    description: error types and base classes
  - path: src/errors/handlers.ts
    action: create
    description: error handlers
  - path: src/errors/recovery.ts
    action: create
    description: recovery strategies
  - path: tests/errors.test.ts
    action: create
    description: error handling tests
---

**Description:**
Implement comprehensive error handling with proper error types, recovery strategies, and user-friendly messages.

**Acceptance Criteria:**
- [ ] Custom error types defined
- [ ] Error boundaries implemented
- [ ] Recovery strategies work
- [ ] User-friendly error messages
- [ ] Stack traces in debug mode

**Notes:**
Critical for robustness and user experience.

---

## Block 15: Security and Validation (Depends on: Block 1)

### PR-045: Input Validation and Sanitization

---
pr_id: PR-045
title: Input Validation and Sanitization
cold_state: new
priority: high
complexity:
  score: 4
  estimated_minutes: 40
  suggested_model: sonnet
  rationale: Security-critical validation logic
dependencies: [PR-009]
estimated_files:
  - path: src/validation/index.ts
    action: create
    description: validation utilities
  - path: src/validation/yaml.ts
    action: create
    description: YAML validation
  - path: src/validation/paths.ts
    action: create
    description: path validation
  - path: tests/validation.test.ts
    action: create
    description: validation tests
---

**Description:**
Implement input validation and sanitization for all user inputs including YAML, file paths, and commands.

**Acceptance Criteria:**
- [ ] YAML injection prevented
- [ ] Path traversal blocked
- [ ] Command injection prevented
- [ ] Input limits enforced
- [ ] Clear validation errors

**Notes:**
Critical for security, especially with file system operations.

### PR-046: Environment Variable Management

---
pr_id: PR-046
title: Environment Variable Management
cold_state: new
priority: medium
complexity:
  score: 3
  estimated_minutes: 30
  suggested_model: haiku
  rationale: Configuration and secrets management
dependencies: [PR-001]
estimated_files:
  - path: src/config/env.ts
    action: create
    description: environment variable handling
  - path: src/config/schema.ts
    action: create
    description: configuration schema
  - path: .env.example
    action: create
    description: example environment file
  - path: tests/config.test.ts
    action: create
    description: configuration tests
---

**Description:**
Implement secure environment variable management with validation, defaults, and proper secret handling.

**Acceptance Criteria:**
- [ ] Environment variables validated
- [ ] Defaults provided
- [ ] Secrets never logged
- [ ] .env.example comprehensive
- [ ] Type-safe configuration

**Notes:**
Important for secure configuration management.

---

## Block 16: Cross-Platform Support (Depends on: Block 4)

### PR-047: Windows Compatibility

---
pr_id: PR-047
title: Windows Compatibility
cold_state: new
priority: high
complexity:
  score: 5
  estimated_minutes: 50
  suggested_model: sonnet
  rationale: Cross-platform path and process handling
dependencies: [PR-004, PR-012]
estimated_files:
  - path: src/utils/platform.ts
    action: create
    description: platform detection utilities
  - path: src/utils/paths.ts
    action: create
    description: cross-platform paths
  - path: src/utils/processes.ts
    action: create
    description: process management
  - path: tests/windows.test.ts
    action: create
    description: Windows-specific tests
---

**Description:**
Ensure Windows compatibility with proper path handling, process management, and Docker Desktop integration.

**Acceptance Criteria:**
- [ ] Path separators handled correctly
- [ ] Process spawning works on Windows
- [ ] Docker Desktop integration works
- [ ] WSL support verified
- [ ] PowerShell commands work

**Notes:**
Essential for Windows developer support.

### PR-048: macOS and Linux Optimization

---
pr_id: PR-048
title: macOS and Linux Optimization
cold_state: new
priority: medium
complexity:
  score: 3
  estimated_minutes: 30
  suggested_model: haiku
  rationale: Platform-specific optimizations
dependencies: [PR-047]
estimated_files:
  - path: src/utils/unix.ts
    action: create
    description: Unix-specific optimizations
  - path: scripts/install-deps.sh
    action: create
    description: dependency installation script
  - path: tests/unix.test.ts
    action: create
    description: Unix-specific tests
---

**Description:**
Add platform-specific optimizations for macOS and Linux including native commands and performance tweaks.

**Acceptance Criteria:**
- [ ] Native commands utilized
- [ ] File watchers optimized
- [ ] Signal handling correct
- [ ] Performance improvements measurable
- [ ] Resource usage optimized

**Notes:**
Improves experience for Unix-based developers.

---

## Block 17: Final Integration and Polish (Depends on: All blocks)

### PR-049: Dog-fooding Setup

---
pr_id: PR-049
title: Dog-fooding Setup
cold_state: new
priority: high
complexity:
  score: 2
  estimated_minutes: 20
  suggested_model: haiku
  rationale: Meta-setup for self-hosting development
dependencies: [PR-039]
estimated_files:
  - path: dogfood/spec.md
    action: create
    description: Lemegeton's own spec
  - path: dogfood/task-list.md
    action: create
    description: Generated task list
  - path: dogfood/config.json
    action: create
    description: Dog-fooding configuration
---

**Description:**
Set up Lemegeton to use itself for its own development, creating the ultimate test of the system.

**Acceptance Criteria:**
- [ ] Can generate PRD for Lemegeton
- [ ] Can create task list for features
- [ ] Can coordinate development
- [ ] Demonstrates all features
- [ ] Meta-development works

**Notes:**
Ultimate validation of system capabilities.

### PR-049a: Agent-Accessible CLI Commands

---
pr_id: PR-049a
title: Agent-Accessible CLI Commands
cold_state: new
priority: high
complexity:
  score: 3
  estimated_minutes: 30
  suggested_model: haiku
  rationale: Exposing existing functionality through CLI for agent use
dependencies: [PR-014, PR-020]
estimated_files:
  - path: src/cli/agentCommands.ts
    action: create
    description: agent-friendly CLI commands
  - path: src/cli/plan.ts
    action: create
    description: npx lemegeton plan command
  - path: src/cli/test.ts
    action: create
    description: npx lemegeton test command
  - path: src/cli/analyze.ts
    action: create
    description: npx lemegeton analyze command
  - path: docs/agent-commands.md
    action: create
    description: documentation of agent-accessible commands
  - path: tests/cli.test.ts
    action: modify
    description: tests for new commands
---

**Description:**
Verify and expose all agent-useful functionality through programmatic CLI commands, allowing users to blanket-approve `npx lemegeton` commands for reduced friction during agent operations.

**Acceptance Criteria:**
- [ ] Planning agent callable via `npx lemegeton plan spec.md`
- [ ] QC tests callable via `npx lemegeton test PR-XXX`
- [ ] Complexity analysis via `npx lemegeton analyze PR-XXX`
- [ ] State inspection via `npx lemegeton status`
- [ ] All commands return structured, parseable output
- [ ] Commands safe for blanket approval (no destructive operations)

**Notes:**
Reduces friction by allowing users to pre-approve all `npx lemegeton` commands, knowing they're safe and designed for agent use. Critical for smooth agent workflow.

### PR-050: Final Architecture Documentation

---
pr_id: PR-050
title: Final Architecture Documentation
cold_state: new
priority: medium
complexity:
  score: 8
  estimated_minutes: 80
  suggested_model: opus
  rationale: Comprehensive system documentation requiring full understanding
dependencies: [PR-001, PR-002, PR-003, PR-004, PR-005, PR-006, PR-007, PR-008, PR-009, PR-010, PR-011, PR-012, PR-013, PR-014, PR-015, PR-016, PR-017, PR-018, PR-019, PR-020, PR-021, PR-022, PR-023, PR-024, PR-025, PR-026, PR-027, PR-028, PR-029, PR-030, PR-031, PR-032, PR-033, PR-034, PR-035, PR-036, PR-037, PR-038, PR-039, PR-040, PR-041, PR-042, PR-043, PR-044, PR-045, PR-046, PR-047, PR-048, PR-049]
estimated_files:
  - path: docs/architecture.md
    action: modify
    description: comprehensive technical documentation
  - path: docs/diagrams/system-overview.mmd
    action: create
    description: system architecture diagram
  - path: docs/diagrams/state-machine.mmd
    action: create
    description: state machine diagram
  - path: docs/diagrams/coordination-modes.mmd
    action: create
    description: coordination mode transitions
  - path: docs/api-reference.md
    action: create
    description: complete API reference
---

**Description:**
Create comprehensive technical documentation covering the complete system architecture, all design decisions, and operational characteristics.

**Acceptance Criteria:**
- [ ] Complete system architecture documented
- [ ] All design decisions explained
- [ ] Mermaid diagrams comprehensive
- [ ] API documentation complete
- [ ] Performance characteristics documented
- [ ] Deployment guide included

**Notes:**
High complexity task requiring comprehensive system understanding. Opus recommended for thoroughness. This is the final PR in the dependency graph.