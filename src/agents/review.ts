/**
 * Review Agent
 *
 * Performs code review on completed PRs.
 * Can be spawned as a standalone process by the Hub.
 */

import { BaseAgent } from './base';
import { Assignment, WorkResult } from './types';

/**
 * Review agent implementation
 */
export class ReviewAgent extends BaseAgent {
  /**
   * Perform code review
   */
  async doWork(assignment: Assignment): Promise<WorkResult> {
    console.log(`[ReviewAgent] Starting review for PR ${assignment.prId}`);

    try {
      // Stub implementation - actual review would be done here
      // In a real implementation, this would:
      // 1. Read changed files
      // 2. Check code quality
      // 3. Check for anti-patterns
      // 4. Verify best practices
      // 5. Generate review comments

      // Simulate review work
      await this.simulateReview(assignment);

      console.log(`[ReviewAgent] Completed review for PR ${assignment.prId}`);

      return {
        success: true,
        prId: assignment.prId,
        output: 'Review completed - approved with 2 comments',
      };
    } catch (error) {
      console.error(`[ReviewAgent] Review failed for PR ${assignment.prId}:`, error);

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
      console.error('[ReviewAgent] Assignment missing PR ID');
      return false;
    }

    return true;
  }

  /**
   * Simulate review work (for testing/development)
   */
  private async simulateReview(assignment: Assignment): Promise<void> {
    // Simulate review taking some time
    const reviewTime = Math.random() * 4000 + 2000; // 2-6 seconds
    await new Promise((resolve) => setTimeout(resolve, reviewTime));

    // Report progress
    if (this.prId) {
      await this.reportProgress({
        prId: this.prId,
        percentComplete: 50,
        message: 'Analyzing code quality...',
        timestamp: Date.now(),
      });
    }

    // Simulate more review
    await new Promise((resolve) => setTimeout(resolve, reviewTime));
  }
}

/**
 * Start agent when run as standalone process
 */
if (require.main === module) {
  const agentId = process.env.AGENT_ID || 'review-1';
  const agentType = process.env.AGENT_TYPE || 'review';
  const redisUrl = process.env.REDIS_URL;
  const heartbeatInterval = parseInt(process.env.HEARTBEAT_INTERVAL || '30000', 10);
  const heartbeatTimeout = parseInt(process.env.HEARTBEAT_TIMEOUT || '90000', 10);

  console.log(`[ReviewAgent] Starting ${agentId}...`);
  console.log(`[ReviewAgent] Redis URL: ${redisUrl}`);

  const agent = new ReviewAgent(agentId, {
    agentType,
    redisUrl,
    heartbeatInterval,
    heartbeatTimeout,
  });

  // Handle process signals
  process.on('SIGTERM', async () => {
    console.log('[ReviewAgent] Received SIGTERM, shutting down...');
    try {
      await agent.stop();
      process.exit(0);
    } catch (error) {
      console.error('[ReviewAgent] Error during shutdown:', error);
      process.exit(1);
    }
  });

  process.on('SIGINT', async () => {
    console.log('[ReviewAgent] Received SIGINT, shutting down...');
    try {
      await agent.stop();
      process.exit(0);
    } catch (error) {
      console.error('[ReviewAgent] Error during shutdown:', error);
      process.exit(1);
    }
  });

  // Start the agent
  agent
    .start()
    .then(() => {
      console.log(`[ReviewAgent] ${agentId} started successfully`);
    })
    .catch((error) => {
      console.error('[ReviewAgent] Failed to start:', error);
      process.exit(1);
    });
}
