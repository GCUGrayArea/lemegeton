#!/usr/bin/env node
/**
 * Lemegeton CLI
 *
 * Main entry point for the lemegeton command-line interface.
 * Provides subcommands for hub management, prompt access, and configuration.
 */

import { promptCommand } from './commands/prompt';

/**
 * Parse command-line arguments and route to appropriate handler.
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showUsage();
    process.exit(0);
  }

  const command = args[0];

  try {
    switch (command) {
      case 'prompt':
        await promptCommand(args.slice(1));
        break;

      case 'hub':
        console.error('Hub management not yet implemented');
        process.exit(1);
        break;

      case 'config':
        console.error('Configuration management not yet implemented');
        process.exit(1);
        break;

      case 'help':
      case '--help':
      case '-h':
        showUsage();
        process.exit(0);
        break;

      case 'version':
      case '--version':
      case '-v':
        showVersion();
        process.exit(0);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        showUsage();
        process.exit(1);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error('An unknown error occurred');
    }
    process.exit(1);
  }
}

/**
 * Display usage information.
 */
function showUsage() {
  console.log(`
Lemegeton - Agent Orchestration Framework

Usage:
  npx lemegeton <command> [options]

Commands:
  prompt <subcommand>    Access and manage prompts
  hub <subcommand>       Manage the Hub coordinator (not yet implemented)
  config <subcommand>    Manage configuration (not yet implemented)
  help                   Show this help message
  version                Show version information

Prompt Commands:
  prompt get <name>      Get a prompt by name (outputs YAML)
  prompt list            List all available prompts

Examples:
  npx lemegeton prompt get agent-defaults
  npx lemegeton prompt list

For more information, visit: https://github.com/gcugrayarea/lemegeton
  `.trim());
}

/**
 * Display version information.
 */
function showVersion() {
  // Import version from package.json
  const packageJson = require('../../package.json');
  console.log(`Lemegeton v${packageJson.version}`);
}

// Run main function
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
