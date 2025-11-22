/**
 * Planning Agent
 *
 * Generates PRDs and task lists from specifications.
 * Can be spawned as a standalone process by the Hub.
 */

import { BaseAgent } from './base';
import { Assignment, WorkResult } from './types';
import * as fs from 'fs/promises';
import * as path from 'path';
import { RedisClient } from '../redis/client';

/**
 * Planning agent implementation
 */
export class PlanningAgent extends BaseAgent {
  /**
   * Perform planning work
   */
  async doWork(assignment: Assignment): Promise<WorkResult> {
    console.log(`[PlanningAgent] Starting planning for ${assignment.prId}`);

    try {
      // 1. Fetch PR details from Redis
      const prData = await this.fetchPRData(assignment.prId);
      if (!prData) {
        throw new Error(`PR data not found for ${assignment.prId}`);
      }

      console.log(`[PlanningAgent] Fetched PR data for ${assignment.prId}`);

      // 2. Report progress
      if (this.prId) {
        await this.reportProgress({
          prId: this.prId,
          percentComplete: 25,
          message: 'Analyzing requirements...',
          timestamp: Date.now(),
        });
      }

      // 3. Generate implementation plan
      const plan = await this.generatePlan(prData);

      // 4. Report progress
      if (this.prId) {
        await this.reportProgress({
          prId: this.prId,
          percentComplete: 50,
          message: 'Creating PRD document...',
          timestamp: Date.now(),
        });
      }

      // 5. Create PRD document
      const prdPath = await this.createPRD(assignment.prId, prData, plan);

      // 6. Report progress
      if (this.prId) {
        await this.reportProgress({
          prId: this.prId,
          percentComplete: 75,
          message: 'Updating PR state...',
          timestamp: Date.now(),
        });
      }

      // 7. Update PR state to 'planned'
      await this.updatePRState(assignment.prId, 'planned');

      console.log(`[PlanningAgent] Completed planning for ${assignment.prId}`);

      return {
        success: true,
        prId: assignment.prId,
        output: `Planning completed. PRD created at ${prdPath}`,
        filesModified: [prdPath],
      };
    } catch (error) {
      console.error(`[PlanningAgent] Planning failed for ${assignment.prId}:`, error);

      return {
        success: false,
        prId: assignment.prId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Validate assignment before accepting
   */
  async validateAssignment(assignment: Assignment): Promise<boolean> {
    // Check required fields
    if (!assignment.prId) {
      console.error('[PlanningAgent] Assignment missing PR ID');
      return false;
    }

    // Assignment structure doesn't include description field
    // This is acceptable for planning agents

    return true;
  }

  /**
   * Fetch PR data from Redis
   */
  private async fetchPRData(prId: string): Promise<any> {
    const redisClient = new RedisClient(this.config.redisUrl || 'redis://localhost:6379');

    try {
      await redisClient.connect();

      // Fetch PR data from Redis
      const prKey = `pr:${prId}`;
      const prDataStr = await redisClient.getClient()?.get(prKey);

      if (!prDataStr) {
        return null;
      }

      const prData = JSON.parse(prDataStr);
      await redisClient.disconnect();

      return prData;
    } catch (error) {
      console.error(`[PlanningAgent] Error fetching PR data:`, error);
      await redisClient.disconnect();
      throw error;
    }
  }

  /**
   * Generate implementation plan from PR data
   */
  private async generatePlan(prData: any): Promise<string> {
    const lines: string[] = [];

    lines.push(`# Implementation Plan: ${prData.title}`);
    lines.push('');
    lines.push(`**PR ID:** ${prData.pr_id}`);
    lines.push(`**Complexity:** ${prData.complexity?.score || 'unknown'} (${prData.complexity?.estimated_minutes || 'unknown'} minutes)`);
    lines.push(`**Suggested Model:** ${prData.complexity?.suggested_model || 'sonnet'}`);
    lines.push('');

    // Dependencies
    if (prData.dependencies && prData.dependencies.length > 0) {
      lines.push('## Dependencies');
      lines.push('');
      lines.push('This PR depends on:');
      for (const dep of prData.dependencies) {
        lines.push(`- ${dep}`);
      }
      lines.push('');
    }

    // Description
    if (prData.description) {
      lines.push('## Description');
      lines.push('');
      lines.push(prData.description);
      lines.push('');
    }

    // Files to implement
    if (prData.estimated_files && prData.estimated_files.length > 0) {
      lines.push('## Files to Implement');
      lines.push('');
      for (const file of prData.estimated_files) {
        lines.push(`### ${file.path}`);
        if (file.description) {
          lines.push('');
          lines.push(file.description);
        }
        lines.push('');
      }
    }

    // Implementation steps
    lines.push('## Implementation Steps');
    lines.push('');
    lines.push('1. Review dependencies and ensure they are completed');
    lines.push('2. Set up file structure based on estimated files');
    lines.push('3. Implement core functionality');
    lines.push('4. Add error handling and edge cases');
    lines.push('5. Write tests');
    lines.push('6. Update documentation');
    lines.push('');

    // Testing strategy
    lines.push('## Testing Strategy');
    lines.push('');
    lines.push('- Unit tests for all new functions/classes');
    lines.push('- Integration tests for system interactions');
    lines.push('- Edge case coverage');
    lines.push('- Error handling verification');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Create PRD document
   */
  private async createPRD(prId: string, prData: any, plan: string): Promise<string> {
    // Generate filename slug from title
    const slug = prData.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const filename = `${prId}-${slug}.md`;
    const prdDir = path.join(process.cwd(), 'docs', 'plans');
    const prdPath = path.join(prdDir, filename);

    // Ensure directory exists
    await fs.mkdir(prdDir, { recursive: true });

    // Write PRD file
    await fs.writeFile(prdPath, plan, 'utf-8');

    console.log(`[PlanningAgent] Created PRD at ${prdPath}`);

    return prdPath;
  }

  /**
   * Update PR state in Redis
   */
  private async updatePRState(prId: string, newState: string): Promise<void> {
    const redisClient = new RedisClient(this.config.redisUrl || 'redis://localhost:6379');

    try {
      await redisClient.connect();

      // Fetch current PR data
      const prKey = `pr:${prId}`;
      const prDataStr = await redisClient.getClient()?.get(prKey);

      if (!prDataStr) {
        throw new Error(`PR ${prId} not found in Redis`);
      }

      const prData = JSON.parse(prDataStr);
      prData.cold_state = newState;

      // Update in Redis
      await redisClient.getClient()?.set(prKey, JSON.stringify(prData));

      console.log(`[PlanningAgent] Updated ${prId} state to: ${newState}`);

      await redisClient.disconnect();
    } catch (error) {
      console.error(`[PlanningAgent] Error updating PR state:`, error);
      await redisClient.disconnect();
      throw error;
    }
  }
}

/**
 * Start agent when run as standalone process
 */
if (require.main === module) {
  const agentId = process.env.AGENT_ID || 'planning-1';
  const agentType = process.env.AGENT_TYPE || 'planning';
  const redisUrl = process.env.REDIS_URL;
  const heartbeatInterval = parseInt(process.env.HEARTBEAT_INTERVAL || '30000', 10);
  const heartbeatTimeout = parseInt(process.env.HEARTBEAT_TIMEOUT || '90000', 10);

  console.log(`[PlanningAgent] Starting ${agentId}...`);
  console.log(`[PlanningAgent] Redis URL: ${redisUrl}`);

  const agent = new PlanningAgent(agentId, {
    agentType,
    redisUrl,
    heartbeatInterval,
    heartbeatTimeout,
  });

  // Handle process signals
  process.on('SIGTERM', async () => {
    console.log('[PlanningAgent] Received SIGTERM, shutting down...');
    try {
      await agent.stop();
      process.exit(0);
    } catch (error) {
      console.error('[PlanningAgent] Error during shutdown:', error);
      process.exit(1);
    }
  });

  process.on('SIGINT', async () => {
    console.log('[PlanningAgent] Received SIGINT, shutting down...');
    try {
      await agent.stop();
      process.exit(0);
    } catch (error) {
      console.error('[PlanningAgent] Error during shutdown:', error);
      process.exit(1);
    }
  });

  // Start the agent
  agent
    .start()
    .then(() => {
      console.log(`[PlanningAgent] ${agentId} started successfully`);
    })
    .catch((error) => {
      console.error('[PlanningAgent] Failed to start:', error);
      process.exit(1);
    });
}
