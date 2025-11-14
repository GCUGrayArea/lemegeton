# Lemegeton

**Agent Orchestration Framework for Coding Projects**

Lemegeton is a production-grade orchestration system for parallel AI development agents. It enables unprecedented productivity gains by coordinating multiple AI agents (Claude Code, Cursor, OpenCode, etc.) working together on the same codebase without conflicts.

## Features

- **Parallel Agent Coordination**: Run 4-10 AI agents simultaneously without merge conflicts
- **Atomic File Locking**: Redis-based pessimistic locking prevents conflicts by design
- **Graceful Degradation**: Continues working even when Redis or network fails
- **Hot/Cold State Model**: Ephemeral work-in-progress tracking with durable git checkpoints
- **Cost Optimization**: Heterogeneous agent pools (Haiku/Sonnet/Opus) for 30%+ cost savings
- **Tool Agnostic**: Works with Claude Code, Cursor, OpenCode, or any LLM API
- **Zero Configuration**: Auto-spawns Redis in Docker when not found
- **Team Rotation**: Institutional memory and pattern consistency across developer rotations

## Installation

```bash
npm install lemegeton
```

## Quick Start

```bash
# Start the Hub (coordinates all agents)
npx lemegeton hub start

# In another terminal, run agents
npx lemegeton run --agents=4

# Or use in your favorite AI tool (Claude Code, Cursor, etc.)
npx lemegeton plan ./my-spec.md
```

## Documentation

For comprehensive documentation, see:

- **[Product Requirements Document](./docs/prd.md)** - Vision, features, and success criteria
- **[Technical Architecture](./docs/ARCHITECTURE.md)** - Design decisions and system components
- **[Task List](./docs/task-list.md)** - Implementation roadmap with 51 PRs

## Project Phases

- **Phase 0.1a**: Core coordination (Hub, Redis, file leases, MIS scheduler)
- **Phase 0.1b**: User experience (CLI, TUI, MCP integration)
- **Phase 0.2**: Intelligence and optimization (Planning agent, cost control, testing)
- **Phase 0.3**: Advanced features (Heterogeneous pools, degradation, rollback)
- **Phase 0.4**: Validation (Testing, documentation, dog-fooding)
- **Phase 1.0**: Team features (Memory bank, code review, pattern continuity)

## Security Model

Lemegeton relies on the security model of the underlying AI tool (Claude Code, Cursor, etc.). It does **not** have direct access to LLM API keys or credentials. All interactions go through the user's chosen AI tool, which handles authentication and API security.

## Development

```bash
# Build from source
npm run build

# Watch mode
npm run dev

# Run tests
npm test

# Clean build artifacts
npm run clean
```

## License

MIT

## Getting Help

- Check the [docs](./docs/) directory for detailed documentation
- Review the [task list](./docs/task-list.md) for implementation details
- See [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for technical deep dives
