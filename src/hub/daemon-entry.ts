#!/usr/bin/env node
/**
 * Hub Daemon Entry Point
 *
 * Standalone entry point for running the Hub daemon process.
 * This script is spawned by HubClient when starting the daemon.
 */

import { Hub } from './index';
import * as path from 'path';

/**
 * Main daemon entry point
 */
async function main() {
  const pidFile = process.env.LEMEGETON_PID_FILE || path.join(process.cwd(), '.lemegeton', 'hub.pid');
  const logFile = path.join(path.dirname(pidFile), 'hub.log');
  const workDir = process.env.LEMEGETON_WORK_DIR || process.cwd();

  console.log('[HubDaemon] Starting Hub daemon...');
  console.log('[HubDaemon] PID:', process.pid);
  console.log('[HubDaemon] Work directory:', workDir);
  console.log('[HubDaemon] Log file:', logFile);

  try {
    // Create Hub instance
    const hub = new Hub({
      daemon: {
        pidFile,
        logFile,
        workDir
      }
    });

    // Start the Hub
    await hub.start();

    console.log('[HubDaemon] Hub started successfully');

    // Keep process alive
    process.on('SIGTERM', async () => {
      console.log('[HubDaemon] Received SIGTERM, shutting down gracefully...');
      await hub.stop();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      console.log('[HubDaemon] Received SIGINT, shutting down gracefully...');
      await hub.stop();
      process.exit(0);
    });

  } catch (error) {
    console.error('[HubDaemon] Failed to start Hub:', error);
    process.exit(1);
  }
}

// Run if this is the main module
if (require.main === module) {
  main().catch(error => {
    console.error('[HubDaemon] Fatal error:', error);
    process.exit(1);
  });
}
