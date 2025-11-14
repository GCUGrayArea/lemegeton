/**
 * Memory Bank Service
 *
 * High-level service for managing institutional knowledge across agent sessions.
 * Uses injected MemoryAdapter for storage abstraction and Redis for caching.
 *
 * Features:
 * - Adapter-based storage (file-based now, vector DB later)
 * - Redis caching with automatic invalidation
 * - Update trigger logic from Picatrix memory bank
 * - High-level operations (read/write/query)
 *
 * The memory bank stores four core files:
 * - systemPatterns: Architectural decisions and design patterns
 * - techContext: Technologies, setup, constraints
 * - activeContext: Current work focus and blockers
 * - progress: Feature status and remaining work
 */

import {
  MemoryAdapter,
  MemoryFile,
  MemoryBankSnapshot,
  QueryOptions,
  MemoryQueryResult,
  UpdateContext,
} from '../types/memory';

export class MemoryBank {
  private adapter: MemoryAdapter;
  private redis: any; // Use any to avoid complex Redis type issues
  private cacheKeyPrefix = 'memory:';
  private cacheTTL = 3600; // 1 hour

  /**
   * Create a new MemoryBank service.
   *
   * @param adapter - Storage adapter (FileMemoryAdapter or VectorMemoryAdapter)
   * @param redis - Redis client for caching
   */
  constructor(adapter: MemoryAdapter, redis: any) {
    this.adapter = adapter;
    this.redis = redis;
  }

  /**
   * Read a memory file with Redis caching.
   *
   * Flow:
   * 1. Check Redis cache
   * 2. If hit, return cached value
   * 3. If miss, read from adapter
   * 4. Cache result in Redis
   * 5. Return content
   */
  async read(file: MemoryFile): Promise<string> {
    const cacheKey = this.getCacheKey(file);

    // Try Redis cache first
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Fallback to adapter
    const content = await this.adapter.read(file);

    // Cache in Redis with TTL
    await this.redis.setex(cacheKey, this.cacheTTL, content);

    return content;
  }

  /**
   * Write a memory file with cache invalidation.
   *
   * Flow:
   * 1. Write to adapter (durable storage)
   * 2. Invalidate Redis cache
   * 3. Update cache with new content (optional but recommended)
   */
  async write(file: MemoryFile, content: string): Promise<void> {
    // Write to durable storage
    await this.adapter.write(file, content);

    // Invalidate and update cache
    const cacheKey = this.getCacheKey(file);
    await this.redis.del(cacheKey);
    await this.redis.setex(cacheKey, this.cacheTTL, content);
  }

  /**
   * Check if a memory file exists.
   * Not cached since it's a quick filesystem check.
   */
  async exists(file: MemoryFile): Promise<boolean> {
    return this.adapter.exists(file);
  }

  /**
   * Read all memory files at once.
   * Useful for loading full context at session start.
   */
  async readAll(): Promise<MemoryBankSnapshot> {
    return this.adapter.readAll();
  }

  /**
   * Write all memory files at once.
   * Useful for batch updates or restoring from backup.
   */
  async writeAll(snapshot: MemoryBankSnapshot): Promise<void> {
    // Write to adapter
    await this.adapter.writeAll(snapshot);

    // Invalidate all caches
    await this.invalidateAll();

    // Update caches with new content
    await Promise.all([
      this.redis.setex(
        this.getCacheKey(MemoryFile.SystemPatterns),
        this.cacheTTL,
        snapshot.systemPatterns
      ),
      this.redis.setex(
        this.getCacheKey(MemoryFile.TechContext),
        this.cacheTTL,
        snapshot.techContext
      ),
      this.redis.setex(
        this.getCacheKey(MemoryFile.ActiveContext),
        this.cacheTTL,
        snapshot.activeContext
      ),
      this.redis.setex(
        this.getCacheKey(MemoryFile.Progress),
        this.cacheTTL,
        snapshot.progress
      ),
    ]);
  }

  /**
   * Query memory files based on a question or keywords.
   *
   * Implementation varies by adapter:
   * - FileMemoryAdapter: Simple keyword matching
   * - VectorMemoryAdapter: Semantic similarity search
   */
  async query(
    question: string,
    options?: QueryOptions
  ): Promise<MemoryQueryResult[]> {
    return this.adapter.query(question, options);
  }

  /**
   * Determine if memory bank should be updated based on context.
   *
   * Update triggers (from Picatrix memory bank):
   * - Discovered new architectural pattern
   * - Implemented major change (PR completed, feature added)
   * - Received clarification that should be documented
   * - PR transitioned to completed state
   * - User explicitly requested update
   *
   * @param context - Current work context
   * @returns true if update is recommended
   */
  shouldUpdate(context: UpdateContext): boolean {
    return (
      context.discoveredNewPattern ||
      context.implementedMajorChange ||
      context.needsClarification ||
      context.prComplete ||
      context.userRequested
    );
  }

  /**
   * Get recommended files to update based on context.
   *
   * @param context - Current work context
   * @returns Array of memory files that should be updated
   */
  getRecommendedUpdates(context: UpdateContext): MemoryFile[] {
    const files: MemoryFile[] = [];

    if (context.discoveredNewPattern) {
      files.push(MemoryFile.SystemPatterns);
    }

    if (context.implementedMajorChange || context.prComplete) {
      files.push(MemoryFile.Progress);
      files.push(MemoryFile.ActiveContext);
    }

    if (context.needsClarification) {
      files.push(MemoryFile.TechContext);
      files.push(MemoryFile.ActiveContext);
    }

    // Remove duplicates
    return Array.from(new Set(files));
  }

  /**
   * Invalidate all Redis caches.
   */
  private async invalidateAll(): Promise<void> {
    const keys = [
      this.getCacheKey(MemoryFile.SystemPatterns),
      this.getCacheKey(MemoryFile.TechContext),
      this.getCacheKey(MemoryFile.ActiveContext),
      this.getCacheKey(MemoryFile.Progress),
    ];

    await this.redis.del(keys);
  }

  /**
   * Get Redis cache key for a memory file.
   */
  private getCacheKey(file: MemoryFile): string {
    return `${this.cacheKeyPrefix}${file}`;
  }
}
