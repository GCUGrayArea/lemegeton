/**
 * Prompt CLI Command
 *
 * Provides access to bundled prompt files for agents and Hub.
 * Eliminates need for direct filesystem access to node_modules.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PromptName } from '../../types/prompts';

/**
 * Prompt command handler.
 *
 * @param args - Command arguments (excluding 'prompt')
 */
export async function promptCommand(args: string[]): Promise<void> {
  if (args.length === 0) {
    showPromptUsage();
    process.exit(1);
  }

  const subcommand = args[0];

  switch (subcommand) {
    case 'get':
      await getPrompt(args.slice(1));
      break;

    case 'list':
      await listPrompts();
      break;

    case 'validate':
      console.error('Prompt validation not yet implemented');
      process.exit(1);
      break;

    case 'help':
    case '--help':
    case '-h':
      showPromptUsage();
      process.exit(0);
      break;

    default:
      console.error(`Unknown prompt subcommand: ${subcommand}`);
      showPromptUsage();
      process.exit(1);
  }
}

/**
 * Get a prompt by name and output to stdout.
 *
 * @param args - Arguments (prompt name)
 */
async function getPrompt(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Error: Prompt name required');
    console.error('Usage: npx lemegeton prompt get <name>');
    process.exit(1);
  }

  const promptName = args[0];

  // Validate prompt name
  const validNames = Object.values(PromptName);
  if (!validNames.includes(promptName as PromptName)) {
    console.error(`Error: Prompt '${promptName}' not found`);
    console.error(`Available prompts: ${validNames.join(', ')}`);
    process.exit(1);
  }

  // Resolve prompt path
  // In production: node_modules/lemegeton/prompts/
  // In development: ../../prompts/ from compiled dist/cli/commands/
  const promptPath = resolvePromptPath(promptName);

  if (!fs.existsSync(promptPath)) {
    console.error(`Error: Prompt file not found at ${promptPath}`);
    console.error('This may indicate a corrupted installation.');
    process.exit(1);
  }

  // Read and output prompt
  try {
    const promptContent = fs.readFileSync(promptPath, 'utf8');
    console.log(promptContent);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error reading prompt: ${error.message}`);
    } else {
      console.error('Unknown error reading prompt');
    }
    process.exit(1);
  }
}

/**
 * List all available prompts with descriptions.
 */
async function listPrompts(): Promise<void> {
  const prompts = [
    {
      name: PromptName.PlanningAgent,
      description: 'Transform specs into PRD and task list',
    },
    {
      name: PromptName.AgentDefaults,
      description: 'Core coordination workflow',
    },
    {
      name: PromptName.CommitPolicy,
      description: 'Commit rules with hot/cold states',
    },
    {
      name: PromptName.CostGuidelines,
      description: 'Cost control and model routing',
    },
  ];

  console.log('Available prompts:');
  for (const prompt of prompts) {
    console.log(`  ${prompt.name.padEnd(20)} - ${prompt.description}`);
  }
}

/**
 * Resolve the path to a prompt file.
 *
 * Supports both development (from repo) and production (from node_modules).
 *
 * @param promptName - Name of the prompt
 * @returns Absolute path to prompt file
 */
function resolvePromptPath(promptName: string): string {
  // Try multiple paths to support different execution contexts
  const possiblePaths = [
    // Development: from compiled dist/cli/commands/
    path.join(__dirname, '../../../prompts', `${promptName}.yml`),
    // Production: from node_modules/lemegeton/dist/cli/commands/
    path.join(__dirname, '../../../prompts', `${promptName}.yml`),
    // Alternative: relative to package root
    path.join(process.cwd(), 'node_modules', 'lemegeton', 'prompts', `${promptName}.yml`),
  ];

  for (const promptPath of possiblePaths) {
    if (fs.existsSync(promptPath)) {
      return promptPath;
    }
  }

  // Fallback to first path for error reporting
  return possiblePaths[0];
}

/**
 * Show usage information for prompt command.
 */
function showPromptUsage() {
  console.log(`
Lemegeton Prompt Commands

Usage:
  npx lemegeton prompt <subcommand> [options]

Subcommands:
  get <name>       Get a prompt by name (outputs YAML)
  list             List all available prompts
  validate <file>  Validate a custom prompt file (not yet implemented)
  help             Show this help message

Available prompt names:
  ${Object.values(PromptName).join(', ')}

Examples:
  # Get the agent-defaults prompt
  npx lemegeton prompt get agent-defaults

  # List all available prompts
  npx lemegeton prompt list

  # Get planning-agent prompt and save to file
  npx lemegeton prompt get planning-agent > my-planning-prompt.yml
  `.trim());
}
