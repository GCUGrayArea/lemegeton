/**
 * CLI Error Types
 *
 * Custom error classes for CLI operations with helpful suggestions
 * and proper exit codes.
 */

/**
 * Base class for all CLI errors
 */
export class CLIError extends Error {
  constructor(
    message: string,
    public exitCode: number = 1,
    public suggestions: string[] = []
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Hub daemon is not running
 */
export class HubNotRunningError extends CLIError {
  constructor() {
    super(
      'Hub daemon is not running',
      1,
      [
        'Run `lemegeton hub start` to start the daemon',
        'Check if Redis is running'
      ]
    );
  }
}

/**
 * Hub daemon is already running
 */
export class HubAlreadyRunningError extends CLIError {
  constructor(pid: number) {
    super(
      `Hub daemon is already running (PID: ${pid})`,
      1,
      [
        'Run `lemegeton hub stop` to stop the existing daemon',
        'Run `lemegeton hub restart` to restart it'
      ]
    );
  }
}

/**
 * Invalid PR ID
 */
export class InvalidPRError extends CLIError {
  constructor(prId: string) {
    super(
      `PR "${prId}" not found in task list`,
      1,
      [
        'Check docs/task-list.md for valid PR IDs',
        'Run `lemegeton status` to see available work'
      ]
    );
  }
}

/**
 * Redis connection error
 */
export class RedisConnectionError extends CLIError {
  constructor(url: string) {
    super(
      `Failed to connect to Redis at ${url}`,
      1,
      [
        'Ensure Redis is running',
        'Check Redis connection URL in config',
        'Run `lemegeton hub start` with --auto-spawn to start Redis automatically'
      ]
    );
  }
}

/**
 * Configuration error
 */
export class ConfigurationError extends CLIError {
  constructor(message: string, suggestions: string[] = []) {
    super(
      `Configuration error: ${message}`,
      1,
      suggestions.length > 0 ? suggestions : ['Check .lemegeton/config.yml']
    );
  }
}

/**
 * Task list parse error
 */
export class TaskListParseError extends CLIError {
  constructor(filePath: string, reason: string) {
    super(
      `Failed to parse task list at ${filePath}: ${reason}`,
      1,
      [
        'Check docs/task-list.md for syntax errors',
        'Ensure the file follows the expected format'
      ]
    );
  }
}

/**
 * Daemon spawn error
 */
export class DaemonSpawnError extends CLIError {
  constructor(reason: string) {
    super(
      `Failed to spawn daemon: ${reason}`,
      1,
      [
        'Check system logs for errors',
        'Ensure sufficient system resources',
        'Try running in foreground mode with --foreground'
      ]
    );
  }
}

/**
 * Shutdown timeout error
 */
export class ShutdownTimeoutError extends CLIError {
  constructor(timeout: number) {
    super(
      `Hub shutdown timed out after ${timeout}ms`,
      1,
      [
        'Try `lemegeton hub stop --force` to force shutdown',
        'Check if agents are hung or unresponsive'
      ]
    );
  }
}

/**
 * Validation error (generic)
 */
export class ValidationError extends CLIError {
  constructor(message: string, suggestions: string[] = []) {
    super(message, 1, suggestions);
  }
}

/**
 * Format a CLI error for display
 */
export function formatCLIError(error: Error | CLIError): string {
  const lines: string[] = [];

  lines.push(`Error: ${error.message}`);

  if (error instanceof CLIError && error.suggestions.length > 0) {
    lines.push('');
    lines.push('Suggestions:');
    for (const suggestion of error.suggestions) {
      lines.push(`  • ${suggestion}`);
    }
  }

  return lines.join('\n');
}

/**
 * Get exit code from error
 */
export function getExitCode(error: Error | CLIError): number {
  if (error instanceof CLIError) {
    return error.exitCode;
  }
  return 1;
}
