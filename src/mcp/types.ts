/**
 * MCP (Model Context Protocol) Types
 *
 * Type definitions for MCP client, servers, requests, and responses.
 */

/**
 * Transport types supported by MCP
 */
export type MCPTransport = 'stdio' | 'http';

/**
 * MCP Server configuration
 */
export interface MCPServerConfig {
  /** Server name/identifier */
  name: string;

  /** Transport type */
  transport: MCPTransport;

  /** Server URL (for HTTP transport) */
  url?: string;

  /** Command to execute (for stdio transport) */
  command?: string;

  /** Command arguments (for stdio transport) */
  args?: string[];

  /** Environment variables */
  env?: Record<string, string>;

  /** Enable/disable this server */
  enabled?: boolean;

  /** Connection timeout in ms */
  timeout?: number;
}

/**
 * MCP Server registry containing all configured servers
 */
export interface MCPServerRegistry {
  servers: {
    github?: MCPServerConfig;
    npm?: MCPServerConfig;
    mdn?: MCPServerConfig;
    custom?: MCPServerConfig[];
  };
}

/**
 * MCP Tool definition
 */
export interface MCPTool {
  /** Tool name */
  name: string;

  /** Tool description */
  description: string;

  /** Input schema */
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * MCP Request
 */
export interface MCPRequest {
  /** Tool to call */
  tool: string;

  /** Tool parameters */
  parameters: Record<string, any>;

  /** Request timeout in ms */
  timeout?: number;

  /** Request metadata */
  metadata?: {
    /** Request ID for tracking */
    requestId?: string;

    /** Agent ID making the request */
    agentId?: string;

    /** Timestamp */
    timestamp?: number;
  };
}

/**
 * MCP Response
 */
export interface MCPResponse<T = any> {
  /** Response content */
  content: T;

  /** Response metadata */
  metadata?: {
    /** Source server name */
    source: string;

    /** Response timestamp */
    timestamp: number;

    /** Whether response was cached */
    cached: boolean;

    /** Cache age in ms (if cached) */
    cacheAge?: number;

    /** Request duration in ms */
    duration?: number;
  };

  /** Error information (if request failed) */
  error?: MCPError;
}

/**
 * MCP Error
 */
export interface MCPError {
  /** Error code */
  code: string;

  /** Error message */
  message: string;

  /** Error details */
  details?: any;

  /** Stack trace (in development) */
  stack?: string;
}

/**
 * Cache configuration
 */
export interface MCPCacheConfig {
  /** Enable/disable caching */
  enabled: boolean;

  /** TTL per server (in seconds) */
  ttl: {
    github?: number;
    npm?: number;
    mdn?: number;
    default: number;
  };

  /** Maximum cache size in bytes */
  maxSize: number;

  /** Use Redis for persistent cache */
  useRedis?: boolean;
}

/**
 * Cache entry
 */
export interface MCPCacheEntry<T = any> {
  /** Cached data */
  data: T;

  /** Cache timestamp */
  timestamp: number;

  /** TTL in seconds */
  ttl: number;

  /** Entry size in bytes */
  size: number;
}

/**
 * MCP Client configuration
 */
export interface MCPClientConfig {
  /** Server configurations */
  servers: MCPServerConfig[];

  /** Cache configuration */
  cache?: MCPCacheConfig;

  /** Fallback configuration */
  fallback?: {
    /** Enable fallback to cached data */
    enabled: boolean;

    /** Allow stale cache on errors */
    allowStale: boolean;

    /** Return null on failure (vs throwing) */
    graceful: boolean;
  };

  /** Retry configuration */
  retry?: {
    /** Maximum retry attempts */
    maxAttempts: number;

    /** Initial delay in ms */
    initialDelay: number;

    /** Backoff multiplier */
    backoffMultiplier: number;

    /** Maximum delay in ms */
    maxDelay: number;
  };
}

/**
 * Server health status
 */
export interface MCPServerHealth {
  /** Server name */
  server: string;

  /** Is server available */
  available: boolean;

  /** Last successful connection timestamp */
  lastSuccess?: number;

  /** Last failed connection timestamp */
  lastFailure?: number;

  /** Consecutive failures */
  failureCount: number;

  /** Average response time in ms */
  avgResponseTime?: number;
}

/**
 * MCP Client statistics
 */
export interface MCPClientStats {
  /** Total requests made */
  totalRequests: number;

  /** Successful requests */
  successfulRequests: number;

  /** Failed requests */
  failedRequests: number;

  /** Cache hits */
  cacheHits: number;

  /** Cache misses */
  cacheMisses: number;

  /** Average response time in ms */
  avgResponseTime: number;

  /** Server health statuses */
  servers: MCPServerHealth[];
}

/**
 * GitHub repository information
 */
export interface GitHubRepository {
  owner: string;
  name: string;
  fullName: string;
  description?: string;
  url: string;
  homepage?: string;
  language?: string;
  stars: number;
  forks: number;
  topics?: string[];
  license?: string;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * npm package information
 */
export interface NpmPackage {
  name: string;
  version: string;
  description?: string;
  author?: string;
  license?: string;
  homepage?: string;
  repository?: {
    type: string;
    url: string;
  };
  keywords?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  publishedAt: string;
  downloads?: {
    weekly: number;
    monthly: number;
  };
}

/**
 * npm package versions
 */
export interface NpmVersions {
  package: string;
  latest: string;
  versions: string[];
  distTags: Record<string, string>;
}
