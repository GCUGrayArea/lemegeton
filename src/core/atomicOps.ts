/**
 * Atomic Redis operations for the file lease system
 *
 * This module provides atomic transaction support using Redis MULTI/EXEC
 * with WATCH for optimistic locking, ensuring race-condition-free operations.
 */

import { LemegetonRedisClient } from '../redis/client';

/**
 * Result of an atomic operation
 */
export interface AtomicResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  aborted?: boolean;  // Transaction aborted due to WATCH conflict
}

/**
 * Lease data structure stored in Redis
 */
export interface LeaseMeta {
  agentId: string;
  prId: string;
  timestamp: number;
  ttl: number;
  heartbeat?: number;  // Last heartbeat timestamp
}

/**
 * Options for atomic operations
 */
export interface AtomicOptions {
  /** Maximum retry attempts for transaction conflicts */
  maxRetries?: number;
  /** Delay between retries in ms */
  retryDelay?: number;
  /** Timeout for the entire operation in ms */
  timeout?: number;
}

/**
 * Executes an atomic Redis transaction with WATCH
 *
 * @param client Redis client
 * @param watchKeys Keys to watch for changes
 * @param transaction Function that builds the transaction
 * @param options Atomic operation options
 * @returns Result of the atomic operation
 */
export async function executeAtomic<T>(
  client: LemegetonRedisClient,
  watchKeys: string[],
  transaction: (multi: any) => Promise<any>,
  options: AtomicOptions = {}
): Promise<AtomicResult<T>> {
  const maxRetries = options.maxRetries ?? 3;
  const retryDelay = options.retryDelay ?? 100;
  const timeout = options.timeout ?? 5000;

  const startTime = Date.now();
  let attempt = 0;

  while (attempt < maxRetries) {
    // Check timeout
    if (Date.now() - startTime > timeout) {
      return {
        success: false,
        error: 'Atomic operation timed out',
      };
    }

    try {
      // Watch the specified keys
      if (watchKeys.length > 0) {
        await client.watch(watchKeys);
      }

      // Start transaction
      const multi = client.multi();

      // Build the transaction
      await transaction(multi);

      // Execute transaction
      const results = await multi.exec();

      // Check if transaction was aborted due to WATCH conflict
      if (results === null) {
        // Keys were modified, retry
        attempt++;
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
          continue;
        }
        return {
          success: false,
          error: 'Transaction aborted due to concurrent modification',
          aborted: true,
        };
      }

      // Transaction succeeded
      return {
        success: true,
        data: results as T,
      };

    } catch (error: any) {
      // Unwatch keys on error
      try {
        await client.unwatch();
      } catch {
        // Ignore unwatch errors
      }

      return {
        success: false,
        error: error.message || 'Unknown error in atomic operation',
      };
    }
  }

  return {
    success: false,
    error: `Transaction failed after ${maxRetries} attempts`,
    aborted: true,
  };
}

/**
 * Atomically sets multiple keys with expiration
 *
 * @param client Redis client
 * @param keys Keys to set
 * @param value Value to set (will be JSON stringified)
 * @param ttl Time to live in seconds
 * @param onlyIfNotExists Only set if keys don't exist
 * @returns Result of the atomic operation
 */
export async function atomicMultiSet(
  client: LemegetonRedisClient,
  keys: string[],
  values: any[],
  ttl: number,
  onlyIfNotExists: boolean = true
): Promise<AtomicResult<boolean[]>> {
  // First check if any keys exist (if onlyIfNotExists is true)
  if (onlyIfNotExists) {
    const existingKeys = await Promise.all(
      keys.map(key => client.exists(key))
    );

    const conflicts = keys.filter((key, index) => existingKeys[index] > 0);
    if (conflicts.length > 0) {
      return {
        success: false,
        error: `Keys already exist: ${conflicts.join(', ')}`,
        data: existingKeys.map(exists => exists > 0),
      };
    }
  }

  return executeAtomic<boolean[]>(
    client,
    keys,
    async (multi) => {
      for (let i = 0; i < keys.length; i++) {
        const value = typeof values[i] === 'string'
          ? values[i]
          : JSON.stringify(values[i]);

        if (onlyIfNotExists) {
          // Use SET with NX (only if not exists) and EX (expiration)
          multi.set(keys[i], value, {
            NX: true,
            EX: ttl,
          });
        } else {
          // Regular SET with expiration
          multi.set(keys[i], value, {
            EX: ttl,
          });
        }
      }
    }
  );
}

/**
 * Atomically deletes multiple keys
 *
 * @param client Redis client
 * @param keys Keys to delete
 * @returns Result of the atomic operation
 */
export async function atomicMultiDelete(
  client: LemegetonRedisClient,
  keys: string[]
): Promise<AtomicResult<number>> {
  if (keys.length === 0) {
    return { success: true, data: 0 };
  }

  try {
    const result = await client.del(keys);
    return {
      success: true,
      data: result,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to delete keys',
    };
  }
}

/**
 * Atomically gets multiple keys
 *
 * @param client Redis client
 * @param keys Keys to get
 * @returns Result of the atomic operation
 */
export async function atomicMultiGet(
  client: LemegetonRedisClient,
  keys: string[]
): Promise<AtomicResult<(string | null)[]>> {
  if (keys.length === 0) {
    return { success: true, data: [] };
  }

  try {
    const results = await client.mGet(keys);
    return {
      success: true,
      data: results,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to get keys',
    };
  }
}

/**
 * Atomically extends TTL for multiple keys
 *
 * @param client Redis client
 * @param keys Keys to extend
 * @param ttl New TTL in seconds
 * @returns Result of the atomic operation
 */
export async function atomicExtendTTL(
  client: LemegetonRedisClient,
  keys: string[],
  ttl: number
): Promise<AtomicResult<boolean[]>> {
  return executeAtomic<boolean[]>(
    client,
    [],  // No need to watch for TTL extension
    async (multi) => {
      for (const key of keys) {
        multi.expire(key, ttl);
      }
    }
  );
}

/**
 * Checks if a Redis transaction result indicates success
 *
 * @param result Result from Redis command in transaction
 * @returns True if the command succeeded
 */
export function isTransactionSuccess(result: any): boolean {
  // Redis returns 'OK' for successful SET operations
  if (result === 'OK') return true;

  // Redis returns 1 for successful operations that affect one item
  if (result === 1) return true;

  // Redis returns true for some operations
  if (result === true) return true;

  // Redis returns null for SET with NX when key exists
  // or for other operations that don't make changes
  return false;
}

/**
 * Parses lease metadata from Redis value
 *
 * @param value Redis value (JSON string or null)
 * @returns Parsed lease metadata or null
 */
export function parseLeaseMeta(value: string | null): LeaseMeta | null {
  if (!value) return null;

  try {
    return JSON.parse(value) as LeaseMeta;
  } catch {
    return null;
  }
}

/**
 * Creates a lease key for a file path
 *
 * @param filepath File path
 * @returns Redis key for the file lease
 */
export function makeLeaseKey(filepath: string): string {
  // Normalize path separators for consistency
  const normalized = filepath.replace(/\\/g, '/');
  return `lease:file:${normalized}`;
}

/**
 * Creates an agent lease set key
 *
 * @param agentId Agent ID
 * @returns Redis key for the agent's lease set
 */
export function makeAgentLeaseSetKey(agentId: string): string {
  return `lease:agent:${agentId}`;
}

/**
 * Creates a PR lease set key
 *
 * @param prId PR ID
 * @returns Redis key for the PR's lease set
 */
export function makePrLeaseSetKey(prId: string): string {
  return `lease:pr:${prId}`;
}