/**
 * Run Command
 *
 * Execute work - either a specific PR or the full task list.
 */

import { Command } from 'commander';
import ora from 'ora';
import { HubClient, RunOptions } from '../hubClient';
import { OutputFormatter } from '../formatters';
import { formatCLIError } from '../errors';

/**
 * Commander.js options for run command
 */
interface RunCommandOptions {
  watch?: boolean;
  agent?: string;
  model?: string;
  budget?: number;
  dryRun?: boolean;
}

/**
 * Create run command
 */
export function createRunCommand(): Command {
  return new Command('run')
    .description('Execute work')
    .argument('[pr-id]', 'Specific PR to run (e.g., PR-009)')
    .option('--watch', 'Watch mode - continuous execution')
    .option('--agent <type>', 'Specific agent type to use')
    .option('--model <tier>', 'Force specific model tier (haiku|sonnet|opus)')
    .option('--budget <amount>', 'Cost budget limit', parseFloat)
    .option('--dry-run', 'Simulate without executing')
    .action(async (prId, options) => {
      await handleRun(prId, options);
    });
}

/**
 * Handle run command
 */
async function handleRun(prId: string | undefined, options: RunCommandOptions): Promise<void> {
  const client = new HubClient();

  const runOptions: RunOptions = {
    watch: options.watch,
    agent: options.agent,
    model: options.model,
    budget: options.budget,
    dryRun: options.dryRun
  };

  try {
    if (prId) {
      // Run specific PR
      await runSinglePR(client, prId, runOptions);
    } else {
      // Run all available work
      await runAllWork(client, runOptions);
    }
  } catch (error) {
    console.error(formatCLIError(error as Error));
    process.exit(1);
  } finally {
    await client.close();
  }
}

/**
 * Run a single PR
 */
async function runSinglePR(
  client: HubClient,
  prId: string,
  options: RunOptions
): Promise<void> {
  const spinner = ora(`Running ${prId}...`).start();

  try {
    const result = await client.runPR(prId, options);

    if (result.success) {
      spinner.succeed();
      console.log(OutputFormatter.formatWorkResult(result));
    } else {
      spinner.fail();
      console.log(OutputFormatter.formatWorkResult(result));
      process.exit(1);
    }
  } catch (error) {
    spinner.fail(`Failed to run ${prId}`);
    throw error;
  }
}

/**
 * Run all available work
 */
async function runAllWork(
  client: HubClient,
  options: RunOptions
): Promise<void> {
  if (options.watch) {
    await runWatchMode(client, options);
  } else {
    await runOnce(client, options);
  }
}

/**
 * Run all work once
 */
async function runOnce(client: HubClient, options: RunOptions): Promise<void> {
  const spinner = ora('Running all available work...').start();

  try {
    const results = await client.runAll(options);

    if (results.length === 0) {
      spinner.info('No work available');
      return;
    }

    spinner.succeed(`Completed ${results.length} tasks`);

    // Display results
    for (const result of results) {
      console.log(OutputFormatter.formatWorkResult(result));
    }

    // Check for failures
    const failures = results.filter(r => !r.success);
    if (failures.length > 0) {
      console.log('');
      console.log(OutputFormatter.error(`${failures.length} task(s) failed`));
      process.exit(1);
    }
  } catch (error) {
    spinner.fail('Failed to run work');
    throw error;
  }
}

/**
 * Run in watch mode
 */
async function runWatchMode(client: HubClient, options: RunOptions): Promise<void> {
  console.log(OutputFormatter.info('Starting watch mode...'));
  console.log(OutputFormatter.info('Press Ctrl+C to stop'));
  console.log('');

  // Set up signal handlers
  let stopping = false;
  process.on('SIGINT', () => {
    if (!stopping) {
      stopping = true;
      console.log('');
      console.log(OutputFormatter.info('Stopping watch mode...'));
      process.exit(0);
    }
  });

  // Watch loop
  while (!stopping) {
    const spinner = ora('Checking for work...').start();

    try {
      const results = await client.runAll(options);

      if (results.length === 0) {
        spinner.info('No work available');
      } else {
        spinner.succeed(`Completed ${results.length} tasks`);

        // Display results
        for (const result of results) {
          console.log(OutputFormatter.formatWorkResult(result));
        }
      }

      // Wait before next iteration
      console.log('');
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
      spinner.fail('Error in watch mode');
      console.error(formatCLIError(error as Error));

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
}
