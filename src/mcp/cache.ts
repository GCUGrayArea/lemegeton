/**
 * MCP Cache
 *
 * Caching layer for MCP responses with TTL and size limits.
 * Uses TTLCache internally for consistent cache behavior.
 */

import { MCPCacheConfig, MCPCacheEntry, MCPRequest } from './types';
import { TTLCache } from '../utils/cache';

/**
 * Cache implementation for MCP responses
 */
export class MCPCache {
  private cache: TTLCache<string, MCPCacheEntry>;
  private config: MCPCacheConfig;

  constructor(config?: MCPCacheConfig) {
    this.config = config || this.getDefaultConfig();

    // Initialize TTLCache with size tracking enabled
    this.cache = new TTLCache({
      defaultTTL: this.config.ttl.default * 1000, // Convert seconds to ms
      maxEntries: 1000, // Reasonable limit for number of entries
      maxSize: this.config.maxSize,
      cleanupInterval: 60000, // 1 minute cleanup interval
    });
  }

  /**
   * Get cached data
   */
  async get<T = any>(request: MCPRequest): Promise<MCPCacheEntry<T> | null> {
    if (!this.config.enabled) {
      return null;
    }

    const key = this.generateKey(request);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Return the full entry (which includes timestamp, ttl, size, data)
    return entry as MCPCacheEntry<T>;
  }

  /**
   * Set cached data
   */
  async set(request: MCPRequest, data: any): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const key = this.generateKey(request);
    const ttl = this.getTTL(request.tool);
    const size = this.calculateSize(data);

    // Check size limits
    if (size > this.config.maxSize) {
      // Data too large to cache
      return;
    }

    // Create cache entry with metadata
    const entry: MCPCacheEntry = {
      data,
      timestamp: Date.now(),
      ttl,
      size,
    };

    // Store entry with TTL in milliseconds
    // Pass size explicitly so TTLCache can track total size
    this.cache.set(key, entry, ttl * 1000, size);
  }

  /**
   * Invalidate cache entry
   */
  async invalidate(request: MCPRequest): Promise<void> {
    const key = this.generateKey(request);
    this.cache.delete(key);
  }

  /**
   * Clear entire cache
   */
  async clear(): Promise<void> {
    this.cache.destroy();
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    entries: number;
    totalSize: number;
    maxSize: number;
    utilizationPercent: number;
  } {
    const stats = this.cache.getStats();

    return {
      entries: stats.entries,
      totalSize: stats.totalSize ?? 0,
      maxSize: stats.maxSize ?? this.config.maxSize,
      utilizationPercent: stats.utilizationPercent ?? 0,
    };
  }

  // Private methods

  /**
   * Generate cache key from request
   */
  private generateKey(request: MCPRequest): string {
    const params = JSON.stringify(request.parameters);
    return `${request.tool}:${params}`;
  }

  /**
   * Get TTL for a tool (in seconds)
   */
  private getTTL(tool: string): number {
    if (tool.startsWith('github')) {
      return this.config.ttl.github || this.config.ttl.default;
    } else if (tool.startsWith('npm')) {
      return this.config.ttl.npm || this.config.ttl.default;
    } else if (tool.startsWith('mdn')) {
      return this.config.ttl.mdn || this.config.ttl.default;
    }

    return this.config.ttl.default;
  }

  /**
   * Calculate approximate size of data in bytes
   *
   * Note: Uses string length approximation instead of Blob API
   * for Node.js compatibility. Provides reasonable estimates.
   */
  private calculateSize(data: any): number {
    try {
      const json = JSON.stringify(data);
      // Approximate size: 2 bytes per character in UTF-16
      return json.length * 2;
    } catch {
      // If data can't be stringified, use default size
      return 1024; // 1KB default
    }
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(): MCPCacheConfig {
    return {
      enabled: true,
      ttl: {
        github: 3600, // 1 hour
        npm: 1800, // 30 minutes
        mdn: 86400, // 24 hours
        default: 3600, // 1 hour
      },
      maxSize: 104857600, // 100MB
      useRedis: false,
    };
  }
}
