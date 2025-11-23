/**
 * MCP Client
 *
 * Core client for connecting to MCP servers and making requests.
 */

import { EventEmitter } from 'events';
import {
  MCPClientConfig,
  MCPServerConfig,
  MCPRequest,
  MCPResponse,
  MCPTool,
  MCPServerHealth,
  MCPClientStats,
  MCPError,
} from './types';
import { MCPCache } from './cache';
import { RetryManager } from './utils/retry';

/**
 * Maximum number of consecutive failures before marking server as unavailable
 */
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * MCP Client operation mode
 */
export type MCPClientMode = 'production' | 'stub';

/**
 * MCP Client for making requests to MCP servers
 *
 * NOTE: Currently running in stub mode by default as the MCP SDK
 * has not been integrated yet. Set mode='production' when ready.
 */
export class MCPClient extends EventEmitter {
  private readonly mode: MCPClientMode;
  private config: MCPClientConfig;
  private cache: MCPCache;
  private retry: RetryManager;
  private servers: Map<string, MCPServerConfig>;
  private serverHealth: Map<string, MCPServerHealth>;
  private stats: MCPClientStats;
  private connected: boolean = false;

  constructor(config: MCPClientConfig, mode: MCPClientMode = 'stub') {
    super();
    this.mode = mode;
    this.config = config;
    this.cache = new MCPCache(config.cache);
    this.retry = new RetryManager(config.retry);
    this.servers = new Map();
    this.serverHealth = new Map();
    this.stats = this.initializeStats();

    // Warn if running in stub mode
    if (this.mode === 'stub') {
      console.warn('[MCPClient] Running in stub mode - MCP SDK not integrated. Real server communication disabled.');
    }

    // Register servers
    for (const server of config.servers) {
      if (server.enabled !== false) {
        this.servers.set(server.name, server);
        this.serverHealth.set(server.name, {
          server: server.name,
          available: false,
          failureCount: 0,
        });
      }
    }
  }

  /**
   * Get the current operation mode
   */
  getMode(): MCPClientMode {
    return this.mode;
  }

  /**
   * Connect to all configured MCP servers
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    const connectionPromises = Array.from(this.servers.values()).map(
      async (server) => {
        try {
          await this.connectToServer(server);
          this.updateServerHealth(server.name, true);
          this.emit('serverConnected', server.name);
        } catch (error) {
          this.updateServerHealth(server.name, false);
          this.emit('serverConnectionFailed', server.name, error);
          // Don't throw - graceful degradation
          throw error;
        }
      }
    );

    const results = await Promise.allSettled(connectionPromises);

    // Check connection results
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length === this.servers.size) {
      // All servers failed
      throw new Error('Failed to connect to all MCP servers');
    }

    if (failures.length > 0) {
      // Some servers failed
      this.emit('partialConnection', {
        successful: results.length - failures.length,
        failed: failures.length,
      });
    }

    this.connected = true;
    this.emit('connected');
  }

  /**
   * Disconnect from all MCP servers
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    const disconnectionPromises = Array.from(this.servers.values()).map(
      async (server) => {
        try {
          await this.disconnectFromServer(server);
          this.emit('serverDisconnected', server.name);
        } catch (error) {
          this.emit('serverDisconnectionFailed', server.name, error);
        }
      }
    );

    await Promise.allSettled(disconnectionPromises);
    this.connected = false;
    this.emit('disconnected');
  }

  /**
   * Query an MCP server
   */
  async query<T = any>(request: MCPRequest): Promise<MCPResponse<T>> {
    const startTime = Date.now();
    this.stats.totalRequests++;

    try {
      // Try cache first
      const cached = await this.cache.get<T>(request);
      if (cached && this.isCacheFresh(cached)) {
        this.stats.cacheHits++;
        return {
          content: cached.data,
          metadata: {
            source: 'cache',
            timestamp: Date.now(),
            cached: true,
            cacheAge: Date.now() - cached.timestamp,
            duration: Date.now() - startTime,
          },
        };
      }

      this.stats.cacheMisses++;

      // Find appropriate server for this tool
      const server = this.findServerForTool(request.tool);
      if (!server) {
        throw this.createError(
          'NO_SERVER',
          `No server configured for tool: ${request.tool}`
        );
      }

      // Check server health
      const health = this.serverHealth.get(server.name);
      if (health && !health.available) {
        // Try stale cache as fallback
        if (cached && this.config.fallback?.allowStale) {
          return {
            content: cached.data,
            metadata: {
              source: server.name,
              timestamp: Date.now(),
              cached: true,
              cacheAge: Date.now() - cached.timestamp,
              duration: Date.now() - startTime,
            },
          };
        }

        throw this.createError(
          'SERVER_UNAVAILABLE',
          `Server ${server.name} is unavailable`
        );
      }

      // Make request with retry
      const response = await this.retry.execute(async () => {
        return await this.sendRequest<T>(server, request);
      });

      // Cache successful response
      await this.cache.set(request, response.content);

      // Update stats
      this.stats.successfulRequests++;
      this.updateServerHealth(server.name, true);
      this.updateResponseTime(Date.now() - startTime);

      return {
        ...response,
        metadata: {
          source: response.metadata?.source || server.name,
          timestamp: response.metadata?.timestamp || Date.now(),
          cached: response.metadata?.cached || false,
          cacheAge: response.metadata?.cacheAge,
          duration: Date.now() - startTime,
        },
      };
    } catch (error) {
      this.stats.failedRequests++;

      // Try stale cache as last resort
      const cached = await this.cache.get<T>(request);
      if (cached && this.config.fallback?.allowStale) {
        return {
          content: cached.data,
          metadata: {
            source: 'stale-cache',
            timestamp: Date.now(),
            cached: true,
            cacheAge: Date.now() - cached.timestamp,
            duration: Date.now() - startTime,
          },
        };
      }

      // Graceful failure or throw
      if (this.config.fallback?.graceful) {
        return {
          content: null as any,
          error: this.normalizeError(error),
          metadata: {
            source: 'error',
            timestamp: Date.now(),
            cached: false,
            duration: Date.now() - startTime,
          },
        };
      }

      throw error;
    }
  }

  /**
   * List available tools from all servers
   */
  async listTools(serverName?: string): Promise<MCPTool[]> {
    const tools: MCPTool[] = [];

    const serversToQuery = serverName
      ? [this.servers.get(serverName)].filter(Boolean)
      : Array.from(this.servers.values());

    for (const server of serversToQuery as MCPServerConfig[]) {
      try {
        const serverTools = await this.listServerTools(server);
        tools.push(...serverTools);
      } catch (error) {
        this.emit('toolListError', server.name, error);
        // Continue with other servers
      }
    }

    return tools;
  }

  /**
   * Call a specific tool
   */
  async callTool<T = any>(
    toolName: string,
    args: Record<string, any>
  ): Promise<T> {
    const response = await this.query<T>({
      tool: toolName,
      parameters: args,
    });

    if (response.error) {
      throw new Error(`Tool call failed: ${response.error.message}`);
    }

    return response.content;
  }

  /**
   * Get client statistics
   */
  getStats(): MCPClientStats {
    return {
      ...this.stats,
      servers: Array.from(this.serverHealth.values()),
    };
  }

  /**
   * Get server health status
   */
  getServerHealth(serverName: string): MCPServerHealth | undefined {
    return this.serverHealth.get(serverName);
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  // Private methods

  /**
   * Connect to a specific server
   */
  private async connectToServer(server: MCPServerConfig): Promise<void> {
    if (this.mode === 'stub') {
      return this.connectToServerStub(server);
    }
    return this.connectToServerProduction(server);
  }

  /**
   * Stub implementation of server connection
   */
  private async connectToServerStub(server: MCPServerConfig): Promise<void> {
    // Validate configuration only
    if (server.transport === 'http' && !server.url) {
      throw new Error(`HTTP server ${server.name} requires a URL`);
    }
    if (server.transport === 'stdio' && !server.command) {
      throw new Error(`stdio server ${server.name} requires a command`);
    }
    // Connection successful (stub - no actual connection)
    return Promise.resolve();
  }

  /**
   * Production implementation of server connection
   */
  private async connectToServerProduction(server: MCPServerConfig): Promise<void> {
    // TODO: Implement with MCP SDK
    // For HTTP: establish connection and verify server is reachable
    // For stdio: spawn process and establish communication
    throw new Error('Production MCP connection not yet implemented - MCP SDK integration pending');
  }

  /**
   * Disconnect from a specific server
   */
  private async disconnectFromServer(server: MCPServerConfig): Promise<void> {
    if (this.mode === 'stub') {
      return Promise.resolve();
    }
    // TODO: Implement production disconnect with MCP SDK
    // Close HTTP connections or kill stdio processes
    return Promise.resolve();
  }

  /**
   * Send request to server
   */
  private async sendRequest<T>(
    server: MCPServerConfig,
    request: MCPRequest
  ): Promise<MCPResponse<T>> {
    if (this.mode === 'stub') {
      return this.sendRequestStub<T>(server, request);
    }
    return this.sendRequestProduction<T>(server, request);
  }

  /**
   * Stub implementation of request sending
   */
  private async sendRequestStub<T>(
    server: MCPServerConfig,
    request: MCPRequest
  ): Promise<MCPResponse<T>> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 100));

    // Return mock response for testing
    return {
      content: {} as T,
      metadata: {
        source: server.name,
        timestamp: Date.now(),
        cached: false,
      },
    };
  }

  /**
   * Production implementation of request sending
   */
  private async sendRequestProduction<T>(
    server: MCPServerConfig,
    request: MCPRequest
  ): Promise<MCPResponse<T>> {
    // TODO: Implement with MCP SDK
    // Use MCP SDK to send actual requests to servers
    throw new Error('Production MCP requests not yet implemented - MCP SDK integration pending');
  }

  /**
   * List tools from a specific server
   */
  private async listServerTools(server: MCPServerConfig): Promise<MCPTool[]> {
    if (this.mode === 'stub') {
      // Stub: return empty list
      return [];
    }
    // TODO: Implement with MCP SDK to list available tools
    return [];
  }

  /**
   * Find appropriate server for a tool
   */
  private findServerForTool(toolName: string): MCPServerConfig | null {
    // Determine which server handles this tool
    // GitHub tools: github server
    // npm tools: npm server
    // etc.

    if (toolName.startsWith('github')) {
      return this.servers.get('github') ?? null;
    } else if (toolName.startsWith('npm')) {
      return this.servers.get('npm') ?? null;
    } else if (toolName.startsWith('mdn')) {
      return this.servers.get('mdn') ?? null;
    }

    // Try first available server as fallback
    const servers = Array.from(this.servers.values());
    return servers.length > 0 ? servers[0] : null;
  }

  /**
   * Update server health status
   */
  private updateServerHealth(serverName: string, success: boolean): void {
    const health = this.serverHealth.get(serverName);
    if (!health) return;

    if (success) {
      health.available = true;
      health.lastSuccess = Date.now();
      health.failureCount = 0;
    } else {
      health.lastFailure = Date.now();
      health.failureCount++;

      // Mark unavailable after consecutive failures
      if (health.failureCount >= MAX_CONSECUTIVE_FAILURES) {
        health.available = false;
        this.emit('serverUnavailable', serverName);
      }
    }

    this.serverHealth.set(serverName, health);
  }

  /**
   * Update average response time
   */
  private updateResponseTime(duration: number): void {
    const totalResponses = this.stats.successfulRequests + this.stats.failedRequests;
    this.stats.avgResponseTime =
      (this.stats.avgResponseTime * (totalResponses - 1) + duration) /
      totalResponses;
  }

  /**
   * Check if cached data is fresh
   */
  private isCacheFresh(cached: any): boolean {
    if (!cached || !cached.timestamp || !cached.ttl) {
      return false;
    }

    const age = Date.now() - cached.timestamp;
    return age < cached.ttl * 1000;
  }

  /**
   * Create standardized error
   */
  private createError(code: string, message: string): MCPError {
    return {
      code,
      message,
      details: null,
    };
  }

  /**
   * Normalize error to MCPError
   */
  private normalizeError(error: any): MCPError {
    if (typeof error === 'object' && error.code && error.message) {
      return error as MCPError;
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: error?.message || String(error),
      details: error,
    };
  }

  /**
   * Initialize statistics
   */
  private initializeStats(): MCPClientStats {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      avgResponseTime: 0,
      servers: [],
    };
  }
}
