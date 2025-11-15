# PR-020: Planning Agent - Implementation Summary

**Date:** 2025-11-15
**Status:** Ready to Implement

---

## What We Already Have ✅

### 1. **Complete Planning Prompt** (`prompts/planning-agent.yml`)
- Comprehensive prompt that was used to generate this very project!
- Tech stack clarification process
- PRD generation guidelines
- Task list structure with YAML frontmatter
- PR template with complexity scoring
- Special PR types (test, cross-cutting, architecture docs)
- Quality checklist
- Post-generation workflow

### 2. **CLI Stub** (`src/cli/commands/plan.ts`)
- Command structure ready: `npx lemegeton plan <spec-file>`
- Options defined: `--output`, `--interactive`, `--mcp`
- Just needs implementation wired up

### 3. **Dependencies Complete**
- ✅ PR-011: BaseAgent class (to extend)
- ✅ PR-009: TaskListParser (to parse/validate output)
- ✅ PR-018: ComplexityScorer (to score PRs)
- ✅ PR-022: MCP client (for tech stack queries)

### 4. **Integration Points Ready**
- Hub can spawn planning agent (PR-012)
- Message bus for communication (PR-013)
- State machine for workflow tracking (PR-003)
- Git operations for committing (PR-010)

---

## What We Need to Build 🔨

### Phase 1: Core Planning Agent Class (20 minutes)

**Create:** `src/agents/planning/PlanningAgent.ts`

```typescript
class PlanningAgent extends BaseAgent {
  async plan(specPath: string, options: PlanningOptions): Promise<PlanningResult> {
    // 1. Read spec file
    // 2. Run LLM with planning-agent.yml prompt
    // 3. Parse PRD and task list from response
    // 4. Validate output format
    // 5. Return results for approval
  }
}
```

**Key Capabilities:**
- Load and apply `planning-agent.yml` prompt
- Call LLM (Anthropic/OpenAI/etc) with spec content
- Parse structured output (PRD markdown + task-list markdown)
- Validate YAML frontmatter in task list
- Handle errors and retries

### Phase 2: Interactive Clarification (15 minutes)

**Create:** `src/agents/planning/interactive.ts`

```typescript
class InteractiveUI {
  async askTechStackQuestions(missing: string[], suggestions: any): Promise<Answers> {
    // Use inquirer or similar for CLI prompts
    // Present MCP-sourced suggestions
    // Collect user answers
  }
}
```

**Handles:**
- Identify missing tech stack details from spec
- Format questions for user (language, framework, database, etc.)
- Present MCP suggestions as options
- Collect and validate answers

### Phase 3: MCP Integration (15 minutes)

**Create:** `src/agents/planning/mcpQueries.ts`

```typescript
class MCPQueryEngine {
  async getTechStackSuggestions(spec: Spec, missing: string[]): Promise<Suggestions> {
    // Query MCP for framework options
    // Query MCP for database options
    // Get latest versions from npm/etc
    // Return structured suggestions
  }
}
```

**MCP Queries:**
- npm: Get popular frameworks for language
- GitHub: Find example projects with similar stack
- Documentation: Get setup guides for suggested tech

### Phase 4: Document Generation (10 minutes)

**Create:** `src/agents/planning/documentGenerator.ts`

```typescript
class DocumentGenerator {
  generatePRD(llmOutput: string): string {
    // Extract PRD section from LLM response
    // Validate markdown structure
    // Return formatted PRD
  }

  generateTaskList(llmOutput: string): string {
    // Extract task list section
    // Validate YAML frontmatter
    // Parse with TaskListParser (PR-009)
    // Return validated task list
  }
}
```

**Responsibilities:**
- Parse LLM output into separate documents
- Validate structure and formatting
- Use TaskListParser for validation
- Handle malformed outputs

### Phase 5: Complexity Scoring Integration (5 minutes)

**Update:** `src/agents/planning/PlanningAgent.ts`

```typescript
async scoreComplexity(prs: PR[]): Promise<PR[]> {
  const scorer = new ComplexityScorer(); // from PR-018

  return prs.map(pr => ({
    ...pr,
    complexity: scorer.score(pr)
  }));
}
```

**Integration:**
- Use ComplexityScorer (PR-018) to score each PR
- Add scores to YAML frontmatter
- Recalculate if user modifies task list

### Phase 6: Git Operations (10 minutes)

**Create:** `src/agents/planning/gitOps.ts`

```typescript
class PlanningGitOps {
  async commitDocuments(prd: string, taskList: string): Promise<void> {
    // Write docs/prd.md
    // Write docs/task-list.md
    // Git add both files
    // Git commit with standardized message
  }
}
```

**Handles:**
- Write documents to correct paths
- Create docs/ directory if needed
- Atomic commit of both files
- Standardized commit message (see planning prompt)

### Phase 7: CLI Integration (10 minutes)

**Update:** `src/cli/commands/plan.ts`

```typescript
async function handlePlan(specFile: string, options: any): Promise<void> {
  const agent = new PlanningAgent('plan-001', config);

  const result = await agent.plan(specFile, {
    interactive: options.interactive,
    enableMCP: options.mcp,
    outputPath: options.output
  });

  // Display PRD and task list
  // Ask for approval
  // Commit if approved
}
```

**Flow:**
1. Instantiate PlanningAgent
2. Run plan() workflow
3. Display results to user
4. Request approval
5. Commit if approved
6. Show success/error messages

### Phase 8: Testing (15 minutes)

**Create:** `tests/planningAgent.test.ts`

```typescript
describe('PlanningAgent', () => {
  it('reads spec file')
  it('identifies missing tech stack details')
  it('queries MCP for suggestions')
  it('generates valid PRD')
  it('generates valid task list with YAML frontmatter')
  it('scores complexity correctly')
  it('commits documents')
  it('handles approval flow')
});
```

**Coverage Goals:**
- Spec parsing
- Tech stack clarification
- MCP integration
- Document generation
- Complexity scoring
- Git operations
- Error handling

---

## Implementation Sequence

**Total Estimated Time: ~100 minutes (1.5 hours)**

1. ✅ Core PlanningAgent class (20 min)
2. ✅ Interactive clarification (15 min)
3. ✅ MCP integration (15 min)
4. ✅ Document generation (10 min)
5. ✅ Complexity scoring (5 min)
6. ✅ Git operations (10 min)
7. ✅ CLI integration (10 min)
8. ✅ Testing (15 min)

---

## What's NOT Needed

### Already Handled by Existing Prompt

The `planning-agent.yml` prompt already handles:
- ✅ PRD structure and sections
- ✅ Task list YAML frontmatter format
- ✅ PR template with all required fields
- ✅ Complexity scoring guidelines
- ✅ Dependency block organization
- ✅ Special PR types (test, cross-cutting, docs)
- ✅ Quality checklist
- ✅ Post-generation workflow
- ✅ Commit message format

**We just need to:**
1. Load the prompt
2. Send it to LLM with the spec
3. Parse the output
4. Validate it
5. Commit it

### Already Implemented in Other PRs

- ✅ Complexity scoring algorithm (PR-018)
- ✅ Task list parsing/validation (PR-009)
- ✅ MCP client and adapters (PR-022)
- ✅ BaseAgent lifecycle (PR-011)
- ✅ Git operations wrapper (PR-010)

---

## Key Design Decisions

### 1. Prompt Application Strategy

Use the existing `planning-agent.yml` as a system prompt:

```typescript
const promptContent = await loadPrompt('planning-agent');
const systemPrompt = convertYAMLToSystemPrompt(promptContent);

const response = await llm.chat({
  system: systemPrompt,
  messages: [
    { role: 'user', content: `Spec file content:\n\n${specContent}` }
  ]
});
```

### 2. MCP Query Timing

Query MCP **before** LLM call:
- Faster (parallel queries)
- Cheaper (fewer LLM tokens)
- More reliable (LLM gets verified info)

```typescript
// Get MCP suggestions first
const suggestions = await mcpEngine.getTechStackSuggestions(spec);

// Include in prompt
const userMessage = `
Spec: ${specContent}

Tech Stack Suggestions from MCP:
${JSON.stringify(suggestions, null, 2)}
`;
```

### 3. Output Parsing

Expect LLM to return both documents in one response:

```
## PRD (docs/prd.md)

[PRD content here]

---

## Task List (docs/task-list.md)

[Task list content here]
```

Parse by splitting on markers, validate each separately.

### 4. Approval Workflow

Simple CLI approval:

```bash
Planning complete! Generated:
  - docs/prd.md (1250 lines)
  - docs/task-list.md (45 PRs, 2800 lines)

Review documents above. Commit? [Y/n]
```

---

## Success Criteria

- [ ] `npx lemegeton plan spec.md` generates valid PRD
- [ ] `npx lemegeton plan spec.md` generates valid task list
- [ ] Task list has proper YAML frontmatter for all PRs
- [ ] Interactive mode asks clarifying questions
- [ ] MCP queries provide tech stack suggestions
- [ ] Complexity scores added to all PRs (via PR-018)
- [ ] Documents committed with proper message
- [ ] All tests passing
- [ ] Can dogfood: use planning agent to plan new features!

---

## Integration with Existing Code

### Files to Create
- `src/agents/planning/PlanningAgent.ts` (main class)
- `src/agents/planning/interactive.ts` (CLI questions)
- `src/agents/planning/mcpQueries.ts` (MCP integration)
- `src/agents/planning/documentGenerator.ts` (output parsing)
- `src/agents/planning/gitOps.ts` (commit handling)
- `src/agents/planning/types.ts` (TypeScript interfaces)
- `tests/planningAgent.test.ts` (comprehensive tests)

### Files to Modify
- `src/cli/commands/plan.ts` (wire up real implementation)
- `src/agents/planning.ts` (update entry point)

### Files to Use (No Changes)
- `prompts/planning-agent.yml` (existing prompt - use as-is)
- `src/cost/complexityScorer.ts` (PR-018 - just call it)
- `src/parsers/taskList.ts` (PR-009 - validate output)
- `src/mcp/client.ts` (PR-022 - query for suggestions)
- `src/agents/base.ts` (PR-011 - extend it)

---

## Next Steps

Ready to implement! The prompt is comprehensive, dependencies are complete, and the architecture is clear. This PR transforms the manual planning workflow into an automated agent that enables true dogfooding.
