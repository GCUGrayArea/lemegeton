/**
 * Hub Commands
 *
 * CLI commands for managing the Hub daemon (start, stop, status, restart).
 */

import { Command } from 'commander';
import ora from 'ora';
import { HubClient } from '../hubClient';
import { OutputFormatter } from '../formatters';
import { formatCLIError } from '../errors';

/**
 * Commander.js options for hub start command
 */
interface HubStartOptions {
  config?: string;
  foreground?: boolean;
  verbose?: boolean;
}

/**
 * Commander.js options for hub stop command
 */
interface HubStopOptions {
  force?: boolean;
  timeout: string;
}

/**
 * Commander.js options for hub status command
 */
interface HubStatusOptions {
  json?: boolean;
}

/**
 * Commander.js options for hub restart command
 */
interface HubRestartOptions {
  timeout: string;
}

/**
 * Create hub command group
 */
export function createHubCommands(): Command {
  const hub = new Command('hub')
    .description('Hub daemon management');

  // hub start
  hub.command('start')
    .description('Start hub daemon')
    .option('--config <path>', 'Config file path')
    .option('--foreground', 'Run in foreground with logs')
    .option('--verbose', 'Enable verbose logging')
    .action(async (options) => {
      await handleHubStart(options);
    });

  // hub stop
  hub.command('stop')
    .description('Stop hub daemon')
    .option('--force', 'Force stop without graceful shutdown')
    .option('--timeout <ms>', 'Shutdown timeout in milliseconds', '30000')
    .action(async (options) => {
      await handleHubStop(options);
    });

  // hub status
  hub.command('status')
    .description('Show hub status')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      await handleHubStatus(options);
    });

  // hub restart
  hub.command('restart')
    .description('Restart hub daemon')
    .option('--timeout <ms>', 'Shutdown timeout in milliseconds', '30000')
    .action(async (options) => {
      await handleHubRestart(options);
    });

  return hub;
}

/**
 * Handle hub start command
 */
async function handleHubStart(options: HubStartOptions): Promise<void> {
  const client = new HubClient();
  const spinner = ora('Starting Hub daemon...').start();

  try {
    const result = await client.startHub({
      config: options.config,
      foreground: options.foreground,
      verbose: options.verbose
    });

    if (result.mode === 'foreground') {
      spinner.succeed('Hub started in foreground mode');
      console.log(OutputFormatter.info('Press Ctrl+C to stop'));

      // Keep process alive in foreground mode
      await new Promise(() => {}); // Never resolves
    } else {
      spinner.succeed(`Hub daemon started (PID: ${result.pid})`);
      console.log(OutputFormatter.info('Run `lemegeton hub status` to check status'));
    }
  } catch (error) {
    spinner.fail('Failed to start Hub');
    console.error(formatCLIError(error as Error));
    process.exit(1);
  }
}

/**
 * Handle hub stop command
 */
async function handleHubStop(options: HubStopOptions): Promise<void> {
  const client = new HubClient();
  const spinner = ora('Stopping Hub daemon...').start();

  try {
    await client.stopHub({
      force: options.force,
      timeout: parseInt(options.timeout, 10)
    });

    spinner.succeed('Hub daemon stopped');
  } catch (error) {
    spinner.fail('Failed to stop Hub');
    console.error(formatCLIError(error as Error));
    process.exit(1);
  }
}

/**
 * Handle hub status command
 */
async function handleHubStatus(options: HubStatusOptions): Promise<void> {
  const client = new HubClient();

  try {
    const status = await client.getStatus();
    const output = OutputFormatter.formatHubStatus(status, options.json);
    console.log(output);
  } catch (error) {
    console.error(formatCLIError(error as Error));
    process.exit(1);
  } finally {
    await client.close();
  }
}

/**
 * Handle hub restart command
 */
async function handleHubRestart(options: HubRestartOptions): Promise<void> {
  const client = new HubClient();
  const spinner = ora('Restarting Hub daemon...').start();

  try {
    // Stop first
    spinner.text = 'Stopping Hub daemon...';
    try {
      await client.stopHub({
        timeout: parseInt(options.timeout, 10)
      });
    } catch (error) {
      // Ignore if already stopped
    }

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Start again
    spinner.text = 'Starting Hub daemon...';
    const result = await client.startHub({});

    spinner.succeed(`Hub daemon restarted (PID: ${result.pid})`);
  } catch (error) {
    spinner.fail('Failed to restart Hub');
    console.error(formatCLIError(error as Error));
    process.exit(1);
  }
}
