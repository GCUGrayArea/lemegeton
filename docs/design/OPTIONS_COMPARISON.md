# Architecture Options Comparison

**Date:** 2025-11-23
**Purpose:** Side-by-side comparison of Option A (Subagents) vs Option C (MCP Bridge)

---

## TL;DR

| Criterion | Winner | Reason |
|-----------|--------|--------|
| **Tool-Agnosticism** | Option C | Works with Claude, Cursor, Windsurf, VS Code |
| **Claude Code UX** | Option A | Native integration, cleanest experience |
| **Portability** | Option C | Standalone CLI, CI/CD work without changes |
| **Implementation Time** | Option C | 6-9 days vs 15-22 days |
| **Authentication** | Tie | Both solve auth problem automatically |
| **Flexibility** | Option C | Unlimited concurrency, agent nesting possible |
| **Simplicity** | Option A | Declarative YAML vs code-based architecture |
| **Lock-in Risk** | Option C | MCP is industry standard, Claude-specific |

**Recommendation:** **Option C** if tool-agnosticism matters, **Option A** if Claude-only is acceptable.

---

## Quick Comparison Table

| Feature | Option A (Subagents) | Option C (MCP Bridge) |
|---------|---------------------|----------------------|
| **Works on Claude Code** | ✅ Best experience | ✅ Good experience |
| **Works on Cursor** | ❌ Not compatible | ✅ Works |
| **Works on Windsurf** | ❌ Not compatible | ✅ Works |
| **Works on VS Code** | ⚠️ Via Agent SDK (complex) | ✅ MCP extension |
| **Standalone CLI** | ❌ Requires rewrite | ✅ Works (API key) |
| **CI/CD (GitHub Actions)** | ⚠️ Agent SDK setup | ✅ Standard CLI |
| **Authentication** | ✅ Automatic (session) | ✅ Automatic (in-session) or API key |
| **Max Concurrency** | ⚠️ 10 agents | ✅ Unlimited |
| **Agent Nesting** | ❌ Flat only | ✅ Possible |
| **Real-time Monitoring** | ❌ No visibility | ⚠️ Partial (tool calls) |
| **Implementation Effort** | 3-4 weeks | 6-9 days |
| **Code Architecture** | Natural language (YAML) | TypeScript/code-based |
| **Tool-Agnostic** | ❌ Claude-specific | ✅ MCP standard |
| **Future-Proof** | ⚠️ Vendor lock-in | ✅ Industry standard |

---

## Detailed Breakdown

### 1. Claude-Specificity (Tool Lock-In)

**Option A (Subagents): HIGHLY Claude-Specific**

❌ **Cannot Run On:**
- Cursor
- Windsurf
- Standard VS Code
- OpenAI/ChatGPT
- Any non-Claude environment

⚠️ **Limited Support:**
- VS Code with Agent SDK (requires Python/TypeScript setup)
- CI/CD via Agent SDK (requires API key + SDK installation)

✅ **Native Support:**
- Claude Code (best experience)

**Verdict:** Deep lock-in to Claude ecosystem. Moving away requires **full rewrite**.

---

**Option C (MCP Bridge): Tool-Agnostic**

✅ **Works Natively On:**
- Claude Code (automatic session auth)
- Cursor (MCP supported)
- Windsurf (MCP supported)
- VS Code (via MCP extension)
- Standalone CLI (API key fallback)
- CI/CD (standard CLI)

**Verdict:** MCP is becoming **industry standard**. Portable across tools.

---

### 2. Implementation Complexity

**Option A (Subagents): 3-4 Weeks**

1. MCP tool bridge: 3-5 days
2. Orchestrator agent: 2-3 days
3. Specialized agents: 5-7 days
4. End-to-end integration: 3-4 days
5. UX polish: 2-3 days

**Total: 15-22 days**

**Why Longer:**
- Must define agents in YAML + system prompts
- MCP tools to bridge to existing code
- Orchestrator logic in natural language
- Testing is harder (no real-time visibility)
- Need to tune prompts for reliability

---

**Option C (MCP Bridge): 6-9 Days**

1. Proof of concept: 1-2 days
2. Core tool set: 2-3 days
3. Multi-tool auth: 1-2 days
4. Plugin packaging: 1 day
5. Documentation: 1 day

**Total: 6-9 days**

**Why Faster:**
- Most code already exists (HubClient, Scheduler)
- MCP server is thin wrapper
- No agent prompt engineering
- Standard testing approaches work
- Familiar code-based architecture

---

### 3. Architecture Philosophy

**Option A: Natural Language First**

```yaml
# .claude/agents/worker-agent.md
---
name: "WorkerAgent"
description: "Implements PRs"
tools: "file-read,file-write,bash"
---

You are an expert TypeScript developer.
When assigned a PR:
1. Read the PRD
2. Generate code
3. Run build
4. Update state
```

**Philosophy:**
- Agents defined by **what they should do** (instructions)
- Claude interprets and executes
- No explicit code for agent behavior

**Pros:**
- Very high-level, declarative
- Non-programmers can define agents
- Natural language is flexible

**Cons:**
- Prompt engineering needed for reliability
- Harder to debug (no code to trace)
- Behavior can be non-deterministic

---

**Option C: Code First**

```typescript
// mcp-server/src/tools/run-pr.js
export function registerRunPR(server) {
  server.addTool({
    name: 'run_pr',
    parameters: z.object({ prId: z.string() }),
    execute: async ({ prId }) => {
      const result = await hubClient.runPR(prId);
      return result;
    }
  });
}
```

**Philosophy:**
- Tools expose **what agents can do** (capabilities)
- Existing code does the work
- AI calls tools, code executes logic

**Pros:**
- Deterministic behavior
- Easy to debug and test
- Familiar development patterns

**Cons:**
- More code to write
- Less "AI-native"
- Programmers needed to extend

---

### 4. Architectural Constraints

**Option A (Subagents): Strict Limitations**

❌ **Flat Architecture Only:**
```
Orchestrator
├── PlanningAgent ✅
├── WorkerAgent ✅
│   └── HelperAgent ❌ Cannot nest!
└── QCAgent ✅
```

❌ **Max 10 Concurrent Agents**
- Additional agents queue
- No control over priority
- Bottleneck for high parallelism

❌ **No Real-Time Visibility**
- Can't monitor progress
- Can't see intermediate results
- Must wait for completion

❌ **Unidirectional Communication**
- Agents can't query parent
- All context passed upfront
- No inter-agent communication

---

**Option C (MCP Bridge): More Flexible**

✅ **Hierarchical Architecture Possible:**
```
MCP Server
├── Hub (spawns agents)
│   ├── WorkerAgent
│   │   └── CodeGenHelper ✅ Can spawn!
│   └── QCAgent
```

✅ **Unlimited Concurrency**
- Spawn as many agents as resources allow
- Custom queuing/priority logic

✅ **Real-Time Monitoring**
- Stdout/stderr capture
- Progress reporting
- Can abort mid-execution

✅ **Bidirectional Communication**
- Agents communicate via MessageBus
- Can query shared state (Redis)
- Inter-agent coordination

---

### 5. Use Case Fit

**When Option A (Subagents) is Better:**

✅ **Best for:**
- Claude Code power users
- Internal tools (not for distribution)
- Declarative, YAML-first workflows
- Simple, flat agent hierarchies
- Natural language-first teams

❌ **Not Good for:**
- Multi-tool support
- Open-source distribution
- Complex agent coordination
- CI/CD automation
- High concurrency needs

---

**When Option C (MCP Bridge) is Better:**

✅ **Best for:**
- Open-source projects
- Multi-tool ecosystems
- Standalone CLI usage
- CI/CD integration
- Complex orchestration
- Code-first teams
- High concurrency

❌ **Not Good for:**
- Claude Code-only use cases (simpler to use subagents)
- Non-technical users defining agents (YAML easier than code)

---

### 6. Long-Term Strategic Fit

**Option A: Claude Ecosystem Bet**

**Assumption:** Claude Code becomes dominant AI coding platform

**If True:**
- ✅ Best possible UX
- ✅ Native features, first-class support
- ✅ Simpler architecture

**If False:**
- ❌ Locked into declining platform
- ❌ Must rewrite for migration
- ❌ Limited growth potential

**Risk Level:** Medium-High

---

**Option C: Multi-Tool Strategy**

**Assumption:** AI coding tool landscape remains diverse

**If True:**
- ✅ Support Claude, Cursor, Windsurf, VS Code
- ✅ Portable to new tools as they emerge
- ✅ Standalone CLI always works

**If False (Claude dominates):**
- ⚠️ More complex than needed
- ⚠️ Maintaining unused portability

**Risk Level:** Low

---

## Decision Framework

### If Your Priority Is...

**🎯 Best Claude Code Experience**
→ **Option A** (Subagents)

**🌍 Tool-Agnosticism**
→ **Option C** (MCP Bridge)

**⚡ Fastest Implementation**
→ **Option C** (6-9 days vs 15-22)

**🏗️ Architectural Flexibility**
→ **Option C** (nesting, concurrency)

**📝 Declarative/YAML-First**
→ **Option A** (Subagents)

**💻 Code-First Architecture**
→ **Option C** (MCP Bridge)

**🔓 Future Portability**
→ **Option C** (MCP standard)

**🔒 Deep Claude Integration**
→ **Option A** (Subagents)

---

## Hybrid Approach

### Can We Have Both?

**Yes!** Implement dual modes:

```javascript
const mode = detectExecutionMode();

switch (mode) {
  case 'claude-subagents':
    // Use Task tool, YAML agents
    break;
  case 'mcp-server':
    // Run as MCP server
    break;
  case 'standalone-cli':
    // Child process spawning
    break;
}
```

**Effort:** +30-40% development time

**Benefits:**
- Best Claude UX when available
- Portable fallback for other environments
- Maximum flexibility

**Drawbacks:**
- More code to maintain
- Larger testing surface
- Complexity in mode switching

---

## Recommendation

### Strategic Recommendation: **Option C (MCP Bridge)**

**Rationale:**

1. **Aligns with Lemegeton's design goals** - Tool-agnosticism is core
2. **Lower risk** - Don't lock into single vendor
3. **Faster to implement** - 6-9 days vs 15-22 days
4. **More flexible** - Hierarchical, unlimited concurrency
5. **Future-proof** - MCP becoming industry standard
6. **Comparable UX** - Good experience across all MCP tools

**Option A is excellent** for Claude Code-specific projects, but Lemegeton's vision is broader.

### Tactical Recommendation: Validate with Option B First

**Current state:** Option B (OAuth token passing) implemented ✅

**Next steps:**
1. **Test Option B** - Validate coordination core works
2. **If successful** - Implement Option C (MCP Bridge)
3. **Optional** - Add Option A (Subagents) later if desired

**This de-risks the decision** by proving the architecture before committing.

---

## Key Questions to Answer

Before deciding, answer these:

1. **Is Lemegeton Claude Code-only?**
   - Yes → Option A is simpler
   - No → Option C preserves portability

2. **Do you need CI/CD support?**
   - Yes → Option C (standalone CLI)
   - No → Either works

3. **Will users run on multiple tools?**
   - Yes → Option C (MCP works everywhere)
   - No → Option A (best Claude UX)

4. **Is architectural flexibility important?**
   - Yes → Option C (nesting, concurrency)
   - No → Option A (flat is simpler)

5. **Do you want to distribute as open-source?**
   - Yes → Option C (portable)
   - No → Either works

6. **Is code-first or declarative-first better for your team?**
   - Code → Option C
   - Declarative → Option A

---

## Summary Table

| Decision Factor | Choose Option A If... | Choose Option C If... |
|----------------|----------------------|----------------------|
| **Platform** | Claude Code only | Multiple tools |
| **Distribution** | Internal/private | Open-source |
| **Timeline** | 3-4 weeks acceptable | Need faster (6-9 days) |
| **Architecture** | Flat is sufficient | Need flexibility |
| **Team** | Natural language first | Code first |
| **Lock-in** | Acceptable risk | Must avoid |
| **Future** | Betting on Claude | Hedging bets |

---

## Files Created

```
docs/design/
├── option-a-claude-subagents.md  # Full Option A design (1020 lines)
├── option-c-mcp-bridge.md        # Full Option C design (682 lines)
├── OPTION_C_SUMMARY.md           # Quick Option C reference
└── OPTIONS_COMPARISON.md         # This file
```

---

**Next Step:** Review both full design docs, then decide based on your priorities.

**Recommendation:** Start with **Option C** for tool-agnosticism and speed. Can always add Option A (subagent mode) later if you go all-in on Claude Code.
