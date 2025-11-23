/**
 * Worker Agent
 *
 * General-purpose coding agent for implementing PRs.
 * Can be spawned as a standalone process by the Hub.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { BaseAgent } from './base';
import { Assignment, WorkResult } from './types';
import { AnthropicClient } from '../llm/AnthropicClient';
import { RedisClient } from '../redis/client';

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
      // 1. Read PRD
      await this.reportProgress({
        prId: assignment.prId,
        percentComplete: 10,
        message: 'Reading PRD...',
        timestamp: Date.now(),
      });

      const prd = await this.readPRD(assignment.prId);
      if (!prd) {
        throw new Error(`PRD not found for ${assignment.prId}`);
      }

      // 2. Get PR data from Redis for full context
      const prData = await this.fetchPRData(assignment.prId);
      if (!prData) {
        throw new Error(`PR data not found for ${assignment.prId}`);
      }

      // 3. Check for API key
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY not set. Cannot generate code.');
      }

      // 4. Generate implementation using Claude
      await this.reportProgress({
        prId: assignment.prId,
        percentComplete: 20,
        message: 'Generating implementation...',
        timestamp: Date.now(),
      });

      const implementation = await this.generateImplementation(prd, prData, apiKey);

      // 5. Write files
      await this.reportProgress({
        prId: assignment.prId,
        percentComplete: 60,
        message: 'Writing files...',
        timestamp: Date.now(),
      });

      const filesModified = await this.writeFiles(implementation.files);

      // 6. Run build to verify
      await this.reportProgress({
        prId: assignment.prId,
        percentComplete: 80,
        message: 'Running build...',
        timestamp: Date.now(),
      });

      const buildResult = await this.runBuild();
      if (!buildResult.success) {
        throw new Error(`Build failed: ${buildResult.error}`);
      }

      // 7. Update PR state to 'implemented'
      await this.reportProgress({
        prId: assignment.prId,
        percentComplete: 90,
        message: 'Updating state...',
        timestamp: Date.now(),
      });

      await this.updatePRState(assignment.prId, 'implemented');

      console.log(`[WorkerAgent] Completed work on PR ${assignment.prId}`);

      return {
        success: true,
        prId: assignment.prId,
        filesModified,
        output: `Implementation completed. Modified ${filesModified.length} files.`,
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

    // Assignment doesn't require description field
    // Just check that we have something to work on
    if (!assignment.files || assignment.files.length === 0) {
      console.log('[WorkerAgent] Warning: No files specified in assignment');
    }

    return true;
  }

  /**
   * Read PRD file for the PR
   */
  private async readPRD(prId: string): Promise<string | null> {
    try {
      const plansDir = path.join(process.cwd(), 'docs', 'plans');
      const files = await fs.readdir(plansDir);

      // Find PRD file that starts with the PR ID
      const prdFile = files.find(f => f.startsWith(prId) && f.endsWith('.md'));
      if (!prdFile) {
        console.error(`[WorkerAgent] No PRD file found for ${prId}`);
        return null;
      }

      const prdPath = path.join(plansDir, prdFile);
      const content = await fs.readFile(prdPath, 'utf-8');

      console.log(`[WorkerAgent] Read PRD from ${prdPath}`);
      return content;
    } catch (error) {
      console.error(`[WorkerAgent] Error reading PRD:`, error);
      return null;
    }
  }

  /**
   * Fetch PR data from Redis
   */
  private async fetchPRData(prId: string): Promise<any> {
    const redisClient = new RedisClient(this.config.redisUrl || 'redis://localhost:6379');

    try {
      await redisClient.connect();

      const prsDataStr = await redisClient.getClient()?.get('state:prs');
      if (!prsDataStr) {
        await redisClient.disconnect();
        return null;
      }

      const prsData = JSON.parse(prsDataStr);
      const prData = prsData[prId];

      await redisClient.disconnect();

      return prData || null;
    } catch (error) {
      console.error(`[WorkerAgent] Error fetching PR data:`, error);
      await redisClient.disconnect();
      throw error;
    }
  }

  /**
   * Generate implementation using Claude API
   */
  private async generateImplementation(
    prd: string,
    prData: any,
    apiKey: string
  ): Promise<{ files: Array<{ path: string; content: string; action: string }> }> {
    const client = new AnthropicClient({ apiKey });

    // Build prompt for Claude
    const systemPrompt = `You are an expert TypeScript developer implementing features for the Lemegeton agent orchestration system.

Your task is to implement the changes described in the PRD below. Follow these guidelines:
- Write clean, well-documented TypeScript code
- Follow existing code patterns in the codebase
- Include proper error handling
- Write code that will pass TypeScript compilation
- For each file, specify the action: 'create', 'modify', or 'delete'

Respond with ONLY a JSON object in this exact format:
{
  "files": [
    {
      "path": "relative/path/to/file.ts",
      "action": "create",
      "content": "file contents here"
    }
  ]
}`;

    const userPrompt = `# PRD

${prd}

# PR Metadata

- PR ID: ${prData.id}
- Title: ${prData.title}
- Dependencies: ${prData.dependencies?.join(', ') || 'none'}

# Files to Implement

${prData.estimated_files?.map((f: any) => `- ${f.path}: ${f.description || f.action}`).join('\n') || 'Not specified'}

Please implement this PR according to the PRD.`;

    console.log('[WorkerAgent] Sending request to Claude API...');

    const response = await client.generate({
      model: prData.complexity?.suggested_model === 'opus' ? 'claude-opus-4-20250514' :
             prData.complexity?.suggested_model === 'haiku' ? 'claude-3-5-haiku-20241022' :
             'claude-3-5-sonnet-20241022',
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt }
      ],
      maxTokens: 8000,
      temperature: 0.3,
    });

    console.log('[WorkerAgent] Received response from Claude API');

    // Parse JSON response
    try {
      const implementation = JSON.parse(response.content);
      return implementation;
    } catch (error) {
      console.error('[WorkerAgent] Failed to parse Claude response as JSON');
      console.error('Response:', response.content);
      throw new Error('Invalid JSON response from Claude API');
    }
  }

  /**
   * Write files to disk
   */
  private async writeFiles(files: Array<{ path: string; content: string; action: string }>): Promise<string[]> {
    const written: string[] = [];

    for (const file of files) {
      const fullPath = path.join(process.cwd(), file.path);

      try {
        if (file.action === 'delete') {
          await fs.unlink(fullPath);
          console.log(`[WorkerAgent] Deleted ${file.path}`);
        } else {
          // Ensure directory exists
          const dir = path.dirname(fullPath);
          await fs.mkdir(dir, { recursive: true });

          // Write file
          await fs.writeFile(fullPath, file.content, 'utf-8');
          console.log(`[WorkerAgent] ${file.action === 'create' ? 'Created' : 'Modified'} ${file.path}`);
        }

        written.push(file.path);
      } catch (error) {
        console.error(`[WorkerAgent] Error writing file ${file.path}:`, error);
        throw error;
      }
    }

    return written;
  }

  /**
   * Run TypeScript build to verify compilation
   */
  private async runBuild(): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      console.log('[WorkerAgent] Running npm run build...');

      const build = spawn('npm', ['run', 'build'], {
        cwd: process.cwd(),
        shell: true,
      });

      let output = '';
      let errorOutput = '';

      build.stdout?.on('data', (data) => {
        output += data.toString();
      });

      build.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      build.on('close', (code) => {
        if (code === 0) {
          console.log('[WorkerAgent] Build succeeded');
          resolve({ success: true });
        } else {
          console.error('[WorkerAgent] Build failed');
          console.error('Output:', output);
          console.error('Error:', errorOutput);
          resolve({ success: false, error: errorOutput || output });
        }
      });

      build.on('error', (error) => {
        console.error('[WorkerAgent] Build process error:', error);
        resolve({ success: false, error: error.message });
      });
    });
  }

  /**
   * Update PR state in Redis
   */
  private async updatePRState(prId: string, newState: string): Promise<void> {
    const redisClient = new RedisClient(this.config.redisUrl || 'redis://localhost:6379');

    try {
      await redisClient.connect();

      const prsDataStr = await redisClient.getClient()?.get('state:prs');
      if (!prsDataStr) {
        throw new Error('No PRs found in Redis state');
      }

      const prsData = JSON.parse(prsDataStr);
      if (!prsData[prId]) {
        throw new Error(`PR ${prId} not found in Redis state`);
      }

      prsData[prId].cold_state = newState;

      await redisClient.getClient()?.set('state:prs', JSON.stringify(prsData));

      console.log(`[WorkerAgent] Updated ${prId} state to: ${newState}`);

      await redisClient.disconnect();
    } catch (error) {
      console.error(`[WorkerAgent] Error updating PR state:`, error);
      await redisClient.disconnect();
      throw error;
    }
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
