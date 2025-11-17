#!/usr/bin/env node
/**
 * Lemegeton CLI
 *
 * Main entry point for the lemegeton command-line interface.
 * Provides comprehensive command structure using Commander.js.
 */

import { Command } from 'commander';
import { createHubCommands } from './commands/hub';
import { createRunCommand } from './commands/run';
import { createStatusCommand } from './commands/status';
import { createPlanCommand } from './commands/plan';
import { createDashboardCommand } from './commands/dashboard';
import { promptCommand } from './commands/prompt';
import { formatCLIError, getExitCode } from './errors';

/**
 * Get package version
 */
function getVersion(): string {
  const packageJson = require('../../package.json');
  return packageJson.version;
}

/**
 * Create prompt commands (legacy wrapper for Commander.js)
 */
function createPromptCommands(): Command {
  const prompt = new Command('prompt')
    .description('Access and manage prompts');

  prompt.command('get <name>')
    .description('Get a prompt by name (outputs YAML)')
    .action(async (name) => {
      await promptCommand(['get', name]);
    });

  prompt.command('list')
    .description('List all available prompts')
    .action(async () => {
      await promptCommand(['list']);
    });

  return prompt;
}

/**
 * Main CLI entry point
 */
async function main() {
  const program = new Command();

  program
    .name('lemegeton')
    .description('Multi-agent task orchestration system')
    .version(getVersion(), '-v, --version', 'Show version information')
    .helpOption('-h, --help', 'Show help');

  // Add command groups
  program.addCommand(createHubCommands());
  program.addCommand(createRunCommand());
  program.addCommand(createStatusCommand());
  program.addCommand(createPlanCommand());
  program.addCommand(createDashboardCommand());
  program.addCommand(createPromptCommands());

  // Add examples to help
  program.addHelpText('after', `
Examples:
  # Hub Management
  lemegeton hub start           Start the hub daemon
  lemegeton hub stop            Stop the hub daemon
  lemegeton hub status          Check hub status

  # Web Dashboard
  lemegeton dashboard           Launch web-based dashboard
  lemegeton dashboard -p 8080   Launch dashboard on custom port

  # Work Execution
  lemegeton run                 Run all available work
  lemegeton run PR-009          Run specific PR

  # Status Monitoring
  lemegeton status              Show system status
  lemegeton status --watch      Watch status continuously

  # Planning & Prompts
  lemegeton plan <spec.md>      Generate PRD and task list from spec
  lemegeton prompt list         List all available prompts
  lemegeton prompt get <name>   Get a prompt file

For more information, visit: https://github.com/gcugrayarea/lemegeton
  `);

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    console.error(formatCLIError(error as Error));
    process.exit(getExitCode(error as Error));
  }
}

// Run main function
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
