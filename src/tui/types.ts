/**
 * TUI Type Definitions
 *
 * Type definitions for Terminal UI components
 */

import { Widgets } from 'blessed';
import { AgentInfo } from '../hub/agentRegistry';
import { CoordinationMode } from '../core/coordinationMode';

/**
 * TUI configuration
 */
export interface TUIConfig {
  /** Refresh interval in milliseconds (default: 1000) */
  refreshInterval?: number;

  /** Max FPS for render loop (default: 10) */
  maxFPS?: number;

  /** Activity log buffer size (default: 1000) */
  logBufferSize?: number;

  /** Enable debug mode (default: false) */
  debug?: boolean;

  /** Color theme (default: 'auto') */
  theme?: 'dark' | 'light' | 'auto';

  /** Redis URL for pub/sub */
  redisUrl?: string;

  /** Path to task list file (default: 'docs/task-list.md') */
  taskListPath?: string;

  /** Show progress panel by default (default: true) */
  showProgress?: boolean;
}

/**
 * Activity log entry
 */
export interface ActivityLogEntry {
  /** Timestamp */
  timestamp: Date;

  /** Source agent ID or 'hub' */
  source: string;

  /** Message type */
  type: 'info' | 'success' | 'warning' | 'error' | 'debug';

  /** Message content */
  message: string;

  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Status bar state
 */
export interface StatusBarState {
  /** Coordination mode */
  mode: CoordinationMode;

  /** Active agents */
  agents: AgentInfo[];

  /** Active PR count */
  activePRs: number;

  /** Total agent capacity */
  maxAgents: number;

  /** Connection status */
  connected: boolean;

  /** Hub daemon running status */
  hubRunning?: boolean;

  /** Hub daemon PID */
  hubPid?: number;

  /** Hub location (local or remote) */
  hubLocation?: 'local' | 'remote';

  /** Additional stats */
  stats?: {
    messagesPerSecond?: number;
    cpuUsage?: number;
    memoryUsage?: number;
  };
}

/**
 * Input router command
 */
export interface InputCommand {
  /** Command type */
  type: 'broadcast' | 'direct' | 'system';

  /** Target agent ID (for direct messages) */
  target?: string;

  /** Message payload */
  payload: string;

  /** Raw input */
  raw: string;
}

/**
 * TUI component interface
 */
export interface TUIComponent {
  /** Initialize component */
  init(screen: Widgets.Screen): void;

  /** Update component state */
  update(data: unknown): void;

  /** Render component */
  render(): void;

  /** Clean up component */
  destroy(): void;

  /** Get blessed widget */
  getWidget(): Widgets.Node;
}

/**
 * Theme colors
 */
export interface ThemeColors {
  /** Primary text color */
  fg: string;

  /** Background color */
  bg: string;

  /** Border color */
  border: string;

  /** Success color */
  success: string;

  /** Warning color */
  warning: string;

  /** Error color */
  error: string;

  /** Info color */
  info: string;

  /** Debug color */
  debug: string;

  /** Highlight color */
  highlight: string;

  /** Muted color */
  muted: string;
}

/**
 * Filter options for activity log
 */
export interface LogFilterOptions {
  /** Filter by agent ID */
  agent?: string;

  /** Filter by message type */
  type?: ActivityLogEntry['type'];

  /** Filter by text search */
  search?: string;

  /** Only show last N entries */
  limit?: number;
}
