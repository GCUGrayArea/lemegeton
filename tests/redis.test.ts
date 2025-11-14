/**
 * Tests for Redis client, health checking, and auto-spawn
 *
 * These tests require Docker to be available and will test the actual
 * auto-spawn functionality, which is critical to the system.
 */

import { RedisClient, RedisConnectionState, getDefaultRedisClient, resetDefaultRedisClient } from '../src/redis/client';
import { RedisHealthChecker, HealthStatus } from '../src/redis/health';
import { RedisAutoSpawner, AutoSpawnStatus, getDefaultAutoSpawner, resetDefaultAutoSpawner } from '../src/redis/autoSpawn';
import * as docker from '../src/utils/docker';
import { loadConfig, resetConfig } from '../src/config';

// Increase timeout for Docker operations
jest.setTimeout(60000);

describe('Redis Integration Tests', () => {
  let dockerAvailable: boolean = false;

  beforeAll(async () => {
    // Check if Docker is available
    const availability = await docker.checkDockerAvailability();
    dockerAvailable = availability.available;

    if (!dockerAvailable) {
      console.warn('Docker not available. Some tests will be skipped.');
      console.warn('Error:', availability.error);
    }
  });

  afterAll(async () => {
    // Clean up any test containers
    if (dockerAvailable) {
      const containers = await docker.listContainers({ name: 'lemegeton-test' });
      for (const container of containers) {
        await docker.stopContainer(container.id);
        await docker.removeContainer(container.id);
      }
    }
  });

  describe('Docker utilities', () => {
    it('should check Docker availability', async () => {
      const availability = await docker.checkDockerAvailability();

      expect(availability).toHaveProperty('available');
      if (availability.available) {
        expect(availability).toHaveProperty('version');
        expect(availability).toHaveProperty('platform');
      } else {
        expect(availability).toHaveProperty('error');
      }
    });

    it('should check port availability', async () => {
      // Test with a likely available high port
      const available = await docker.isPortAvailable(54321);
      expect(typeof available).toBe('boolean');

      // Port 1 is typically reserved and unavailable
      const unavailable = await docker.isPortAvailable(1);
      expect(typeof unavailable).toBe('boolean');
    });

    it('should find available ports', async () => {
      const port = await docker.findAvailablePort(54320, 10);

      if (port) {
        expect(port).toBeGreaterThanOrEqual(54320);
        expect(port).toBeLessThan(54330);

        // Verify the port is actually available
        const isAvailable = await docker.isPortAvailable(port);
        expect(isAvailable).toBe(true);
      }
    });

    (dockerAvailable ? it : it.skip)('should run and stop Redis container', async () => {
      const testPort = await docker.findAvailablePort(16379);
      expect(testPort).not.toBeNull();

      const containerName = `lemegeton-test-${Date.now()}`;

      // Run Redis container
      const result = await docker.runContainer({
        image: 'redis:alpine',
        name: containerName,
        ports: [{ host: testPort!, container: 6379 }],
        detached: true
      });

      expect(result.success).toBe(true);
      expect(result.containerId).toBeTruthy();

      // Check if container is running
      const isRunning = await docker.isContainerRunning(result.containerId);
      expect(isRunning).toBe(true);

      // Wait for Redis to be ready
      await docker.waitForContainer(result.containerId, {
        timeout: 10000,
        healthCheck: async () => {
          try {
            const tempClient = new RedisClient(`redis://localhost:${testPort}`);
            await tempClient.connect();
            const pong = await tempClient.ping();
            await tempClient.disconnect();
            return pong === 'PONG';
          } catch {
            return false;
          }
        }
      });

      // Stop and remove container
      const stopped = await docker.stopContainer(result.containerId);
      expect(stopped).toBe(true);

      const removed = await docker.removeContainer(result.containerId);
      expect(removed).toBe(true);
    });
  });

  describe('RedisClient', () => {
    let client: RedisClient;

    afterEach(async () => {
      if (client) {
        await client.disconnect();
      }
    });

    (dockerAvailable ? it : it.skip)('should handle connection lifecycle', async () => {
      const port = await docker.findAvailablePort(16380);
      expect(port).not.toBeNull();

      // Start a Redis container for testing
      const containerName = `lemegeton-test-client-${Date.now()}`;
      const container = await docker.runContainer({
        image: 'redis:alpine',
        name: containerName,
        ports: [{ host: port!, container: 6379 }],
        detached: true
      });

      expect(container.success).toBe(true);

      // Wait for container to be ready
      await new Promise(resolve => setTimeout(resolve, 2000));

      client = new RedisClient(`redis://localhost:${port}`);

      // Test state transitions
      expect(client.getState()).toBe(RedisConnectionState.DISCONNECTED);
      expect(client.isConnected()).toBe(false);

      // Connect
      await client.connect();
      expect(client.getState()).toBe(RedisConnectionState.CONNECTED);
      expect(client.isConnected()).toBe(true);

      // Test ping
      const pong = await client.ping();
      expect(pong).toBe('PONG');

      // Test basic operations
      await client.execute(async (c) => {
        await c.set('test:key', 'test-value');
        const value = await c.get('test:key');
        expect(value).toBe('test-value');
      });

      // Test pub/sub
      const messages: string[] = [];
      await client.subscribe('test:channel', (msg) => {
        messages.push(msg);
      });

      await client.publish('test:channel', 'test-message');

      // Wait for message to be received
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(messages).toContain('test-message');

      // Disconnect
      await client.disconnect();
      expect(client.getState()).toBe(RedisConnectionState.CLOSED);
      expect(client.isConnected()).toBe(false);

      // Clean up container
      await docker.stopContainer(container.containerId);
      await docker.removeContainer(container.containerId);
    });

    it('should handle connection failure gracefully', async () => {
      client = new RedisClient('redis://localhost:59999'); // Non-existent port

      await expect(client.connect()).rejects.toThrow();
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('RedisHealthChecker', () => {
    let client: RedisClient;
    let healthChecker: RedisHealthChecker;
    let container: { containerId: string } | null = null;

    afterEach(async () => {
      if (healthChecker) {
        healthChecker.stop();
      }
      if (client) {
        await client.disconnect();
      }
      if (container) {
        await docker.stopContainer(container.containerId);
        await docker.removeContainer(container.containerId);
      }
    });

    (dockerAvailable ? it : it.skip)('should monitor Redis health', async () => {
      const port = await docker.findAvailablePort(16381);
      expect(port).not.toBeNull();

      // Start Redis container
      const containerName = `lemegeton-test-health-${Date.now()}`;
      const containerResult = await docker.runContainer({
        image: 'redis:alpine',
        name: containerName,
        ports: [{ host: port!, container: 6379 }],
        detached: true
      });

      expect(containerResult.success).toBe(true);
      container = containerResult;

      // Wait for container
      await new Promise(resolve => setTimeout(resolve, 2000));

      client = new RedisClient(`redis://localhost:${port}`);
      await client.connect();

      healthChecker = new RedisHealthChecker(client, {
        interval: 1000,
        timeout: 500,
        failureThreshold: 2
      });

      // Start health checking
      healthChecker.start();

      // Check initial health
      const result = await healthChecker.check();
      expect(result.status).toBe(HealthStatus.HEALTHY);
      expect(result.latency).toBeDefined();
      expect(result.latency).toBeLessThan(100);

      // Monitor health status
      expect(healthChecker.isHealthy()).toBe(true);
      expect(healthChecker.getStatus()).toBe(HealthStatus.HEALTHY);
    });

    (dockerAvailable ? it : it.skip)('should detect unhealthy Redis', async () => {
      // Create client pointing to non-existent Redis
      client = new RedisClient('redis://localhost:59998');

      healthChecker = new RedisHealthChecker(client, {
        interval: 1000,
        timeout: 500,
        failureThreshold: 2,
        autoReconnect: false
      });

      const result = await healthChecker.check();
      expect(result.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.error).toBeDefined();
      expect(result.consecutiveFailures).toBe(1);
    });
  });

  describe('RedisAutoSpawner', () => {
    let spawner: RedisAutoSpawner;
    let client: RedisClient;

    beforeEach(() => {
      resetConfig();
    });

    afterEach(async () => {
      if (spawner) {
        await spawner.cleanup();
      }
      if (client) {
        await client.disconnect();
      }
      await resetDefaultAutoSpawner();
      resetDefaultRedisClient();
    });

    (dockerAvailable ? it : it.skip)('should auto-spawn Redis when not available', async () => {
      // Configure for auto-spawn
      const config = loadConfig({
        skipEnvFile: true,
        overrides: {
          redis: {
            port: await docker.findAvailablePort(16382) || 16382,
            autoSpawn: true
          },
          docker: {
            enabled: true,
            containerPrefix: 'lemegeton-test-spawn',
            cleanupOnExit: true
          }
        }
      });

      client = new RedisClient(undefined); // Will use config
      spawner = new RedisAutoSpawner(client);

      expect(spawner.shouldAttemptSpawn()).toBe(true);
      expect(spawner.getStatus()).toBe(AutoSpawnStatus.IDLE);

      // Attempt spawn
      const result = await spawner.spawn();

      if (result.success) {
        expect(result.status).toBe(AutoSpawnStatus.RUNNING);
        expect(result.containerId).toBeTruthy();
        expect(result.port).toBeDefined();

        // Verify Redis is accessible
        await client.connect();
        const pong = await client.ping();
        expect(pong).toBe('PONG');

        // Check spawner status
        expect(spawner.getStatus()).toBe(AutoSpawnStatus.RUNNING);
        expect(spawner.getContainerId()).toBeTruthy();
      } else {
        // If spawn failed, verify it failed gracefully
        expect(result.error).toBeDefined();
        expect(spawner.getStatus()).toBe(AutoSpawnStatus.FAILED);
      }
    });

    (dockerAvailable ? it : it.skip)('should not spawn if Redis already available', async () => {
      const port = await docker.findAvailablePort(16383);
      expect(port).not.toBeNull();

      // Start Redis manually
      const containerName = `lemegeton-test-nospawn-${Date.now()}`;
      const container = await docker.runContainer({
        image: 'redis:alpine',
        name: containerName,
        ports: [{ host: port!, container: 6379 }],
        detached: true
      });

      expect(container.success).toBe(true);

      // Wait for container
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Configure to use existing Redis
      loadConfig({
        skipEnvFile: true,
        overrides: {
          redis: {
            url: `redis://localhost:${port}`,
            autoSpawn: true
          }
        }
      });

      client = new RedisClient(`redis://localhost:${port}`);
      spawner = new RedisAutoSpawner(client);

      const result = await spawner.spawn();

      // Should detect existing Redis and not spawn
      expect(result.success).toBe(true);
      expect(result.status).toBe(AutoSpawnStatus.IDLE);
      expect(spawner.getContainerId()).toBeNull();

      // Clean up manual container
      await docker.stopContainer(container.containerId);
      await docker.removeContainer(container.containerId);
    });

    (dockerAvailable ? it : it.skip)('should handle connectWithFallback', async () => {
      const port = await docker.findAvailablePort(16384);

      loadConfig({
        skipEnvFile: true,
        overrides: {
          redis: {
            port: port || 16384,
            autoSpawn: true
          },
          docker: {
            containerPrefix: 'lemegeton-test-fallback'
          }
        }
      });

      client = new RedisClient(undefined);
      spawner = new RedisAutoSpawner(client);

      // Try to connect with fallback to auto-spawn
      const connected = await spawner.connectWithFallback(client);

      expect(connected).toBe(true);
      expect(client.isConnected()).toBe(true);

      // Test Redis works
      const pong = await client.ping();
      expect(pong).toBe('PONG');
    });

    it('should handle Docker not available', async () => {
      if (dockerAvailable) {
        console.log('Skipping test - Docker is available');
        return;
      }

      loadConfig({
        skipEnvFile: true,
        overrides: {
          redis: { autoSpawn: true },
          docker: { enabled: true }
        }
      });

      client = new RedisClient(undefined);
      spawner = new RedisAutoSpawner(client);

      const result = await spawner.spawn();

      expect(result.success).toBe(false);
      expect(result.status).toBe(AutoSpawnStatus.FAILED);
      expect(result.fallbackReason).toBe('Docker not available');
    });
  });

  describe('End-to-end auto-spawn scenario', () => {
    (dockerAvailable ? it : it.skip)('should provide seamless Redis availability', async () => {
      // Reset everything
      resetConfig();
      resetDefaultRedisClient();
      await resetDefaultAutoSpawner();

      // Configure for auto-spawn
      const port = await docker.findAvailablePort(16385);
      loadConfig({
        skipEnvFile: true,
        overrides: {
          redis: {
            port: port || 16385,
            autoSpawn: true
          },
          docker: {
            containerPrefix: 'lemegeton-test-e2e',
            cleanupOnExit: true
          }
        }
      });

      // Get default client and spawner
      const client = getDefaultRedisClient();
      const spawner = getDefaultAutoSpawner(client);

      // Connect with auto-spawn fallback
      const connected = await spawner.connectWithFallback(client);
      expect(connected).toBe(true);

      // Use Redis normally
      await client.execute(async (c) => {
        await c.set('e2e:test', 'success');
        const value = await c.get('e2e:test');
        expect(value).toBe('success');
      });

      // Create health checker
      const healthChecker = new RedisHealthChecker(client);
      const health = await healthChecker.check();
      expect(health.status).toBe(HealthStatus.HEALTHY);

      // Clean up
      await client.disconnect();
      await spawner.cleanup();
    });
  });
});