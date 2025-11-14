# Lemegeton Prompt System

## Overview

The Lemegeton prompt system provides YAML-based configuration files that guide agent behavior. These prompts are bundled with the NPM package and loaded into Redis at Hub startup, enabling fast, consistent access for all agents.

## Architecture

### Storage and Loading

```
lemegeton/                     # NPM package
├── prompts/                   # Bundled prompt files
│   ├── agent-defaults.yml
│   ├── commit-policy.yml
│   └── cost-guidelines.yml
└── dist/
    └── services/
        └── PromptLoader.js    # Compiled service

User's project:
└── .lemegeton/
    ├── config.yml             # User configuration
    └── prompts/               # User overrides (future feature)
```

### Loading Flow

1. **Hub Startup**: Hub calls `PromptLoader.loadAllPrompts()`
2. **File Read**: PromptLoader reads YAML files from `prompts/` directory
3. **Parse & Validate**: YAML parsed and validated against TypeScript schemas
4. **Cache in Redis**: Parsed prompts stored as JSON in Redis with keys `prompt:<name>`
5. **Agent Access**: Agents retrieve prompts from Redis cache via `PromptLoader.getPrompt()`

### Why Redis Cache?

- **Performance**: Sub-millisecond retrieval vs file I/O
- **Consistency**: All agents see identical prompt content
- **Hot Reload**: Future feature to update prompts without restarting Hub
- **Distributed**: Multiple Hub instances can share Redis cache

## Available Prompts

### 1. Planning Agent (`planning-agent.yml`)

**Purpose**: Guide for the Planning Agent to transform project specifications into PRD and task list

**Key Sections**:
- **Role**: Planning Agent responsibilities and scope
- **Input Processing**: How to analyze specifications and ask clarifying questions
- **Tech Stack Clarification**: Critical requirements verification (language, framework, database, etc.)
- **Output Documents**: PRD and task-list.md structure with YAML frontmatter
- **Task List Structure**: Document metadata, PR-000 setup, dependency blocks
- **PR Template**: YAML frontmatter format with required/optional fields
- **Complexity Scoring**: Guidelines for scoring PRs 1-10 and routing to appropriate models
- **Special PR Types**: Test PRs, cross-cutting concerns, final architecture docs
- **.gitignore Review**: Tech stack-specific exclusions
- **Quality Checklist**: Validation before presenting to user
- **Post-Generation Workflow**: Review, approval, and commit process

**Used By**: Planning Agent (autonomous during planning phase)

**New for Lemegeton**:
- YAML frontmatter for reliable machine parsing
- Complexity-based model routing (Haiku/Sonnet/Opus)
- Estimated file lists for conflict detection
- PR-000 for Lemegeton setup
- Final architecture documentation PR

### 2. Agent Defaults (`agent-defaults.yml`)

**Purpose**: Core coordination workflow for all agents

**Key Sections**:
- **Work Claiming**: How to discover and claim available PRs
- **State Model**: Hot vs cold state behaviors and transitions
- **Redis Coordination**: Locking, transactions, and pub/sub patterns
- **Coding Standards**: Size limits (75 lines/function, 750 lines/file)
- **Emergency Procedures**: Halt signal checking and response

**Used By**: All agent types (implementation, QC, planning)

**Adaptations from Picatrix**:
- Replaced git-based file locks with Redis SETNX leases
- Added hot state transitions (Redis-only, no commits)
- Updated to use Hub coordination API instead of direct task-list.md access

### 3. Commit Policy (`commit-policy.yml`)

**Purpose**: Defines when and how agents commit changes

**Key Sections**:
- **Git Sync**: Always pull before commit (fast-forward expected)
- **Planning Phase**: Auto-commit rules (no approval needed)
- **Implementation Phase**: Bundled commits (approval required)
- **State Commit Rules**: Hot states (Redis only) vs cold states (Redis + git)
- **Read-Only Files**: Governance files that cannot be modified

**Used By**:
- Planning Agent (autonomous commits)
- Implementation Agents (approval-required commits)
- QC Agent (autonomous validation commits)

**Adaptations from Picatrix**:
- Merged atomic-commits.md rules into single prompt
- Added hot/cold state distinction (hot = no commit, cold = commit required)
- Changed from "always commit immediately" to "bundle with code" for implementation
- Planning phase remains autonomous (like Picatrix)

### 4. Cost Guidelines (`cost-guidelines.yml`)

**Purpose**: Cost control and model selection for heterogeneous agent pools

**Key Sections**:
- **Model Routing**: Complexity-based tier selection (Haiku/Sonnet/Opus)
- **Budget Enforcement**: Limits for tokens/PR, tokens/hour, cost/day
- **Fallback Strategies**: What to do when approaching or exceeding limits
- **Tool Support**: Provider-agnostic design (Claude, OpenCode, GPT-4, custom)

**Used By**: Hub (for agent assignment and budget tracking)

**New for Lemegeton**:
- No equivalent in Picatrix
- Enables cost optimization via heterogeneous pools
- Expected 60% Haiku, 35% Sonnet, 5% Opus distribution
- Target: 30%+ cost reduction vs homogeneous Sonnet pool

## Hot vs Cold State Model

A key architectural difference from Picatrix is Lemegeton's dual-state coordination:

### Hot States (Ephemeral, Redis-only)

**States**: `investigating`, `planning`, `in-progress`, `under-review`

**Characteristics**:
- Coordinated entirely via Redis
- No git commits for transitions
- Lost on Redis failure (recovered from cold states)
- Real-time updates via pub/sub
- Sub-second coordination latency

**Example**: Agent claims PR (ready → investigating) via Redis SET, no commit needed

### Cold States (Durable, Redis + Git)

**States**: `ready`, `blocked`, `planned`, `completed`, `approved`, `broken`

**Characteristics**:
- Require both Redis update AND task-list.md commit
- Persist across Redis failures
- Authoritative source for recovery
- Slower (git overhead) but durable

**Example**: Planning Agent completes planning (ready → planned) via auto-commit

### Commit Bundling

Unlike Picatrix (immediate coordination commits), Lemegeton bundles:

**Planning Phase** (autonomous):
```
ready → planned:
  - task-list.md update
  - prd.md updates
  - Single commit, no approval
```

**Implementation Phase** (requires approval):
```
in-progress → completed:
  - All implementation code
  - All tests
  - task-list.md update
  - Single bundled commit, user approval required
```

**Rationale**: Redis handles real-time coordination, git is for durability. No need for chatty coordination commits.

## Coding Standards Enforcement

The `agent-defaults.yml` prompt defines hard limits:

- **Max 75 lines per function**
- **Max 750 lines per file**

These limits are **enforced by QC Agent**. Code exceeding limits will fail validation.

### Decomposition Strategies

When limits are exceeded, agents must refactor using:

1. **Extract helpers**: Move complex logic to private functions
2. **Name predicates**: Replace boolean expressions with named functions
3. **Create utilities**: Move reusable logic to shared modules
4. **Separate concerns**: Split files by responsibility
5. **Decompose classes**: Break large classes into smaller ones
6. **Use composition**: Combine small objects vs large monoliths

## File Lease System

Lemegeton prevents merge conflicts via Redis-based file leases:

### How It Works

1. **Before claiming PR**: Agent queries Redis for file leases
2. **Check conflicts**: `GET lease:<file-path>` for each expected file
3. **Acquire atomically**: Use `MULTI/EXEC` to acquire all leases or none
4. **Work exclusively**: Only lease holder can modify file
5. **Release on completion**: `DEL lease:<file-path>` when done

### Lease Properties

- **TTL**: 2 hours default (configurable)
- **Automatic expiration**: Prevents orphaned leases
- **Heartbeat renewal**: Long operations extend TTL
- **Conflict detection**: Second agent sees lease, selects different work

### Integration with Prompts

The `agent-defaults.yml` prompt instructs agents to:
1. Check leases before claiming work
2. Acquire leases atomically before transitioning to `in-progress`
3. Release leases before exiting or halting

## User Overrides (Future Feature)

Future versions will support user-specific prompt customization:

```
.lemegeton/
└── prompts/
    ├── agent-defaults.yml      # Override bundled version
    └── custom-guidelines.yml   # Add new prompts
```

**Merge Strategy**:
- User prompts override bundled prompts
- Section-level merging (not file-level replacement)
- Allows customizing specific behaviors without forking

**Use Cases**:
- Company-specific coding standards
- Custom commit message formats
- Project-specific cost limits
- Integration with internal tools

## Prompt Development

### Creating New Prompts

1. **Define TypeScript Interface** in `src/types/prompts.ts`:
   ```typescript
   export interface MyPrompt extends BasePrompt {
     name: 'my-prompt';
     mySection: {
       myField: string;
     };
   }
   ```

2. **Add to PromptName Enum**:
   ```typescript
   export enum PromptName {
     MyPrompt = 'my-prompt',
   }
   ```

3. **Create YAML File** in `prompts/my-prompt.yml`:
   ```yaml
   name: my-prompt
   version: "1.0"
   description: My custom prompt
   mySection:
     myField: |
       Multi-line content here
   ```

4. **Add Validation** in `PromptLoader.ts`:
   ```typescript
   private validateMyPrompt(prompt: MyPrompt): void {
     if (!prompt.mySection) {
       throw new Error('MyPrompt missing required field: mySection');
     }
   }
   ```

5. **Update loadAllPrompts()** to include new prompt

6. **Write Tests** in `src/services/__tests__/PromptLoader.test.ts`

### YAML Best Practices

- **Use multiline strings** for long text: `field: |`
- **Structure logically**: Group related fields
- **Be explicit**: Don't rely on YAML's implicit typing
- **Validate**: Define TypeScript interfaces first
- **Document**: Add inline comments for complex sections

## Testing

Run prompt tests:
```bash
npm test -- PromptLoader.test.ts
```

Tests verify:
- ✅ YAML parsing correctness
- ✅ Redis caching functionality
- ✅ Schema validation
- ✅ Prompt retrieval
- ✅ Error handling

## Troubleshooting

### Prompt Not Found Error

```
Error: Prompt not found in cache: agent-defaults. Did you call loadAllPrompts()?
```

**Solution**: Hub must call `PromptLoader.loadAllPrompts()` during startup

### YAML Parse Error

```
Error: Invalid YAML: unexpected token
```

**Solution**: Validate YAML syntax, check indentation (use spaces, not tabs)

### Validation Error

```
Error: AgentDefaultsPrompt missing required field: workClaiming
```

**Solution**: Ensure YAML file includes all required fields per TypeScript interface

### Redis Connection Error

```
Error: Redis connection refused
```

**Solution**: Ensure Redis is running (`docker run -p 6379:6379 redis:7`)

## Future Enhancements

- **Version Management**: Support prompt versioning for graceful migrations
- **Hot Reload**: Update prompts without restarting Hub
- **User Overrides**: Allow project-specific customization
- **Prompt Analytics**: Track which prompts are accessed most frequently
- **Localization**: Support multiple languages for international teams
- **Template Variables**: Dynamic prompt content based on project config

## See Also

- [Architecture Documentation](../ARCHITECTURE.md) - System architecture overview
- [State Machine](../ARCHITECTURE.md#state-machine) - PR state transitions
- [Cost Controller](../ARCHITECTURE.md#cost-controller) - Budget enforcement details
- [PRD](../prd.md) - Product requirements and success criteria
