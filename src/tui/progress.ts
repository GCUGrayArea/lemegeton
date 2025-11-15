/**
 * Progress Tracker Component
 *
 * Displays PR progress with status icons, dependency trees, phase progress,
 * and completion metrics in a scrollable blessed list widget.
 */

import * as blessed from 'blessed';
import { Widgets } from 'blessed';
import { TUIComponent, ThemeColors } from './types';
import { PRData } from '../parser/types';
import { PRState } from '../types/pr';
import { DependencyGraph } from './dependencies';
import { MetricsCalculator, MetricsFormatter, MetricsState } from './metrics';

/**
 * Progress tracker state
 */
export interface ProgressState {
  // All PRs from task list
  allPRs: PRData[];

  // Current PR states from Redis/git
  prStates: Map<string, PRState>;

  // Dependency graph
  dependencies: Map<string, string[]>;

  // Selected phase/block filter
  selectedPhase?: string;

  // Expansion state for dependency trees
  expandedPRs: Set<string>;

  // Scroll position
  scrollOffset: number;
}

/**
 * Progress Tracker Component
 */
export class ProgressTracker implements TUIComponent {
  private widget!: Widgets.BoxElement;
  private theme: ThemeColors;
  private state: ProgressState;
  private dependencyGraph!: DependencyGraph;
  private metricsCalculator!: MetricsCalculator;
  private metrics: MetricsState | null = null;
  private visible: boolean = true;
  private focusedIndex: number = 0;

  constructor(theme: ThemeColors) {
    this.theme = theme;
    this.state = {
      allPRs: [],
      prStates: new Map(),
      dependencies: new Map(),
      expandedPRs: new Set(),
      scrollOffset: 0,
    };
  }

  /**
   * Initialize component
   */
  init(screen: Widgets.Screen): void {
    this.widget = blessed.box({
      top: 3,
      left: 0,
      width: '30%',
      height: screen.height - 6,
      label: ' Progress ',
      border: {
        type: 'line',
      },
      style: {
        fg: this.theme.fg,
        bg: this.theme.bg,
        border: {
          fg: this.theme.border,
        },
        label: {
          fg: this.theme.highlight,
        },
      },
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: '█',
        style: {
          fg: this.theme.muted,
        },
      },
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
    });

    screen.append(this.widget);

    // Setup key handlers
    this.setupKeyHandlers();
  }

  /**
   * Setup key handlers
   */
  private setupKeyHandlers(): void {
    this.widget.key(['up', 'k'], () => {
      this.scrollUp();
    });

    this.widget.key(['down', 'j'], () => {
      this.scrollDown();
    });

    this.widget.key(['e', 'enter'], () => {
      this.toggleExpansion();
    });

    this.widget.key(['home'], () => {
      this.widget.setScrollPerc(0);
      this.focusedIndex = 0;
    });

    this.widget.key(['end'], () => {
      this.widget.setScrollPerc(100);
      this.focusedIndex = this.state.allPRs.length - 1;
    });
  }

  /**
   * Update component state
   */
  update(data: ProgressState): void {
    this.state = data;

    // Initialize dependency graph if needed
    if (this.state.allPRs.length > 0) {
      this.dependencyGraph = new DependencyGraph(this.state.allPRs);
      this.metricsCalculator = new MetricsCalculator(
        this.state.allPRs,
        this.state.prStates
      );
      this.metrics = this.metricsCalculator.calculate();
    }

    this.render();
  }

  /**
   * Render component
   */
  render(): void {
    if (!this.widget || !this.visible) {
      return;
    }

    const lines: string[] = [];

    // Render phase progress and metrics
    if (this.metrics) {
      lines.push(...this.renderOverallProgress());
      lines.push('');
      lines.push(...this.renderPhaseProgress());
      lines.push('');
    }

    // Render PR list
    lines.push(...this.renderPRList());

    // Render metrics
    if (this.metrics) {
      lines.push('');
      lines.push(...this.renderMetrics());
    }

    // Set content
    this.widget.setContent(lines.join('\n'));
    this.widget.screen.render();
  }

  /**
   * Render overall progress
   */
  private renderOverallProgress(): string[] {
    if (!this.metrics) return [];

    const lines: string[] = [];
    const percent = this.metrics.completionPercent;
    const progressBar = MetricsFormatter.createProgressBar(percent, 20);
    const percentColor = MetricsFormatter.formatPercent(percent).color;

    lines.push(`{bold}Overall Progress{/bold}`);
    lines.push(
      `{${percentColor}-fg}${progressBar}{/${percentColor}-fg} {bold}${percent}%{/bold} (${this.metrics.completed}/${this.metrics.total})`
    );

    return lines;
  }

  /**
   * Render phase progress
   */
  private renderPhaseProgress(): string[] {
    if (!this.metrics) return [];

    const lines: string[] = [];
    const phases = this.metrics.phaseProgress;

    // Filter to show only the current phase or a few recent phases
    const currentPhase = this.getCurrentPhase();

    if (currentPhase && phases.has(currentPhase)) {
      const phaseData = phases.get(currentPhase)!;
      const progressBar = MetricsFormatter.createProgressBar(phaseData.percent, 15);
      const percentColor = MetricsFormatter.formatPercent(phaseData.percent).color;

      lines.push(`{bold}${currentPhase}{/bold}`);
      lines.push(
        `{${percentColor}-fg}${progressBar}{/${percentColor}-fg} ${phaseData.percent}% (${phaseData.completed}/${phaseData.total})`
      );
    }

    return lines;
  }

  /**
   * Render PR list
   */
  private renderPRList(): string[] {
    const lines: string[] = [];

    // Filter by phase if selected
    let prs = this.state.allPRs;
    if (this.state.selectedPhase) {
      prs = prs.filter(
        (pr) => this.extractPhase(pr.pr_id) === this.state.selectedPhase
      );
    }

    // Group by phase for better organization
    const prsByPhase = new Map<string, PRData[]>();
    for (const pr of prs) {
      const phase = this.extractPhase(pr.pr_id);
      if (!prsByPhase.has(phase)) {
        prsByPhase.set(phase, []);
      }
      prsByPhase.get(phase)!.push(pr);
    }

    // Render each phase
    for (const [phase, phasePRs] of prsByPhase) {
      if (!this.state.selectedPhase) {
        lines.push('');
        lines.push(`{bold}{cyan-fg}${phase}{/cyan-fg}{/bold}`);
      }

      for (const pr of phasePRs) {
        lines.push(...this.renderPR(pr, 0));

        // Render dependencies if expanded
        if (this.state.expandedPRs.has(pr.pr_id)) {
          lines.push(...this.renderDependencies(pr.pr_id, 1));
        }
      }
    }

    return lines;
  }

  /**
   * Render a single PR
   */
  private renderPR(pr: PRData, indent: number): string[] {
    const lines: string[] = [];
    const prefix = '  '.repeat(indent);

    const state = this.state.prStates.get(pr.pr_id);
    const icon = this.getStatusIcon(pr, state);
    const statusText = this.getStatusText(pr, state);

    // Format: Icon PR-ID: Title [status]
    const line = `${prefix}${icon} {bold}${pr.pr_id}{/bold}: ${this.truncate(pr.title, 35)} ${statusText}`;

    lines.push(line);

    return lines;
  }

  /**
   * Render dependencies for a PR
   */
  private renderDependencies(prId: string, indent: number): string[] {
    const lines: string[] = [];
    const deps = this.dependencyGraph.getDependencies(prId);

    if (deps.length === 0) {
      return lines;
    }

    const prefix = '  '.repeat(indent);

    for (let i = 0; i < deps.length; i++) {
      const depId = deps[i];
      const isLast = i === deps.length - 1;
      const connector = isLast ? '└─' : '├─';

      const depState = this.state.prStates.get(depId);
      const depIcon = this.getStatusIcon(
        this.state.allPRs.find((pr) => pr.pr_id === depId)!,
        depState
      );

      const depStatusText = depState
        ? this.isCompleted(depState)
          ? '{green-fg}✓{/green-fg}'
          : '{red-fg}✗{/red-fg}'
        : '{yellow-fg}?{/yellow-fg}';

      lines.push(
        `${prefix}  ${connector} depends on: {bold}${depId}{/bold} ${depStatusText}`
      );
    }

    return lines;
  }

  /**
   * Render metrics panel
   */
  private renderMetrics(): string[] {
    if (!this.metrics) return [];

    const lines: string[] = [];

    lines.push('{bold}Metrics:{/bold}');
    lines.push(`  Total: ${this.metrics.total}`);
    lines.push(
      `  Completed: {green-fg}${this.metrics.completed}{/green-fg} (${this.metrics.completionPercent}%)`
    );

    if (this.metrics.inProgress > 0) {
      lines.push(`  In Progress: {yellow-fg}${this.metrics.inProgress}{/yellow-fg}`);
    }

    if (this.metrics.blocked > 0) {
      lines.push(`  Blocked: {red-fg}${this.metrics.blocked}{/red-fg}`);
    }

    if (this.metrics.ready > 0) {
      lines.push(`  Ready: {cyan-fg}${this.metrics.ready}{/cyan-fg}`);
    }

    if (this.metrics.broken > 0) {
      lines.push(`  Broken: {red-fg}${this.metrics.broken}{/red-fg}`);
    }

    lines.push('');
    lines.push('{bold}Estimates:{/bold}');
    lines.push(
      `  Remaining: ${MetricsFormatter.formatHours(this.metrics.estimatedHoursRemaining)}`
    );
    lines.push(
      `  Est. Done: ${MetricsFormatter.formatDate(this.metrics.estimatedCompletionDate)}`
    );

    return lines;
  }

  /**
   * Get status icon for PR
   */
  private getStatusIcon(pr: PRData | undefined, state: PRState | undefined): string {
    if (!pr || !state) {
      return '{white-fg}○{/white-fg}'; // New
    }

    // Check hot state first
    if (state.hot_state) {
      switch (state.hot_state) {
        case 'investigating':
        case 'planning':
        case 'in-progress':
          return '{yellow-fg}▶{/yellow-fg}'; // In progress
        case 'under-review':
          return '{cyan-fg}~{/cyan-fg}'; // Under review
      }
    }

    // Check cold state
    switch (state.cold_state) {
      case 'completed':
      case 'approved':
        return '{green-fg}✓{/green-fg}'; // Completed
      case 'broken':
        return '{red-fg}!{/red-fg}'; // Broken
      case 'blocked':
        return '{red-fg}●{/red-fg}'; // Blocked
      case 'ready':
        return '{cyan-fg}○{/cyan-fg}'; // Ready
      case 'planned':
        return '{yellow-fg}○{/yellow-fg}'; // Planned
      default:
        return '{white-fg}○{/white-fg}'; // New
    }
  }

  /**
   * Get status text for PR
   */
  private getStatusText(pr: PRData, state: PRState | undefined): string {
    if (!state) {
      return '{muted-fg}[new]{/muted-fg}';
    }

    if (state.hot_state) {
      const agentText = state.agent_id ? `, ${state.agent_id}` : '';
      return `{yellow-fg}[${state.hot_state}${agentText}]{/yellow-fg}`;
    }

    const stateColor =
      state.cold_state === 'completed' || state.cold_state === 'approved'
        ? 'green'
        : state.cold_state === 'broken'
        ? 'red'
        : state.cold_state === 'blocked'
        ? 'red'
        : 'muted';

    return `{${stateColor}-fg}[${state.cold_state}]{/${stateColor}-fg}`;
  }

  /**
   * Check if PR is completed
   */
  private isCompleted(state: PRState): boolean {
    return state.cold_state === 'completed' || state.cold_state === 'approved';
  }

  /**
   * Get current phase based on in-progress PRs
   */
  private getCurrentPhase(): string | null {
    // Find the first in-progress PR and return its phase
    for (const pr of this.state.allPRs) {
      const state = this.state.prStates.get(pr.pr_id);
      if (state && (state.hot_state || state.agent_id)) {
        return this.extractPhase(pr.pr_id);
      }
    }

    // Find the first non-completed PR
    for (const pr of this.state.allPRs) {
      const state = this.state.prStates.get(pr.pr_id);
      if (!state || !this.isCompleted(state)) {
        return this.extractPhase(pr.pr_id);
      }
    }

    return null;
  }

  /**
   * Extract phase from PR ID
   */
  private extractPhase(prId: string): string {
    const match = prId.match(/PR-(\d+)/);
    if (!match) {
      return 'Unknown';
    }

    const num = parseInt(match[1], 10);

    if (num <= 13) return 'Phase 0.1a';
    if (num <= 16) return 'Phase 0.1b';
    if (num <= 25) return 'Phase 0.2';
    if (num <= 31) return 'Phase 0.3';
    if (num <= 36) return 'Phase 0.4';
    if (num <= 50) return 'Phase 1.0';

    return 'Unknown';
  }

  /**
   * Truncate text to max length
   */
  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }

  /**
   * Toggle expansion for focused PR
   */
  toggleExpansion(prId?: string): void {
    const targetPR = prId || this.getFocusedPR();

    if (!targetPR) {
      return;
    }

    if (this.state.expandedPRs.has(targetPR)) {
      this.state.expandedPRs.delete(targetPR);
    } else {
      this.state.expandedPRs.add(targetPR);
    }

    this.render();
  }

  /**
   * Get focused PR
   */
  getFocusedPR(): string | null {
    if (
      this.focusedIndex >= 0 &&
      this.focusedIndex < this.state.allPRs.length
    ) {
      return this.state.allPRs[this.focusedIndex].pr_id;
    }
    return null;
  }

  /**
   * Scroll up
   */
  scrollUp(): void {
    this.widget.scroll(-1);
    this.focusedIndex = Math.max(0, this.focusedIndex - 1);
  }

  /**
   * Scroll down
   */
  scrollDown(): void {
    this.widget.scroll(1);
    this.focusedIndex = Math.min(
      this.state.allPRs.length - 1,
      this.focusedIndex + 1
    );
  }

  /**
   * Set phase filter
   */
  setPhaseFilter(phase?: string): void {
    this.state.selectedPhase = phase;
    this.render();
  }

  /**
   * Set visibility
   */
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.widget) {
      this.widget.hidden = !visible;
      this.widget.screen.render();
    }
  }

  /**
   * Clean up component
   */
  destroy(): void {
    if (this.widget) {
      this.widget.destroy();
    }
  }

  /**
   * Get blessed widget
   */
  getWidget(): Widgets.Node {
    return this.widget;
  }
}
