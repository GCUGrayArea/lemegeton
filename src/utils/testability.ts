/**
 * Testability Utilities
 *
 * Provides injectable interfaces for system dependencies that are normally
 * hard to mock in tests (timers, process handlers, etc.).
 */

/**
 * Injectable clock interface for time-based operations
 *
 * Allows tests to control time progression and avoid actual delays.
 */
export interface Clock {
  /**
   * Get current timestamp in milliseconds
   */
  now(): number;

  /**
   * Schedule a function to run after a delay
   */
  setTimeout(callback: () => void, ms: number): NodeJS.Timeout;

  /**
   * Schedule a function to run repeatedly
   */
  setInterval(callback: () => void, ms: number): NodeJS.Timeout;

  /**
   * Cancel a timeout
   */
  clearTimeout(timer: NodeJS.Timeout): void;

  /**
   * Cancel an interval
   */
  clearInterval(timer: NodeJS.Timeout): void;
}

/**
 * System clock implementation using native Node.js functions
 */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }

  setTimeout(callback: () => void, ms: number): NodeJS.Timeout {
    return setTimeout(callback, ms);
  }

  setInterval(callback: () => void, ms: number): NodeJS.Timeout {
    return setInterval(callback, ms);
  }

  clearTimeout(timer: NodeJS.Timeout): void {
    clearTimeout(timer);
  }

  clearInterval(timer: NodeJS.Timeout): void {
    clearInterval(timer);
  }
}

/**
 * Injectable process handlers interface for signal handling
 *
 * Allows tests to mock signal handling without affecting the actual process.
 */
export interface ProcessHandlers {
  /**
   * Register a signal handler
   */
  on(signal: NodeJS.Signals, handler: () => void): void;

  /**
   * Unregister a signal handler
   */
  off(signal: NodeJS.Signals, handler: () => void): void;

  /**
   * Register an unhandled exception handler
   */
  onException(handler: (error: Error) => void): void;

  /**
   * Unregister an unhandled exception handler
   */
  offException(handler: (error: Error) => void): void;

  /**
   * Register an unhandled rejection handler
   */
  onRejection(handler: (reason: unknown, promise: Promise<unknown>) => void): void;

  /**
   * Unregister an unhandled rejection handler
   */
  offRejection(handler: (reason: unknown, promise: Promise<unknown>) => void): void;
}

/**
 * System process handlers implementation using Node.js process
 */
export class SystemProcessHandlers implements ProcessHandlers {
  on(signal: NodeJS.Signals, handler: () => void): void {
    process.on(signal, handler);
  }

  off(signal: NodeJS.Signals, handler: () => void): void {
    process.off(signal, handler);
  }

  onException(handler: (error: Error) => void): void {
    process.on('uncaughtException', handler);
  }

  offException(handler: (error: Error) => void): void {
    process.off('uncaughtException', handler);
  }

  onRejection(handler: (reason: unknown, promise: Promise<unknown>) => void): void {
    process.on('unhandledRejection', handler);
  }

  offRejection(handler: (reason: unknown, promise: Promise<unknown>) => void): void {
    process.off('unhandledRejection', handler);
  }
}

/**
 * Get the default (system) clock instance
 */
export function getSystemClock(): Clock {
  return new SystemClock();
}

/**
 * Get the default (system) process handlers instance
 */
export function getSystemProcessHandlers(): ProcessHandlers {
  return new SystemProcessHandlers();
}
