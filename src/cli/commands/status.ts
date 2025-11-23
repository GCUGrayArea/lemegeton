/**
 * Status Command
 *
 * Show comprehensive system status including Hub, agents, and task progress.
 */

import { Command } from 'commander';
import { HubClient } from '../hubClient';
import { OutputFormatter } from '../formatters';
import { formatCLIError } from '../errors';

/**
 * Commander.js options for status command
 */
interface StatusCommandOptions {
  json?: boolean;
  watch?: boolean;
}

/**
 * Create status command
 */
export function createStatusCommand(): Command {
  return new Command('status')
    .description('Show system status')
    .option('--json', 'Output as JSON')
    .option('--watch', 'Continuous updates every 5 seconds')
    .action(async (options) => {
      await handleStatus(options);
    });
}

/**
 * Handle status command
 */
async function handleStatus(options: StatusCommandOptions): Promise<void> {
  const client = new HubClient();

  try {
    if (options.watch) {
      await watchStatus(client, options);
    } else {
      await showStatusOnce(client, options);
    }
  } catch (error) {
    console.error(formatCLIError(error as Error));
    process.exit(1);
  } finally {
    await client.close();
  }
}

/**
 * Show status once
 */
async function showStatusOnce(client: HubClient, options: StatusCommandOptions): Promise<void> {
  try {
    const status = await client.getStatus();
    const output = OutputFormatter.formatHubStatus(status, options.json);
    console.log(output);
  } catch (error) {
    throw error;
  }
}

/**
 * Watch status continuously
 */
async function watchStatus(client: HubClient, options: StatusCommandOptions): Promise<void> {
  console.log(OutputFormatter.info('Watching status (updates every 5 seconds)'));
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
    try {
      // Clear screen (ANSI escape code)
      if (!options.json) {
        process.stdout.write('\x1Bc');
      }

      const status = await client.getStatus();
      const output = OutputFormatter.formatHubStatus(status, options.json);
      console.log(output);

      if (!options.json) {
        console.log('');
        console.log(OutputFormatter.info('Press Ctrl+C to stop'));
      }

      // Wait before next iteration
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
      console.error(formatCLIError(error as Error));

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
}
