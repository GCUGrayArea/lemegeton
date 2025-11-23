# Option C Research Summary

**Date:** 2025-11-23
**Research Time:** ~2 hours during your sleep
**Status:** Complete - Design document ready for review

---

## What Was Done

Researched **Taskmaster's MCP architecture** and created comprehensive design notes for implementing **Option C (MCP Bridge)** for Lemegeton.

**Deliverable:** `/docs/design/option-c-mcp-bridge.md` (682 lines)

---

## Key Findings

### Taskmaster's Approach

**Architecture Pattern:**
```
AI Tool Session (has auth)
  ↓
MCP Server (thin wrapper, runs in-process)
  ↓
Tool Functions (40+ self-contained modules)
  ↓
Core Business Logic (reusable packages)
```

**What They Do Well:**
1. **Separation of concerns** - MCP server is just a thin bridge, business logic is separate
2. **Tool modularity** - Each tool is a self-contained file (40+ tools in `tools/` directory)
3. **Mode system** - Core (7), Standard (15), All (44) tools for context optimization
4. **Declarative tools** - Zod schemas for automatic parameter validation
5. **Session auth** - Inherits parent AI tool's authentication automatically

### How It Maps to Lemegeton

**Good News:** We already have most of what we need!

**Mapping:**
- Taskmaster's "tasks" → Lemegeton's PRs
- Their tool functions → Wrappers around our `HubClient` methods
- Their core logic → Our Hub/Scheduler/Agents (already exists)
- Their MCP server → New thin layer (6-9 days work)

**Core Tools We'd Expose:**
```javascript
// Minimal viable tool set
1. run_pr          // Main tool - wraps HubClient.runPR()
2. list_prs        // Shows available work
3. next_pr         // Get next PR to work on
4. get_pr_status   // Check progress
5. stop_hub        // Graceful shutdown
```

Most of these already exist in `src/cli/hubClient.ts` - we just need to expose them as MCP tools!

### Authentication Strategy

**Multi-Tool Support:**
```
┌─────────────────┬──────────────┬─────────────────┐
│ Tool            │ Auth Method  │ Auto/Manual     │
├─────────────────┼──────────────┼─────────────────┤
│ Claude Code     │ Session      │ ✅ Automatic    │
│ Cursor          │ API Key      │ ⚠️ Manual       │
│ Copilot         │ GitHub Token │ ⚠️ Manual       │
│ Standalone CLI  │ API Key      │ ⚠️ Manual       │
└─────────────────┴──────────────┴─────────────────┘
```

**Fallback Strategy:**
1. Try MCP session auth (automatic)
2. Fall back to `ANTHROPIC_API_KEY`
3. Fall back to `CLAUDE_CODE_OAUTH_TOKEN` (Option B)
4. Error if none available

**Key Insight:** MCP servers run **in-process** within AI tool sessions, so they inherit auth automatically. This solves the Option B token management problem elegantly.

---

## Comparison: Option C vs Others

### vs Option A (Subagents)

**Option C Wins:**
- ✅ Works with **any** MCP-compatible tool (Claude Code, Cursor, Windsurf, VS Code)
- ✅ Less invasive (keep current architecture)
- ✅ Standard protocol (MCP is becoming industry standard)

**Option A Advantage:**
- Slightly simpler (no MCP server to build)

**Verdict:** Option C better for tool-agnosticism

### vs Option B (OAuth Token Passing - Current)

**Option C Wins:**
- ✅ **Automatic** session auth (no `claude setup-token` needed)
- ✅ **Secure** (tokens never exposed in env vars)
- ✅ **Official** (documented, supported pattern)
- ✅ No token expiration issues

**Option B Advantage:**
- Already implemented (good for validation!)

**Verdict:** Option C is the proper long-term solution; Option B is good for proof-of-concept

### vs Option D (Require API Keys)

**Option C Wins:**
- ✅ **No extra cost** (uses subscription, not API billing)
- ✅ **Better UX** (automatic auth)
- ✅ Enables dogfooding (you don't have API key)

**Option D Advantage:**
- Simplest (no code changes)

**Verdict:** Option C enables users with subscriptions to use Lemegeton without additional API costs

---

## Implementation Plan

### Phase 1: Proof of Concept (1-2 days)
```
✓ Research Taskmaster ← Done!
→ Create mcp-server/ directory
→ Implement basic LemegetonMCPServer class
→ Add single tool: run_pr (wraps HubClient.runPR)
→ Test with Claude Code
```

**Success Criteria:** Run a PR using MCP tool without API key

### Phase 2: Core Tools (2-3 days)
```
→ Implement 5 core tools
→ Add tool registry with mode system
→ Structured responses
→ Error handling
```

**Success Criteria:** Orchestrate full workflow via MCP tools

### Phase 3: Multi-Tool Auth (1-2 days)
```
→ MultiToolAuthAdapter class
→ Support Claude Code, Cursor, Copilot
→ Test with multiple tools
```

**Success Criteria:** Detects and adapts to different AI tools

### Phase 4: Plugin Packaging (1 day)
```
→ Claude Code plugin manifest
→ Installation instructions
→ Test install flow
```

**Success Criteria:** Install with `/plugin add lemegeton`

### Phase 5: Documentation (1 day)
```
→ MCP server docs
→ Tool usage examples
→ Troubleshooting guide
```

**Total:** 6-9 days

---

## Example: How It Would Work

**User Experience with Option C:**

```bash
# Installation (one-time setup)
/plugin add lemegeton

# Usage (from within Claude Code chat)
User: "Can you work on PR-017?"

Claude: *calls run_pr tool*
        run_pr({ prId: "PR-017" })

Lemegeton MCP Server:
  ✓ Detects Claude Code session
  ✓ Inherits session auth automatically
  ✓ Calls HubClient.runPR("PR-017")
  ✓ Hub spawns worker agent
  ✓ Agent generates code using Claude API
  ✓ Returns result to Claude

Claude: "I've completed PR-017. The implementation adds..."
```

**No API key needed!** Works seamlessly because MCP server inherits Claude Code session auth.

---

## What You Need to Decide

After validating Option B (which proves the coordination core works):

**Decision Point:** Implement Option C for long-term?

**Considerations:**
1. **Effort:** 6-9 days (medium complexity)
2. **Benefits:** Tool-agnostic, automatic auth, no extra costs
3. **Risks:** New territory (learning MCP protocol)
4. **Alternative:** Stick with Option B (works but has manual token mgmt)

**Recommendation:** Yes, implement Option C
- Aligns with tool-agnosticism design goal
- Follows proven pattern (Taskmaster's success)
- Better UX than Option B
- Positions Lemegeton well for multi-tool ecosystem

---

## Next Steps

**Immediate (when you wake up):**
1. Review design doc: `/docs/design/option-c-mcp-bridge.md`
2. Validate Option B (test with OAuth token)
3. If validation succeeds, decide: Option C or stick with B?

**If choosing Option C:**
1. Start with Phase 1 (proof of concept)
2. Test MCP session auth actually works
3. Iterate based on findings

**If sticking with Option B:**
1. Document token management requirements
2. Add to user setup guide
3. Mark as "known limitation" for future improvement

---

## Files Created

```
docs/design/
├── option-c-mcp-bridge.md     # Full design doc (682 lines)
└── OPTION_C_SUMMARY.md        # This summary
```

**Committed:** ✅ `cfbf46c` - "Add Option C (MCP Bridge) design document"
**Pushed:** ✅ To branch `claude/evaluate-dogfooding-readiness-01GXB552UtQnG2fibXPVZdAz`

---

## Questions Answered

**Q: Is Option C what Taskmaster uses?**
A: Yes, exactly. Taskmaster is an MCP server that exposes task management as tools.

**Q: Could we make it available in Cursor/OpenCode?**
A: Yes! MCP is supported by:
- ✅ Claude Code (native)
- ✅ Cursor (yes)
- ✅ Windsurf (yes)
- ✅ VS Code (via extension)
- ❓ GitHub Copilot (unclear)

**Q: Where does this fit in the task list?**
A: High Priority, right after Option B validation:

```
Critical Path:
1. Validate Option B ← You're here

High Priority:
2. Implement Option C (MCP Bridge) ← NEW (6-9 days)
3. WorkerAgent validation
4. QCAgent implementation

Medium Priority:
5. Git state sync
6. Error recovery
...
```

Not Critical Path because you can dogfood with Option B. But High Priority because it's the recommended long-term architecture.

---

## TL;DR

**What:** Researched Taskmaster, created full design for Option C (MCP Bridge)

**Why:** Preserves tool-agnosticism, automatic auth, no API costs

**How:** MCP server as thin wrapper over existing Hub/Scheduler/Agents

**Effort:** 6-9 days total, start with 1-2 day proof of concept

**Next:** Review design doc, validate Option B, then decide

**Status:** Design complete, ready to implement when you decide

---

Sleep well! The design is ready for your review when you're back. 🌙
