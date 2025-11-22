# Adversarial Testing: Prompt Separation Summary

**Date:** 2025-11-22
**Purpose:** Enforce separation between implementation and testing to prevent "tests written to pass" failure mode

---

## Overview

Implemented prompt-level enforcement of adversarial testing model where:
- **Implementation agents** focus on building features to spec
- **Test agents** focus on breaking code and finding edge cases
- Agents work on **separate PRs** and cannot modify each other's work
- Creates healthy tension that produces robust code

---

## Changes Made

### 1. **agent-defaults.yml** - Core Separation Rules

**Location:** `prompts/agent-defaults.yml` (new section: `implementationVsTesting`)

**Added:**

#### Implementation Agent Rules (FORBIDDEN)
- ❌ Write, modify, or create ANY test files (`*.test.ts`, `*.spec.ts`, `tests/*`)
- ❌ Add test cases to existing test suites
- ❌ Fix failing tests by modifying test code
- ❌ Include test coverage in implementation work
- ❌ Think about "making tests pass" during implementation

#### Implementation Agent Rules (REQUIRED)
- ✅ Implement exactly to specification
- ✅ Write clean, well-structured production code
- ✅ Handle edge cases in implementation logic
- ✅ Add appropriate error handling
- ✅ For BROKEN PRs: Fix implementation to match test expectations

#### Test Agent Rules (FORBIDDEN)
- ❌ Modify implementation code to make tests pass
- ❌ Skip edge cases because they're "hard to test"
- ❌ Write tests that just verify current behavior
- ❌ Make tests pass by lowering coverage requirements
- ❌ Avoid testing error paths

#### Test Agent Rules (REQUIRED)
- ✅ Study implementation critically - assume it has bugs
- ✅ Test edge cases implementation might have missed:
  - Boundary values (0, -1, MAX_INT, empty, null, undefined)
  - Invalid inputs (wrong types, malformed data)
  - Race conditions and timing issues
  - Resource exhaustion
  - Error scenarios (network failures, permissions, etc.)
- ✅ Write tests that SHOULD pass if implementation is correct
- ✅ Don't care if tests fail initially - that's the point
- ✅ Focus on whether test makes sense, not whether it passes
- ✅ Achieve >90% coverage for critical paths

#### PR Type Identification
Clear indicators for agents to know which rules apply:

**Implementation PR:**
- Title: "Implementation", "Feature", "Add", "Create", "Refactor"
- Files: `src/*`, `lib/*`, `components/*`, `services/*`
- Description focuses on functionality
- NOT in tests/ directory

**Test PR:**
- Title: "Tests", "Test Coverage", "Unit Tests", "Integration Tests"
- Files: `tests/*`, `__tests__/*`, `*.test.ts`, `*.spec.ts`
- Description mentions coverage, test cases, edge cases
- Dependencies include implementation PR being tested

---

### 2. **test-agent.yml** - New Adversarial Testing Prompt

**Location:** `prompts/test-agent.yml` (NEW FILE)

**Purpose:** Dedicated prompt for agents working on test PRs with adversarial mindset

**Key Sections:**

#### Philosophy
```
You are NOT writing tests to pass. You are writing tests to BREAK CODE.

Your role is adversarial - assume the implementation has bugs and your job is to find them.

Success Metrics:
- Finding bugs in implementation (tests fail initially) = GOOD
- All tests pass immediately = SUSPICIOUS (tests too weak?)
- High edge case coverage = EXCELLENT
- Tests find issues implementation author missed = IDEAL
```

#### Core Responsibilities
1. **Study implementation critically** - not reverently
2. **Review spec** - what's required vs what's implemented
3. **Write comprehensive tests** - happy path + ALL edge cases
4. **Achieve meaningful coverage** - >90% for critical paths

#### Adversarial Thinking Checklist
Organized categories for edge case testing:
- **Boundary values:** zero, negative, MAX_INT, empty, null, undefined
- **Invalid inputs:** wrong types, malformed data, special characters
- **Error scenarios:** network failures, file system errors, database errors
- **Concurrency:** race conditions, deadlocks, state changes mid-operation
- **Resource limits:** large inputs, memory pressure, deep recursion

#### Test Failure Response
Clear guidance on what to do when tests fail:
1. **Implementation bug?** → Document and mark PR broken (GOOD!)
2. **Test config issue?** → Fix your mocks/imports/setup
3. **Spec ambiguity?** → Escalate for clarification

#### Best Practices
- Test structure (Arrange-Act-Assert)
- Naming conventions (specific, clear descriptions)
- Assertion quality (precise, not vague)
- Mocking strategy (external deps only, not your own code)
- Coverage guidelines (meaningful paths, not just lines)

#### Bug Reporting
Template for documenting bugs found:
```markdown
## Bug Found: Null pointer in UserService.create

**Test:** `UserService.create should handle null email`
**Expected:** Should throw ValidationError
**Actual:** Throws TypeError: Cannot read property 'toLowerCase' of null

**Reproduction:** [minimal test case]
**Root Cause:** [analysis]
**Fix Required:** [what implementation needs to do]
```

---

### 3. **planning-agent.yml** - Reinforced Separation

**Location:** `prompts/planning-agent.yml` (updated `specialPRTypes.testPR`)

**Added Philosophy Section:**
```yaml
testPR:
  philosophy: |
    CRITICAL: Lemegeton uses an adversarial testing model.

    - Implementation PRs and Test PRs are ALWAYS SEPARATE
    - Different agents work on implementation vs tests
    - Test agents actively try to break code (see test-agent.yml)
    - This prevents "writing tests to pass" failure mode

    When creating test PRs:
    - Make them depend on the implementation PR they test
    - Focus test description on adversarial goals (find bugs, test edge cases)
    - Include acceptance criteria about coverage AND thoroughness
    - Expect tests to find bugs - that's the point!
```

This ensures Planning Agent creates task lists with proper separation.

---

## How This Works in Practice

### Scenario 1: Implementation PR (PR-015)

**Agent:** Worker agent assigned to implement authentication feature

**Reads:** `agent-defaults.yml` → sees `implementationAgentRules`

**Behavior:**
- Implements authentication logic in `src/auth/AuthService.ts`
- Handles edge cases in implementation (null checks, validation)
- DOES NOT create `tests/auth/AuthService.test.ts`
- DOES NOT think about "making tests pass"
- Focuses purely on meeting specification
- Commits implementation code only

**Result:** Clean implementation without test bias

---

### Scenario 2: Test PR (PR-016)

**Agent:** Different agent assigned to test authentication

**Reads:** `test-agent.yml` → adversarial mindset activated

**Behavior:**
- Studies `src/auth/AuthService.ts` critically
- Identifies assumptions (what if email is null? what if password is empty?)
- Creates `tests/auth/AuthService.test.ts` with comprehensive tests:
  ```typescript
  describe('AuthService', () => {
    it('should throw ValidationError when email is null', () => {
      expect(() => authService.login(null, 'password'))
        .toThrow(ValidationError);
    });

    it('should handle SQL injection attempt in username', () => {
      const malicious = "admin'; DROP TABLE users; --";
      expect(() => authService.login(malicious, 'pass'))
        .toThrow(ValidationError);
    });

    it('should rate limit after 5 failed attempts', async () => {
      // ... comprehensive edge case test
    });
  });
  ```
- Tests FAIL initially → discovers implementation missed SQL injection check
- Documents bug clearly
- Marks PR-015 as `broken`
- DOES NOT modify `src/auth/AuthService.ts` to "fix it quickly"

**Result:** Bugs found, documented, sent back to implementation agent

---

### Scenario 3: Fixing Broken Implementation (PR-015 reopened)

**Agent:** Worker agent (could be same or different) assigned broken PR

**Reads:** `agent-defaults.yml` → sees "For BROKEN state PRs" rules

**Behavior:**
- Reads test failure output from PR-016
- Sees: "should handle SQL injection attempt in username - FAIL"
- Examines implementation in `src/auth/AuthService.ts`
- Adds SQL injection validation to implementation
- Runs tests locally → confirms they pass now
- Commits fix
- Marks PR-015 as `completed` again

**Result:** Implementation improved, tests pass, code is robust

---

## Benefits of This Approach

### 1. **Prevents Confirmation Bias**
- Implementation author thinks: "How do I make this work?"
- Test author thinks: "How do I make this break?"
- No ego investment in tests passing immediately

### 2. **Finds More Bugs**
- Test author actively tries to break code
- No pressure to write "nice" tests
- Edge cases get thorough coverage

### 3. **Better Code Quality**
- Implementation must handle real edge cases
- Can't cheat by writing weak tests
- Adversarial tension creates robust code

### 4. **Clear Responsibilities**
- Implementation agents own production code
- Test agents own test code
- No confusion about who does what

### 5. **Realistic Testing**
- Tests reflect real-world usage (including misuse)
- Error handling gets proper testing
- Security edge cases get attention

---

## Potential Concerns & Responses

### "Won't this slow development?"

**Initial cycles:** Slightly slower (bugs found, sent back)
**Overall:** Faster - fewer bugs in production, less debugging later
**ROI:** Bug found in test phase costs minutes, bug in production costs hours/days

### "What if test agent is too aggressive?"

Good! That's the point. Implementation should be robust enough to handle:
- Invalid inputs
- Edge cases
- Error scenarios

If tests seem "unfair," it means implementation is fragile.

### "What if tests are wrong?"

Test agent has guidance for this:
- Bad test config (imports, mocks) → fix the test
- Testing wrong behavior → escalate for spec clarification
- Implementation is actually correct → rare, but can happen

Clear process for handling each case.

### "How do we know agents will follow this?"

Three layers of enforcement:
1. **Prompt-level:** Clear FORBIDDEN/REQUIRED rules
2. **PR structure:** Planning agent creates separate PRs
3. **Review:** User can verify commits don't cross boundaries

---

## Files Modified/Created

### Modified
1. `prompts/agent-defaults.yml`
   - Added `implementationVsTesting` section (~90 lines)
   - Clear separation rules for both agent types

2. `prompts/planning-agent.yml`
   - Added `philosophy` to `testPR` section
   - Reinforces adversarial model

### Created
3. `prompts/test-agent.yml` (NEW)
   - Comprehensive adversarial testing guide (~650 lines)
   - Edge case checklists
   - Bug reporting templates
   - Best practices and examples

---

## Next Steps

### For User Review
1. Review the three prompt files
2. Verify the philosophy aligns with your vision
3. Suggest any modifications or additions
4. Approve or request changes

### After Approval
Consider architectural changes:
1. Implement event hooks for QC agent auto-spawning
2. Add validation in Hub to enforce separation (reject commits that cross boundary)
3. Create QC agent implementation (PR-023)
4. Test the adversarial workflow end-to-end

---

## Example Task List Structure

Planning Agent would create:

```markdown
### PR-015: Authentication Service Implementation
dependencies: [PR-014]
estimated_files:
  - src/auth/AuthService.ts
  - src/auth/validators.ts

### PR-016: Authentication Service Tests
dependencies: [PR-015]  # ← Depends on implementation
estimated_files:
  - tests/auth/AuthService.test.ts
  - tests/auth/validators.test.ts
  - tests/fixtures/auth.ts
```

Different agents claim these PRs → adversarial testing achieved.

---

## Conclusion

These prompt changes enforce your adversarial testing vision at the agent level. Implementation agents are forbidden from writing tests, test agents are encouraged to break code, and the separation creates healthy tension that produces robust, well-tested software.

The prompts are detailed enough to guide agent behavior while maintaining flexibility for different scenarios (broken PRs, test config issues, spec ambiguity).

**Ready for your review and feedback!**
