/**
 * QC (Quality Control) Agent
 *
 * Automated testing agent that verifies PR completions.
 * Can be spawned as a standalone process by the Hub.
 */

import { BaseAgent } from './base';
import { Assignment, WorkResult } from './types';

/**
 * QC agent implementation
 */
export class QCAgent extends BaseAgent {
  /**
   * Perform QC work for an assignment
   */
  async doWork(assignment: Assignment): Promise<WorkResult> {
    console.log(`[QCAgent] Starting QC for PR ${assignment.prId}`);

    try {
      // Stub implementation - actual QC would be done here
      // In a real implementation, this would:
      // 1. Pull latest changes
      // 2. Run test suite
      // 3. Check code coverage
      // 4. Run linters
      // 5. Report results

      // Simulate QC work
      await this.simulateQC(assignment);

      console.log(`[QCAgent] Completed QC for PR ${assignment.prId}`);

      return {
        success: true,
        prId: assignment.prId,
        message: 'All tests passed',
        metadata: {
          testsPassed: true,
          coverage: 85,
          lintErrors: 0,
        },
      };
    } catch (error) {
      console.error(`[QCAgent] QC failed for PR ${assignment.prId}:`, error);

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
      console.error('[QCAgent] Assignment missing PR ID');
      return false;
    }

    return true;
  }

  /**
   * Simulate QC work (for testing/development)
   */
  private async simulateQC(assignment: Assignment): Promise<void> {
    // Simulate test execution
    const testTime = Math.random() * 3000 + 2000; // 2-5 seconds
    await new Promise((resolve) => setTimeout(resolve, testTime));

    // Report progress
    if (this.prId) {
      await this.reportProgress({
        prId: this.prId,
        percentComplete: 50,
        message: 'Running tests...',
        timestamp: Date.now(),
      });
    }

    // Simulate more testing
    await new Promise((resolve) => setTimeout(resolve, testTime));
  }
}

/**
 * Start agent when run as standalone process
 */
if (require.main === module) {
  const agentId = process.env.AGENT_ID || 'qc-1';
  const agentType = process.env.AGENT_TYPE || 'qc';
  const redisUrl = process.env.REDIS_URL;
  const heartbeatInterval = parseInt(process.env.HEARTBEAT_INTERVAL || '30000', 10);
  const heartbeatTimeout = parseInt(process.env.HEARTBEAT_TIMEOUT || '90000', 10);

  console.log(`[QCAgent] Starting ${agentId}...`);
  console.log(`[QCAgent] Redis URL: ${redisUrl}`);

  const agent = new QCAgent(agentId, {
    agentType,
    redisUrl,
    heartbeatInterval,
    heartbeatTimeout,
  });

  // Handle process signals
  process.on('SIGTERM', async () => {
    console.log('[QCAgent] Received SIGTERM, shutting down...');
    try {
      await agent.stop();
      process.exit(0);
    } catch (error) {
      console.error('[QCAgent] Error during shutdown:', error);
      process.exit(1);
    }
  });

  process.on('SIGINT', async () => {
    console.log('[QCAgent] Received SIGINT, shutting down...');
    try {
      await agent.stop();
      process.exit(0);
    } catch (error) {
      console.error('[QCAgent] Error during shutdown:', error);
      process.exit(1);
    }
  });

  // Start the agent
  agent
    .start()
    .then(() => {
      console.log(`[QCAgent] ${agentId} started successfully`);
    })
    .catch((error) => {
      console.error('[QCAgent] Failed to start:', error);
      process.exit(1);
    });
}
