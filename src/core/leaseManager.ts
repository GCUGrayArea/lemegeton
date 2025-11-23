/**
 * File lease management system
 *
 * This module provides atomic file lease acquisition and management,
 * preventing concurrent modifications to the same files by different agents.
 */

import { EventEmitter } from 'events';
import { RedisClient } from '../redis/client';
import {
  executeAtomic,
  atomicMultiSet,
  atomicMultiDelete,
  atomicMultiGet,
  atomicExtendTTL,
  LeaseMeta,
  parseLeaseMeta,
  makeLeaseKey,
  makeAgentLeaseSetKey,
  makePrLeaseSetKey,
  AtomicResult,
} from './atomicOps';
import {
  PairedLockingConfig,
  DEFAULT_PAIRED_LOCKING_CONFIG,
} from './pairedLocking';
import {
  FileLockingStrategy,
  createFileLockingStrategy,
} from './fileLockingStrategy';
import { mergeConfig } from '../utils/config';

/**
 * Lease acquisition result
 */
export interface LeaseResult {
  success: boolean;
  leasedFiles?: string[];
  conflicts?: LeaseConflict[];
  error?: string;
  expanded?: boolean;  // Whether files were expanded with pairs
}

/**
 * Lease conflict information
 */
export interface LeaseConflict {
  file: string;
  holder: LeaseMeta;
  requestedBy: string;
}

/**
 * Lease manager configuration
 */
export interface LeaseManagerConfig {
  /** Default TTL for leases in seconds (default: 300 = 5 minutes) */
  defaultTTL?: number;

  /** Heartbeat interval in ms (default: 120000 = 2 minutes) */
  heartbeatInterval?: number;

  /** Grace period before considering lease expired in seconds (default: 30) */
  gracePeriod?: number;

  /** Paired locking configuration */
  pairedLocking?: PairedLockingConfig;

  /** Whether to track leases in sets for agents and PRs */
  trackSets?: boolean;

  /** Maximum files per lease request (default: 100) */
  maxFilesPerRequest?: number;
}

/**
 * Lease manager events
 */
export interface LeaseManagerEvents {
  'lease-acquired': (agentId: string, files: string[]) => void;
  'lease-released': (agentId: string, files: string[]) => void;
  'lease-renewed': (agentId: string, files: string[]) => void;
  'lease-expired': (agentId: string, files: string[]) => void;
  'lease-conflict': (conflict: LeaseConflict) => void;
  'heartbeat-started': (agentId: string) => void;
  'heartbeat-stopped': (agentId: string) => void;
  'heartbeat-failed': (agentId: string, error: Error) => void;
}

/**
 * Default lease manager configuration
 */
export const DEFAULT_LEASE_MANAGER_CONFIG: Required<LeaseManagerConfig> = {
  defaultTTL: 300,
  heartbeatInterval: 120000,
  gracePeriod: 30,
  pairedLocking: DEFAULT_PAIRED_LOCKING_CONFIG,
  trackSets: true,
  maxFilesPerRequest: 100,
};

/**
 * File lease manager
 */
export class LeaseManager extends EventEmitter {
  private readonly config: Required<LeaseManagerConfig>;
  private readonly lockingStrategy: FileLockingStrategy;
  private heartbeatTimers: Map<string, NodeJS.Timeout> = new Map();
  private agentLeases: Map<string, Set<string>> = new Map();

  constructor(
    private readonly redisClient: RedisClient,
    config: LeaseManagerConfig = {}
  ) {
    super();

    this.config = mergeConfig(DEFAULT_LEASE_MANAGER_CONFIG, config);

    // Initialize file locking strategy based on configuration
    this.lockingStrategy = createFileLockingStrategy(this.config.pairedLocking);
  }

  /**
   * Acquires leases for files
   *
   * @param files Files to lease
   * @param agentId Agent requesting the lease
   * @param prId PR the agent is working on
   * @param ttl Optional TTL override in seconds
   * @returns Lease result
   */
  public async acquireLease(
    files: string[],
    agentId: string,
    prId: string,
    ttl?: number
  ): Promise<LeaseResult> {
    if (files.length === 0) {
      return { success: true, leasedFiles: [] };
    }

    if (files.length > this.config.maxFilesPerRequest) {
      return {
        success: false,
        error: `Too many files requested (${files.length} > ${this.config.maxFilesPerRequest})`,
      };
    }

    const leaseTTL = ttl ?? this.config.defaultTTL;

    try {
      // Expand files using the configured locking strategy
      const expansionResult = await this.lockingStrategy.expandFiles(files);
      const allFiles = expansionResult.all;
      const expanded = expansionResult.expanded;

      // Check for existing leases
      const conflicts = await this.checkConflicts(allFiles, agentId);
      if (conflicts.length > 0) {
        this.emitConflicts(conflicts);
        return {
          success: false,
          conflicts,
          error: `Conflicts detected for ${conflicts.length} file(s)`,
        };
      }

      // Prepare lease metadata
      const leaseMeta: LeaseMeta = {
        agentId,
        prId,
        timestamp: Date.now(),
        ttl: leaseTTL * 1000,  // Store TTL in ms
        heartbeat: Date.now(),
      };

      // Prepare keys and values
      const keys = allFiles.map(file => makeLeaseKey(file));
      const values = keys.map(() => leaseMeta);

      // Attempt atomic acquisition
      const client = this.redisClient.getClient();
      const result = await atomicMultiSet(
        client,
        keys,
        values,
        leaseTTL,
        true  // Only if not exists
      );

      if (!result.success) {
        // Check if it's a conflict or other error
        if (result.data) {
          // Some keys existed, get conflict details
          const recentConflicts = await this.checkConflicts(allFiles, agentId);
          this.emitConflicts(recentConflicts);
          return {
            success: false,
            conflicts: recentConflicts,
            error: result.error || 'Failed to acquire some leases',
          };
        }

        return {
          success: false,
          error: result.error || 'Failed to acquire leases',
        };
      }

      // Track leases for this agent
      this.trackAgentLeases(agentId, allFiles);

      // Update tracking sets in Redis if enabled
      if (this.config.trackSets) {
        await this.updateTrackingSets(agentId, prId, allFiles, 'add');
      }

      // Start heartbeat if not already running
      this.startHeartbeat(agentId);

      // Emit success event
      this.emit('lease-acquired', agentId, allFiles);

      return {
        success: true,
        leasedFiles: allFiles,
        expanded,
      };

    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Unknown error acquiring leases',
      };
    }
  }

  /**
   * Releases leases for files
   *
   * @param files Files to release (or null for all files)
   * @param agentId Agent releasing the leases
   * @returns Lease result
   */
  public async releaseLease(
    files: string[] | null,
    agentId: string
  ): Promise<LeaseResult> {
    try {
      // Determine which files to release
      let filesToRelease: string[];

      if (files === null) {
        // Release all files for this agent
        const agentFiles = this.agentLeases.get(agentId);
        if (!agentFiles || agentFiles.size === 0) {
          return { success: true, leasedFiles: [] };
        }
        filesToRelease = Array.from(agentFiles);
      } else {
        filesToRelease = files;
      }

      if (filesToRelease.length === 0) {
        return { success: true, leasedFiles: [] };
      }

      // Get current leases to verify ownership
      const keys = filesToRelease.map(file => makeLeaseKey(file));
      const client = this.redisClient.getClient();
      const getResult = await atomicMultiGet(client, keys);

      if (!getResult.success) {
        return {
          success: false,
          error: getResult.error || 'Failed to verify leases',
        };
      }

      // Filter to only files actually held by this agent
      const validReleases: string[] = [];
      const validKeys: string[] = [];

      for (let i = 0; i < filesToRelease.length; i++) {
        const value = getResult.data![i];
        if (value) {
          const meta = parseLeaseMeta(value);
          if (meta && meta.agentId === agentId) {
            validReleases.push(filesToRelease[i]);
            validKeys.push(keys[i]);
          }
        }
      }

      if (validKeys.length === 0) {
        return {
          success: true,
          leasedFiles: [],
        };
      }

      // Delete the leases
      const deleteResult = await atomicMultiDelete(client, validKeys);

      if (!deleteResult.success) {
        return {
          success: false,
          error: deleteResult.error || 'Failed to release leases',
        };
      }

      // Update local tracking
      this.untrackAgentLeases(agentId, validReleases);

      // Update tracking sets in Redis if enabled
      if (this.config.trackSets) {
        // We need to get PR ID from one of the leases
        const firstLease = getResult.data!.find(v => v !== null);
        if (firstLease) {
          const meta = parseLeaseMeta(firstLease);
          if (meta) {
            await this.updateTrackingSets(agentId, meta.prId, validReleases, 'remove');
          }
        }
      }

      // Stop heartbeat if no more leases
      const remaining = this.agentLeases.get(agentId);
      if (!remaining || remaining.size === 0) {
        this.stopHeartbeat(agentId);
      }

      // Emit release event
      this.emit('lease-released', agentId, validReleases);

      return {
        success: true,
        leasedFiles: validReleases,
      };

    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Unknown error releasing leases',
      };
    }
  }

  /**
   * Renews leases for an agent
   *
   * @param agentId Agent renewing leases
   * @param ttl Optional new TTL in seconds
   * @returns Lease result
   */
  public async renewLease(
    agentId: string,
    ttl?: number
  ): Promise<LeaseResult> {
    try {
      const agentFiles = this.agentLeases.get(agentId);
      if (!agentFiles || agentFiles.size === 0) {
        return { success: true, leasedFiles: [] };
      }

      const files = Array.from(agentFiles);
      const keys = files.map(file => makeLeaseKey(file));
      const leaseTTL = ttl ?? this.config.defaultTTL;

      // Get current leases to update heartbeat
      const client = this.redisClient.getClient();
      const getResult = await atomicMultiGet(client, keys);

      if (!getResult.success) {
        return {
          success: false,
          error: getResult.error || 'Failed to get leases for renewal',
        };
      }

      // Update heartbeat and TTL for valid leases
      const validKeys: string[] = [];
      const validFiles: string[] = [];
      const updatedMetas: LeaseMeta[] = [];

      for (let i = 0; i < files.length; i++) {
        const value = getResult.data![i];
        if (value) {
          const meta = parseLeaseMeta(value);
          if (meta && meta.agentId === agentId) {
            meta.heartbeat = Date.now();
            validKeys.push(keys[i]);
            validFiles.push(files[i]);
            updatedMetas.push(meta);
          }
        }
      }

      if (validKeys.length === 0) {
        return {
          success: true,
          leasedFiles: [],
        };
      }

      // Update leases with new heartbeat
      const setResult = await atomicMultiSet(
        client,
        validKeys,
        updatedMetas,
        leaseTTL,
        false  // Allow overwrite
      );

      if (!setResult.success) {
        this.emit('heartbeat-failed', agentId, new Error(setResult.error || 'Failed to renew leases'));
        return {
          success: false,
          error: setResult.error || 'Failed to renew leases',
        };
      }

      // Emit renewal event
      this.emit('lease-renewed', agentId, validFiles);

      return {
        success: true,
        leasedFiles: validFiles,
      };

    } catch (error: any) {
      this.emit('heartbeat-failed', agentId, error);
      return {
        success: false,
        error: error.message || 'Unknown error renewing leases',
      };
    }
  }

  /**
   * Gets current leases for an agent
   *
   * @param agentId Agent ID
   * @returns Array of leased files
   */
  public getAgentLeases(agentId: string): string[] {
    const leases = this.agentLeases.get(agentId);
    return leases ? Array.from(leases) : [];
  }

  /**
   * Gets all current leases
   *
   * @returns Map of agent IDs to leased files
   */
  public getAllLeases(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const [agentId, files] of this.agentLeases) {
      result.set(agentId, Array.from(files));
    }
    return result;
  }

  /**
   * Checks for conflicts with existing leases
   */
  private async checkConflicts(
    files: string[],
    requestingAgent: string
  ): Promise<LeaseConflict[]> {
    const conflicts: LeaseConflict[] = [];
    const keys = files.map(file => makeLeaseKey(file));

    const client = this.redisClient.getClient();
    const result = await atomicMultiGet(client, keys);

    if (!result.success || !result.data) {
      return conflicts;
    }

    for (let i = 0; i < files.length; i++) {
      const value = result.data[i];
      if (value) {
        const meta = parseLeaseMeta(value);
        if (meta && meta.agentId !== requestingAgent) {
          // Check if lease is expired (with grace period)
          const expiryTime = meta.timestamp + meta.ttl + (this.config.gracePeriod * 1000);
          if (Date.now() < expiryTime) {
            conflicts.push({
              file: files[i],
              holder: meta,
              requestedBy: requestingAgent,
            });
          }
        }
      }
    }

    return conflicts;
  }

  /**
   * Tracks leases locally for an agent
   */
  private trackAgentLeases(agentId: string, files: string[]): void {
    let agentFiles = this.agentLeases.get(agentId);
    if (!agentFiles) {
      agentFiles = new Set();
      this.agentLeases.set(agentId, agentFiles);
    }
    for (const file of files) {
      agentFiles.add(file);
    }
  }

  /**
   * Untracks leases locally for an agent
   */
  private untrackAgentLeases(agentId: string, files: string[]): void {
    const agentFiles = this.agentLeases.get(agentId);
    if (agentFiles) {
      for (const file of files) {
        agentFiles.delete(file);
      }
      if (agentFiles.size === 0) {
        this.agentLeases.delete(agentId);
      }
    }
  }

  /**
   * Updates tracking sets in Redis
   */
  private async updateTrackingSets(
    agentId: string,
    prId: string,
    files: string[],
    operation: 'add' | 'remove'
  ): Promise<void> {
    const client = this.redisClient.getClient();
    const agentKey = makeAgentLeaseSetKey(agentId);
    const prKey = makePrLeaseSetKey(prId);

    try {
      if (operation === 'add') {
        await client.sAdd(agentKey, files);
        await client.sAdd(prKey, files);
        // Set expiration on sets
        await client.expire(agentKey, this.config.defaultTTL);
        await client.expire(prKey, this.config.defaultTTL);
      } else {
        await client.sRem(agentKey, files);
        await client.sRem(prKey, files);
      }
    } catch (error) {
      // Non-critical error, log but don't fail
      console.warn(`Failed to update tracking sets: ${error}`);
    }
  }

  /**
   * Starts heartbeat for an agent
   */
  private startHeartbeat(agentId: string): void {
    if (this.heartbeatTimers.has(agentId)) {
      return;  // Already running
    }

    const timer = setInterval(async () => {
      await this.renewLease(agentId);
    }, this.config.heartbeatInterval);

    this.heartbeatTimers.set(agentId, timer);
    this.emit('heartbeat-started', agentId);
  }

  /**
   * Stops heartbeat for an agent
   */
  private stopHeartbeat(agentId: string): void {
    const timer = this.heartbeatTimers.get(agentId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(agentId);
      this.emit('heartbeat-stopped', agentId);
    }
  }

  /**
   * Emits conflict events
   */
  private emitConflicts(conflicts: LeaseConflict[]): void {
    for (const conflict of conflicts) {
      this.emit('lease-conflict', conflict);
    }
  }

  /**
   * Cleans up all resources
   */
  public async cleanup(): Promise<void> {
    // Stop all heartbeats
    for (const [agentId, timer] of this.heartbeatTimers) {
      clearInterval(timer);
      this.emit('heartbeat-stopped', agentId);
    }
    this.heartbeatTimers.clear();

    // Release all leases
    for (const agentId of this.agentLeases.keys()) {
      await this.releaseLease(null, agentId);
    }
    this.agentLeases.clear();
  }
}