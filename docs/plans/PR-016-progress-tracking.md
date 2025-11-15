# PR-016: Progress Tracking Display - Implementation Plan

**Status**: Planning
**Priority**: Medium
**Complexity**: 4/10 (40 minutes, Sonnet)
**Dependencies**: PR-015 (Terminal UI Implementation)

## Overview

Add progress tracking visualization to the TUI showing PR completion status, dependencies, and metrics. This PR extends the existing TUI (PR-015) with three new components that provide visibility into overall project progress and task dependencies.

## Current State Analysis

### Existing TUI Components (from PR-015)
- **TUIManager**: Main orchestrator with lifecycle management
- **StatusBar**: Shows coordination mode, active agents, active PR count (top 3 lines)
- **ActivityLog**: Scrollable activity feed with 1000-entry buffer
- **InputRouter**: Command parsing with @agent-id syntax
- **RenderLoop**: Throttled rendering at max 10 FPS

### Available Data Sources
- **TaskListParser** (PR-009): Parses task-list.md with PR metadata, dependencies, complexity
- **StateSync** (PR-010): Provides PR states (hot/cold), agent assignments, real-time updates
- **RedisOps**: Can query all PR states from Redis
- **GitOps**: Can reconstruct state from git

### Current Layout (3 lines used)
```
┌─ Status Bar (3 lines) ──────────────────────────────┐
│ Mode: DISTRIBUTED | Agents: 3/10 | PRs: 5 | Redis OK │
│ agent-001: planning PR-015 | agent-002: in-progress │
└──────────────────────────────────────────────────────┘
┌─ Activity Log (remaining height - 3 lines) ─────────┐
│ [12:34:56] hub: Agent agent-001 started             │
│ [12:35:01] agent-001: Planning PR-015...            │
│                                                      │
└──────────────────────────────────────────────────────┘
┌─ Input (3 lines) ───────────────────────────────────┐
│ > _                                                  │
└──────────────────────────────────────────────────────┘
```

## Design Goals

1. **Non-intrusive**: Add progress panel without disrupting existing TUI workflow
2. **Real-time**: Update automatically via StateSync events
3. **Informative**: Show completion status, dependencies, time estimates
4. **Interactive**: Allow users to expand/collapse views
5. **Performance**: Efficient rendering, no layout thrashing

## New TUI Layout

### Split-pane Layout (with progress panel)
```
┌─ Status Bar (3 lines) ──────────────────────────────┐
│ Mode: DISTRIBUTED | Agents: 3/10 | PRs: 5 | Redis OK │
│ agent-001: planning PR-015 | agent-002: in-progress │
└──────────────────────────────────────────────────────┘
┌─ Progress Panel (left, 30%) ────┬─ Activity Log ────┐
│ Phase 0.1b: UX & Integration    │ [12:34:56] hub:   │
│ ████████████░░░░░░░░ 60% (3/5)  │  Agent started    │
│                                  │ [12:35:01] agent: │
│ ✓ PR-014: CLI Commands           │  Planning...      │
│ ✓ PR-015: Terminal UI            │                   │
│ ▶ PR-016: Progress Tracking      │                   │
│   └─ depends on: PR-015          │                   │
│ ○ PR-017: Cost Controller        │                   │
│ ○ PR-018: Complexity Scorer      │                   │
│                                  │                   │
│ Metrics:                         │                   │
│ • Total PRs: 50                  │                   │
│ • Completed: 15 (30%)            │                   │
│ • In Progress: 3                 │                   │
│ • Blocked: 2                     │                   │
│ • Remaining: 30                  │                   │
│ • Est. Completion: 2.5 days      │                   │
└──────────────────────────────────┴───────────────────┘
┌─ Input (3 lines) ───────────────────────────────────┐
│ > _                                                  │
└──────────────────────────────────────────────────────┘
```

### Toggle Behavior
- **Default**: Progress panel visible (left 30%)
- **Toggle key**: `p` to show/hide progress panel
- **When hidden**: Activity log expands to full width
- **Responsive**: Panel width adjusts to terminal size (min 25%, max 40%)

## Component Architecture

### 1. ProgressTracker Component

**File**: `src/tui/progress.ts`

**Responsibilities**:
- Display overall project progress
- Show phase-level completion
- List PRs with status icons
- Display dependency chains
- Provide completion estimates

**State**:
```typescript
interface ProgressState {
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
```

**API**:
```typescript
class ProgressTracker implements TUIComponent {
  constructor(theme: ThemeColors);

  // Initialize with blessed screen
  init(screen: Widgets.Screen): void;

  // Update progress data
  update(data: ProgressState): void;

  // Render to screen
  render(): void;

  // Clean up
  destroy(): void;

  // Get blessed widget
  getWidget(): Widgets.Node;

  // Toggle panel visibility
  setVisible(visible: boolean): void;

  // Expand/collapse dependency tree
  toggleExpansion(prId: string): void;

  // Filter by phase
  setPhaseFilter(phase?: string): void;

  // Scroll controls
  scrollUp(): void;
  scrollDown(): void;
}
```

**Display Format**:
```
Phase 0.1b: UX & Integration
████████████░░░░░░░░ 60% (3/5)

✓ PR-014: CLI Commands           [completed]
✓ PR-015: Terminal UI             [completed]
▶ PR-016: Progress Tracking       [in-progress, agent-001]
  └─ depends on: PR-015 ✓
○ PR-017: Cost Controller         [blocked]
  └─ depends on: PR-002 ✓, PR-007 ✗
○ PR-018: Complexity Scorer       [ready]
  └─ depends on: PR-009 ✓
```

**Status Icons**:
- `✓` Completed (green)
- `▶` In progress (yellow)
- `○` Ready/New (white)
- `●` Blocked (red)
- `!` Broken (red)
- `~` Under review (cyan)

### 2. DependencyGraph Component

**File**: `src/tui/dependencies.ts`

**Responsibilities**:
- Build dependency graph from task list
- Detect circular dependencies
- Calculate critical path
- Find blocking PRs
- Compute completion estimates

**API**:
```typescript
class DependencyGraph {
  constructor(prs: PRData[]);

  // Get direct dependencies for a PR
  getDependencies(prId: string): string[];

  // Get all PRs that depend on this PR
  getDependents(prId: string): string[];

  // Check if PR is blocked by incomplete dependencies
  isBlocked(prId: string, states: Map<string, PRState>): boolean;

  // Get all PRs blocking this PR
  getBlockers(prId: string, states: Map<string, PRState>): string[];

  // Calculate critical path (longest dependency chain)
  getCriticalPath(): string[];

  // Get all PRs ready to start (dependencies met)
  getReadyPRs(states: Map<string, PRState>): string[];

  // Detect circular dependencies
  detectCycles(): string[][];

  // Get topological order for parallel execution
  getTopologicalOrder(): string[][];

  // Get completion estimate based on complexity
  estimateCompletion(
    states: Map<string, PRState>,
    agentCount: number
  ): {
    hoursRemaining: number;
    estimatedDate: Date;
    criticalPathHours: number;
  };
}
```

**Algorithms**:
- **Topological Sort**: For execution order
- **DFS**: For cycle detection
- **BFS**: For dependency tree traversal
- **Critical Path**: For completion estimates

### 3. MetricsPanel Component

**File**: `src/tui/metrics.ts`

**Responsibilities**:
- Display aggregate metrics
- Show completion statistics
- Calculate time estimates
- Track velocity

**State**:
```typescript
interface MetricsState {
  // Counts by state
  total: number;
  completed: number;
  inProgress: number;
  blocked: number;
  ready: number;
  new: number;
  broken: number;

  // Completion percentage
  completionPercent: number;

  // Time estimates
  estimatedHoursRemaining: number;
  estimatedCompletionDate: Date;

  // Velocity (PRs per day)
  velocity?: number;

  // Complexity distribution
  complexityDistribution: {
    haiku: number;
    sonnet: number;
    opus: number;
  };

  // Phase progress
  phaseProgress: Map<string, {
    total: number;
    completed: number;
    percent: number;
  }>;
}
```

**API**:
```typescript
class MetricsCalculator {
  constructor(prs: PRData[], states: Map<string, PRState>);

  // Calculate all metrics
  calculate(): MetricsState;

  // Get metrics for specific phase
  getPhaseMetrics(phase: string): PhaseMetrics;

  // Calculate velocity from recent completions
  calculateVelocity(window: number): number;

  // Estimate completion date
  estimateCompletion(agentCount: number): Date;
}
```

**Display Format**:
```
Metrics:
• Total PRs: 50
• Completed: 15 (30%)
• In Progress: 3
• Blocked: 2
• Ready: 10
• Remaining: 30

Complexity:
• Haiku: 28 PRs
• Sonnet: 19 PRs
• Opus: 3 PRs

Estimates:
• Hours Remaining: 38.5h
• Est. Completion: Jan 20, 2025
• Velocity: 2.3 PRs/day
```

## Integration with Existing TUI

### TUIManager Updates

**Add to TUIManager state**:
```typescript
private progressTracker!: ProgressTracker;
private dependencyGraph!: DependencyGraph;
private metricsCalculator!: MetricsCalculator;
private progressVisible: boolean = true;
private taskListPath: string = 'docs/task-list.md';
```

**Initialize in `init()` method**:
```typescript
// Parse task list
const parser = new TaskListParser();
const taskList = await parser.parse(this.taskListPath);

// Build dependency graph
this.dependencyGraph = new DependencyGraph(taskList.prs);

// Initialize progress tracker
this.progressTracker = new ProgressTracker(theme);
this.progressTracker.init(this.screen);

// Initialize metrics calculator
this.metricsCalculator = new MetricsCalculator(
  taskList.prs,
  new Map() // Will be populated by state sync
);
```

**Update layout in `init()` method**:
```typescript
// Adjust activity log width when progress panel is visible
private updateLayout(): void {
  const width = this.screen.width;
  const height = this.screen.height;

  if (this.progressVisible) {
    // Split layout
    const progressWidth = Math.max(
      Math.floor(width * 0.25),
      Math.min(Math.floor(width * 0.4), 40)
    );

    this.progressTracker.getWidget().width = progressWidth;
    this.activityLog.getWidget().left = progressWidth;
    this.activityLog.getWidget().width = width - progressWidth;
  } else {
    // Full width activity log
    this.activityLog.getWidget().left = 0;
    this.activityLog.getWidget().width = width;
  }

  this.renderLoop.forceRender();
}
```

**Add to `setupKeyBindings()` method**:
```typescript
// Toggle progress panel on 'p'
this.screen.key(['p'], () => {
  this.progressVisible = !this.progressVisible;
  this.progressTracker.setVisible(this.progressVisible);
  this.updateLayout();
  this.log('info', 'tui', `Progress panel ${this.progressVisible ? 'shown' : 'hidden'}`);
});

// Expand/collapse dependency tree on 'e'
this.screen.key(['e'], () => {
  // Toggle expansion for focused PR
  const focusedPR = this.progressTracker.getFocusedPR();
  if (focusedPR) {
    this.progressTracker.toggleExpansion(focusedPR);
  }
});

// Scroll progress panel
this.screen.key(['pageup'], () => {
  this.progressTracker.scrollUp();
});

this.screen.key(['pagedown'], () => {
  this.progressTracker.scrollDown();
});
```

**Add to `updateStatus()` method**:
```typescript
// Update progress tracker
const prStates = await this.getAllPRStates();
const metrics = this.metricsCalculator.calculate();

this.progressTracker.update({
  allPRs: taskList.prs,
  prStates,
  dependencies: this.dependencyGraph.getDependencyMap(),
  selectedPhase: this.currentPhase,
  expandedPRs: this.expandedPRs,
  scrollOffset: 0,
});
```

**Add StateSync event handlers**:
```typescript
// Subscribe to state sync events
this.stateSync.on('cold-sync', (prId, state) => {
  this.updateProgress();
});

this.stateSync.on('hot-sync', (prId, state) => {
  this.updateProgress();
});

private async updateProgress(): Promise<void> {
  const prStates = await this.getAllPRStates();
  const metrics = this.metricsCalculator.calculate();

  this.progressTracker.update({
    // ... state
  });
}
```

### Helper Methods

```typescript
/**
 * Get all PR states from Redis/git
 */
private async getAllPRStates(): Promise<Map<string, PRState>> {
  const states = new Map<string, PRState>();

  // Get from RedisOps
  const hotStates = await this.redisOps.getAllHotStates();
  const coldStates = await this.redisOps.getAllColdStates();

  // Merge hot and cold states
  for (const [prId, coldInfo] of coldStates) {
    const hotInfo = hotStates.get(prId);
    states.set(prId, {
      pr_id: prId,
      cold_state: coldInfo.state,
      hot_state: hotInfo?.state,
      agent_id: hotInfo?.agent_id,
      dependencies: coldInfo.dependencies || [],
      files_locked: coldInfo.files_locked || [],
      last_transition: coldInfo.timestamp,
    });
  }

  return states;
}
```

## File Structure

```
src/tui/
  ├── index.ts              [modify] Add progress tracker integration
  ├── progress.ts           [create]  ProgressTracker component
  ├── dependencies.ts       [create]  DependencyGraph utilities
  ├── metrics.ts            [create]  MetricsCalculator and panel
  ├── types.ts              [modify] Add progress types
  └── ...existing files...

tests/
  └── tui.test.ts           [create]  TUI component tests
```

## Implementation Steps

### Step 1: Dependencies Module (15 minutes)

1. Create `src/tui/dependencies.ts`
2. Implement `DependencyGraph` class
   - Constructor to build graph from PRs
   - `getDependencies()` and `getDependents()`
   - `isBlocked()` and `getBlockers()`
   - `getCriticalPath()` using longest path algorithm
   - `getReadyPRs()` filtering
   - `detectCycles()` using DFS
   - `getTopologicalOrder()` using Kahn's algorithm
   - `estimateCompletion()` using critical path + parallelism
3. Add unit tests for dependency algorithms

### Step 2: Metrics Module (10 minutes)

1. Create `src/tui/metrics.ts`
2. Implement `MetricsCalculator` class
   - `calculate()` to compute all metrics
   - `getPhaseMetrics()` for phase-specific stats
   - `calculateVelocity()` from recent completions
   - `estimateCompletion()` using velocity + remaining work
3. Implement `MetricsPanel` component
   - Render metrics in formatted table
   - Color-code percentages (green >50%, yellow >25%, red <25%)
4. Add unit tests for metrics calculations

### Step 3: Progress Tracker Component (10 minutes)

1. Create `src/tui/progress.ts`
2. Implement `ProgressTracker` class
   - Blessed list widget for PR display
   - Status icons based on PR state
   - Dependency tree with indentation
   - Phase filtering
   - Expansion/collapse state
   - Scroll handling
3. Implement rendering logic
   - Progress bars using Unicode blocks (█░)
   - Color-coded status icons
   - Dependency tree with box-drawing characters
4. Add unit tests for component logic

### Step 4: TUI Integration (5 minutes)

1. Modify `src/tui/index.ts`
   - Add progress tracker initialization
   - Add layout management
   - Add key bindings (p, e, pageup, pagedown)
   - Wire up state sync events
   - Add helper methods for PR state fetching
2. Modify `src/tui/types.ts`
   - Add `ProgressState`, `MetricsState` interfaces
3. Test integration with existing TUI

### Step 5: Testing (5 minutes)

1. Create `tests/tui.test.ts`
2. Test DependencyGraph
   - Dependency resolution
   - Cycle detection
   - Critical path calculation
   - Topological sort
3. Test MetricsCalculator
   - Metric calculations
   - Velocity tracking
   - Completion estimates
4. Test ProgressTracker
   - State updates
   - Rendering
   - Expansion/collapse
   - Filtering
5. Test TUI integration
   - Layout switching
   - Real-time updates
   - Key bindings

## Testing Strategy

### Unit Tests

**DependencyGraph tests**:
```typescript
describe('DependencyGraph', () => {
  it('should build dependency graph from PRs', () => {
    const prs = [
      { pr_id: 'PR-001', dependencies: [] },
      { pr_id: 'PR-002', dependencies: ['PR-001'] },
    ];
    const graph = new DependencyGraph(prs);
    expect(graph.getDependencies('PR-002')).toEqual(['PR-001']);
  });

  it('should detect circular dependencies', () => {
    const prs = [
      { pr_id: 'PR-001', dependencies: ['PR-002'] },
      { pr_id: 'PR-002', dependencies: ['PR-001'] },
    ];
    const graph = new DependencyGraph(prs);
    const cycles = graph.detectCycles();
    expect(cycles).toHaveLength(1);
  });

  it('should calculate critical path', () => {
    // Test longest dependency chain
  });

  it('should identify ready PRs', () => {
    // Test PRs with met dependencies
  });
});
```

**MetricsCalculator tests**:
```typescript
describe('MetricsCalculator', () => {
  it('should calculate completion percentage', () => {
    const prs = createMockPRs(10);
    const states = createMockStates({ completed: 3 });
    const calc = new MetricsCalculator(prs, states);
    const metrics = calc.calculate();
    expect(metrics.completionPercent).toBe(30);
  });

  it('should estimate completion date', () => {
    // Test with velocity
  });

  it('should calculate complexity distribution', () => {
    // Test haiku/sonnet/opus counts
  });
});
```

**ProgressTracker tests**:
```typescript
describe('ProgressTracker', () => {
  it('should render PR list with status icons', () => {
    // Test rendering
  });

  it('should toggle dependency expansion', () => {
    // Test expansion state
  });

  it('should filter by phase', () => {
    // Test phase filtering
  });
});
```

### Integration Tests

**TUI integration tests**:
```typescript
describe('TUI with Progress Tracking', () => {
  it('should toggle progress panel', () => {
    // Test 'p' key
  });

  it('should update on state sync events', () => {
    // Test real-time updates
  });

  it('should adjust layout on resize', () => {
    // Test responsive layout
  });
});
```

### Manual Testing Checklist

- [ ] Progress panel displays correctly
- [ ] Status icons show correct state
- [ ] Dependency trees render properly
- [ ] Metrics are accurate
- [ ] Real-time updates work
- [ ] Toggle key (p) shows/hides panel
- [ ] Expansion key (e) expands/collapses trees
- [ ] Scroll keys work (pageup/pagedown)
- [ ] Layout adjusts to terminal size
- [ ] Performance is acceptable (no lag)

## Acceptance Criteria Validation

✅ **Shows completed/in-progress/blocked PRs**
- ProgressTracker displays all PR states with status icons
- Metrics panel shows counts by state
- Color-coded for quick visual identification

✅ **Dependency chains visible**
- DependencyGraph builds and displays dependency trees
- Indented tree view with box-drawing characters
- Expand/collapse for complex dependencies

✅ **Completion percentage displayed**
- Phase-level progress bars with percentage
- Overall project completion percentage
- Color-coded progress bars (green/yellow/red)

✅ **Time estimates shown**
- MetricsCalculator estimates completion date
- Critical path calculation for realistic estimates
- Velocity tracking for data-driven estimates

✅ **Updates in real-time**
- StateSync event handlers update progress immediately
- No manual refresh required
- Efficient rendering (max 10 FPS)

## Performance Considerations

1. **Efficient Rendering**: Leverage RenderLoop's throttling (10 FPS max)
2. **Incremental Updates**: Only re-render changed sections
3. **Lazy Expansion**: Only render expanded dependency trees
4. **Caching**: Cache dependency graph, recalculate only on task list changes
5. **Debouncing**: Debounce rapid state updates to reduce render load

## Error Handling

1. **Task List Parse Errors**: Graceful fallback, show error in activity log
2. **State Sync Errors**: Continue with cached state, log warning
3. **Circular Dependencies**: Detect and display warning
4. **Missing Dependencies**: Show as errors in dependency tree

## Future Enhancements (Post-PR-016)

1. **Interactive Navigation**: Arrow keys to navigate PR list
2. **PR Details Panel**: Show full PR details on selection
3. **Filter Controls**: Filter by state, complexity, phase
4. **Export Progress**: Export progress report to markdown
5. **Gantt Chart View**: Visual timeline for PRs (blessed-contrib)
6. **Cost Tracking**: Display cost metrics alongside progress
7. **Agent Assignment View**: Show which agents are working on which PRs

## Dependencies

**Existing Dependencies**:
- `blessed`: Terminal UI framework
- `blessed-contrib`: Additional widgets (for future Gantt charts)

**New Dependencies**: None (uses existing infrastructure)

## Risk Assessment

**Low Risk**:
- Extends existing TUI without breaking changes
- Optional feature (can be toggled off)
- Well-isolated components
- Comprehensive testing strategy

**Potential Issues**:
- Layout complexity with split panes (mitigated by blessed's layout system)
- Performance with large task lists (mitigated by throttling and lazy rendering)
- Terminal size compatibility (mitigated by responsive design)

## Rollout Plan

1. **Phase 1**: Implement core components (dependencies, metrics)
2. **Phase 2**: Implement ProgressTracker component
3. **Phase 3**: Integrate with TUI
4. **Phase 4**: Add tests
5. **Phase 5**: Manual testing and polish

## Documentation Updates

**Files to update**:
- `docs/guide/commands.md`: Document progress panel key bindings
- `README.md`: Add screenshot of progress tracking
- `src/tui/README.md`: (new) Document TUI architecture

## Success Metrics

- [ ] All acceptance criteria met
- [ ] Test coverage >90%
- [ ] No performance regression (maintain <100ms render time)
- [ ] Clean TypeScript compilation (no errors)
- [ ] User feedback positive (usability)

## Estimated Timeline

- **Dependencies Module**: 15 minutes
- **Metrics Module**: 10 minutes
- **Progress Tracker**: 10 minutes
- **TUI Integration**: 5 minutes
- **Testing**: 5 minutes
- **Buffer**: 5 minutes

**Total**: 50 minutes (within 40-minute estimate + 10-minute buffer)

## Notes

- Build on solid foundation from PR-015 (TUI)
- Leverage existing state sync for real-time updates
- Keep UI simple and keyboard-driven (terminal-first)
- Focus on information density without clutter
- Design for extensibility (future enhancements)
