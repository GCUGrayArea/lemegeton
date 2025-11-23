/**
 * Main configuration module for Lemegeton
 *
 * This module handles loading configuration from environment variables
 * and .env files, validates the configuration, and provides a singleton
 * instance for use throughout the application.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import {
  LemegetonConfig,
  DEFAULT_CONFIG,
  validateConfig,
  mergeWithDefaults,
  RedisConfig,
  DockerConfig,
  HubConfig,
  AgentConfig,
} from './schema';
import { parseIntSafe, parseFloatSafe } from '../utils/config';

// Re-export types for convenience
export * from './schema';

/**
 * Configuration singleton instance
 */
let configInstance: Required<LemegetonConfig> | null = null;

/**
 * Loads configuration from environment variables
 * @returns Partial configuration object
 */
function loadFromEnvironment(): LemegetonConfig {
  const config: LemegetonConfig = {};

  // Redis configuration
  const redisConfig: RedisConfig = {};

  if (process.env.REDIS_URL) {
    redisConfig.url = process.env.REDIS_URL;
  } else {
    if (process.env.REDIS_HOST) redisConfig.host = process.env.REDIS_HOST;
    if (process.env.REDIS_PORT) {
      redisConfig.port = parseIntSafe(process.env.REDIS_PORT, 6379, 'REDIS_PORT');
    }
  }

  if (process.env.REDIS_DATABASE) {
    redisConfig.database = parseIntSafe(process.env.REDIS_DATABASE, 0, 'REDIS_DATABASE');
  }
  if (process.env.REDIS_CONNECT_TIMEOUT) {
    redisConfig.connectTimeout = parseIntSafe(process.env.REDIS_CONNECT_TIMEOUT, 5000, 'REDIS_CONNECT_TIMEOUT');
  }
  if (process.env.REDIS_AUTO_SPAWN !== undefined) redisConfig.autoSpawn = process.env.REDIS_AUTO_SPAWN === 'true';

  // Redis retry configuration
  if (process.env.REDIS_RETRY_MAX_ATTEMPTS || process.env.REDIS_RETRY_INITIAL_DELAY) {
    redisConfig.retry = {};
    if (process.env.REDIS_RETRY_MAX_ATTEMPTS) {
      redisConfig.retry.maxAttempts = parseIntSafe(
        process.env.REDIS_RETRY_MAX_ATTEMPTS,
        10,
        'REDIS_RETRY_MAX_ATTEMPTS'
      );
    }
    if (process.env.REDIS_RETRY_INITIAL_DELAY) {
      redisConfig.retry.initialDelay = parseIntSafe(
        process.env.REDIS_RETRY_INITIAL_DELAY,
        1000,
        'REDIS_RETRY_INITIAL_DELAY'
      );
    }
    if (process.env.REDIS_RETRY_MAX_DELAY) {
      redisConfig.retry.maxDelay = parseIntSafe(
        process.env.REDIS_RETRY_MAX_DELAY,
        30000,
        'REDIS_RETRY_MAX_DELAY'
      );
    }
    if (process.env.REDIS_RETRY_FACTOR) {
      redisConfig.retry.factor = parseFloatSafe(
        process.env.REDIS_RETRY_FACTOR,
        2,
        'REDIS_RETRY_FACTOR'
      );
    }
  }

  if (Object.keys(redisConfig).length > 0) {
    config.redis = redisConfig;
  }

  // Docker configuration
  const dockerConfig: DockerConfig = {};

  if (process.env.DOCKER_ENABLED !== undefined) dockerConfig.enabled = process.env.DOCKER_ENABLED === 'true';
  if (process.env.DOCKER_REDIS_IMAGE) dockerConfig.redisImage = process.env.DOCKER_REDIS_IMAGE;
  if (process.env.DOCKER_CONTAINER_PREFIX) dockerConfig.containerPrefix = process.env.DOCKER_CONTAINER_PREFIX;
  if (process.env.DOCKER_CLEANUP_ON_EXIT !== undefined) {
    dockerConfig.cleanupOnExit = process.env.DOCKER_CLEANUP_ON_EXIT === 'true';
  }
  if (process.env.DOCKER_SOCKET_PATH) dockerConfig.socketPath = process.env.DOCKER_SOCKET_PATH;

  if (Object.keys(dockerConfig).length > 0) {
    config.docker = dockerConfig;
  }

  // Hub configuration
  const hubConfig: HubConfig = {};

  if (process.env.HUB_API_PORT) {
    hubConfig.apiPort = parseIntSafe(process.env.HUB_API_PORT, 3000, 'HUB_API_PORT');
  }
  if (process.env.HUB_DEBUG !== undefined) hubConfig.debug = process.env.HUB_DEBUG === 'true';
  if (process.env.HUB_WORKING_DIRECTORY) hubConfig.workingDirectory = process.env.HUB_WORKING_DIRECTORY;
  if (process.env.HUB_TASK_LIST_PATH) hubConfig.taskListPath = process.env.HUB_TASK_LIST_PATH;
  if (process.env.HUB_SYNC_INTERVAL) {
    hubConfig.syncInterval = parseIntSafe(process.env.HUB_SYNC_INTERVAL, 30000, 'HUB_SYNC_INTERVAL');
  }

  if (Object.keys(hubConfig).length > 0) {
    config.hub = hubConfig;
  }

  // Agent configuration
  const agentConfig: AgentConfig = {};

  if (process.env.AGENT_MAX_CONCURRENT) {
    agentConfig.maxConcurrent = parseIntSafe(process.env.AGENT_MAX_CONCURRENT, 5, 'AGENT_MAX_CONCURRENT');
  }
  if (process.env.AGENT_HEARTBEAT_INTERVAL) {
    agentConfig.heartbeatInterval = parseIntSafe(process.env.AGENT_HEARTBEAT_INTERVAL, 30000, 'AGENT_HEARTBEAT_INTERVAL');
  }
  if (process.env.AGENT_TIMEOUT) {
    agentConfig.timeout = parseIntSafe(process.env.AGENT_TIMEOUT, 300000, 'AGENT_TIMEOUT');
  }
  if (process.env.AGENT_DEBUG !== undefined) agentConfig.debug = process.env.AGENT_DEBUG === 'true';

  if (Object.keys(agentConfig).length > 0) {
    config.agent = agentConfig;
  }

  // Global configuration
  if (process.env.NODE_ENV) {
    const env = process.env.NODE_ENV.toLowerCase();
    if (env === 'development' || env === 'production' || env === 'test') {
      config.environment = env;
    }
  }

  if (process.env.LOG_LEVEL) {
    const level = process.env.LOG_LEVEL.toLowerCase();
    if (['error', 'warn', 'info', 'debug', 'trace'].includes(level)) {
      config.logLevel = level as 'error' | 'warn' | 'info' | 'debug' | 'trace';
    }
  }

  return config;
}

/**
 * Finds and loads .env file from current or parent directories
 * @param startPath Starting directory path
 * @returns Boolean indicating if .env was loaded
 */
function findAndLoadEnvFile(startPath: string = process.cwd()): boolean {
  let currentPath = startPath;
  const root = path.parse(currentPath).root;

  while (currentPath !== root) {
    const envPath = path.join(currentPath, '.env');
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
      return true;
    }
    currentPath = path.dirname(currentPath);
  }

  return false;
}

/**
 * Loads and validates configuration
 * @param options Configuration options
 * @returns Complete validated configuration
 */
export function loadConfig(options?: {
  /** Skip loading .env file */
  skipEnvFile?: boolean;
  /** Override configuration values */
  overrides?: LemegetonConfig;
}): Required<LemegetonConfig> {
  // Return cached instance if available (unless we have overrides)
  if (configInstance && !options?.overrides) {
    return configInstance;
  }

  // Load .env file unless skipped
  if (!options?.skipEnvFile) {
    findAndLoadEnvFile();
  }

  // Load from environment
  let config = loadFromEnvironment();

  // Apply overrides if provided
  if (options?.overrides) {
    config = { ...config, ...options.overrides };
  }

  // Validate configuration
  const errors = validateConfig(config);
  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n  ${errors.join('\n  ')}`);
  }

  // Merge with defaults
  const finalConfig = mergeWithDefaults(config);

  // Cache the instance (unless we have overrides)
  if (!options?.overrides) {
    configInstance = finalConfig;
  }

  return finalConfig;
}

/**
 * Gets the current configuration instance
 * @returns Current configuration or loads default
 */
export function getConfig(): Required<LemegetonConfig> {
  if (!configInstance) {
    return loadConfig();
  }
  return configInstance;
}

/**
 * Resets the configuration singleton (mainly for testing)
 */
export function resetConfig(): void {
  configInstance = null;
}

/**
 * Creates a Redis connection URL from config
 * @param config Redis configuration
 * @returns Redis connection URL
 */
export function getRedisUrl(config: RedisConfig = getConfig().redis): string {
  if (config.url) {
    return config.url;
  }

  const host = config.host || DEFAULT_CONFIG.redis.host;
  const port = config.port || 6379;
  const db = config.database || 0;

  return `redis://${host}:${port}/${db}`;
}

/**
 * Checks if we should auto-spawn Redis
 * @param config Configuration
 * @returns True if auto-spawn should be attempted
 */
export function shouldAutoSpawnRedis(config: LemegetonConfig = getConfig()): boolean {
  // Check if auto-spawn is enabled
  if (config.redis?.autoSpawn === false) {
    return false;
  }

  // Check if Docker is enabled
  if (config.docker?.enabled === false) {
    return false;
  }

  // In test environment, don't auto-spawn by default
  if (config.environment === 'test' && config.redis?.autoSpawn !== true) {
    return false;
  }

  // Auto-spawn if no URL is configured OR if explicitly enabled
  return !config.redis?.url || config.redis?.autoSpawn === true;
}