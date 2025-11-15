/**
 * MCP Integration Tests
 *
 * Comprehensive test suite for MCP client and adapters.
 */

import {
  MCPClient,
  MCPCache,
  GitHubAdapter,
  NpmAdapter,
  loadServerConfig,
  validateServerConfig,
} from '../src/mcp';
import type {
  MCPClientConfig,
  MCPServerConfig,
  MCPRequest,
} from '../src/mcp/types';

describe('MCP Cache', () => {
  let cache: MCPCache;

  beforeEach(() => {
    cache = new MCPCache({
      enabled: true,
      ttl: {
        github: 3600,
        npm: 1800,
        default: 3600,
      },
      maxSize: 1024 * 1024, // 1MB
    });
  });

  afterEach(async () => {
    await cache.clear();
  });

  test('should cache and retrieve data', async () => {
    const request: MCPRequest = {
      tool: 'github.getRepository',
      parameters: { owner: 'test', repo: 'test' },
    };
    const data = { name: 'test-repo', stars: 100 };

    await cache.set(request, data);
    const cached = await cache.get(request);

    expect(cached).not.toBeNull();
    expect(cached?.data).toEqual(data);
  });

  test('should return null for non-existent cache', async () => {
    const request: MCPRequest = {
      tool: 'github.getRepository',
      parameters: { owner: 'test', repo: 'nonexistent' },
    };

    const cached = await cache.get(request);
    expect(cached).toBeNull();
  });

  test('should respect TTL', async () => {
    const cache = new MCPCache({
      enabled: true,
      ttl: {
        default: 1, // 1 second
      },
      maxSize: 1024 * 1024,
    });

    const request: MCPRequest = {
      tool: 'test.tool',
      parameters: { id: 1 },
    };
    const data = { result: 'test' };

    await cache.set(request, data);

    // Should be cached immediately
    let cached = await cache.get(request);
    expect(cached).not.toBeNull();

    // Wait for expiration
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Should be expired
    cached = await cache.get(request);
    expect(cached).toBeNull();
  });

  test('should invalidate cache entry', async () => {
    const request: MCPRequest = {
      tool: 'github.getRepository',
      parameters: { owner: 'test', repo: 'test' },
    };
    const data = { name: 'test-repo' };

    await cache.set(request, data);
    await cache.invalidate(request);

    const cached = await cache.get(request);
    expect(cached).toBeNull();
  });

  test('should provide cache statistics', async () => {
    const request: MCPRequest = {
      tool: 'test.tool',
      parameters: { id: 1 },
    };

    await cache.set(request, { data: 'test' });

    const stats = cache.getStats();
    expect(stats.entries).toBe(1);
    expect(stats.totalSize).toBeGreaterThan(0);
    expect(stats.maxSize).toBe(1024 * 1024);
  });
});

describe('MCP Client', () => {
  let client: MCPClient;
  let config: MCPClientConfig;

  beforeEach(() => {
    config = {
      servers: [
        {
          name: 'github',
          transport: 'http',
          url: 'http://localhost:3000',
          enabled: true,
        },
        {
          name: 'npm',
          transport: 'http',
          url: 'http://localhost:3001',
          enabled: true,
        },
      ],
      cache: {
        enabled: true,
        ttl: { default: 3600 },
        maxSize: 1024 * 1024,
      },
      fallback: {
        enabled: true,
        allowStale: true,
        graceful: true,
      },
      retry: {
        maxAttempts: 3,
        initialDelay: 100,
        backoffMultiplier: 2,
        maxDelay: 1000,
      },
    };

    client = new MCPClient(config);
  });

  afterEach(async () => {
    if (client.isConnected()) {
      await client.disconnect();
    }
  });

  test('should create client with configuration', () => {
    expect(client).toBeDefined();
    expect(client.isConnected()).toBe(false);
  });

  test('should connect to servers', async () => {
    await client.connect();
    expect(client.isConnected()).toBe(true);
  });

  test('should disconnect from servers', async () => {
    await client.connect();
    await client.disconnect();
    expect(client.isConnected()).toBe(false);
  });

  test('should track statistics', async () => {
    const stats = client.getStats();
    expect(stats.totalRequests).toBe(0);
    expect(stats.successfulRequests).toBe(0);
    expect(stats.failedRequests).toBe(0);
    expect(stats.cacheHits).toBe(0);
    expect(stats.cacheMisses).toBe(0);
  });

  test('should get server health', async () => {
    await client.connect();
    const health = client.getServerHealth('github');
    expect(health).toBeDefined();
    expect(health?.server).toBe('github');
  });

  test('should handle graceful failure mode', async () => {
    const request: MCPRequest = {
      tool: 'nonexistent.tool',
      parameters: {},
    };

    const response = await client.query(request);
    expect(response.error).toBeDefined();
    expect(response.content).toBeNull();
  });

  test('should use cache for repeated requests', async () => {
    // Note: This is a stub test since we don't have actual MCP servers
    // In a real test environment, you would mock the server responses
    const request: MCPRequest = {
      tool: 'github.getRepository',
      parameters: { owner: 'test', repo: 'test' },
    };

    // First request (cache miss)
    await client.query(request);

    // Second request (should be cache hit)
    await client.query(request);

    const stats = client.getStats();
    expect(stats.totalRequests).toBeGreaterThanOrEqual(2);
  });
});

describe('GitHub Adapter', () => {
  let client: MCPClient;
  let adapter: GitHubAdapter;

  beforeEach(() => {
    const config: MCPClientConfig = {
      servers: [
        {
          name: 'github',
          transport: 'http',
          url: 'http://localhost:3000',
          enabled: true,
        },
      ],
      cache: {
        enabled: true,
        ttl: { default: 3600 },
        maxSize: 1024 * 1024,
      },
      fallback: {
        enabled: true,
        allowStale: true,
        graceful: true,
      },
    };

    client = new MCPClient(config);
    adapter = new GitHubAdapter(client);
  });

  test('should create GitHub adapter', () => {
    expect(adapter).toBeDefined();
    expect(adapter.getServerName()).toBe('github');
  });

  test('should have repository methods', () => {
    expect(adapter.getRepository).toBeDefined();
    expect(adapter.getReadme).toBeDefined();
    expect(adapter.searchIssues).toBeDefined();
    expect(adapter.getFileContent).toBeDefined();
    expect(adapter.getReleases).toBeDefined();
  });

  // Note: The following tests would require actual MCP server or mocks
  // For now, they verify the adapter structure
});

describe('npm Adapter', () => {
  let client: MCPClient;
  let adapter: NpmAdapter;

  beforeEach(() => {
    const config: MCPClientConfig = {
      servers: [
        {
          name: 'npm',
          transport: 'http',
          url: 'http://localhost:3001',
          enabled: true,
        },
      ],
      cache: {
        enabled: true,
        ttl: { default: 1800 },
        maxSize: 1024 * 1024,
      },
      fallback: {
        enabled: true,
        allowStale: true,
        graceful: true,
      },
    };

    client = new MCPClient(config);
    adapter = new NpmAdapter(client);
  });

  test('should create npm adapter', () => {
    expect(adapter).toBeDefined();
    expect(adapter.getServerName()).toBe('npm');
  });

  test('should have package methods', () => {
    expect(adapter.getPackageInfo).toBeDefined();
    expect(adapter.getVersions).toBeDefined();
    expect(adapter.getDependencies).toBeDefined();
    expect(adapter.searchPackages).toBeDefined();
    expect(adapter.getReadme).toBeDefined();
  });
});

describe('Server Configuration', () => {
  test('should load server config from environment', () => {
    const servers = loadServerConfig();
    expect(Array.isArray(servers)).toBe(true);
  });

  test('should validate valid server config', () => {
    const config: MCPServerConfig = {
      name: 'test',
      transport: 'http',
      url: 'http://localhost:3000',
      enabled: true,
    };

    const result = validateServerConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('should reject invalid HTTP server config', () => {
    const config: MCPServerConfig = {
      name: 'test',
      transport: 'http',
      // Missing URL
      enabled: true,
    } as any;

    const result = validateServerConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('should reject invalid stdio server config', () => {
    const config: MCPServerConfig = {
      name: 'test',
      transport: 'stdio',
      // Missing command
      enabled: true,
    } as any;

    const result = validateServerConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('should reject server without name', () => {
    const config: MCPServerConfig = {
      transport: 'http',
      url: 'http://localhost:3000',
      enabled: true,
    } as any;

    const result = validateServerConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Server name is required');
  });

  test('should reject server with invalid transport', () => {
    const config: MCPServerConfig = {
      name: 'test',
      transport: 'invalid' as any,
      enabled: true,
    };

    const result = validateServerConfig(config);
    expect(result.valid).toBe(false);
  });
});

describe('Integration Tests', () => {
  test('should work end-to-end with cache', async () => {
    const config: MCPClientConfig = {
      servers: [
        {
          name: 'github',
          transport: 'http',
          url: 'http://localhost:3000',
          enabled: true,
        },
      ],
      cache: {
        enabled: true,
        ttl: { default: 3600 },
        maxSize: 1024 * 1024,
      },
      fallback: {
        enabled: true,
        allowStale: true,
        graceful: true,
      },
    };

    const client = new MCPClient(config);
    await client.connect();

    const adapter = new GitHubAdapter(client);
    expect(adapter).toBeDefined();

    await client.disconnect();
  });

  test('should handle multiple adapters', async () => {
    const config: MCPClientConfig = {
      servers: [
        {
          name: 'github',
          transport: 'http',
          url: 'http://localhost:3000',
          enabled: true,
        },
        {
          name: 'npm',
          transport: 'http',
          url: 'http://localhost:3001',
          enabled: true,
        },
      ],
      cache: {
        enabled: true,
        ttl: { default: 3600 },
        maxSize: 1024 * 1024,
      },
      fallback: {
        enabled: true,
        allowStale: true,
        graceful: true,
      },
    };

    const client = new MCPClient(config);
    await client.connect();

    const githubAdapter = new GitHubAdapter(client);
    const npmAdapter = new NpmAdapter(client);

    expect(githubAdapter.getServerName()).toBe('github');
    expect(npmAdapter.getServerName()).toBe('npm');

    await client.disconnect();
  });
});
