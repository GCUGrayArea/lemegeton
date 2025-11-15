/**
 * Status Bar Component
 *
 * Displays system status, coordination mode, and active agents
 */

import * as blessed from 'blessed';
import { Widgets } from 'blessed';
import { TUIComponent, StatusBarState, ThemeColors } from './types';
import { getAgentStateColor, getModeColor } from './themes';
import { truncate } from './utils';

/**
 * Status Bar Component
 */
export class StatusBar implements TUIComponent {
  private box!: Widgets.BoxElement;
  private state: StatusBarState;
  private theme: ThemeColors;
  private screen!: Widgets.Screen;

  constructor(theme: ThemeColors) {
    this.theme = theme;
    this.state = {
      mode: 'distributed' as any,
      agents: [],
      activePRs: 0,
      maxAgents: 10,
      connected: false,
    };
  }

  /**
   * Initialize component
   */
  init(screen: Widgets.Screen): void {
    this.screen = screen;

    // Create box for status bar
    this.box = blessed.box({
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      tags: true,
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
    });

    this.render();
  }

  /**
   * Update component state
   */
  update(data: StatusBarState): void {
    this.state = { ...this.state, ...data };
    this.render();
  }

  /**
   * Render component
   */
  render(): void {
    if (!this.box) return;

    const width = this.box.width as number;
    const content = this.buildContent(width - 4); // Account for borders

    this.box.setContent(content);
    this.screen.render();
  }

  /**
   * Build status bar content
   */
  private buildContent(width: number): string {
    const lines: string[] = [];

    // Line 1: Hub status, Mode, agent count, active PRs, connection status
    const modeColor = getModeColor(this.state.mode, this.theme);
    const redisStatus = this.state.connected ? '{green-fg}●{/}' : '{red-fg}●{/}';

    // Hub status display
    let hubStatus: string;
    if (this.state.hubRunning) {
      const location = this.state.hubLocation === 'remote' ? ' [Remote]' : '';
      const pidInfo = this.state.hubPid ? ` (${this.state.hubPid})` : '';
      hubStatus = `{green-fg}Hub: Running${location}${pidInfo}{/}`;
    } else {
      hubStatus = '{red-fg}Hub: Not Running{/}';
    }

    const line1 = [
      hubStatus,
      `Mode: {${modeColor}-fg}${this.state.mode.toUpperCase()}{/}`,
      `Agents: ${this.state.agents.length}/${this.state.maxAgents}`,
      `Active PRs: ${this.state.activePRs}`,
      `Redis ${redisStatus}`,
    ].join(' │ ');

    lines.push(line1);

    // Line 2: Agent status list
    const agentStatus = this.buildAgentStatus(width);
    lines.push(agentStatus);

    return lines.join('\n');
  }

  /**
   * Build agent status line
   */
  private buildAgentStatus(width: number): string {
    if (this.state.agents.length === 0) {
      return '{gray-fg}No active agents{/}';
    }

    const agentStrings: string[] = [];
    let currentLength = 0;

    for (const agent of this.state.agents) {
      const color = getAgentStateColor(agent.status, this.theme);
      const prInfo = agent.assignedPR
        ? ` PR-${agent.assignedPR}`
        : '';

      const agentStr = `{${color}-fg}${agent.id}{/} [${agent.status}]${prInfo}`;
      const plainLength = `${agent.id} [${agent.status}]${prInfo}`.length;

      // Check if adding this agent would exceed width
      if (currentLength + plainLength + 3 > width && agentStrings.length > 0) {
        agentStrings.push('{gray-fg}...{/}');
        break;
      }

      agentStrings.push(agentStr);
      currentLength += plainLength + 3; // +3 for separator
    }

    return agentStrings.join(' │ ');
  }

  /**
   * Clean up component
   */
  destroy(): void {
    if (this.box) {
      this.box.destroy();
    }
  }

  /**
   * Get blessed widget
   */
  getWidget(): Widgets.Node {
    return this.box;
  }

  /**
   * Get current state
   */
  getState(): StatusBarState {
    return { ...this.state };
  }
}
