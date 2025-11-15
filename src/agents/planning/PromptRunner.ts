/**
 * Prompt Runner
 *
 * Executes the planning-agent.yml prompt workflow, parsing specs
 * and extracting structured information.
 */

import { Spec, TechStack } from './types';
import { PromptLoader } from '../../services/PromptLoader';

/**
 * Runs planning prompts and parses spec files
 */
export class PromptRunner {
  private promptCache: string | null = null;

  /**
   * Load the planning agent prompt from YAML file
   */
  async loadPrompt(): Promise<string> {
    if (this.promptCache) {
      return this.promptCache;
    }

    try {
      const yaml = require('js-yaml');
      const fs = require('fs');
      const path = require('path');

      // Load planning-agent.yml
      const promptPath = path.join(process.cwd(), 'prompts', 'planning-agent.yml');
      const promptYaml = fs.readFileSync(promptPath, 'utf-8');
      const promptData = yaml.load(promptYaml);

      // Build comprehensive system prompt from YAML sections
      const sections = [];

      if (promptData.role) {
        sections.push(`# Role\n${promptData.role}`);
      }

      if (promptData.input?.process) {
        sections.push(`# Input Processing\n${promptData.input.process}`);
      }

      if (promptData.techStackClarification) {
        sections.push(`# Tech Stack Clarification\n${promptData.techStackClarification.clarificationProcess || ''}`);
      }

      if (promptData.outputDocuments) {
        sections.push(`# Output Documents\nGenerate the following documents:\n${JSON.stringify(promptData.outputDocuments, null, 2)}`);
      }

      if (promptData.taskListStructure) {
        sections.push(`# Task List Structure\n${JSON.stringify(promptData.taskListStructure, null, 2)}`);
      }

      this.promptCache = sections.join('\n\n');
      return this.promptCache;
    } catch (error) {
      console.warn('Failed to load planning-agent.yml:', (error as Error).message);
      // Return basic fallback prompt
      return `You are a project planning agent. Generate a PRD and task list from the provided specification.`;
    }
  }

  /**
   * Parse spec file content into structured format
   *
   * Extracts:
   * - Title from first heading
   * - Description from content before first section
   * - Requirements from bullet lists
   * - Tech stack from dedicated section (if present)
   */
  parseSpec(content: string): Spec {
    const title = this.extractTitle(content);
    const description = this.extractDescription(content);
    const requirements = this.extractRequirements(content);
    const techStack = this.extractTechStack(content);

    return {
      title,
      description,
      requirements,
      techStack,
    };
  }

  /**
   * Extract title from first h1 heading
   */
  private extractTitle(content: string): string {
    const match = content.match(/^#\s+(.+)/m);
    return match ? match[1].trim() : 'Untitled Project';
  }

  /**
   * Extract description from content before first h2 section
   */
  private extractDescription(content: string): string {
    // Split by first h2
    const parts = content.split(/\n##\s+/);
    if (parts.length < 2) {
      // No h2 sections, use everything after h1
      const afterTitle = content.replace(/^#\s+.+\n+/, '');
      return afterTitle.trim();
    }

    // Get content between h1 and first h2
    const intro = parts[0].replace(/^#\s+.+\n+/, '');
    return intro.trim();
  }

  /**
   * Extract requirements from bullet lists
   */
  private extractRequirements(content: string): string[] {
    const requirements: string[] = [];

    // Look for sections that might contain requirements
    const requirementSections = [
      'requirements',
      'features',
      'functionality',
      'capabilities',
    ];

    for (const sectionName of requirementSections) {
      const regex = new RegExp(
        `##\\s+${sectionName}[^#]*?\\n([\\s\\S]*?)(?=\\n##|$)`,
        'i'
      );
      const match = content.match(regex);

      if (match && match[1]) {
        const bullets = match[1]
          .split('\n')
          .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
          .map(line => line.replace(/^[\s\-\*]+/, '').trim())
          .filter(line => line.length > 0);

        requirements.push(...bullets);
      }
    }

    // If no dedicated section, extract all bullet points
    if (requirements.length === 0) {
      const bullets = content
        .split('\n')
        .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
        .map(line => line.replace(/^[\s\-\*]+/, '').trim())
        .filter(line => line.length > 0);

      requirements.push(...bullets);
    }

    return requirements;
  }

  /**
   * Extract tech stack from dedicated section
   *
   * Looks for sections like "Tech Stack", "Technology Stack",
   * "Technical Requirements", etc.
   */
  private extractTechStack(content: string): Partial<TechStack> {
    const techStack: Partial<TechStack> = {};

    // Look for tech stack section
    const techSectionRegex = /##\s+(?:tech(?:nology)?(?:\s+stack)?|technical\s+requirements)[^#]*?\n([\s\S]*?)(?=\n##|$)/i;
    const match = content.match(techSectionRegex);

    if (!match || !match[1]) {
      // Try to extract from content
      return this.extractTechStackFromContent(content);
    }

    const sectionContent = match[1];

    // Extract specific technologies
    const patterns = {
      language: /(?:language|runtime):\s*(.+)/i,
      webFramework: /(?:web\s+framework|framework):\s*(.+)/i,
      database: /database:\s*(.+)/i,
      buildTools: /(?:build\s+tools?|bundler):\s*(.+)/i,
      testingFramework: /(?:testing|test\s+framework):\s*(.+)/i,
      deploymentTarget: /deployment:\s*(.+)/i,
    };

    for (const [key, pattern] of Object.entries(patterns)) {
      const match = sectionContent.match(pattern);
      if (match && match[1]) {
        techStack[key as keyof TechStack] = match[1].trim();
      }
    }

    return techStack;
  }

  /**
   * Extract tech stack mentions from general content
   *
   * Fallback when no dedicated tech stack section exists
   */
  private extractTechStackFromContent(content: string): Partial<TechStack> {
    const techStack: Partial<TechStack> = {};

    // Common language/runtime patterns
    const languages = {
      'Node.js': /node\.?js|npm|javascript|typescript/i,
      'Python': /python|pip|django|flask|fastapi/i,
      'Rust': /rust|cargo/i,
      'Go': /\bgo\b|golang/i,
      'Java': /\bjava\b|maven|gradle/i,
    };

    const frameworks = {
      'React': /\breact\b/i,
      'Next.js': /next\.?js/i,
      'Vue': /vue\.?js/i,
      'Svelte': /svelte/i,
      'Angular': /angular/i,
    };

    const databases = {
      'PostgreSQL': /postgres(?:ql)?/i,
      'MySQL': /mysql/i,
      'SQLite': /sqlite/i,
      'MongoDB': /mongo(?:db)?/i,
    };

    // Check for languages
    for (const [name, pattern] of Object.entries(languages)) {
      if (pattern.test(content)) {
        techStack.language = name;
        break;
      }
    }

    // Check for frameworks
    for (const [name, pattern] of Object.entries(frameworks)) {
      if (pattern.test(content)) {
        techStack.webFramework = name;
        break;
      }
    }

    // Check for databases
    for (const [name, pattern] of Object.entries(databases)) {
      if (pattern.test(content)) {
        techStack.database = name;
        break;
      }
    }

    return techStack;
  }
}
