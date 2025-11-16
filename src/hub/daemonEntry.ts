#!/usr/bin/env node
/**
 * Hub Daemon Entry Point
 *
 * Standalone script for running the Hub as a daemon process.
 * This is spawned by the HubClient when starting the daemon.
 */

import { Hub } from './index';
import * as path from 'path';

async function main() {
  try {
    // Get configuration from environment
    const pidFile = process.env.LEMEGETON_PID_FILE || path.join(process.cwd(), '.lemegeton', 'hub.pid');
    const logFile = path.join(path.dirname(pidFile), 'hub.log');
    const workDir = process.env.LEMEGETON_WORK_DIR || process.cwd();

    console.log('[Daemon] Starting Hub...');
    console.log(`[Daemon] PID: ${process.pid}`);
    console.log(`[Daemon] Work Dir: ${workDir}`);
    console.log(`[Daemon] PID File: ${pidFile}`);
    console.log(`[Daemon] Log File: ${logFile}`);

    // Create and start hub
    const hub = new Hub({
      daemon: {
        pidFile,
        logFile,
        workDir
      }
    });

    // Handle graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`[Daemon] Received ${signal}, shutting down...`);
      try {
        await hub.stop();
        console.log('[Daemon] Hub stopped');
        process.exit(0);
      } catch (error) {
        console.error('[Daemon] Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGHUP', () => shutdown('SIGHUP'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      console.error('[Daemon] Uncaught exception:', error);
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('[Daemon] Unhandled rejection at:', promise, 'reason:', reason);
      shutdown('unhandledRejection');
    });

    // Start the hub
    await hub.start();
    console.log('[Daemon] Hub started successfully');

    // Keep process alive
    // The hub will handle its own event loop
  } catch (error) {
    console.error('[Daemon] Failed to start hub:', error);
    process.exit(1);
  }
}

// Only run if this is the main module
if (require.main === module) {
  main().catch((error) => {
    console.error('[Daemon] Fatal error:', error);
    process.exit(1);
  });
}

export { main };
