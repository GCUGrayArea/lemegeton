/**
 * MCP (Model Context Protocol) Integration
 *
 * Main exports for MCP client and adapters.
 */

// Core client
export { MCPClient } from './client';
export { MCPCache } from './cache';

// Adapters
export { BaseMCPAdapter } from './adapters/base';
export { GitHubAdapter } from './adapters/github';
export { NpmAdapter } from './adapters/npm';

// Server configuration
export {
  DEFAULT_SERVERS,
  getDefaultServerRegistry,
  loadServerConfig,
  validateServerConfig,
  mergeServerConfig,
} from './servers';

// Types
export * from './types';

// Utilities
export { RetryManager } from './utils/retry';
