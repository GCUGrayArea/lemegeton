/**
 * MCP Cache
 *
 * Caching layer for MCP responses with TTL and size limits.
 */

import { MCPCacheConfig, MCPCacheEntry, MCPRequest } from './types';

/**
 * Cache implementation for MCP responses
 */
export class MCPCache {
  private memoryCache: Map<string, MCPCacheEntry>;
  private totalSize: number = 0;
  private config: MCPCacheConfig;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config?: MCPCacheConfig) {
    this.config = config || this.getDefaultConfig();
    this.memoryCache = new Map();

    // Periodic cleanup
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000); // Every minute
  }

  /**
   * Get cached data
   */
  async get<T = any>(request: MCPRequest): Promise<MCPCacheEntry<T> | null> {
    if (!this.config.enabled) {
      return null;
    }

    const key = this.generateKey(request);
    const entry = this.memoryCache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    const age = (Date.now() - entry.timestamp) / 1000; // in seconds
    if (age > entry.ttl) {
      this.memoryCache.delete(key);
      this.totalSize -= entry.size;
      return null;
    }

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

    // Evict entries if needed
    while (this.totalSize + size > this.config.maxSize) {
      this.evictOldest();
    }

    const entry: MCPCacheEntry = {
      data,
      timestamp: Date.now(),
      ttl,
      size,
    };

    this.memoryCache.set(key, entry);
    this.totalSize += size;
  }

  /**
   * Invalidate cache entry
   */
  async invalidate(request: MCPRequest): Promise<void> {
    const key = this.generateKey(request);
    const entry = this.memoryCache.get(key);

    if (entry) {
      this.memoryCache.delete(key);
      this.totalSize -= entry.size;
    }
  }

  /**
   * Clear entire cache
   */
  async clear(): Promise<void> {
    this.memoryCache.clear();
    this.totalSize = 0;

    // Stop cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
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
    return {
      entries: this.memoryCache.size,
      totalSize: this.totalSize,
      maxSize: this.config.maxSize,
      utilizationPercent: (this.totalSize / this.config.maxSize) * 100,
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
   * Get TTL for a tool
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
   */
  private calculateSize(data: any): number {
    const json = JSON.stringify(data);
    return new Blob([json]).size;
  }

  /**
   * Evict oldest entry
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.memoryCache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const entry = this.memoryCache.get(oldestKey);
      if (entry) {
        this.memoryCache.delete(oldestKey);
        this.totalSize -= entry.size;
      }
    }
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [key, entry] of this.memoryCache.entries()) {
      const age = (now - entry.timestamp) / 1000;
      if (age > entry.ttl) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      const entry = this.memoryCache.get(key);
      if (entry) {
        this.memoryCache.delete(key);
        this.totalSize -= entry.size;
      }
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
