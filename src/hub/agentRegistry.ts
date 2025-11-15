/**
 * Agent Registry
 *
 * Tracks all active agents in the system, including:
 * - Agent registration and deregistration
 * - Heartbeat monitoring
 * - Crash detection
 * - Agent status tracking
 */

import { RedisClient } from '../redis/client';

/**
 * Agent types
 */
export type AgentType = 'planning' | 'worker' | 'qc' | 'review';

/**
 * Agent status
 */
export type AgentStatus = 'active' | 'idle' | 'working' | 'crashed';

/**
 * Agent information
 */
export interface AgentInfo {
  id: string;
  type: AgentType;
  status: AgentStatus;
  lastHeartbeat: number;
  assignedPR: string | null;
  pid: number;
  startedAt: number;
  metadata?: Record<string, any>;
}

/**
 * Heartbeat configuration
 */
export interface HeartbeatConfig {
  interval?: number;
  timeout?: number;
}

/**
 * Agent registry for tracking active agents
 */
export class AgentRegistry {
  private agents: Map<string, AgentInfo> = new Map();
  private redis: RedisClient | null = null;
  private config: Required<HeartbeatConfig>;

  constructor(config: HeartbeatConfig = {}) {
    this.config = {
      interval: config.interval || 30000,  // 30 seconds
      timeout: config.timeout || 90000,    // 90 seconds (3 missed heartbeats)
    };
  }

  /**
   * Initialize with Redis client
   */
  async initialize(redis: RedisClient): Promise<void> {
    this.redis = redis;

    // Load existing agents from Redis
    await this.loadAgentsFromRedis();
  }

  /**
   * Load agents from Redis
   */
  private async loadAgentsFromRedis(): Promise<void> {
    if (!this.redis) return;

    await this.redis.execute(async (client) => {
      const agentKeys = await client.keys('agent:*');

      for (const key of agentKeys) {
        // Skip lease keys (agent:xxx:leases)
        if (key.includes(':leases')) continue;

        const agentData = await client.hGetAll(key);
        if (agentData && agentData.id) {
          const agent: AgentInfo = {
            id: agentData.id,
            type: (agentData.type || 'worker') as AgentType,
            status: (agentData.status || 'idle') as AgentStatus,
            lastHeartbeat: parseInt(agentData.lastHeartbeat || '0', 10),
            assignedPR: agentData.assignedPR || null,
            pid: parseInt(agentData.pid || '0', 10),
            startedAt: parseInt(agentData.startedAt || '0', 10),
            metadata: agentData.metadata ? JSON.parse(agentData.metadata) : undefined,
          };

          // Check if agent is crashed based on heartbeat
          const now = Date.now();
          if (now - agent.lastHeartbeat > this.config.timeout) {
            agent.status = 'crashed';
          }

          this.agents.set(agent.id, agent);
        }
      }
    });

    console.log(`[AgentRegistry] Loaded ${this.agents.size} agents from Redis`);
  }

  /**
   * Register a new agent
   */
  async registerAgent(agent: AgentInfo): Promise<void> {
    // Ensure required fields
    agent.lastHeartbeat = agent.lastHeartbeat || Date.now();
    agent.startedAt = agent.startedAt || Date.now();
    agent.status = agent.status || 'idle';

    // Store in memory
    this.agents.set(agent.id, agent);

    // Store in Redis
    if (this.redis) {
      await this.redis.execute(async (client) => {
        const key = `agent:${agent.id}`;
        await client.hSet(key, {
          id: agent.id,
          type: agent.type,
          status: agent.status,
          lastHeartbeat: String(agent.lastHeartbeat),
          pid: String(agent.pid),
          startedAt: String(agent.startedAt),
        });

        if (agent.assignedPR) {
          await client.hSet(key, 'assignedPR', agent.assignedPR);
        }

        if (agent.metadata) {
          await client.hSet(key, 'metadata', JSON.stringify(agent.metadata));
        }
      });
    }

    console.log(`[AgentRegistry] Registered agent ${agent.id} (${agent.type})`);
  }

  /**
   * Handle agent heartbeat
   */
  async handleHeartbeat(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    const now = Date.now();
    agent.lastHeartbeat = now;

    // Update status if it was crashed
    if (agent.status === 'crashed') {
      agent.status = 'active';
      console.log(`[AgentRegistry] Agent ${agentId} recovered from crash`);
    }

    // Update Redis
    if (this.redis) {
      await this.redis.execute(async (client) => {
        const key = `agent:${agentId}`;
        await client.hSet(key, {
          lastHeartbeat: String(now),
          status: agent.status,
        });
      });
    }
  }

  /**
   * Check for crashed agents
   */
  async checkForCrashedAgents(): Promise<string[]> {
    const crashed: string[] = [];
    const now = Date.now();

    for (const [id, agent] of this.agents) {
      // Skip already crashed agents
      if (agent.status === 'crashed') {
        continue;
      }

      // Check if heartbeat timeout exceeded
      if (now - agent.lastHeartbeat > this.config.timeout) {
        agent.status = 'crashed';
        crashed.push(id);

        // Update Redis
        if (this.redis) {
          await this.redis.execute(async (client) => {
            await client.hSet(`agent:${id}`, 'status', 'crashed');
          });
        }

        console.log(`[AgentRegistry] Agent ${id} marked as crashed (last heartbeat: ${
          Math.round((now - agent.lastHeartbeat) / 1000)}s ago)`);
      }
    }

    return crashed;
  }

  /**
   * Update agent status
   */
  async updateAgentStatus(agentId: string, status: AgentStatus): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    agent.status = status;

    // Update Redis
    if (this.redis) {
      await this.redis.execute(async (client) => {
        await client.hSet(`agent:${agentId}`, 'status', status);
      });
    }
  }

  /**
   * Assign PR to agent
   */
  async assignPR(agentId: string, prId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    agent.assignedPR = prId;
    agent.status = 'working';

    // Update Redis
    if (this.redis) {
      await this.redis.execute(async (client) => {
        await client.hSet(`agent:${agentId}`, {
          assignedPR: prId,
          status: 'working',
        });
      });
    }

    console.log(`[AgentRegistry] Assigned PR ${prId} to agent ${agentId}`);
  }

  /**
   * Unassign PR from agent
   */
  async unassignPR(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    const prId = agent.assignedPR;
    agent.assignedPR = null;
    agent.status = 'idle';

    // Update Redis
    if (this.redis) {
      await this.redis.execute(async (client) => {
        const key = `agent:${agentId}`;
        await client.hDel(key, 'assignedPR');
        await client.hSet(key, 'status', 'idle');
      });
    }

    if (prId) {
      console.log(`[AgentRegistry] Unassigned PR ${prId} from agent ${agentId}`);
    }
  }

  /**
   * Remove agent
   */
  async removeAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }

    // Remove from memory
    this.agents.delete(agentId);

    // Remove from Redis
    if (this.redis) {
      await this.redis.execute(async (client) => {
        // Remove agent data
        await client.del(`agent:${agentId}`);

        // Remove agent's leases
        await client.del(`agent:${agentId}:leases`);
      });
    }

    console.log(`[AgentRegistry] Removed agent ${agentId}`);
  }

  /**
   * Get agent by ID
   */
  async getAgent(agentId: string): Promise<AgentInfo | null> {
    return this.agents.get(agentId) || null;
  }

  /**
   * Get all agents
   */
  async getAllAgents(): Promise<AgentInfo[]> {
    return Array.from(this.agents.values());
  }

  /**
   * Get active agents
   */
  async getActiveAgents(): Promise<AgentInfo[]> {
    return Array.from(this.agents.values()).filter(
      agent => agent.status !== 'crashed'
    );
  }

  /**
   * Get agents by type
   */
  async getAgentsByType(type: AgentType): Promise<AgentInfo[]> {
    return Array.from(this.agents.values()).filter(
      agent => agent.type === type
    );
  }

  /**
   * Get agents by status
   */
  async getAgentsByStatus(status: AgentStatus): Promise<AgentInfo[]> {
    return Array.from(this.agents.values()).filter(
      agent => agent.status === status
    );
  }

  /**
   * Get idle agents
   */
  async getIdleAgents(): Promise<AgentInfo[]> {
    return this.getAgentsByStatus('idle');
  }

  /**
   * Get statistics
   */
  getStatistics(): Record<string, number> {
    const stats: Record<string, number> = {
      total: this.agents.size,
      active: 0,
      idle: 0,
      working: 0,
      crashed: 0,
    };

    for (const agent of this.agents.values()) {
      stats[agent.status]++;
      stats[`type_${agent.type}`] = (stats[`type_${agent.type}`] || 0) + 1;
    }

    return stats;
  }

  /**
   * Get heartbeat configuration
   */
  getHeartbeatConfig(): Required<HeartbeatConfig> {
    return { ...this.config };
  }

  /**
   * Clear all agents (for testing)
   */
  async clearAll(): Promise<void> {
    this.agents.clear();

    if (this.redis) {
      await this.redis.execute(async (client) => {
        const keys = await client.keys('agent:*');
        if (keys.length > 0) {
          await client.del(keys);
        }
      });
    }
  }
}