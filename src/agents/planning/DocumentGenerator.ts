/**
 * Document Generator
 *
 * Generates PRD and task list documents from specs and tech stacks using LLM.
 *
 * Uses the planning-agent.yml prompt as a system prompt to generate:
 * - Comprehensive PRDs with all required sections
 * - Intelligent task list with PR breakdowns
 * - Complexity estimates and dependency analysis
 *
 * Falls back to template-based generation if LLM is unavailable.
 */

import { Spec, TechStack, PRD, PRDSection, PlanningOptions, EstimatedFile } from './types';
import { PRData, FileEstimate } from '../../parser/types';
import { ColdState } from '../../types/pr';
import { LLMClient } from '../../llm/types';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Generates PRD and task list markdown documents
 */
export class DocumentGenerator {
  private llmClient: LLMClient | null = null;
  private systemPrompt: string | null = null;

  /**
   * Set LLM client for intelligent generation
   */
  setLLMClient(client: LLMClient, systemPrompt: string): void {
    this.llmClient = client;
    this.systemPrompt = systemPrompt;
  }
  /**
   * Generate PRD document from spec and tech stack
   */
  async generatePRD(spec: Spec, techStack: TechStack, options: PlanningOptions): Promise<PRD> {
    // Try LLM-based generation first
    if (this.llmClient && this.systemPrompt) {
      try {
        return await this.generatePRDWithLLM(spec, techStack);
      } catch (error) {
        console.warn('LLM generation failed, falling back to templates:', (error as Error).message);
      }
    }

    // Fallback to template-based generation
    const sections: PRDSection[] = [
      this.generateProductOverview(spec),
      this.generateFunctionalRequirements(spec),
      this.generateTechnicalRequirements(spec, techStack),
      this.generateNonFunctionalRequirements(spec),
      this.generateAcceptanceCriteria(spec),
      this.generateOutOfScope(spec),
    ];

    return {
      title: spec.title,
      sections,
      metadata: {
        version: '1.0',
        author: 'Planning Agent',
        date: new Date().toISOString().split('T')[0],
      },
    };
  }

  /**
   * Generate PRD using LLM
   */
  private async generatePRDWithLLM(spec: Spec, techStack: TechStack): Promise<PRD> {
    const userPrompt = this.buildPRDPrompt(spec, techStack);

    const response = await this.llmClient!.generate({
      model: 'claude-3-5-sonnet-20241022',
      system: this.systemPrompt!,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 8192,
      temperature: 0.7,
    });

    // Parse LLM response into PRD structure
    return this.parsePRDFromLLMResponse(response.content, spec.title);
  }

  /**
   * Build prompt for PRD generation
   */
  private buildPRDPrompt(spec: Spec, techStack: TechStack): string {
    return `Generate a comprehensive Product Requirements Document (PRD) for the following project:

**Title:** ${spec.title}

**Description:**
${spec.description}

**Requirements:**
${spec.requirements.map(r => `- ${r}`).join('\n')}

**Tech Stack:**
${Object.entries(techStack).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

Generate a detailed PRD with the following sections:
1. Product Overview
2. Functional Requirements
3. Technical Requirements
4. Non-Functional Requirements
5. Acceptance Criteria
6. Out of Scope

Format the output as markdown with clear section headers.`;
  }

  /**
   * Parse LLM response into PRD structure
   */
  private parsePRDFromLLMResponse(content: string, title: string): PRD {
    const sections: PRDSection[] = [];
    const lines = content.split('\n');

    let currentSection: PRDSection | null = null;
    let currentContent: string[] = [];

    for (const line of lines) {
      // Check for section headers (## Section Name)
      const headerMatch = line.match(/^##\s+(.+)/);
      if (headerMatch) {
        // Save previous section
        if (currentSection) {
          currentSection.content = currentContent.join('\n').trim();
          sections.push(currentSection);
        }

        // Start new section
        currentSection = {
          title: headerMatch[1].trim(),
          content: '',
        };
        currentContent = [];
      } else if (currentSection) {
        currentContent.push(line);
      }
    }

    // Save last section
    if (currentSection) {
      currentSection.content = currentContent.join('\n').trim();
      sections.push(currentSection);
    }

    return {
      title,
      sections,
      metadata: {
        version: '1.0',
        author: 'Planning Agent (LLM)',
        date: new Date().toISOString().split('T')[0],
      },
    };
  }

  /**
   * Generate task list with dependency blocks
   */
  async generateTaskList(prd: PRD, techStack: TechStack, options: PlanningOptions): Promise<string> {
    // Try LLM-based generation first
    if (this.llmClient && this.systemPrompt) {
      try {
        return await this.generateTaskListWithLLM(prd, techStack, options);
      } catch (error) {
        console.warn('LLM task list generation failed, falling back to templates:', (error as Error).message);
      }
    }

    // Fallback to template-based generation
    let markdown = '';

    // Document metadata
    markdown += this.generateDocumentMetadata(prd);
    markdown += '\n\n';

    // Generate PRs (simplified)
    const prs = this.generatePRsFromPRD(prd, techStack, options);

    // Organize into blocks
    const blocks = this.organizeDependencyBlocks(prs);

    // Generate blocks
    for (const block of blocks) {
      markdown += this.generateBlock(block);
      markdown += '\n\n';
    }

    return markdown;
  }

  /**
   * Generate task list using LLM
   */
  private async generateTaskListWithLLM(
    prd: PRD,
    techStack: TechStack,
    options: PlanningOptions
  ): Promise<string> {
    const userPrompt = this.buildTaskListPrompt(prd, techStack, options);

    const response = await this.llmClient!.generate({
      model: 'claude-3-5-sonnet-20241022',
      system: this.systemPrompt!,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 16384,
      temperature: 0.7,
    });

    return response.content;
  }

  /**
   * Build prompt for task list generation
   */
  private buildTaskListPrompt(prd: PRD, techStack: TechStack, options: PlanningOptions): string {
    const prdContent = this.formatPRDForPrompt(prd);
    const skipLemegeton = options.skipLemegetonSetup ? '\n\n**IMPORTANT:** Skip PR-000 (Lemegeton setup) as it is already configured.' : '';

    return `Based on the following PRD, generate a comprehensive task-list.md file with YAML frontmatter for each PR.

${prdContent}

**Tech Stack:**
${Object.entries(techStack).map(([k, v]) => `- ${k}: ${v}`).join('\n')}
${skipLemegeton}

Generate a task list following the structure defined in the planning-agent.yml prompt. Include:
- Document metadata with complexity estimates
- Dependency blocks organizing PRs logically
- Each PR with YAML frontmatter including:
  - pr_id, title, cold_state, priority
  - complexity (score, estimated_minutes, suggested_model, rationale)
  - dependencies array
  - estimated_files with path, action, description
- Clear descriptions and acceptance criteria for each PR

Format the output as a complete markdown document ready to save as task-list.md.`;
  }

  /**
   * Format PRD for prompt
   */
  private formatPRDForPrompt(prd: PRD): string {
    let content = `# ${prd.title}\n\n`;
    for (const section of prd.sections) {
      content += `## ${section.title}\n\n${section.content}\n\n`;
    }
    return content;
  }

  /**
   * Write documents to disk
   */
  async writeDocuments(prd: PRD, taskList: string, outputPath: string): Promise<void> {
    const prdPath = path.join(outputPath, 'prd.md');
    const taskListPath = path.join(outputPath, 'task-list.md');

    const prdContent = this.formatPRD(prd);

    await fs.writeFile(prdPath, prdContent, 'utf-8');
    await fs.writeFile(taskListPath, taskList, 'utf-8');
  }

  /**
   * Generate git commit message
   */
  generateCommitMessage(prd: PRD, taskList: string): string {
    const prCount = (taskList.match(/^pr_id:/gm) || []).length;

    return `[Planning] Initial PRD and task list for ${prd.title}

PRD includes:
- Product overview and requirements
- Technical architecture decisions
- Acceptance criteria

Task list includes:
- ${prCount} PRs with YAML frontmatter
- Dependency blocks for parallel execution
- Complexity scores for intelligent routing

Generated with Lemegeton Planning Agent.`;
  }

  /**
   * Generate document metadata
   */
  private generateDocumentMetadata(prd: PRD): string {
    return `# Task List for ${prd.title}

## Orchestration Metadata
**Generated for:** Lemegeton v1.0+
**Generated on:** ${new Date().toISOString().split('T')[0]}

---`;
  }

  /**
   * Generate PRs from PRD (simplified)
   *
   * Real implementation would use LLM with planning-agent.yml prompt
   * to analyze PRD and generate detailed PR breakdown.
   */
  private generatePRsFromPRD(prd: PRD, techStack: TechStack, options: PlanningOptions): PRData[] {
    const prs: PRData[] = [];

    // PR-000: Lemegeton setup (if not skipped)
    if (!options.skipLemegetonSetup) {
      prs.push(this.generateLemegetonSetupPR());
    }

    // PR-001: Project scaffolding
    prs.push(this.generateProjectScaffoldingPR(prd, techStack, options));

    // Add more PRs based on requirements (simplified)
    const reqPRs = this.generateRequirementPRs(prd, techStack);
    prs.push(...reqPRs);

    return prs;
  }

  /**
   * Generate PR-000: Lemegeton Setup
   */
  private generateLemegetonSetupPR(): PRData {
    const estimatedFiles: FileEstimate[] = [
      {
        path: 'package.json',
        action: 'modify',
        description: 'add lemegeton dependency',
      },
      {
        path: 'docs/prd.md',
        action: 'create',
        description: 'the PRD document',
      },
      {
        path: 'docs/task-list.md',
        action: 'create',
        description: 'this file with all PRs',
      },
    ];

    return {
      pr_id: 'PR-000',
      title: 'Install and Configure Lemegeton',
      cold_state: 'new' as ColdState,
      priority: 'critical',
      complexity: {
        score: 2,
        estimated_minutes: 20,
        suggested_model: 'haiku',
        rationale: 'Simple setup task',
      },
      dependencies: [],
      estimated_files: estimatedFiles,
    };
  }

  /**
   * Generate PR-001: Project Scaffolding
   */
  private generateProjectScaffoldingPR(prd: PRD, techStack: TechStack, options: PlanningOptions): PRData {
    const estimatedFiles: FileEstimate[] = [
      {
        path: 'README.md',
        action: 'create',
        description: 'project documentation',
      },
      {
        path: '.gitignore',
        action: 'create',
        description: 'git ignore configuration',
      },
    ];

    if (techStack.language?.includes('Node')) {
      estimatedFiles.push({
        path: 'package.json',
        action: 'create',
        description: 'Node.js project configuration',
      });
      estimatedFiles.push({
        path: 'tsconfig.json',
        action: 'create',
        description: 'TypeScript configuration',
      });
    }

    return {
      pr_id: 'PR-001',
      title: 'Project Scaffolding and Initial Setup',
      cold_state: 'new' as ColdState,
      priority: 'high',
      complexity: {
        score: 3,
        estimated_minutes: 30,
        suggested_model: 'haiku',
        rationale: 'Basic project setup',
      },
      dependencies: options.skipLemegetonSetup ? [] : ['PR-000'],
      estimated_files: estimatedFiles,
    };
  }

  /**
   * Generate PRs from requirements (simplified)
   */
  private generateRequirementPRs(prd: PRD, techStack: TechStack): PRData[] {
    // This is a simplified implementation
    // Real implementation would use LLM to analyze requirements and generate PRs
    return [];
  }

  /**
   * Organize PRs into dependency blocks
   */
  private organizeDependencyBlocks(prs: PRData[]): any[] {
    // Simplified: create single block for now
    // Real implementation would do topological sort and grouping
    return [
      {
        id: 0,
        title: 'Foundation',
        prs,
        dependencies: [],
      },
    ];
  }

  /**
   * Generate block markdown
   */
  private generateBlock(block: any): string {
    let markdown = `## Block ${block.id}: ${block.title}\n\n`;

    for (const pr of block.prs) {
      markdown += this.generatePRSection(pr);
      markdown += '\n\n';
    }

    return markdown;
  }

  /**
   * Generate PR section with YAML frontmatter
   */
  private generatePRSection(pr: PRData): string {
    const estimatedFiles = pr.estimated_files || [];

    return `### ${pr.pr_id}: ${pr.title}

---
pr_id: ${pr.pr_id}
title: ${pr.title}
cold_state: ${pr.cold_state}
priority: ${pr.priority}
dependencies: ${JSON.stringify(pr.dependencies || [])}
estimated_files:
${estimatedFiles.map(f => `  - path: ${f.path}
    action: ${f.action}
    description: ${f.description}`).join('\n')}
---

**Description:**
Implementation of ${pr.title.toLowerCase()}.

**Acceptance Criteria:**
- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated`;
  }

  /**
   * Generate Product Overview section
   */
  private generateProductOverview(spec: Spec): PRDSection {
    return {
      title: 'Product Overview',
      content: spec.description || 'Product overview not provided.',
    };
  }

  /**
   * Generate Functional Requirements section
   */
  private generateFunctionalRequirements(spec: Spec): PRDSection {
    const requirements = spec.requirements.length > 0
      ? spec.requirements.map(r => `- ${r}`).join('\n')
      : 'No specific requirements provided.';

    return {
      title: 'Functional Requirements',
      content: requirements,
    };
  }

  /**
   * Generate Technical Requirements section
   */
  private generateTechnicalRequirements(spec: Spec, techStack: TechStack): PRDSection {
    const stack = [];

    if (techStack.language) stack.push(`**Language/Runtime:** ${techStack.language}`);
    if (techStack.webFramework) stack.push(`**Web Framework:** ${techStack.webFramework}`);
    if (techStack.database) stack.push(`**Database:** ${techStack.database}`);
    if (techStack.buildTools) stack.push(`**Build Tools:** ${techStack.buildTools}`);
    if (techStack.testingFramework) stack.push(`**Testing Framework:** ${techStack.testingFramework}`);
    if (techStack.deploymentTarget) stack.push(`**Deployment:** ${techStack.deploymentTarget}`);

    const content = stack.length > 0
      ? `Technology Stack:\n\n${stack.join('\n')}`
      : 'Technology stack not fully specified.';

    return {
      title: 'Technical Requirements',
      content,
    };
  }

  /**
   * Generate Non-Functional Requirements section
   */
  private generateNonFunctionalRequirements(spec: Spec): PRDSection {
    return {
      title: 'Non-Functional Requirements',
      content: `- **Performance:** Application should be responsive
- **Security:** Follow security best practices
- **Maintainability:** Code should be well-documented and tested`,
    };
  }

  /**
   * Generate Acceptance Criteria section
   */
  private generateAcceptanceCriteria(spec: Spec): PRDSection {
    return {
      title: 'Acceptance Criteria',
      content: `The project is complete when:
- All functional requirements are implemented
- All tests are passing
- Documentation is complete
- Deployment is successful`,
    };
  }

  /**
   * Generate Out of Scope section
   */
  private generateOutOfScope(spec: Spec): PRDSection {
    return {
      title: 'Out of Scope',
      content: 'Items explicitly not included in this project will be documented here.',
    };
  }

  /**
   * Format PRD as markdown
   */
  private formatPRD(prd: PRD): string {
    let markdown = `# ${prd.title}\n\n`;

    if (prd.metadata) {
      markdown += `**Version:** ${prd.metadata.version || '1.0'}\n`;
      markdown += `**Date:** ${prd.metadata.date || 'N/A'}\n`;
      markdown += `**Author:** ${prd.metadata.author || 'Planning Agent'}\n\n`;
      markdown += '---\n\n';
    }

    for (const section of prd.sections) {
      markdown += `## ${section.title}\n\n${section.content}\n\n`;
    }

    return markdown;
  }
}
