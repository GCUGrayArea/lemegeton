/**
 * Worker Agent
 *
 * General-purpose coding agent for implementing PRs.
 * Can be spawned as a standalone process by the Hub.
 */

import { BaseAgent } from './base';
import { Assignment, WorkResult } from './types';

/**
 * Worker agent implementation
 */
export class WorkerAgent extends BaseAgent {
  /**
   * Perform work for an assignment
   */
  async doWork(assignment: Assignment): Promise<WorkResult> {
    console.log(`[WorkerAgent] Starting work on PR ${assignment.prId}`);

    try {
      // Stub implementation - actual work would be done here
      // In a real implementation, this would:
      // 1. Acquire file leases
      // 2. Read task description
      // 3. Implement changes
      // 4. Run local tests
      // 5. Commit changes
      // 6. Release leases

      // Simulate work
      await this.simulateWork(assignment);

      console.log(`[WorkerAgent] Completed work on PR ${assignment.prId}`);

      return {
        success: true,
        prId: assignment.prId,
        filesModified: assignment.files || [],
        message: 'Work completed successfully',
      };
    } catch (error) {
      console.error(`[WorkerAgent] Failed to complete PR ${assignment.prId}:`, error);

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
      console.error('[WorkerAgent] Assignment missing PR ID');
      return false;
    }

    if (!assignment.description && !assignment.files) {
      console.error('[WorkerAgent] Assignment missing description and files');
      return false;
    }

    return true;
  }

  /**
   * Simulate work (for testing/development)
   */
  private async simulateWork(assignment: Assignment): Promise<void> {
    // Simulate work taking some time
    const workTime = Math.random() * 2000 + 1000; // 1-3 seconds
    await new Promise((resolve) => setTimeout(resolve, workTime));

    // Report progress midway
    if (this.prId) {
      await this.reportProgress({
        prId: this.prId,
        percentComplete: 50,
        message: 'Implementation in progress',
        timestamp: Date.now(),
      });
    }

    // Simulate more work
    await new Promise((resolve) => setTimeout(resolve, workTime));
  }
}

/**
 * Start agent when run as standalone process
 */
if (require.main === module) {
  const agentId = process.env.AGENT_ID || 'worker-1';
  const agentType = process.env.AGENT_TYPE || 'worker';
  const redisUrl = process.env.REDIS_URL;
  const heartbeatInterval = parseInt(process.env.HEARTBEAT_INTERVAL || '30000', 10);
  const heartbeatTimeout = parseInt(process.env.HEARTBEAT_TIMEOUT || '90000', 10);

  console.log(`[WorkerAgent] Starting ${agentId}...`);
  console.log(`[WorkerAgent] Redis URL: ${redisUrl}`);

  const agent = new WorkerAgent(agentId, {
    agentType,
    redisUrl,
    heartbeatInterval,
    heartbeatTimeout,
  });

  // Handle process signals
  process.on('SIGTERM', async () => {
    console.log('[WorkerAgent] Received SIGTERM, shutting down...');
    try {
      await agent.stop();
      process.exit(0);
    } catch (error) {
      console.error('[WorkerAgent] Error during shutdown:', error);
      process.exit(1);
    }
  });

  process.on('SIGINT', async () => {
    console.log('[WorkerAgent] Received SIGINT, shutting down...');
    try {
      await agent.stop();
      process.exit(0);
    } catch (error) {
      console.error('[WorkerAgent] Error during shutdown:', error);
      process.exit(1);
    }
  });

  // Start the agent
  agent
    .start()
    .then(() => {
      console.log(`[WorkerAgent] ${agentId} started successfully`);
    })
    .catch((error) => {
      console.error('[WorkerAgent] Failed to start:', error);
      process.exit(1);
    });
}
