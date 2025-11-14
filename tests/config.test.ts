/**
 * Tests for configuration module
 */

import {
  loadConfig,
  getConfig,
  resetConfig,
  getRedisUrl,
  shouldAutoSpawnRedis,
  validateConfig,
  mergeWithDefaults,
  DEFAULT_CONFIG,
  LemegetonConfig
} from '../src/config';

describe('Configuration', () => {
  // Save original env
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset configuration and environment before each test
    resetConfig();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    resetConfig();
  });

  describe('loadConfig', () => {
    it('should load default configuration when no env vars set', () => {
      // Clear NODE_ENV to get true defaults
      delete process.env.NODE_ENV;
      const config = loadConfig({ skipEnvFile: true });

      expect(config.redis.host).toBe('localhost');
      expect(config.redis.port).toBe(6379);
      expect(config.redis.autoSpawn).toBe(true);
      expect(config.docker.enabled).toBe(true);
      expect(config.environment).toBe('development');
      expect(config.logLevel).toBe('info');
    });

    it('should load configuration from environment variables', () => {
      process.env.REDIS_HOST = '192.168.1.100';
      process.env.REDIS_PORT = '6380';
      process.env.REDIS_AUTO_SPAWN = 'false';
      process.env.DOCKER_ENABLED = 'false';
      process.env.NODE_ENV = 'production';
      process.env.LOG_LEVEL = 'debug';

      const config = loadConfig({ skipEnvFile: true });

      expect(config.redis.host).toBe('192.168.1.100');
      expect(config.redis.port).toBe(6380);
      expect(config.redis.autoSpawn).toBe(false);
      expect(config.docker.enabled).toBe(false);
      expect(config.environment).toBe('production');
      expect(config.logLevel).toBe('debug');
    });

    it('should prefer REDIS_URL over host/port', () => {
      process.env.REDIS_URL = 'redis://custom:6381/2';
      process.env.REDIS_HOST = 'ignored';
      process.env.REDIS_PORT = '6379';

      const config = loadConfig({ skipEnvFile: true });

      expect(config.redis.url).toBe('redis://custom:6381/2');
      expect(getRedisUrl(config.redis)).toBe('redis://custom:6381/2');
    });

    it('should apply overrides', () => {
      const config = loadConfig({
        skipEnvFile: true,
        overrides: {
          redis: { port: 7000 },
          hub: { debug: true }
        }
      });

      expect(config.redis.port).toBe(7000);
      expect(config.hub.debug).toBe(true);
    });

    it('should cache configuration (singleton)', () => {
      const config1 = loadConfig({ skipEnvFile: true });
      const config2 = getConfig();

      expect(config1).toBe(config2);
    });
  });

  describe('validateConfig', () => {
    it('should accept valid configuration', () => {
      const config: LemegetonConfig = {
        redis: {
          port: 6379,
          database: 0,
          connectTimeout: 5000
        },
        hub: {
          apiPort: 3000,
          syncInterval: 30
        },
        agent: {
          maxConcurrent: 5,
          heartbeatInterval: 30
        },
        environment: 'production',
        logLevel: 'info'
      };

      const errors = validateConfig(config);
      expect(errors).toHaveLength(0);
    });

    it('should reject invalid Redis port', () => {
      const errors = validateConfig({
        redis: { port: 70000 }
      });

      expect(errors).toContain('Redis port must be between 1 and 65535');
    });

    it('should reject negative Redis database', () => {
      const errors = validateConfig({
        redis: { database: -1 }
      });

      expect(errors).toContain('Redis database must be a non-negative integer');
    });

    it('should reject invalid environment', () => {
      const errors = validateConfig({
        environment: 'invalid' as any
      });

      expect(errors).toContain('Environment must be development, production, or test');
    });

    it('should reject invalid log level', () => {
      const errors = validateConfig({
        logLevel: 'verbose' as any
      });

      expect(errors).toContain('Log level must be error, warn, info, debug, or trace');
    });

    it('should reject non-object configuration', () => {
      const errors = validateConfig('invalid' as any);
      expect(errors).toContain('Configuration must be an object');
    });
  });

  describe('mergeWithDefaults', () => {
    it('should merge partial config with defaults', () => {
      const partial: LemegetonConfig = {
        redis: { port: 7000 },
        hub: { debug: true }
      };

      const merged = mergeWithDefaults(partial);

      // Check overridden values
      expect(merged.redis.port).toBe(7000);
      expect(merged.hub.debug).toBe(true);

      // Check default values
      expect(merged.redis.host).toBe('localhost');
      expect(merged.redis.autoSpawn).toBe(true);
      expect(merged.docker.enabled).toBe(true);
      expect(merged.agent.maxConcurrent).toBe(5);
    });

    it('should handle empty configuration', () => {
      const merged = mergeWithDefaults({});

      expect(merged).toEqual(DEFAULT_CONFIG);
    });
  });

  describe('getRedisUrl', () => {
    it('should return configured URL if provided', () => {
      const url = getRedisUrl({
        url: 'redis://custom:6380/1'
      });

      expect(url).toBe('redis://custom:6380/1');
    });

    it('should construct URL from host and port', () => {
      const url = getRedisUrl({
        host: '192.168.1.100',
        port: 6380,
        database: 2
      });

      expect(url).toBe('redis://192.168.1.100:6380/2');
    });

    it('should use defaults for missing values', () => {
      const url = getRedisUrl({});

      expect(url).toBe('redis://localhost:6379/0');
    });
  });

  describe('shouldAutoSpawnRedis', () => {
    it('should return true when auto-spawn enabled and no URL', () => {
      const should = shouldAutoSpawnRedis({
        redis: { autoSpawn: true },
        docker: { enabled: true },
        environment: 'development'
      });

      expect(should).toBe(true);
    });

    it('should return false when auto-spawn disabled', () => {
      const should = shouldAutoSpawnRedis({
        redis: { autoSpawn: false },
        docker: { enabled: true }
      });

      expect(should).toBe(false);
    });

    it('should return false when Docker disabled', () => {
      const should = shouldAutoSpawnRedis({
        redis: { autoSpawn: true },
        docker: { enabled: false }
      });

      expect(should).toBe(false);
    });

    it('should return false in test environment by default', () => {
      const should = shouldAutoSpawnRedis({
        environment: 'test'
      });

      expect(should).toBe(false);
    });

    it('should return true in test if explicitly enabled', () => {
      const should = shouldAutoSpawnRedis({
        redis: { autoSpawn: true },
        environment: 'test'
      });

      expect(should).toBe(true);
    });

    it('should return true even with URL if auto-spawn explicitly enabled', () => {
      const should = shouldAutoSpawnRedis({
        redis: {
          url: 'redis://localhost:6379',
          autoSpawn: true
        }
      });

      expect(should).toBe(true);
    });
  });

  describe('environment variable parsing', () => {
    it('should parse Redis retry configuration', () => {
      process.env.REDIS_RETRY_MAX_ATTEMPTS = '20';
      process.env.REDIS_RETRY_INITIAL_DELAY = '1000';
      process.env.REDIS_RETRY_MAX_DELAY = '10000';
      process.env.REDIS_RETRY_FACTOR = '3';

      const config = loadConfig({ skipEnvFile: true });

      expect(config.redis.retry!.maxAttempts).toBe(20);
      expect(config.redis.retry!.initialDelay).toBe(1000);
      expect(config.redis.retry!.maxDelay).toBe(10000);
      expect(config.redis.retry!.factor).toBe(3);
    });

    it('should parse boolean values correctly', () => {
      process.env.REDIS_AUTO_SPAWN = 'true';
      process.env.DOCKER_ENABLED = 'false';
      process.env.HUB_DEBUG = 'true';
      process.env.AGENT_DEBUG = 'false';

      const config = loadConfig({ skipEnvFile: true });

      expect(config.redis.autoSpawn).toBe(true);
      expect(config.docker.enabled).toBe(false);
      expect(config.hub.debug).toBe(true);
      expect(config.agent.debug).toBe(false);
    });

    it('should parse all configuration sections', () => {
      process.env.DOCKER_REDIS_IMAGE = 'redis:7-alpine';
      process.env.DOCKER_CONTAINER_PREFIX = 'test-redis';
      process.env.HUB_API_PORT = '8080';
      process.env.HUB_TASK_LIST_PATH = 'custom/task-list.md';
      process.env.AGENT_MAX_CONCURRENT = '10';
      process.env.AGENT_TIMEOUT = '600';

      const config = loadConfig({ skipEnvFile: true });

      expect(config.docker.redisImage).toBe('redis:7-alpine');
      expect(config.docker.containerPrefix).toBe('test-redis');
      expect(config.hub.apiPort).toBe(8080);
      expect(config.hub.taskListPath).toBe('custom/task-list.md');
      expect(config.agent.maxConcurrent).toBe(10);
      expect(config.agent.timeout).toBe(600);
    });
  });
});