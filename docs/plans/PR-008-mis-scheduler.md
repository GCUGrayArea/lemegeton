# PR-008: MIS Scheduler Implementation - Plan

## Overview
Implement the Minimum Input Set (MIS) scheduling algorithm that assigns work to agents based on dependencies and file conflicts. This scheduler is the brain of Lemegeton's parallel execution strategy, ensuring multiple agents can work simultaneously without conflicts.

## Key Concepts

### Minimum Input Set (MIS)
The MIS algorithm finds the maximum set of PRs that can be worked on simultaneously by:
1. Respecting dependency constraints (can't work on PR-B if PR-A isn't complete)
2. Avoiding file conflicts (two PRs modifying the same file can't run in parallel)
3. Optimizing for maximum parallelization

### Dependency Graph
- PRs form a directed acyclic graph (DAG) based on dependencies
- A PR is "available" when all its dependencies are complete
- The scheduler must traverse this graph efficiently

### File Conflict Detection
- PRs declare which files they will modify
- Two PRs conflict if they share any files
- Conflicts prevent parallel execution

## Architecture

```
┌─────────────────────────────────────────┐
│           MIS Scheduler                  │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────────┐  ┌──────────────┐   │
│  │ Dependency   │  │   Conflict   │   │
│  │   Analyzer   │  │   Detector   │   │
│  └──────┬───────┘  └──────┬───────┘   │
│         │                  │           │
│  ┌──────▼──────────────────▼───────┐  │
│  │       Graph Builder              │  │
│  └──────────────┬───────────────────┘  │
│                 │                      │
│  ┌──────────────▼───────────────────┐  │
│  │      MIS Algorithm Core          │  │
│  │  - Greedy selection              │  │
│  │  - Conflict resolution           │  │
│  │  - Priority ordering             │  │
│  └──────────────┬───────────────────┘  │
│                 │                      │
│  ┌──────────────▼───────────────────┐  │
│  │     Assignment Manager           │  │
│  └──────────────────────────────────┘  │
│                                         │
└─────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Core Data Structures
1. **PR Node Structure**
   ```typescript
   interface PRNode {
     id: string;
     dependencies: Set<string>;
     dependents: Set<string>;
     files: Set<string>;
     priority: number;
     complexity: number;
     state: PRState;
   }
   ```

2. **Dependency Graph**
   ```typescript
   class DependencyGraph {
     nodes: Map<string, PRNode>;
     buildFromTaskList(taskList: TaskList): void;
     getAvailable(): PRNode[];
     markComplete(prId: string): void;
   }
   ```

3. **Conflict Matrix**
   ```typescript
   class ConflictMatrix {
     conflicts: Map<string, Set<string>>;
     detectConflicts(nodes: PRNode[]): void;
     hasConflict(pr1: string, pr2: string): boolean;
   }
   ```

### Phase 2: MIS Algorithm
1. **Core Algorithm**
   ```typescript
   class MISScheduler {
     findMaximumIndependentSet(
       available: PRNode[],
       conflicts: ConflictMatrix
     ): PRNode[];
   }
   ```

2. **Greedy Heuristics**
   - Sort by priority (critical > high > medium > low)
   - Within same priority, prefer lower complexity
   - Break ties by lexicographic order for determinism

3. **Optimization Strategies**
   - Cache conflict calculations
   - Use bit vectors for fast set operations
   - Prune search space early

### Phase 3: Assignment Logic
1. **Work Assignment**
   ```typescript
   interface Assignment {
     prId: string;
     agentId: string;
     assignedAt: number;
     estimatedDuration: number;
   }
   ```

2. **Agent Selection**
   - Match agent capabilities to PR complexity
   - Balance workload across agents
   - Consider agent specialization (future)

### Phase 4: Integration Points
1. **Hub Integration**
   - Hub queries scheduler for next assignments
   - Scheduler receives completion notifications
   - Real-time graph updates

2. **Redis State**
   - Cache computed MIS results
   - Store assignment history
   - Track PR completion order

3. **Monitoring**
   - Track scheduling efficiency
   - Measure parallelization achieved
   - Identify bottleneck PRs

## Algorithm Details

### MIS Algorithm (Greedy Approach)
```
function findMIS(available, conflicts):
  selected = []
  candidates = sort(available, by=[priority, complexity])

  for pr in candidates:
    canAdd = true
    for selected_pr in selected:
      if conflicts.hasConflict(pr, selected_pr):
        canAdd = false
        break

    if canAdd:
      selected.append(pr)

  return selected
```

### Dependency Resolution
```
function getAvailablePRs(graph, completed):
  available = []

  for pr in graph.nodes:
    if pr.state == 'new':
      allDepsComplete = true
      for dep in pr.dependencies:
        if dep not in completed:
          allDepsComplete = false
          break

      if allDepsComplete:
        available.append(pr)

  return available
```

## Performance Considerations

1. **Scalability Goals**
   - Handle 100+ PRs efficiently
   - Scheduling decision < 100ms
   - Support real-time updates

2. **Optimization Techniques**
   - Incremental graph updates (don't rebuild from scratch)
   - Lazy conflict detection
   - Result caching with invalidation

3. **Memory Management**
   - Use sparse representations for conflict matrix
   - Implement node pooling for graph updates
   - Clear caches periodically

## Testing Strategy

1. **Unit Tests**
   - Graph construction from various task lists
   - Conflict detection edge cases
   - MIS algorithm correctness

2. **Property-Based Tests**
   - No conflicting PRs in result set
   - All dependencies respected
   - Result is maximal (can't add more PRs)

3. **Performance Tests**
   - Large graph handling (100+ nodes)
   - Complex dependency chains
   - Dense conflict scenarios

4. **Integration Tests**
   - Hub scheduler interaction
   - State persistence and recovery
   - Real-time update handling

## File Structure

```
src/scheduler/
├── index.ts              # Main scheduler exports
├── mis.ts                # MIS algorithm implementation
├── dependencies.ts       # Dependency graph analysis
├── conflicts.ts          # File conflict detection
├── assignment.ts         # Work assignment logic
├── graph.ts             # Graph data structures
├── types.ts             # TypeScript interfaces
└── utils.ts             # Helper functions

tests/
├── scheduler.test.ts     # Comprehensive test suite
├── fixtures/            # Test data
│   ├── simple.json      # Simple dependency graph
│   ├── complex.json     # Complex scenarios
│   └── conflicts.json   # Conflict-heavy cases
└── benchmarks/
    └── scheduler.bench.ts # Performance benchmarks
```

## Success Criteria

1. **Correctness**
   - Never assigns conflicting PRs simultaneously
   - Always respects dependency order
   - Finds optimal or near-optimal solutions

2. **Performance**
   - Scheduling decision < 100ms for 100 PRs
   - Memory usage < 50MB for typical workloads
   - Incremental updates < 10ms

3. **Robustness**
   - Handles circular dependency detection
   - Graceful degradation with incomplete data
   - Recovery from corrupted state

## Dependencies

- PR-007: Hub provides the execution context for scheduler
- Redis: For state persistence and caching
- Task List: Source of PR dependencies and file lists

## Risk Mitigation

1. **Algorithm Complexity**
   - Risk: MIS is NP-hard in general case
   - Mitigation: Use greedy approximation with good heuristics

2. **Dynamic Updates**
   - Risk: Graph changes during scheduling
   - Mitigation: Implement proper locking and versioning

3. **Performance Bottleneck**
   - Risk: Scheduler becomes system bottleneck
   - Mitigation: Aggressive caching and incremental updates

## Next Steps

1. Implement core data structures (PRNode, DependencyGraph)
2. Build conflict detection system
3. Implement greedy MIS algorithm
4. Add priority and complexity heuristics
5. Create assignment manager
6. Write comprehensive tests
7. Benchmark and optimize
8. Integrate with Hub

This scheduler is critical for Lemegeton's ability to parallelize work effectively. The implementation should prioritize correctness first, then optimize for performance.