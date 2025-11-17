/**
 * Dashboard Command
 *
 * Launch web-based dashboard server for monitoring agents
 */

import { Command } from 'commander';
import { DashboardServer } from '../../dashboard/server';

interface DashboardOptions {
  port?: number;
  host?: string;
  staticPath?: string;
}

/**
 * Create Dashboard command
 */
export function createDashboardCommand(): Command {
  const command = new Command('dashboard');

  command
    .description('Launch web-based dashboard with real-time monitoring and progress tracking')
    .option('-p, --port <number>', 'HTTP server port (default: 3000)', parseInt)
    .option('-H, --host <host>', 'HTTP server host (default: 0.0.0.0)')
    .option('--static-path <path>', 'Path to static files (default: dashboard/dist)')
    .action(async (options: DashboardOptions) => {
      try {
        console.log('Starting Lemegeton Dashboard...');

        // Create dashboard server
        const server = new DashboardServer({
          port: options.port,
          host: options.host,
          staticPath: options.staticPath,
        });

        // Start server
        await server.start();

        console.log('');
        console.log('Dashboard server is running!');
        console.log(`  → Open http://localhost:${options.port || 3000} in your browser`);
        console.log('');
        console.log('Press Ctrl+C to stop the server');

        // Handle process termination
        const cleanup = async () => {
          console.log('\nShutting down dashboard server...');
          await server.stop();
          console.log('Dashboard server stopped');
          process.exit(0);
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
        process.on('SIGHUP', cleanup);

        // Keep process alive
        await new Promise(() => {});
      } catch (error) {
        console.error('Failed to start dashboard:', error);
        process.exit(1);
      }
    });

  return command;
}
