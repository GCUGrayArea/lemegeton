/**
 * Planning Agent
 *
 * Automates the planning workflow: reads project spec, generates PRD and task list,
 * integrates MCP queries for tech decisions, and manages interactive clarifications.
 */

import { BaseAgent, AgentConfig } from '../base';
import { Assignment, WorkResult } from '../types';
import {
  Spec,
  TechStack,
  PRD,
  PlanningOptions,
  PlanningResult,
} from './types';
import { PromptRunner } from './PromptRunner';
import { MCPQueryEngine } from './MCPQueryEngine';
import { DocumentGenerator } from './DocumentGenerator';
import { InteractiveUI } from './InteractiveUI';
import { MCPClient } from '../../mcp/client';
import { ComplexityScorer } from '../../cost/complexityScorer';
import { TaskListParser } from '../../parser/taskList';
import { AnthropicClient } from '../../llm/AnthropicClient';
import { LLMClient } from '../../llm/types';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export interface PlanningAgentConfig extends AgentConfig {
  mcpClient?: MCPClient;
  enableMCP?: boolean;
  interactive?: boolean;
  llmApiKey?: string;
  llmModel?: string;
}

/**
 * Planning Agent - transforms project specs into PRDs and task lists
 */
export class PlanningAgent extends BaseAgent {
  private promptRunner: PromptRunner;
  private mcpEngine: MCPQueryEngine;
  private docGenerator: DocumentGenerator;
  private interactive: InteractiveUI;
  private scorer: ComplexityScorer;
  private parser: TaskListParser;
  private planningConfig: PlanningAgentConfig;

  constructor(agentId: string, config: PlanningAgentConfig) {
    super(agentId, { ...config, agentType: 'planning' });
    this.planningConfig = config;

    // Initialize components
    this.promptRunner = new PromptRunner();
    this.mcpEngine = new MCPQueryEngine(config.mcpClient ?? null);
    this.docGenerator = new DocumentGenerator();
    this.interactive = new InteractiveUI();
    this.scorer = new ComplexityScorer();
    this.parser = new TaskListParser();
  }

  /**
   * Initialize LLM client for intelligent document generation
   */
  private async initializeLLM(): Promise<void> {
    // Get API key from config or environment
    const apiKey = this.planningConfig.llmApiKey || process.env.ANTHROPIC_API_KEY;

    if (apiKey) {
      const llmClient = new AnthropicClient({ apiKey });
      const systemPrompt = await this.promptRunner.loadPrompt();
      this.docGenerator.setLLMClient(llmClient, systemPrompt);
      this.emit('activity', 'LLM client initialized for intelligent planning');
    } else {
      this.emit('activity', 'No API key found, using template-based planning');
    }
  }

  /**
   * Main planning workflow
   *
   * This is the core method that executes the full planning process:
   * 1. Read and analyze spec
   * 2. Clarify tech stack (with MCP suggestions if available)
   * 3. Generate PRD
   * 4. Generate task list with PRs
   * 5. Score complexity
   * 6. Request approval
   * 7. Commit documents if approved
   */
  public async plan(specPath: string, options: PlanningOptions = {}): Promise<PlanningResult> {
    try {
      this.emit('activity', 'Starting planning workflow');

      // Step 0: Initialize LLM for intelligent planning
      await this.initializeLLM();

      // Step 1: Read and analyze spec
      const spec = await this.readSpec(specPath);
      this.emit('activity', `Analyzed spec: ${spec.title}`);

      // Step 2: Tech stack clarification
      const techStack = await this.clarifyTechStack(spec, options);
      this.emit('activity', `Tech stack confirmed: ${techStack.language || 'not specified'}`);

      // Step 3: Generate PRD
      const prd = await this.generatePRD(spec, techStack, options);
      this.emit('activity', 'PRD generated');

      // Step 4: Generate task list (includes PR breakdown)
      const taskListContent = await this.generateTaskList(prd, techStack, options);
      this.emit('activity', 'Task list generated');

      // Step 5: Parse and score PRs (write temp file to parse)
      const tmpPath = path.join(os.tmpdir(), `task-list-${Date.now()}.md`);
      await fs.writeFile(tmpPath, taskListContent, 'utf-8');
      let scoredPRs;
      try {
        const parsed = await this.parser.parse(tmpPath, false);
        scoredPRs = parsed.prs.map((pr: any) => ({
          ...pr,
          complexity: pr.complexity || this.scorer.score(pr)
        }));
        this.emit('activity', `Scored ${scoredPRs.length} PRs`);
      } finally {
        await fs.unlink(tmpPath).catch(() => {/* ignore */});
      }

      // Step 6: Request approval (unless auto-approve)
      const approved = options.autoApprove ||
                      await this.requestApproval(prd, taskListContent, scoredPRs!);

      // Step 7: Commit documents if approved
      let documentsWritten = false;
      if (approved) {
        await this.commitDocuments(prd, taskListContent, options);
        documentsWritten = true;
        this.emit('activity', 'Documents committed');
      }

      return {
        prd,
        taskList: taskListContent,
        prs: scoredPRs!,
        approved,
        documentsWritten,
      };
    } catch (error) {
      this.emit('error', `Planning failed: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Read and parse spec file
   */
  private async readSpec(specPath: string): Promise<Spec> {
    const content = await fs.readFile(specPath, 'utf-8');
    return this.promptRunner.parseSpec(content);
  }

  /**
   * Clarify tech stack with user interaction and MCP suggestions
   */
  private async clarifyTechStack(
    spec: Spec,
    options: PlanningOptions
  ): Promise<TechStack> {
    // Check if tech stack is complete
    const missing = this.interactive.identifyMissingTechStack(spec);

    if (missing.length === 0) {
      return spec.techStack as TechStack;
    }

    // If not interactive, return what we have
    if (!options.interactive && !this.planningConfig.interactive) {
      return spec.techStack as TechStack;
    }

    // Use MCP to suggest options (if enabled)
    let suggestions;
    if (options.enableMCP || this.planningConfig.enableMCP) {
      suggestions = await this.mcpEngine.getTechStackSuggestions(spec, missing);
    }

    // Ask user to clarify
    const answers = await this.interactive.askTechStackQuestions(missing, suggestions);

    // Combine with spec
    return {
      ...spec.techStack,
      ...answers,
    } as TechStack;
  }

  /**
   * Generate PRD from spec and tech stack
   */
  private async generatePRD(
    spec: Spec,
    techStack: TechStack,
    options: PlanningOptions
  ): Promise<PRD> {
    return this.docGenerator.generatePRD(spec, techStack, options);
  }

  /**
   * Generate task list with PRs
   */
  private async generateTaskList(
    prd: PRD,
    techStack: TechStack,
    options: PlanningOptions
  ): Promise<string> {
    return this.docGenerator.generateTaskList(prd, techStack, options);
  }

  /**
   * Request approval from user
   */
  private async requestApproval(
    prd: PRD,
    taskList: string,
    prs: any[]
  ): Promise<boolean> {
    return this.interactive.requestApproval(prd, taskList, prs);
  }

  /**
   * Commit documents to filesystem and git
   */
  private async commitDocuments(
    prd: PRD,
    taskList: string,
    options: PlanningOptions
  ): Promise<void> {
    const outputPath = options.outputPath || 'docs';

    // Ensure output directory exists
    await fs.mkdir(outputPath, { recursive: true });

    // Write documents
    await this.docGenerator.writeDocuments(prd, taskList, outputPath);

    // Git commit (TODO: implement in PR-010 integration)
    const message = this.docGenerator.generateCommitMessage(prd, taskList);
    this.emit('activity', `Commit message: ${message.split('\n')[0]}`);
  }

  /**
   * Validate assignment (required by BaseAgent)
   */
  async validateAssignment(assignment: Assignment): Promise<boolean> {
    // Planning agent doesn't receive assignments from Hub in typical workflow
    // It's invoked directly via CLI
    // But we need to implement this for BaseAgent compliance
    return assignment.prId === 'planning';
  }

  /**
   * Do work (required by BaseAgent)
   */
  async doWork(assignment: Assignment): Promise<WorkResult> {
    // Planning agent work is done via plan() method
    // This is here for BaseAgent compliance when invoked by Hub
    try {
      const specPath = (assignment as any).specPath || 'spec.md';
      const result = await this.plan(specPath, {
        interactive: this.planningConfig.interactive,
        enableMCP: this.planningConfig.enableMCP,
      });

      return {
        success: result.approved && !!result.documentsWritten,
        prId: assignment.prId,
        filesModified: result.documentsWritten ? [
          'docs/prd.md',
          'docs/task-list.md'
        ] : [],
        output: result.approved
          ? `Generated PRD and task list with ${result.prs.length} PRs`
          : 'Planning cancelled by user',
      };
    } catch (error) {
      return {
        success: false,
        prId: assignment.prId,
        error: (error as Error).message,
      };
    }
  }
}
