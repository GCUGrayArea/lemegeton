/**
 * Generic TTL Cache Utilities
 *
 * Reusable cache implementations with time-to-live (TTL) support,
 * size limits, and automatic eviction strategies.
 */

/**
 * Cache entry with metadata
 */
export interface CacheEntry<V> {
  /** Cached value */
  data: V;
  /** Timestamp when entry was created (ms) */
  timestamp: number;
  /** Time-to-live in milliseconds */
  ttl: number;
  /** Size of entry in bytes (optional, for size-based eviction) */
  size?: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Number of entries in cache */
  entries: number;
  /** Total size in bytes (if size tracking enabled) */
  totalSize?: number;
  /** Maximum size in bytes (if size tracking enabled) */
  maxSize?: number;
  /** Cache utilization percentage (if size tracking enabled) */
  utilizationPercent?: number;
  /** Number of hits */
  hits: number;
  /** Number of misses */
  misses: number;
  /** Hit rate percentage */
  hitRate: number;
}

/**
 * Generic TTL cache with automatic expiration and size-based eviction
 *
 * Features:
 * - Time-to-live (TTL) expiration
 * - Maximum size limit with LRU eviction
 * - Optional size tracking
 * - Periodic cleanup
 * - Statistics tracking
 *
 * @example
 * ```typescript
 * const cache = new TTLCache<string, User>({
 *   defaultTTL: 60000, // 60 seconds
 *   maxEntries: 100
 * });
 *
 * cache.set('user:123', userData);
 * const user = cache.get('user:123'); // Returns user if not expired
 * ```
 */
export class TTLCache<K, V> {
  private cache = new Map<K, CacheEntry<V>>();
  private readonly defaultTTL: number;
  private readonly maxEntries: number;
  private readonly trackSize: boolean;
  private totalSize: number = 0;
  private readonly maxSize?: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  // Statistics
  private hits: number = 0;
  private misses: number = 0;

  constructor(options: {
    /** Default TTL in milliseconds (default: 300000 = 5 minutes) */
    defaultTTL?: number;
    /** Maximum number of entries (default: 100) */
    maxEntries?: number;
    /** Maximum total size in bytes (optional, enables size tracking) */
    maxSize?: number;
    /** Cleanup interval in milliseconds (default: 60000 = 1 minute, 0 = disabled) */
    cleanupInterval?: number;
  } = {}) {
    this.defaultTTL = options.defaultTTL ?? 300000;
    this.maxEntries = options.maxEntries ?? 100;
    this.maxSize = options.maxSize;
    this.trackSize = options.maxSize !== undefined;

    // Start periodic cleanup if enabled
    const cleanupMs = options.cleanupInterval ?? 60000;
    if (cleanupMs > 0) {
      this.cleanupInterval = setInterval(() => this.cleanup(), cleanupMs);
    }
  }

  /**
   * Get value from cache
   *
   * @param key - Cache key
   * @returns Cached value or null if not found/expired
   */
  get(key: K): V | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check if expired
    const age = Date.now() - entry.timestamp;
    if (age > entry.ttl) {
      // Expired, remove and return null
      this.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.data;
  }

  /**
   * Set value in cache
   *
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttl - Optional TTL override (ms)
   * @param size - Optional size override (bytes)
   */
  set(key: K, value: V, ttl?: number, size?: number): void {
    const entryTTL = ttl ?? this.defaultTTL;
    const entrySize = this.trackSize ? (size ?? this.calculateSize(value)) : undefined;

    // Check size limit before adding
    if (this.maxSize && entrySize && entrySize > this.maxSize) {
      // Entry too large to cache
      return;
    }

    // Remove old entry if exists
    if (this.cache.has(key)) {
      this.delete(key);
    }

    // Evict entries if needed for size
    if (this.trackSize && this.maxSize && entrySize) {
      while (this.totalSize + entrySize > this.maxSize && this.cache.size > 0) {
        this.evictOldest();
      }
    }

    // Evict entries if needed for count
    while (this.cache.size >= this.maxEntries) {
      this.evictOldest();
    }

    // Add new entry
    const entry: CacheEntry<V> = {
      data: value,
      timestamp: Date.now(),
      ttl: entryTTL,
      size: entrySize,
    };

    this.cache.set(key, entry);

    if (this.trackSize && entrySize) {
      this.totalSize += entrySize;
    }
  }

  /**
   * Check if key exists and is not expired
   *
   * @param key - Cache key
   * @returns true if key exists and is valid
   */
  has(key: K): boolean {
    return this.get(key) !== null;
  }

  /**
   * Delete entry from cache
   *
   * @param key - Cache key
   * @returns true if entry was deleted
   */
  delete(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    this.cache.delete(key);

    if (this.trackSize && entry.size) {
      this.totalSize -= entry.size;
    }

    return true;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
    this.totalSize = 0;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get number of entries in cache
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? (this.hits / total) * 100 : 0;

    const stats: CacheStats = {
      entries: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate,
    };

    if (this.trackSize && this.maxSize) {
      stats.totalSize = this.totalSize;
      stats.maxSize = this.maxSize;
      stats.utilizationPercent = (this.totalSize / this.maxSize) * 100;
    }

    return stats;
  }

  /**
   * Cleanup expired entries
   *
   * @returns Number of entries removed
   */
  cleanup(): number {
    const now = Date.now();
    const toDelete: K[] = [];

    for (const [key, entry] of this.cache.entries()) {
      const age = now - entry.timestamp;
      if (age > entry.ttl) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      this.delete(key);
    }

    return toDelete.length;
  }

  /**
   * Stop cleanup interval and clear cache
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
  }

  /**
   * Evict oldest entry (based on timestamp)
   */
  private evictOldest(): void {
    let oldestKey: K | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey !== null) {
      this.delete(oldestKey);
    }
  }

  /**
   * Calculate approximate size of value in bytes
   */
  private calculateSize(value: V): number {
    try {
      const json = JSON.stringify(value);
      // Approximate size: 2 bytes per character in UTF-16
      return json.length * 2;
    } catch {
      // If value can't be stringified, use a default size
      return 1024; // 1KB default
    }
  }
}

/**
 * Simple in-memory cache with just TTL support (no size tracking)
 *
 * Lighter weight alternative to TTLCache when size limits aren't needed.
 *
 * @example
 * ```typescript
 * const cache = new SimpleCache<string, ParsedData>({ ttl: 30000 });
 * cache.set('key', data);
 * const value = cache.get('key');
 * ```
 */
export class SimpleCache<K, V> {
  private cache = new Map<K, CacheEntry<V>>();
  private readonly defaultTTL: number;

  constructor(options: { ttl?: number } = {}) {
    this.defaultTTL = options.ttl ?? 300000;
  }

  get(key: K): V | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  set(key: K, value: V, ttl?: number): void {
    this.cache.set(key, {
      data: value,
      timestamp: Date.now(),
      ttl: ttl ?? this.defaultTTL,
    });
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}
