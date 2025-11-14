# PR-004: Redis Client with Configuration and Auto-spawn

## Overview
PR-004 is a critical infrastructure component that establishes Redis connectivity with intelligent fallback mechanisms. This PR has a complexity score of 8 (Opus-level) because it requires careful configuration management, Docker integration, and cross-platform compatibility.

## Key Implementation Details

### 1. Configuration Module (`src/config/index.ts`, `src/config/schema.ts`)
- Load configuration from `.env` file using dotenv
- Define TypeScript interfaces for all configuration options
- Provide secure defaults (localhost:6379, no auth)
- Validate configuration using a schema
- Security principle: No API keys, only infrastructure config

### 2. Redis Client Wrapper (`src/redis/client.ts`)
- Wrap the `redis` npm package with our abstractions
- Handle connection lifecycle (connect, disconnect, reconnect)
- Implement pub/sub capabilities for message bus
- Add connection pooling if needed
- Include automatic retry logic with exponential backoff

### 3. Auto-Spawn Logic (`src/redis/autoSpawn.ts`)
- **Primary trigger**: No REDIS_URL configured in environment
- **Secondary trigger**: Configured REDIS_URL connection fails
- Attempt Docker spawn with `docker run -d -p 6379:6379 redis:alpine`
- Check Docker availability first (`docker --version`)
- Handle Docker Desktop not running gracefully
- Store container ID for cleanup on shutdown

### 4. Health Checking (`src/redis/health.ts`)
- Implement PING/PONG health checks
- Monitor connection state
- Track latency metrics
- Automatic reconnection on health check failures
- Emit events for coordination mode manager

### 5. Docker Utilities (`src/utils/docker.ts`)
- Cross-platform Docker detection
- Container lifecycle management (start, stop, remove)
- Port availability checking before binding
- Handle WSL2 vs native Docker on Windows

## Testing Strategy
- Mock Docker commands in tests
- Mock Redis client for unit tests
- Integration tests with actual Redis if available
- Test all fallback scenarios

## Dependencies to Install
```json
{
  "dependencies": {
    "redis": "^4.6.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0"
  }
}
```

## Implementation Order
1. Start with configuration schema and validation
2. Implement basic Redis client wrapper
3. Add health checking logic
4. Implement Docker utilities
5. Add auto-spawn logic with fallback chain
6. Write comprehensive tests
7. Test on all platforms (Windows, macOS, Linux)

## Critical Success Factors
- Must handle all failure modes gracefully (no Docker, Redis down, port conflicts)
- Auto-spawn feature allows the system to "just work" without manual Redis setup
- Cross-platform compatibility is essential