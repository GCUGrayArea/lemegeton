/**
 * TUI Themes
 *
 * Color themes for Terminal UI
 */

import { ThemeColors } from './types';

/**
 * Dark theme (default)
 */
export const darkTheme: ThemeColors = {
  fg: 'white',
  bg: 'black',
  border: 'blue',
  success: 'green',
  warning: 'yellow',
  error: 'red',
  info: 'cyan',
  debug: 'gray',
  highlight: 'magenta',
  muted: 'gray',
};

/**
 * Light theme
 */
export const lightTheme: ThemeColors = {
  fg: 'black',
  bg: 'white',
  border: 'blue',
  success: 'green',
  warning: 'yellow',
  error: 'red',
  info: 'blue',
  debug: 'gray',
  highlight: 'magenta',
  muted: 'gray',
};

/**
 * Get theme based on name or auto-detect
 */
export function getTheme(name: 'dark' | 'light' | 'auto' = 'auto'): ThemeColors {
  if (name === 'auto') {
    // Auto-detect based on terminal background
    // Default to dark theme for now
    // TODO: Implement terminal background detection
    return darkTheme;
  }

  return name === 'light' ? lightTheme : darkTheme;
}

/**
 * Get color for agent state
 */
export function getAgentStateColor(state: string, theme: ThemeColors): string {
  switch (state.toLowerCase()) {
    case 'working':
    case 'in-progress':
    case 'active':
      return theme.success;
    case 'idle':
    case 'ready':
      return theme.info;
    case 'blocked':
    case 'waiting':
      return theme.warning;
    case 'failed':
    case 'error':
    case 'crashed':
      return theme.error;
    default:
      return theme.muted;
  }
}

/**
 * Get color for coordination mode
 */
export function getModeColor(mode: string, theme: ThemeColors): string {
  switch (mode.toUpperCase()) {
    case 'DISTRIBUTED':
      return theme.success;
    case 'DEGRADED':
      return theme.warning;
    case 'ISOLATED':
      return theme.error;
    default:
      return theme.muted;
  }
}

/**
 * Get color for log entry type
 */
export function getLogTypeColor(type: string, theme: ThemeColors): string {
  switch (type.toLowerCase()) {
    case 'success':
      return theme.success;
    case 'warning':
      return theme.warning;
    case 'error':
      return theme.error;
    case 'info':
      return theme.info;
    case 'debug':
      return theme.debug;
    default:
      return theme.fg;
  }
}
