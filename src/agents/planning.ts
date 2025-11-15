/**
 * Planning Agent
 *
 * Generates PRDs and task lists from specifications.
 * Can be spawned as a standalone process by the Hub.
 */

import { BaseAgent } from './base';
import { Assignment, WorkResult } from './types';

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
      // Stub implementation - actual planning would be done here
      // In a real implementation, this would:
      // 1. Read specification
      // 2. Generate PRD
      // 3. Break down into tasks
      // 4. Estimate complexity
      // 5. Create task-list.md

      // Simulate planning work
      await this.simulatePlanning(assignment);

      console.log(`[PlanningAgent] Completed planning for ${assignment.prId}`);

      return {
        success: true,
        prId: assignment.prId,
        message: 'Planning completed',
        metadata: {
          tasksGenerated: 10,
          estimatedHours: 20,
        },
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

    if (!assignment.description) {
      console.error('[PlanningAgent] Assignment missing specification');
      return false;
    }

    return true;
  }

  /**
   * Simulate planning work (for testing/development)
   */
  private async simulatePlanning(assignment: Assignment): Promise<void> {
    // Simulate planning taking some time
    const planTime = Math.random() * 5000 + 3000; // 3-8 seconds
    await new Promise((resolve) => setTimeout(resolve, planTime));

    // Report progress
    if (this.prId) {
      await this.reportProgress({
        prId: this.prId,
        percentComplete: 50,
        message: 'Generating task breakdown...',
        timestamp: Date.now(),
      });
    }

    // Simulate more planning
    await new Promise((resolve) => setTimeout(resolve, planTime));
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
