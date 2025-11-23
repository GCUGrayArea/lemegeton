/**
 * Configuration schema and validation for Lemegeton
 *
 * This module defines the structure and validation rules for all configuration
 * options. Following the security principle of only storing infrastructure
 * configuration, no API keys or secrets are handled here.
 */

import { mergeConfig } from '../utils/config';

/**
 * Redis connection configuration
 */
export interface RedisConfig {
  /** Redis connection URL (default: redis://localhost:6379) */
  url?: string;

  /** Host for Redis connection (used if url not provided) */
  host?: string;

  /** Port for Redis connection (used if url not provided) */
  port?: number;

  /** Database number to use (default: 0) */
  database?: number;

  /** Connection timeout in milliseconds (default: 5000) */
  connectTimeout?: number;

  /** Enable auto-spawn if Redis unavailable (default: true) */
  autoSpawn?: boolean;

  /** Retry configuration */
  retry?: {
    /** Maximum number of connection attempts (default: 10) */
    maxAttempts?: number;

    /** Initial retry delay in ms (default: 500) */
    initialDelay?: number;

    /** Maximum retry delay in ms (default: 5000) */
    maxDelay?: number;

    /** Exponential backoff factor (default: 2) */
    factor?: number;
  };
}

/**
 * Docker configuration for auto-spawning Redis
 */
export interface DockerConfig {
  /** Enable Docker usage (default: true) */
  enabled?: boolean;

  /** Docker image to use for Redis (default: redis:alpine) */
  redisImage?: string;

  /** Container name prefix (default: lemegeton-redis) */
  containerPrefix?: string;

  /** Clean up containers on shutdown (default: true) */
  cleanupOnExit?: boolean;

  /** Docker socket path (auto-detected if not provided) */
  socketPath?: string;
}

/**
 * Hub configuration
 */
export interface HubConfig {
  /** Port for hub HTTP API (default: 0 for random) */
  apiPort?: number;

  /** Enable debug logging (default: false) */
  debug?: boolean;

  /** Working directory (default: process.cwd()) */
  workingDirectory?: string;

  /** Task list file path (default: docs/task-list.md) */
  taskListPath?: string;

  /** State sync interval in seconds (default: 30) */
  syncInterval?: number;
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  /** Maximum concurrent agents (default: 5) */
  maxConcurrent?: number;

  /** Agent heartbeat interval in seconds (default: 30) */
  heartbeatInterval?: number;

  /** Agent timeout in seconds (default: 300) */
  timeout?: number;

  /** Enable agent debug output (default: false) */
  debug?: boolean;
}

/**
 * Complete configuration structure
 */
export interface LemegetonConfig {
  /** Redis configuration */
  redis?: RedisConfig;

  /** Docker configuration */
  docker?: DockerConfig;

  /** Hub configuration */
  hub?: HubConfig;

  /** Agent configuration */
  agent?: AgentConfig;

  /** Environment (development, production, test) */
  environment?: 'development' | 'production' | 'test';

  /** Log level (error, warn, info, debug, trace) */
  logLevel?: 'error' | 'warn' | 'info' | 'debug' | 'trace';
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Required<LemegetonConfig> = {
  redis: {
    url: undefined,
    host: 'localhost',
    port: 6379,
    database: 0,
    connectTimeout: 5000,
    autoSpawn: true,
    retry: {
      maxAttempts: 10,
      initialDelay: 500,
      maxDelay: 5000,
      factor: 2,
    },
  },
  docker: {
    enabled: true,
    redisImage: 'redis:alpine',
    containerPrefix: 'lemegeton-redis',
    cleanupOnExit: true,
    socketPath: undefined,
  },
  hub: {
    apiPort: 0,
    debug: false,
    workingDirectory: process.cwd(),
    taskListPath: 'docs/task-list.md',
    syncInterval: 30,
  },
  agent: {
    maxConcurrent: 5,
    heartbeatInterval: 30,
    timeout: 300,
    debug: false,
  },
  environment: 'development',
  logLevel: 'info',
};

/**
 * Validates a configuration object
 * @param config Configuration to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateConfig(config: unknown): string[] {
  const errors: string[] = [];

  if (!config || typeof config !== 'object') {
    return ['Configuration must be an object'];
  }

  const cfg = config as LemegetonConfig;

  // Validate Redis config
  if (cfg.redis) {
    if (cfg.redis.port !== undefined) {
      if (!Number.isInteger(cfg.redis.port) || cfg.redis.port < 1 || cfg.redis.port > 65535) {
        errors.push('Redis port must be between 1 and 65535');
      }
    }

    if (cfg.redis.database !== undefined) {
      if (!Number.isInteger(cfg.redis.database) || cfg.redis.database < 0) {
        errors.push('Redis database must be a non-negative integer');
      }
    }

    if (cfg.redis.connectTimeout !== undefined) {
      if (!Number.isInteger(cfg.redis.connectTimeout) || cfg.redis.connectTimeout < 100) {
        errors.push('Redis connect timeout must be at least 100ms');
      }
    }
  }

  // Validate Hub config
  if (cfg.hub) {
    if (cfg.hub.apiPort !== undefined) {
      if (!Number.isInteger(cfg.hub.apiPort) || cfg.hub.apiPort < 0 || cfg.hub.apiPort > 65535) {
        errors.push('Hub API port must be between 0 and 65535');
      }
    }

    if (cfg.hub.syncInterval !== undefined) {
      if (!Number.isInteger(cfg.hub.syncInterval) || cfg.hub.syncInterval < 5) {
        errors.push('Sync interval must be at least 5 seconds');
      }
    }
  }

  // Validate Agent config
  if (cfg.agent) {
    if (cfg.agent.maxConcurrent !== undefined) {
      if (!Number.isInteger(cfg.agent.maxConcurrent) || cfg.agent.maxConcurrent < 1) {
        errors.push('Max concurrent agents must be at least 1');
      }
    }

    if (cfg.agent.heartbeatInterval !== undefined) {
      if (!Number.isInteger(cfg.agent.heartbeatInterval) || cfg.agent.heartbeatInterval < 10) {
        errors.push('Heartbeat interval must be at least 10 seconds');
      }
    }
  }

  // Validate environment
  if (cfg.environment && !['development', 'production', 'test'].includes(cfg.environment)) {
    errors.push('Environment must be development, production, or test');
  }

  // Validate log level
  if (cfg.logLevel && !['error', 'warn', 'info', 'debug', 'trace'].includes(cfg.logLevel)) {
    errors.push('Log level must be error, warn, info, debug, or trace');
  }

  return errors;
}

/**
 * Merges configuration with defaults
 * @param config Partial configuration
 * @returns Complete configuration with defaults
 */
export function mergeWithDefaults(config: LemegetonConfig): Required<LemegetonConfig> {
  return mergeConfig(DEFAULT_CONFIG, config);
}