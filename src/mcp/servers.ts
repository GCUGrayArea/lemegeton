/**
 * MCP Server Configurations
 *
 * Default configurations for common MCP servers.
 */

import { MCPServerConfig, MCPServerRegistry } from './types';

/**
 * Default server configurations
 */
export const DEFAULT_SERVERS: Record<string, MCPServerConfig> = {
  github: {
    name: 'github',
    transport: 'http',
    url: process.env.MCP_GITHUB_URL || 'http://localhost:3000',
    enabled: process.env.MCP_GITHUB_ENABLED !== 'false',
    timeout: 10000,
  },

  npm: {
    name: 'npm',
    transport: 'http',
    url: process.env.MCP_NPM_URL || 'http://localhost:3001',
    enabled: process.env.MCP_NPM_ENABLED !== 'false',
    timeout: 10000,
  },

  mdn: {
    name: 'mdn',
    transport: 'http',
    url: process.env.MCP_MDN_URL || 'http://localhost:3002',
    enabled: process.env.MCP_MDN_ENABLED === 'true', // Optional, disabled by default
    timeout: 10000,
  },
};

/**
 * Get default server registry
 */
export function getDefaultServerRegistry(): MCPServerRegistry {
  return {
    servers: {
      github: DEFAULT_SERVERS.github,
      npm: DEFAULT_SERVERS.npm,
      mdn: DEFAULT_SERVERS.mdn,
      custom: [],
    },
  };
}

/**
 * Load server configuration from environment
 */
export function loadServerConfig(): MCPServerConfig[] {
  const servers: MCPServerConfig[] = [];

  // Add GitHub server if enabled
  if (DEFAULT_SERVERS.github.enabled) {
    servers.push(DEFAULT_SERVERS.github);
  }

  // Add npm server if enabled
  if (DEFAULT_SERVERS.npm.enabled) {
    servers.push(DEFAULT_SERVERS.npm);
  }

  // Add MDN server if enabled
  if (DEFAULT_SERVERS.mdn.enabled) {
    servers.push(DEFAULT_SERVERS.mdn);
  }

  // Add custom servers from environment
  const customServers = loadCustomServers();
  servers.push(...customServers);

  return servers;
}

/**
 * Load custom server configurations from environment
 */
function loadCustomServers(): MCPServerConfig[] {
  const servers: MCPServerConfig[] = [];

  // Check for custom server environment variables
  // Format: MCP_CUSTOM_SERVER_N_NAME, MCP_CUSTOM_SERVER_N_URL, etc.
  let index = 1;
  while (true) {
    const name = process.env[`MCP_CUSTOM_SERVER_${index}_NAME`];
    if (!name) break;

    const transport = (process.env[`MCP_CUSTOM_SERVER_${index}_TRANSPORT`] ||
      'http') as 'http' | 'stdio';
    const url = process.env[`MCP_CUSTOM_SERVER_${index}_URL`];
    const command = process.env[`MCP_CUSTOM_SERVER_${index}_COMMAND`];
    const enabled =
      process.env[`MCP_CUSTOM_SERVER_${index}_ENABLED`] !== 'false';

    if (transport === 'http' && !url) {
      console.warn(
        `Custom server ${name} configured as HTTP but no URL provided, skipping`
      );
      index++;
      continue;
    }

    if (transport === 'stdio' && !command) {
      console.warn(
        `Custom server ${name} configured as stdio but no command provided, skipping`
      );
      index++;
      continue;
    }

    servers.push({
      name,
      transport,
      url,
      command,
      enabled,
      timeout: 10000,
    });

    index++;
  }

  return servers;
}

/**
 * Validate server configuration
 */
export function validateServerConfig(config: MCPServerConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config.name) {
    errors.push('Server name is required');
  }

  if (!config.transport) {
    errors.push('Server transport is required');
  } else if (config.transport !== 'http' && config.transport !== 'stdio') {
    errors.push('Server transport must be "http" or "stdio"');
  }

  if (config.transport === 'http' && !config.url) {
    errors.push('HTTP server requires a URL');
  }

  if (config.transport === 'stdio' && !config.command) {
    errors.push('stdio server requires a command');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Merge custom configuration with defaults
 */
export function mergeServerConfig(
  defaults: MCPServerConfig,
  custom: Partial<MCPServerConfig>
): MCPServerConfig {
  return {
    ...defaults,
    ...custom,
    // Ensure required fields are not undefined
    name: custom.name || defaults.name,
    transport: custom.transport || defaults.transport,
    enabled: custom.enabled !== undefined ? custom.enabled : defaults.enabled,
  };
}
