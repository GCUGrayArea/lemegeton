# PR-022: MCP Server Integration - Implementation Plan

**Version:** 1.0
**Date:** 2025-11-14
**Dependencies:** PR-011 (BaseAgent class)
**Estimated Duration:** 60 minutes
**Suggested Model:** Sonnet
**Complexity Score:** 6/10

---

## Overview

Implement MCP (Model Context Protocol) client integration for querying documentation from MDN, npm, GitHub, and other sources to improve agent accuracy through real-time documentation access.

## Background

The Model Context Protocol (MCP) is an open-source standard introduced by Anthropic in November 2024 for connecting AI assistants to systems where data lives. MCP provides a universal protocol for connecting AI systems with data sources, enabling agents to:

- Query documentation in real-time
- Access up-to-date package information
- Retrieve GitHub repository details
- Look up web API documentation

This integration will significantly improve agent accuracy by providing access to current, authoritative documentation during task execution.

## Goals

1. Implement MCP client for connecting to MCP servers
2. Create adapters for common documentation sources (GitHub, npm, MDN)
3. Add intelligent caching to reduce latency and API calls
4. Implement fallback mechanisms for unavailable servers
5. Integrate with BaseAgent class for use by all agent types

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────┐
│                  BaseAgent                          │
│  (from PR-011)                                      │
└──────────────────────┬──────────────────────────────┘
                       │
                       │ uses
                       ▼
┌─────────────────────────────────────────────────────┐
│              MCPClient                              │
│  - Connection management                            │
│  - Server discovery                                 │
│  - Request routing                                  │
└──────────┬──────────────────────────┬───────────────┘
           │                          │
           ▼                          ▼
┌──────────────────┐      ┌──────────────────────────┐
│  GitHub Adapter  │      │    npm Adapter           │
│  - Repo info     │      │  - Package info          │
│  - Issues        │      │  - Version info          │
│  - Docs          │      │  - Dependencies          │
└──────────────────┘      └──────────────────────────┘
           │                          │
           └──────────┬───────────────┘
                      ▼
           ┌──────────────────────┐
           │   Cache Layer        │
           │  - In-memory cache   │
           │  - Redis cache       │
           │  - TTL management    │
           └──────────────────────┘
```

### MCP Client Architecture

The MCP client will follow the official TypeScript SDK patterns:

```typescript
// Core client interface
interface MCPClient {
  connect(serverConfig: MCPServerConfig): Promise<void>;
  disconnect(): Promise<void>;
  query(request: MCPRequest): Promise<MCPResponse>;
  listTools(): Promise<MCPTool[]>;
  callTool(toolName: string, args: any): Promise<any>;
}

// Server configuration
interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'http';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

// Request/Response types
interface MCPRequest {
  tool: string;
  parameters: Record<string, any>;
  timeout?: number;
}

interface MCPResponse {
  content: any;
  metadata?: {
    source: string;
    timestamp: number;
    cached: boolean;
  };
}
```

## Implementation Strategy

### Phase 1: Core MCP Client (15 minutes)

**File:** `src/mcp/client.ts`

Implement the core MCP client with:
- Connection management to MCP servers
- Transport abstraction (stdio, HTTP)
- Request/response handling
- Error handling and retries
- Server health checking

**Key Features:**
- Support for both stdio and HTTP transports
- Automatic reconnection on failure
- Request timeout handling
- Graceful degradation when servers unavailable

### Phase 2: Server Configuration (10 minutes)

**File:** `src/mcp/servers.ts`

Define server configurations for common MCP servers:
- GitHub MCP server
- npm MCP server
- MDN (if available)
- Custom server registry

**Configuration Schema:**
```typescript
interface MCPServerRegistry {
  servers: {
    github: MCPServerConfig;
    npm: MCPServerConfig;
    mdn?: MCPServerConfig;
    custom?: MCPServerConfig[];
  };
}
```

### Phase 3: GitHub Adapter (10 minutes)

**File:** `src/mcp/adapters/github.ts`

Implement GitHub-specific adapter:
- Repository information lookup
- README retrieval
- Issue search
- Documentation access
- Release notes

**Example Usage:**
```typescript
const github = new GitHubAdapter(mcpClient);
const repoInfo = await github.getRepository('owner/repo');
const readme = await github.getReadme('owner/repo');
```

### Phase 4: npm Adapter (10 minutes)

**File:** `src/mcp/adapters/npm.ts`

Implement npm-specific adapter:
- Package information
- Version lookup
- Dependency tree
- Documentation links
- Download statistics

**Example Usage:**
```typescript
const npm = new NpmAdapter(mcpClient);
const pkgInfo = await npm.getPackageInfo('package-name');
const versions = await npm.getVersions('package-name');
```

### Phase 5: Caching Layer (10 minutes)

**File:** `src/mcp/cache.ts`

Implement intelligent caching:
- In-memory cache for hot data
- Redis cache for persistence
- TTL-based expiration
- Cache invalidation strategies
- Size limits

**Cache Strategy:**
- GitHub repo info: 1 hour TTL
- npm package info: 30 minutes TTL
- Documentation: 24 hours TTL
- Max cache size: 100MB

### Phase 6: Testing (5 minutes)

**File:** `tests/mcp.test.ts`

Comprehensive test suite:
- Client connection/disconnection
- Request/response handling
- Adapter functionality
- Cache behavior
- Fallback mechanisms
- Error scenarios

## File Structure

```
src/mcp/
├── index.ts              # Exports
├── client.ts             # Core MCP client
├── servers.ts            # Server configurations
├── cache.ts              # Caching layer
├── types.ts              # TypeScript types
├── adapters/
│   ├── github.ts        # GitHub adapter
│   ├── npm.ts           # npm adapter
│   └── base.ts          # Base adapter class
└── utils/
    ├── transport.ts     # Transport implementations
    └── retry.ts         # Retry logic

tests/
└── mcp.test.ts          # Comprehensive tests
```

## Dependencies

### New Package Dependencies

Add to `package.json`:
```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  }
}
```

### Internal Dependencies

- `src/agents/base.ts` (PR-011) - Will integrate MCP client
- `src/redis/client.ts` (PR-004) - For caching
- Configuration system - For server config

## Integration Points

### BaseAgent Integration

Extend BaseAgent with MCP capabilities:

```typescript
abstract class BaseAgent extends EventEmitter {
  // Existing properties...
  protected mcp: MCPClient | null = null;

  // Initialize MCP in start()
  async start(): Promise<void> {
    // Existing initialization...
    await this.initializeMCP();
    // ...
  }

  // New method
  protected async initializeMCP(): Promise<void> {
    if (this.config.enableMCP !== false) {
      this.mcp = new MCPClient(this.config.mcpServers);
      await this.mcp.connect();
    }
  }

  // Helper methods for agents
  protected async queryGitHub(repo: string): Promise<any> {
    if (!this.mcp) return null;
    const adapter = new GitHubAdapter(this.mcp);
    return await adapter.getRepository(repo);
  }

  protected async queryNpm(package: string): Promise<any> {
    if (!this.mcp) return null;
    const adapter = new NpmAdapter(this.mcp);
    return await adapter.getPackageInfo(package);
  }
}
```

## Configuration

### Environment Variables

```bash
# Enable/disable MCP
MCP_ENABLED=true

# MCP server configurations
MCP_GITHUB_ENABLED=true
MCP_GITHUB_URL=http://localhost:3000

MCP_NPM_ENABLED=true
MCP_NPM_URL=http://localhost:3001

# Cache settings
MCP_CACHE_ENABLED=true
MCP_CACHE_TTL=3600
MCP_CACHE_MAX_SIZE=104857600  # 100MB
```

### Configuration File

`config/mcp.json`:
```json
{
  "enabled": true,
  "servers": {
    "github": {
      "enabled": true,
      "transport": "http",
      "url": "http://localhost:3000"
    },
    "npm": {
      "enabled": true,
      "transport": "http",
      "url": "http://localhost:3001"
    }
  },
  "cache": {
    "enabled": true,
    "ttl": {
      "github": 3600,
      "npm": 1800,
      "default": 86400
    },
    "maxSize": 104857600
  },
  "fallback": {
    "enabled": true,
    "mode": "graceful"
  }
}
```

## Error Handling

### Failure Modes

1. **Server Unavailable**
   - Log warning
   - Return null/cached data
   - Continue agent execution

2. **Request Timeout**
   - Retry with exponential backoff (3 attempts)
   - Fall back to cached data
   - Log timeout event

3. **Invalid Response**
   - Validate response schema
   - Return error to agent
   - Cache failure for rate limiting

4. **Network Errors**
   - Detect network issues
   - Use cached data if available
   - Disable server temporarily

### Fallback Strategy

```typescript
class MCPClient {
  async query(request: MCPRequest): Promise<MCPResponse> {
    try {
      // Try cache first
      const cached = await this.cache.get(request);
      if (cached && !this.isCacheStale(cached)) {
        return cached;
      }

      // Try MCP server
      const response = await this.sendRequest(request);
      await this.cache.set(request, response);
      return response;

    } catch (error) {
      // Fall back to stale cache
      const stale = await this.cache.get(request);
      if (stale) {
        this.logger.warn('Using stale cache due to error', error);
        return stale;
      }

      // No cache available
      throw new MCPError('Query failed and no cache available', error);
    }
  }
}
```

## Testing Strategy

### Unit Tests

1. **Client Tests**
   - Connection/disconnection
   - Request/response cycle
   - Error handling
   - Retry logic
   - Health checks

2. **Adapter Tests**
   - GitHub adapter methods
   - npm adapter methods
   - Response parsing
   - Error scenarios

3. **Cache Tests**
   - Set/get operations
   - TTL expiration
   - Size limits
   - Invalidation
   - Concurrency

### Integration Tests

1. **End-to-End Flow**
   - Mock MCP servers
   - Full query cycle
   - Cache behavior
   - Fallback scenarios

2. **BaseAgent Integration**
   - MCP initialization
   - Query methods
   - Error handling
   - Graceful degradation

### Mock Servers

Create mock MCP servers for testing:
```typescript
class MockMCPServer {
  async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    // Return mock data based on request
  }
}
```

## Performance Considerations

### Caching Strategy

- **Memory cache:** Fast access for frequently used data
- **Redis cache:** Persistent across agent restarts
- **Cache warming:** Pre-fetch common queries on startup
- **Cache invalidation:** TTL-based with manual invalidation support

### Request Optimization

- **Batch requests:** Combine multiple queries when possible
- **Parallel queries:** Use Promise.all for independent requests
- **Timeout management:** Short timeouts to prevent blocking
- **Circuit breaker:** Disable failing servers temporarily

### Resource Management

- **Connection pooling:** Reuse HTTP connections
- **Memory limits:** Bounded cache sizes
- **Request throttling:** Rate limiting per server
- **Background cleanup:** Periodic cache pruning

## Security Considerations

### Input Validation

- Sanitize all query parameters
- Validate server URLs
- Prevent command injection in stdio transport
- Limit request size

### Access Control

- No direct access to MCP credentials
- Server configurations in secure config files
- Environment-based server selection
- Audit logging for queries

### Data Privacy

- No logging of sensitive data
- Cached data encryption (if needed)
- Clear cache on shutdown
- Respect server rate limits

## Success Criteria

- [ ] MCP client connects to configured servers
- [ ] GitHub documentation queries work correctly
- [ ] npm package info retrieval functional
- [ ] Caching reduces redundant queries by >80%
- [ ] Fallback mechanisms handle server failures gracefully
- [ ] Test coverage >90%
- [ ] Integration with BaseAgent complete
- [ ] Documentation comprehensive
- [ ] No blocking on MCP failures

## Future Enhancements

### Phase 2 (Post-PR)

1. **Additional Adapters**
   - MDN web API documentation
   - Stack Overflow integration
   - Language-specific docs (Python, Go, etc.)
   - Custom documentation sources

2. **Advanced Caching**
   - Predictive cache warming
   - Smart invalidation based on versions
   - Distributed cache for multi-agent
   - Cache analytics

3. **Enhanced Features**
   - Query result ranking
   - Related documentation suggestions
   - Documentation versioning
   - Offline documentation fallback

## Risk Mitigation

### Risk: MCP Server Unavailability

**Mitigation:**
- Comprehensive fallback to cached data
- Graceful degradation to agent default behavior
- Health check before critical operations
- User notification of degraded mode

### Risk: Performance Impact

**Mitigation:**
- Aggressive caching strategy
- Short timeout values
- Async/non-blocking operations
- Circuit breaker pattern

### Risk: Breaking Changes in MCP SDK

**Mitigation:**
- Pin SDK version in package.json
- Adapter pattern isolates changes
- Comprehensive test suite
- Version compatibility checking

## Implementation Notes

### MCP Server Setup

For development and testing, agents will need access to MCP servers. We'll document:

1. **Local Development:**
   - How to run GitHub MCP server locally
   - How to run npm MCP server locally
   - Mock server for testing

2. **Production:**
   - Recommended MCP server deployments
   - Cloud-hosted options
   - Self-hosted configuration

3. **Optional:**
   - MCP is optional, agents work without it
   - Fallback to default behavior
   - Configuration to disable MCP

### TypeScript SDK Usage

The official `@modelcontextprotocol/sdk` package will be used:
- Install via npm
- Use official transports (stdio, HTTP)
- Follow SDK best practices
- Keep SDK updated

## Timeline

- **Phase 1:** Core MCP client (15 min)
- **Phase 2:** Server configuration (10 min)
- **Phase 3:** GitHub adapter (10 min)
- **Phase 4:** npm adapter (10 min)
- **Phase 5:** Caching layer (10 min)
- **Phase 6:** Testing (5 min)

**Total:** 60 minutes (as estimated in task list)

## Acceptance Criteria

From task list (PR-022):
- [ ] MCP client connects to servers
- [ ] GitHub documentation queries work
- [ ] npm package info retrieval works
- [ ] MDN web API queries work (optional - if server available)
- [ ] Caching implemented
- [ ] Fallback for unavailable servers

## Dependencies

- **PR-011:** BaseAgent class (completed)
- **Package:** `@modelcontextprotocol/sdk` (to be added)
- **Infrastructure:** Redis for caching (from PR-004)

## References

- [MCP Official Documentation](https://modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [Anthropic MCP Announcement](https://www.anthropic.com/news/model-context-protocol)
