/**
 * Planning Agent Tests
 *
 * Comprehensive tests for the planning agent workflow including
 * spec parsing, tech stack clarification, PRD generation, and task list creation.
 */

import { PlanningAgent } from '../src/agents/planning/PlanningAgent';
import { PromptRunner } from '../src/agents/planning/PromptRunner';
import { MCPQueryEngine } from '../src/agents/planning/MCPQueryEngine';
import { InteractiveUI } from '../src/agents/planning/InteractiveUI';
import { DocumentGenerator } from '../src/agents/planning/DocumentGenerator';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('PromptRunner', () => {
  let runner: PromptRunner;

  beforeEach(() => {
    runner = new PromptRunner();
  });

  describe('parseSpec', () => {
    it('should extract title from h1 heading', () => {
      const content = '# My Project\n\nDescription here';
      const spec = runner.parseSpec(content);

      expect(spec.title).toBe('My Project');
    });

    it('should use default title if no h1', () => {
      const content = 'Just some text';
      const spec = runner.parseSpec(content);

      expect(spec.title).toBe('Untitled Project');
    });

    it('should extract description from intro text', () => {
      const content = '# Title\n\nThis is the description.\n\n## Section\nMore text';
      const spec = runner.parseSpec(content);

      expect(spec.description).toContain('This is the description');
    });

    it('should extract requirements from bullet lists', () => {
      const content = `# Title

## Requirements
- Feature 1
- Feature 2
- Feature 3`;

      const spec = runner.parseSpec(content);

      expect(spec.requirements).toHaveLength(3);
      expect(spec.requirements).toContain('Feature 1');
    });

    it('should extract tech stack from dedicated section', () => {
      const content = `# Title

## Tech Stack
Language: Node.js
Framework: React
Database: PostgreSQL`;

      const spec = runner.parseSpec(content);

      expect(spec.techStack.language).toBe('Node.js');
      expect(spec.techStack.webFramework).toBe('React');
      expect(spec.techStack.database).toBe('PostgreSQL');
    });

    it('should detect tech stack from content', () => {
      const content = `# Title

We'll build this with React and Node.js, using PostgreSQL for data storage.`;

      const spec = runner.parseSpec(content);

      expect(spec.techStack.language).toBe('Node.js');
      expect(spec.techStack.webFramework).toBe('React');
      expect(spec.techStack.database).toBe('PostgreSQL');
    });
  });
});

describe('MCPQueryEngine', () => {
  let engine: MCPQueryEngine;

  beforeEach(() => {
    engine = new MCPQueryEngine(null); // No MCP client for unit tests
  });

  describe('getTechStackSuggestions', () => {
    it('should return empty map when MCP not available', async () => {
      const spec = {
        title: 'Test',
        description: 'Test',
        requirements: [],
        techStack: {},
      };

      const suggestions = await engine.getTechStackSuggestions(spec, ['Language/Runtime']);

      expect(suggestions.size).toBe(0);
    });
  });

  // Note: Full MCP integration tests would require actual MCP servers
  // These would be in integration tests, not unit tests
});

describe('InteractiveUI', () => {
  let ui: InteractiveUI;

  beforeEach(() => {
    ui = new InteractiveUI();
  });

  afterEach(() => {
    ui.close();
  });

  describe('identifyMissingTechStack', () => {
    it('should identify all missing fields', () => {
      const spec = {
        title: 'Test',
        description: 'Test',
        requirements: [],
        techStack: {},
      };

      const missing = ui.identifyMissingTechStack(spec);

      expect(missing).toContain('Language/Runtime');
      expect(missing).toContain('Web Framework');
      expect(missing).toContain('Database');
    });

    it('should not report present fields as missing', () => {
      const spec = {
        title: 'Test',
        description: 'Test',
        requirements: [],
        techStack: {
          language: 'Node.js',
          database: 'PostgreSQL',
        },
      };

      const missing = ui.identifyMissingTechStack(spec);

      expect(missing).not.toContain('Language/Runtime');
      expect(missing).not.toContain('Database');
    });
  });
});

describe('DocumentGenerator', () => {
  let generator: DocumentGenerator;

  beforeEach(() => {
    generator = new DocumentGenerator();
  });

  describe('generatePRD', () => {
    it('should generate PRD with all sections', () => {
      const spec = {
        title: 'Test Project',
        description: 'A test project',
        requirements: ['Feature 1', 'Feature 2'],
        techStack: {
          language: 'Node.js',
        },
      };

      const techStack = {
        language: 'Node.js',
        webFramework: 'React',
        database: 'PostgreSQL',
      };

      const prd = generator.generatePRD(spec, techStack, {});

      expect(prd.title).toBe('Test Project');
      expect(prd.sections).toHaveLength(6); // All sections
      expect(prd.sections.find(s => s.title === 'Product Overview')).toBeDefined();
      expect(prd.sections.find(s => s.title === 'Technical Requirements')).toBeDefined();
    });
  });

  describe('generateTaskList', () => {
    it('should generate task list with metadata', () => {
      const prd = {
        title: 'Test Project',
        sections: [],
      };

      const techStack = {
        language: 'Node.js',
      };

      const taskList = generator.generateTaskList(prd, techStack, {});

      expect(taskList).toContain('# Task List for Test Project');
      expect(taskList).toContain('## Orchestration Metadata');
    });

    it('should include Lemegeton setup PR by default', () => {
      const prd = {
        title: 'Test',
        sections: [],
      };

      const techStack = { language: 'Node.js' };
      const taskList = generator.generateTaskList(prd, techStack, {});

      expect(taskList).toContain('PR-000');
      expect(taskList).toContain('Install and Configure Lemegeton');
    });

    it('should skip Lemegeton setup when requested', () => {
      const prd = {
        title: 'Test',
        sections: [],
      };

      const techStack = { language: 'Node.js' };
      const taskList = generator.generateTaskList(prd, techStack, {
        skipLemegetonSetup: true,
      });

      expect(taskList).not.toContain('PR-000');
    });
  });

  describe('writeDocuments', () => {
    it('should write PRD and task list to disk', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemegeton-test-'));

      try {
        const prd = {
          title: 'Test Project',
          sections: [
            { title: 'Overview', content: 'Test content' },
          ],
        };

        const taskList = '# Task List\n\nTest content';

        await generator.writeDocuments(prd, taskList, tmpDir);

        const prdContent = await fs.readFile(path.join(tmpDir, 'prd.md'), 'utf-8');
        const taskListContent = await fs.readFile(path.join(tmpDir, 'task-list.md'), 'utf-8');

        expect(prdContent).toContain('# Test Project');
        expect(taskListContent).toContain('# Task List');
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('generateCommitMessage', () => {
    it('should generate proper commit message', () => {
      const prd = {
        title: 'Test Project',
        sections: [],
      };

      const taskList = `
pr_id: PR-000
pr_id: PR-001
pr_id: PR-002
`;

      const message = generator.generateCommitMessage(prd, taskList);

      expect(message).toContain('[Planning]');
      expect(message).toContain('Test Project');
      expect(message).toContain('3 PRs');
    });
  });
});

describe('PlanningAgent Integration', () => {
  let agent: PlanningAgent;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemegeton-test-'));

    agent = new PlanningAgent('test-planning-001', {
      agentType: 'planning',
      interactive: false,
      enableMCP: false,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should execute full planning workflow', async () => {
    // Create test spec file
    const specPath = path.join(tmpDir, 'spec.md');
    const specContent = `# Test Project

A simple test project to verify planning agent.

## Requirements
- Feature 1
- Feature 2

## Tech Stack
Language: Node.js
Framework: React
Database: PostgreSQL
`;

    await fs.writeFile(specPath, specContent, 'utf-8');

    // Run planning with auto-approve
    const result = await agent.plan(specPath, {
      outputPath: tmpDir,
      interactive: false,
      autoApprove: true,
      skipLemegetonSetup: false,
    });

    expect(result.approved).toBe(true);
    expect(result.documentsWritten).toBe(true);
    expect(result.prd.title).toBe('Test Project');
    expect(result.prs.length).toBeGreaterThan(0);

    // Verify files were written
    const prdPath = path.join(tmpDir, 'prd.md');
    const taskListPath = path.join(tmpDir, 'task-list.md');

    expect(await fs.stat(prdPath)).toBeDefined();
    expect(await fs.stat(taskListPath)).toBeDefined();
  });

  it('should handle missing spec file gracefully', async () => {
    await expect(
      agent.plan('/nonexistent/spec.md', {})
    ).rejects.toThrow();
  });
});
