/**
 * Plan Command
 *
 * Runs the planning agent to generate PRD and task list from a spec file.
 */

import { Command } from 'commander';
import { OutputFormatter } from '../formatters';
import { PlanningAgent } from '../../agents/planning/PlanningAgent';
import { MCPClient } from '../../mcp/client';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Create plan command
 */
export function createPlanCommand(): Command {
  return new Command('plan')
    .description('Run planning agent to generate PRD and task list from spec file')
    .argument('<spec-file>', 'Path to specification file')
    .option('--output <path>', 'Output path for generated files (default: docs)')
    .option('--interactive', 'Ask clarifying questions', true)
    .option('--no-interactive', 'Skip interactive questions')
    .option('--mcp', 'Enable MCP queries for tech decisions', false)
    .option('--auto-approve', 'Skip approval and commit automatically', false)
    .option('--skip-lemegeton-setup', 'Skip PR-000 Lemegeton setup', false)
    .action(async (specFile, options) => {
      await handlePlan(specFile, options);
    });
}

/**
 * Handle plan command
 */
async function handlePlan(specFile: string, options: any): Promise<void> {
  try {
    console.log(OutputFormatter.info(`Planning from spec: ${specFile}\n`));

    // Verify spec file exists
    if (!fs.existsSync(specFile)) {
      console.error(OutputFormatter.error(`Spec file not found: ${specFile}`));
      process.exit(1);
    }

    // Initialize MCP client if enabled
    let mcpClient: MCPClient | undefined;
    if (options.mcp) {
      console.log(OutputFormatter.info('Initializing MCP client...'));
      // Create MCP client with default config
      mcpClient = new MCPClient({
        servers: [],
        cache: {
          enabled: true,
          ttl: { default: 300 },
          maxSize: 100,
        },
        retry: {
          maxAttempts: 3,
          initialDelay: 1000,
          backoffMultiplier: 2,
          maxDelay: 5000,
        },
      });
      // MCP initialization would happen here
    }

    // Create planning agent
    const agent = new PlanningAgent('planning-001', {
      agentType: 'planning',
    });

    // Store MCP client and config separately (not part of AgentConfig)
    if (mcpClient) {
      (agent as any).mcpClient = mcpClient;
    }
    (agent as any).enableMCP = options.mcp;
    (agent as any).interactive = options.interactive;

    // Show configuration
    console.log('Configuration:');
    console.log(`  Output path: ${options.output || 'docs'}`);
    console.log(`  Interactive: ${options.interactive ? 'yes' : 'no'}`);
    console.log(`  MCP queries: ${options.mcp ? 'enabled' : 'disabled'}`);
    console.log(`  Auto-approve: ${options.autoApprove ? 'yes' : 'no'}`);
    console.log('');

    // Run planning workflow
    const result = await agent.plan(specFile, {
      outputPath: options.output || 'docs',
      interactive: options.interactive,
      enableMCP: options.mcp,
      autoApprove: options.autoApprove,
      skipLemegetonSetup: options.skipLemegetonSetup,
    });

    // Display results
    if (result.approved && result.documentsWritten) {
      console.log(OutputFormatter.success('\n✓ Planning complete!\n'));
      console.log(`  PRD: ${options.output || 'docs'}/prd.md`);
      console.log(`  Task list: ${options.output || 'docs'}/task-list.md`);
      console.log(`  PRs generated: ${result.prs.length}`);
      console.log('');
      console.log('Next steps:');
      console.log('  1. Review the generated documents');
      console.log('  2. Run `npx lemegeton hub start` to begin orchestration');
      process.exit(0);
    } else if (result.approved && !result.documentsWritten) {
      console.log(OutputFormatter.warning('\nDocuments generated but not written to disk'));
      console.log('Use --auto-approve to skip approval and commit automatically');
      process.exit(0);
    } else {
      console.log(OutputFormatter.warning('\n✗ Planning cancelled by user'));
      process.exit(0);
    }
  } catch (error) {
    console.error(OutputFormatter.error(`\nPlanning failed: ${(error as Error).message}`));
    if (process.env.DEBUG) {
      console.error((error as Error).stack);
    }
    process.exit(1);
  }
}
