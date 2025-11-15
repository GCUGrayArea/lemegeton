/**
 * Input Router Component
 *
 * Routes user input to appropriate agents or system commands
 */

import * as blessed from 'blessed';
import { Widgets } from 'blessed';
import { TUIComponent, InputCommand, ThemeColors } from './types';
import { EventEmitter } from 'events';

/**
 * Input Router Component
 */
export class InputRouter extends EventEmitter implements TUIComponent {
  private inputBox!: Widgets.TextboxElement;
  private promptBox!: Widgets.BoxElement;
  private theme: ThemeColors;
  private screen!: Widgets.Screen;
  private commandHistory: string[] = [];
  private historyIndex: number = -1;

  constructor(theme: ThemeColors) {
    super();
    this.theme = theme;
  }

  /**
   * Initialize component
   */
  init(screen: Widgets.Screen): void {
    this.screen = screen;

    // Create prompt box
    this.promptBox = blessed.box({
      parent: screen,
      bottom: 2,
      left: 0,
      width: 3,
      height: 1,
      content: '{bold}>{/}',
      tags: true,
      style: {
        fg: this.theme.highlight,
        bg: this.theme.bg,
      },
    });

    // Create input textbox
    this.inputBox = blessed.textbox({
      parent: screen,
      bottom: 2,
      left: 3,
      width: '100%-3',
      height: 1,
      inputOnFocus: true,
      keys: true,
      mouse: true,
      style: {
        fg: this.theme.fg,
        bg: this.theme.bg,
      },
    });

    // Create help box
    const helpBox = blessed.box({
      parent: screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 2,
      tags: true,
      border: {
        type: 'line',
      },
      style: {
        fg: this.theme.muted,
        bg: this.theme.bg,
        border: {
          fg: this.theme.border,
        },
      },
      content:
        ' {bold}Commands:{/} /help /quit /filter /clear /stats | {bold}Direct:{/} @agent-id message | {bold}Broadcast:{/} message ',
    });

    // Handle input submit
    this.inputBox.on('submit', (value: string) => {
      this.handleInput(value);
      this.inputBox.clearValue();
      this.focus(); // Use safe focus wrapper
      this.screen.render();
    });

    // Handle input cancel
    this.inputBox.on('cancel', () => {
      this.inputBox.clearValue();
      this.focus(); // Use safe focus wrapper
      this.screen.render();
    });

    // Handle up/down arrows for history
    this.inputBox.key(['up'], () => {
      if (this.commandHistory.length === 0) return;

      if (this.historyIndex === -1) {
        this.historyIndex = this.commandHistory.length - 1;
      } else if (this.historyIndex > 0) {
        this.historyIndex--;
      }

      const command = this.commandHistory[this.historyIndex];
      this.inputBox.setValue(command);
      this.screen.render();
    });

    this.inputBox.key(['down'], () => {
      if (this.historyIndex === -1) return;

      if (this.historyIndex < this.commandHistory.length - 1) {
        this.historyIndex++;
        const command = this.commandHistory[this.historyIndex];
        this.inputBox.setValue(command);
      } else {
        this.historyIndex = -1;
        this.inputBox.clearValue();
      }

      this.screen.render();
    });

    // Don't auto-focus to prevent blessed cursor issues on Windows
    // Users can focus with 'i' or 'enter' key bindings
  }

  /**
   * Handle user input
   */
  private handleInput(input: string): void {
    const trimmed = input.trim();
    if (!trimmed) return;

    // Add to history
    this.commandHistory.push(trimmed);
    if (this.commandHistory.length > 100) {
      this.commandHistory.shift();
    }
    this.historyIndex = -1;

    // Parse command
    const command = this.parseInput(trimmed);

    // Emit command
    this.emit('command', command);
  }

  /**
   * Parse input into command
   */
  parseInput(input: string): InputCommand {
    // System commands start with /
    if (input.startsWith('/')) {
      return {
        type: 'system',
        payload: input.substring(1),
        raw: input,
      };
    }

    // Direct messages start with @agent-id
    const directMatch = input.match(/^@([\w-]+)\s+(.+)$/);
    if (directMatch) {
      return {
        type: 'direct',
        target: directMatch[1],
        payload: directMatch[2],
        raw: input,
      };
    }

    // Everything else is broadcast
    return {
      type: 'broadcast',
      payload: input,
      raw: input,
    };
  }

  /**
   * Update component (not used for input router)
   */
  update(_data: unknown): void {
    // Input router doesn't need updates
  }

  /**
   * Render component
   */
  render(): void {
    // Input router doesn't need explicit rendering
    this.screen.render();
  }

  /**
   * Focus input
   */
  focus(): void {
    try {
      this.inputBox.focus();
    } catch (error) {
      // Ignore focus errors - blessed can have cursor issues on Windows
      // The input will still be usable even if focus fails
    }
  }

  /**
   * Set input value
   */
  setValue(value: string): void {
    this.inputBox.setValue(value);
    this.screen.render();
  }

  /**
   * Clear input
   */
  clear(): void {
    this.inputBox.clearValue();
    this.screen.render();
  }

  /**
   * Get command history
   */
  getHistory(): string[] {
    return [...this.commandHistory];
  }

  /**
   * Clear command history
   */
  clearHistory(): void {
    this.commandHistory = [];
    this.historyIndex = -1;
  }

  /**
   * Clean up component
   */
  destroy(): void {
    if (this.inputBox) {
      this.inputBox.destroy();
    }
    if (this.promptBox) {
      this.promptBox.destroy();
    }
  }

  /**
   * Get blessed widget
   */
  getWidget(): Widgets.Node {
    return this.inputBox;
  }
}
