# PR-009: Task List Parser Implementation Plan

## Overview
Implement robust YAML frontmatter parser for `task-list.md` that extracts PR metadata, validates structure, and enables safe updates while preserving markdown content.

## Dependencies
- **PR-007**: Hub Daemon Process ✅ (completed)

## Goals
1. Parse YAML frontmatter from task-list.md accurately
2. Validate required fields and data types
3. Handle malformed YAML gracefully with helpful errors
4. Preserve markdown content when updating frontmatter
5. Support efficient parsing of large task lists (100+ PRs)

## Architecture

### Components

#### 1. TaskListParser (`src/parser/taskList.ts`)
Main parser class responsible for:
- Reading and splitting frontmatter from markdown content
- Delegating to YAML parser
- Reconstructing full document on updates
- Handling file I/O efficiently

**Key Methods:**
```typescript
class TaskListParser {
  async parse(filePath: string): Promise<ParsedTaskList>
  async update(filePath: string, prId: string, updates: Partial<PRData>): Promise<void>
  async addPR(filePath: string, pr: PRData): Promise<void>
  validate(data: any): ValidationResult
}
```

#### 2. YAML Frontmatter Extractor (`src/parser/frontmatter.ts`)
Handles the extraction and reconstruction of YAML frontmatter:
- Identify frontmatter boundaries (`---`)
- Extract YAML blocks for each PR
- Parse using `js-yaml` library
- Reconstruct frontmatter with proper formatting

**Key Methods:**
```typescript
function extractFrontmatter(content: string): PRBlock[]
function parsePRBlock(block: string): PRData
function serializePRBlock(data: PRData): string
function reconstructDocument(blocks: PRBlock[], markdown: string): string
```

#### 3. Validation System (`src/parser/validation.ts`)
Comprehensive validation of parsed data:
- Required fields check
- Type validation (strings, numbers, arrays, enums)
- Dependency validation (referenced PRs exist)
- Complexity score range (1-10)
- File path format validation

**Validation Rules:**
```typescript
interface ValidationRules {
  required: ['pr_id', 'title', 'cold_state', 'priority', 'complexity', 'dependencies']
  types: {
    pr_id: 'string',
    title: 'string',
    cold_state: ColdState,
    priority: Priority,
    complexity: ComplexityScore,
    dependencies: 'string[]',
    estimated_files: FileEstimate[],
    actual_files: FileActual[]
  }
  ranges: {
    complexity.score: [1, 10],
    complexity.estimated_minutes: [1, 600]
  }
}
```

#### 4. Error Handling (`src/parser/errors.ts`)
Custom error types with context:
- `ParseError`: YAML parsing failures
- `ValidationError`: Schema validation failures
- `StructureError`: Document structure issues
- `FileError`: File I/O problems

**Error Context:**
```typescript
class ParseError extends Error {
  constructor(
    message: string,
    public prId?: string,
    public line?: number,
    public column?: number,
    public snippet?: string
  )
}
```

### Data Model

```typescript
interface ParsedTaskList {
  metadata: TaskListMetadata;
  prs: PRData[];
  raw: string; // Original markdown for preservation
}

interface TaskListMetadata {
  generated_for: string;
  estimated_total_complexity: number;
  recommended_agents: {
    haiku: number;
    sonnet: number;
    opus: number;
  };
}

interface PRData {
  pr_id: string;
  title: string;
  cold_state: ColdState;
  priority: Priority;
  complexity: {
    score: number;
    estimated_minutes: number;
    suggested_model: 'haiku' | 'sonnet' | 'opus';
    rationale: string;
  };
  dependencies: string[];
  estimated_files?: FileEstimate[];
  actual_files?: FileActual[];
  description?: string;
  acceptance_criteria?: string[];
  notes?: string;
}

interface FileEstimate {
  path: string;
  action: 'create' | 'modify' | 'delete';
  description: string;
}

interface FileActual {
  path: string;
  action: 'create' | 'modify' | 'delete';
  lines_added?: number;
  lines_removed?: number;
}
```

## Implementation Strategy

### Phase 1: Basic Parsing (Core Functionality)
1. Set up file reading with proper encoding (UTF-8)
2. Implement frontmatter boundary detection
3. Integrate `js-yaml` for YAML parsing
4. Extract PR blocks into structured data
5. Handle multiple PR blocks in single file

### Phase 2: Validation (Data Integrity)
1. Define validation schema matching types from PR-002
2. Implement required field validation
3. Add type checking for all fields
4. Validate dependency references
5. Check complexity score ranges
6. Validate file path formats

### Phase 3: Error Handling (Robustness)
1. Create custom error types
2. Add line/column tracking for YAML errors
3. Generate helpful error messages with context
4. Include code snippets in errors when possible
5. Implement graceful degradation (partial parsing)

### Phase 4: Updates and Persistence (Write Operations)
1. Implement frontmatter-only updates
2. Preserve markdown content exactly
3. Maintain formatting and comments
4. Add atomic file writes (temp file + rename)
5. Support adding new PR blocks

### Phase 5: Performance Optimization
1. Lazy parsing for large files
2. Caching of parsed results
3. Incremental updates (single PR changes)
4. Stream reading for very large files
5. Benchmark with 100+ PR task lists

## Testing Strategy

### Unit Tests (`tests/parser.test.ts`)

**Parsing Tests:**
- Parse valid task list with multiple PRs
- Extract metadata correctly
- Handle missing optional fields
- Parse nested structures (complexity, files)
- Preserve markdown content

**Validation Tests:**
- Reject missing required fields
- Catch type mismatches
- Validate dependency references
- Check complexity ranges
- Validate file path formats

**Error Handling Tests:**
- Handle malformed YAML gracefully
- Report line numbers accurately
- Provide helpful error messages
- Handle missing frontmatter delimiters
- Handle truncated files

**Update Tests:**
- Update single PR without affecting others
- Preserve markdown content
- Maintain formatting
- Handle concurrent updates safely
- Add new PRs correctly

**Performance Tests:**
- Parse 100+ PR task list < 500ms
- Update single PR < 50ms
- Memory usage reasonable for large files

### Integration Tests
- End-to-end: read → validate → update → verify
- Test with actual task-list.md from repository
- Verify compatibility with Hub's expectations

## Error Scenarios

### 1. Malformed YAML
```yaml
---
pr_id: PR-001
title: Missing closing quote
description: "This is broken
---
```
**Handling:** Catch YAML parse error, report line/column, show snippet

### 2. Missing Required Fields
```yaml
---
pr_id: PR-001
# Missing title, cold_state, etc.
---
```
**Handling:** ValidationError with list of missing fields

### 3. Invalid Dependencies
```yaml
---
pr_id: PR-005
dependencies: [PR-999]  # PR-999 doesn't exist
---
```
**Handling:** ValidationError with reference to non-existent PR

### 4. Structural Issues
```
No frontmatter delimiters found
```
**Handling:** StructureError explaining expected format

## Dependencies

```json
{
  "dependencies": {
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.5"
  }
}
```

## File Structure

```
src/parser/
├── index.ts            # Exports
├── taskList.ts         # Main TaskListParser class
├── frontmatter.ts      # YAML frontmatter extraction
├── validation.ts       # Schema validation
└── errors.ts           # Custom error types

tests/
├── parser.test.ts      # Comprehensive test suite
└── fixtures/
    ├── valid-task-list.md
    ├── invalid-yaml.md
    ├── missing-fields.md
    └── large-task-list.md (100+ PRs)
```

## Success Criteria

- ✅ Parses task-list.md with 50+ PRs correctly
- ✅ All required fields validated
- ✅ Malformed YAML handled gracefully with clear errors
- ✅ Markdown content preserved on updates
- ✅ Updates only touch affected PR frontmatter
- ✅ Performance: Parse 100 PRs in <500ms
- ✅ Test coverage >95%
- ✅ Zero data loss on updates
- ✅ Works with actual repository task-list.md

## Risk Mitigation

### Risk: Data Loss on Updates
**Mitigation:**
- Atomic writes (temp file + rename)
- Backup original before updates
- Extensive update tests

### Risk: YAML Parsing Edge Cases
**Mitigation:**
- Use well-tested `js-yaml` library
- Comprehensive error handling
- Extensive test fixtures

### Risk: Performance with Large Files
**Mitigation:**
- Benchmark early with large task lists
- Implement lazy parsing if needed
- Stream reading for very large files

### Risk: Encoding Issues
**Mitigation:**
- Always use UTF-8 encoding
- Test with non-ASCII characters
- Validate encoding on read

## Future Enhancements (Post-PR)
- Support for multiple task list files
- Watch mode for hot reloading
- Schema evolution (version migrations)
- YAML comment preservation
- Diff generation for changes
