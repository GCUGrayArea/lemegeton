/**
 * TUI Command
 *
 * Launch Terminal UI for monitoring agents
 */

import { Command } from 'commander';
import { TUIManager } from '../../tui';
import { loadConfig } from '../../config';

/**
 * Create TUI command
 */
export function createTUICommand(): Command {
  const command = new Command('tui');

  command
    .description('Launch Terminal UI for monitoring agents')
    .option('-r, --redis-url <url>', 'Redis connection URL')
    .option('--fps <number>', 'Maximum FPS for rendering (default: 10)', parseInt)
    .option('--buffer <size>', 'Activity log buffer size (default: 1000)', parseInt)
    .option('--theme <theme>', 'Color theme (dark/light/auto)', 'auto')
    .option('--debug', 'Enable debug mode')
    .action(async (options) => {
      try {
        // Load config
        const config = loadConfig();

        // Create TUI manager
        const tui = new TUIManager({
          redisUrl: options.redisUrl || config.redis?.url || 'redis://localhost:6379',
          maxFPS: options.fps || 10,
          logBufferSize: options.buffer || 1000,
          theme: options.theme || 'auto',
          debug: options.debug || false,
        });

        // Initialize and start TUI
        await tui.init();
        await tui.start();

        // Handle process termination
        const cleanup = async () => {
          console.log('\nShutting down TUI...');
          await tui.stop();
          process.exit(0);
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
        process.on('SIGHUP', cleanup);

        // Handle errors
        tui.on('error', (error) => {
          console.error('TUI error:', error);
        });
      } catch (error) {
        console.error('Failed to start TUI:', error);
        process.exit(1);
      }
    });

  return command;
}
