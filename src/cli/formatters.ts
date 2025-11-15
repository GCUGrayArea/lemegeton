/**
 * CLI Output Formatters
 *
 * Utilities for formatting CLI output in human-readable and JSON formats.
 */

import Table from 'cli-table3';
import chalk from 'chalk';
import { AgentInfo } from '../hub/agentRegistry';
import { CoordinationMode } from '../core/coordinationMode';
import { WorkResult as AgentWorkResult } from '../agents/types';

/**
 * Hub status information
 */
export interface HubStatus {
  running: boolean;
  pid?: number;
  mode?: CoordinationMode;
  agents: AgentInfo[];
  taskProgress?: TaskProgress;
}

/**
 * Task progress information
 */
export interface TaskProgress {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  failed: number;
}

/**
 * Work result information (re-exported from agents/types)
 */
export type WorkResult = AgentWorkResult;

/**
 * Output formatter class
 */
export class OutputFormatter {
  /**
   * Format hub status
   */
  static formatHubStatus(status: HubStatus, json: boolean = false): string {
    if (json) {
      return JSON.stringify(status, null, 2);
    }

    const lines: string[] = [];

    // Status header
    if (status.running) {
      lines.push(chalk.green(`Hub Status: Running (PID: ${status.pid})`));
    } else {
      lines.push(chalk.red('Hub Status: Not Running'));
      return lines.join('\n');
    }

    // Coordination mode
    if (status.mode) {
      lines.push(chalk.blue(`Coordination Mode: ${status.mode}`));
    }

    // Agents
    lines.push('');
    lines.push(chalk.bold(`Agents: ${status.agents.length} active`));

    if (status.agents.length > 0) {
      for (const agent of status.agents) {
        const assignment = agent.assignedPR
          ? chalk.yellow(`Working on ${agent.assignedPR}`)
          : chalk.gray('Idle');
        lines.push(`  - ${agent.id}: ${assignment}`);
      }
    }

    // Task progress
    if (status.taskProgress) {
      lines.push('');
      lines.push(this.formatTaskProgress(status.taskProgress, false));
    }

    return lines.join('\n');
  }

  /**
   * Format agent list
   */
  static formatAgentList(agents: AgentInfo[], json: boolean = false): string {
    if (json) {
      return JSON.stringify(agents, null, 2);
    }

    if (agents.length === 0) {
      return chalk.gray('No active agents');
    }

    const table = new Table({
      head: ['Agent ID', 'Type', 'Status', 'Assigned PR', 'Last Heartbeat'],
      style: {
        head: ['cyan']
      }
    });

    for (const agent of agents) {
      table.push([
        agent.id,
        agent.type || 'worker',
        agent.status || 'active',
        agent.assignedPR || chalk.gray('none'),
        this.formatRelativeTime(agent.lastHeartbeat)
      ]);
    }

    return table.toString();
  }

  /**
   * Format task progress
   */
  static formatTaskProgress(progress: TaskProgress, json: boolean = false): string {
    if (json) {
      return JSON.stringify(progress, null, 2);
    }

    const lines: string[] = [];

    lines.push(chalk.bold('Task Progress:'));

    const percentage = progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;

    lines.push(`  Completed: ${chalk.green(progress.completed)}/${progress.total} (${percentage}%)`);
    lines.push(`  In Progress: ${chalk.yellow(progress.inProgress)}`);
    lines.push(`  Pending: ${chalk.blue(progress.pending)}`);

    if (progress.failed > 0) {
      lines.push(`  Failed: ${chalk.red(progress.failed)}`);
    }

    // Progress bar
    lines.push('');
    lines.push(this.createProgressBar(progress.completed, progress.total));

    return lines.join('\n');
  }

  /**
   * Format work result
   */
  static formatWorkResult(result: WorkResult, json: boolean = false): string {
    if (json) {
      return JSON.stringify(result, null, 2);
    }

    const lines: string[] = [];

    if (result.success) {
      lines.push(chalk.green(`✓ ${result.prId} completed successfully`));
    } else {
      lines.push(chalk.red(`✗ ${result.prId} failed`));
      if (result.error) {
        lines.push(chalk.gray(`  Error: ${result.error}`));
      }
    }

    if (result.duration) {
      lines.push(chalk.gray(`  Duration: ${this.formatDuration(result.duration)}`));
    }

    return lines.join('\n');
  }

  /**
   * Create a progress bar
   */
  static createProgressBar(current: number, total: number, width: number = 40): string {
    if (total === 0) {
      return chalk.gray('[' + '-'.repeat(width) + ']');
    }

    const percentage = current / total;
    const filled = Math.round(width * percentage);
    const empty = width - filled;

    const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
    const percentageText = `${Math.round(percentage * 100)}%`;

    return `[${bar}] ${percentageText}`;
  }

  /**
   * Create a table
   */
  static createTable(headers: string[], rows: string[][]): string {
    const table = new Table({
      head: headers,
      style: {
        head: ['cyan']
      }
    });

    for (const row of rows) {
      table.push(row);
    }

    return table.toString();
  }

  /**
   * Format duration in milliseconds to human-readable string
   */
  static formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Format relative time (e.g., "2 minutes ago")
   */
  static formatRelativeTime(timestamp: Date | number): string {
    const now = Date.now();
    const then = typeof timestamp === 'number' ? timestamp : timestamp.getTime();
    const diff = now - then;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ago`;
    } else if (hours > 0) {
      return `${hours}h ago`;
    } else if (minutes > 0) {
      return `${minutes}m ago`;
    } else if (seconds > 5) {
      return `${seconds}s ago`;
    } else {
      return 'just now';
    }
  }

  /**
   * Format validation errors
   */
  static formatValidationErrors(errors: Array<{ message: string; field?: string }>): string {
    const lines: string[] = [chalk.red('Validation errors:')];

    for (const error of errors) {
      if (error.field) {
        lines.push(`  ${chalk.yellow(error.field)}: ${error.message}`);
      } else {
        lines.push(`  • ${error.message}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format success message
   */
  static success(message: string): string {
    return chalk.green('✓ ') + message;
  }

  /**
   * Format error message
   */
  static error(message: string): string {
    return chalk.red('✗ ') + message;
  }

  /**
   * Format info message
   */
  static info(message: string): string {
    return chalk.blue('ℹ ') + message;
  }

  /**
   * Format warning message
   */
  static warning(message: string): string {
    return chalk.yellow('⚠ ') + message;
  }
}
