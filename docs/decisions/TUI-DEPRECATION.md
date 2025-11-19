# TUI Deprecation Decision

**Date:** 2025-11-17
**Status:** Implemented
**Decision:** Deprecate TUI CLI commands, keep code as reference, focus on web dashboard

---

## Context

The project originally planned a Terminal UI (TUI) using the Blessed library for single-shell monitoring and interaction with multiple AI agents (PR-015, PR-016). The TUI was fully implemented with sophisticated features:

- **Size:** ~3,800 lines of TypeScript
- **Features:**
  - Real-time status bar with agent monitoring
  - Activity log with filtering and search
  - Input routing to specific agents
  - **Progress tracking with phase-based bars**
  - **Dependency graph visualization with cycle detection**
  - **Completion time estimates and velocity metrics**
  - **Critical path analysis**
  - Keyboard shortcuts and interactive commands

**Actual effort:** ~4 hours (vs 70 minutes estimated)

## Problems with TUI

1. **Windows/MINGW compatibility issues** - Terminal escape sequences, input handling
2. **CRLF line ending handling** - Git and terminal rendering problems
3. **Single-user limitation** - Only one person could monitor at a time
4. **Hub offline freezing** - Terminal would hang when Hub daemon stopped
5. **Limited shareability** - Can't easily share views or export data

## Decision

**Adopted web dashboard instead** (merged in PR #3):

- **Technology:** React 18.2 + TypeScript + Vite + Express + WebSocket
- **Size:** ~1,300 lines (smaller, simpler)
- **Benefits:**
  - Browser-based, works on any platform
  - Multi-user support (max 10 concurrent clients)
  - Better Windows compatibility
  - No terminal escape sequence issues
  - Shareable URLs and exportable data
  - More room for growth (charts, graphs, animations)

## What Was Lost

The dashboard is currently **missing key features** from the TUI:

| Feature | TUI | Dashboard |
|---------|-----|-----------|
| Dependency graph visualization | ✓ (471 lines) | ✗ |
| Phase-based progress bars | ✓ (581 lines) | ✗ |
| Completion time estimates | ✓ (508 lines) | ✗ |
| Velocity tracking | ✓ | ✗ |
| Critical path analysis | ✓ | ✗ |
| Blocking/ready PR metrics | ✓ | ✗ |
| Interactive filtering | ✓ | ✗ |
| Input routing to agents | ✓ | ✗ |

**Total lost functionality:** ~1,560 lines of sophisticated analysis and visualization code

## Implementation

### What Was Removed
- **TUI CLI commands** (`lemegeton tui`) - Removed from `src/cli/index.ts` and `src/cli/commands/tui.ts` deleted
- **Help text** - TUI examples removed from CLI help

### What Was Kept
- **All TUI source code** in `src/tui/` - Serves as reference implementation
- **All algorithms and logic** - Can be ported to dashboard as needed

### Migration Path

**PR-016 has been replanned** as "Dashboard Progress Tracking and Visualization":
- Port dependency graph to React Flow or Cytoscape.js
- Port metrics calculation to React hooks
- Add export functionality (CSV/JSON)
- Restore feature parity with TUI

**Priority:** Medium-high (key visibility feature)
**Estimated effort:** 60 minutes (likely 2-4 hours in reality based on TUI experience)

## Rationale

The web dashboard is the better long-term architecture:
- **More accessible** - Browser > terminal for most users
- **More maintainable** - React ecosystem > terminal escape codes
- **More extensible** - Easy to add charts, exports, team features
- **Better UX** - Modern web UI > terminal constraints

The TUI code remains valuable as:
- **Reference implementation** - Proven algorithms for dependency analysis
- **Fallback option** - Could resurrect for headless/SSH scenarios
- **Documentation** - Shows what features users expect

## Future Work

1. **Port TUI features to dashboard** (PR-016)
   - Dependency graph with React Flow
   - Progress metrics panel
   - Export capabilities

2. **Consider TUI resurrection** (low priority)
   - Only if users request headless mode
   - Fix Windows compatibility first
   - Would be secondary interface

3. **Enhance dashboard beyond TUI**
   - Team collaboration features
   - Historical metrics and trends
   - Cost analytics dashboards
   - Agent performance monitoring

## Lessons Learned

1. **Estimation accuracy:** TUI took 4 hours vs 70 minutes estimated - the team's rapid development methodology makes traditional estimates unreliable
2. **Platform compatibility:** Windows support is critical, test early
3. **Multi-user needs:** Browser-based is better for team visibility
4. **Code preservation:** Keep good code even when deprecating - it's valuable reference

## References

- **Original plans:** `docs/plans/PR-015-tui-implementation.md`, `docs/plans/PR-016-progress-tracking.md`
- **TUI code:** `src/tui/` (3,800 lines)
- **Dashboard code:** `dashboard/src/`, `src/dashboard/server.ts`
- **Analysis:** `DASHBOARD_ANALYSIS.md`
- **Task list updates:** `docs/task-list.md` (PR-015 marked deprecated, PR-016 replanned)

---

**Decision Owners:** Project team
**Implemented By:** Task list updates 2025-11-17
