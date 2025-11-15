/**
 * Activity Log Component
 *
 * Displays real-time activity feed from agents and hub
 */

import * as blessed from 'blessed';
import { Widgets } from 'blessed';
import { TUIComponent, ActivityLogEntry, LogFilterOptions, ThemeColors } from './types';
import { CircularBuffer, formatLogEntry } from './utils';
import { getLogTypeColor } from './themes';

/**
 * Activity Log Component
 */
export class ActivityLog implements TUIComponent {
  private log!: Widgets.Log;
  private buffer: CircularBuffer<ActivityLogEntry>;
  private theme: ThemeColors;
  private screen!: Widgets.Screen;
  private filter: LogFilterOptions = {};

  constructor(bufferSize: number, theme: ThemeColors) {
    this.buffer = new CircularBuffer<ActivityLogEntry>(bufferSize);
    this.theme = theme;
  }

  /**
   * Initialize component
   */
  init(screen: Widgets.Screen): void {
    this.screen = screen;

    // Create scrollable log widget
    // Positioned to the right of the progress panel (30% width)
    this.log = blessed.log({
      parent: screen,
      top: 3, // Below status bar
      left: '30%', // Position after progress panel
      width: '70%', // Take remaining width
      height: '100%-6', // Leave space for status bar and input
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollback: 1000,
      scrollbar: {
        ch: ' ',
        track: {
          bg: this.theme.muted,
        },
        style: {
          inverse: true,
        },
      },
      border: {
        type: 'line',
      },
      style: {
        fg: this.theme.fg,
        bg: this.theme.bg,
        border: {
          fg: this.theme.border,
        },
      },
      label: ' Activity Log (↑↓ to scroll, / to search, f to filter) ',
    });

    // Enable scrolling with mouse wheel
    this.log.on('wheeldown', () => {
      this.log.scroll(1);
      this.screen.render();
    });

    this.log.on('wheelup', () => {
      this.log.scroll(-1);
      this.screen.render();
    });

    this.render();
  }

  /**
   * Add log entry
   */
  addEntry(entry: ActivityLogEntry): void {
    this.buffer.push(entry);
    this.render();
  }

  /**
   * Add multiple entries
   */
  addEntries(entries: ActivityLogEntry[]): void {
    for (const entry of entries) {
      this.buffer.push(entry);
    }
    this.render();
  }

  /**
   * Update component state
   */
  update(data: ActivityLogEntry | ActivityLogEntry[]): void {
    if (Array.isArray(data)) {
      this.addEntries(data);
    } else {
      this.addEntry(data);
    }
  }

  /**
   * Set filter options
   */
  setFilter(options: LogFilterOptions): void {
    this.filter = { ...this.filter, ...options };
    this.render();
  }

  /**
   * Clear filter
   */
  clearFilter(): void {
    this.filter = {};
    this.render();
  }

  /**
   * Clear log
   */
  clear(): void {
    this.buffer.clear();
    this.render();
  }

  /**
   * Render component
   */
  render(): void {
    if (!this.log) return;

    // Get filtered entries
    const entries = this.getFilteredEntries();

    // Clear log
    this.log.setContent('');

    // Add entries with colors
    for (const entry of entries) {
      const color = getLogTypeColor(entry.type, this.theme);
      const formatted = formatLogEntry(entry);
      this.log.log(`{${color}-fg}${formatted}{/}`);
    }

    this.screen.render();
  }

  /**
   * Get filtered entries
   */
  private getFilteredEntries(): ActivityLogEntry[] {
    let entries = this.buffer.getAll();

    // Filter by agent
    if (this.filter.agent) {
      entries = entries.filter((e) => e.source === this.filter.agent);
    }

    // Filter by type
    if (this.filter.type) {
      entries = entries.filter((e) => e.type === this.filter.type);
    }

    // Filter by search text
    if (this.filter.search) {
      const search = this.filter.search.toLowerCase();
      entries = entries.filter(
        (e) =>
          e.message.toLowerCase().includes(search) ||
          e.source.toLowerCase().includes(search)
      );
    }

    // Limit results
    if (this.filter.limit) {
      entries = entries.slice(-this.filter.limit);
    }

    return entries;
  }

  /**
   * Search for text
   */
  search(text: string): void {
    this.setFilter({ search: text });
  }

  /**
   * Get buffer stats
   */
  getStats(): { total: number; filtered: number; dropped: number } {
    const total = this.buffer.getSize();
    const filtered = this.getFilteredEntries().length;
    const dropped = this.buffer.isFull() ? 1 : 0; // Approximate

    return { total, filtered, dropped };
  }

  /**
   * Clean up component
   */
  destroy(): void {
    if (this.log) {
      this.log.destroy();
    }
  }

  /**
   * Get blessed widget
   */
  getWidget(): Widgets.Node {
    return this.log;
  }
}
