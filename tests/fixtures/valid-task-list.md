# Test Task List

## Orchestration Metadata
**Generated for:** Test Project v1.0
**Estimated Total Complexity:** 15
**Recommended Agent Configuration:**
- Haiku agents: 1 (for complexity 1-3)
- Sonnet agents: 1 (for complexity 4-7)
- Opus agents: 1 (for complexity 8-10)

## Test PRs

### PR-001: First Test PR

---
pr_id: PR-001
title: First Test PR
cold_state: new
priority: high
complexity:
  score: 3
  estimated_minutes: 30
  suggested_model: haiku
  rationale: Simple test PR
dependencies: []
estimated_files:
  - path: src/test1.ts
    action: create
    description: Test file 1
---

**Description:**
This is the first test PR.

**Acceptance Criteria:**
- Test passes
- Code compiles

### PR-002: Second Test PR

---
pr_id: PR-002
title: Second Test PR
cold_state: planned
priority: medium
complexity:
  score: 5
  estimated_minutes: 50
  suggested_model: sonnet
  rationale: Medium complexity
dependencies: [PR-001]
estimated_files:
  - path: src/test2.ts
    action: create
    description: Test file 2
---

**Description:**
This is the second test PR that depends on PR-001.

**Notes:**
Should wait for PR-001 to complete.
