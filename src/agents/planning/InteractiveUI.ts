/**
 * Interactive UI
 *
 * Handles user interaction for tech stack clarifications,
 * approval workflows, and question prompting.
 */

import { Spec, TechStack, TechStackSuggestion, PRD } from './types';
import * as readline from 'readline';

/**
 * Manages interactive user prompts for planning
 */
export class InteractiveUI {
  private rl: readline.Interface | null = null;

  /**
   * Identify missing tech stack components
   *
   * Returns list of required tech stack fields that are missing or ambiguous
   */
  identifyMissingTechStack(spec: Spec): string[] {
    const required = [
      'Language/Runtime',
      'Web Framework',
      'Database',
      'Build Tools',
      'Testing Framework',
      'Deployment Target',
    ];

    const missing: string[] = [];

    for (const item of required) {
      if (!this.hasTechStackItem(spec, item)) {
        missing.push(item);
      }
    }

    return missing;
  }

  /**
   * Ask user tech stack clarification questions
   *
   * Presents suggestions from MCP and prompts user for choices
   */
  async askTechStackQuestions(
    missing: string[],
    suggestions?: Map<string, TechStackSuggestion>
  ): Promise<Partial<TechStack>> {
    const answers: Partial<TechStack> = {};

    console.log('\n=== Tech Stack Clarification ===\n');
    console.log('The specification is missing some tech stack details.');
    console.log('Please provide the following information:\n');

    for (const category of missing) {
      const suggestion = suggestions?.get(category);
      const answer = await this.askCategoryQuestion(category, suggestion);
      answers[this.categoryToKey(category)] = answer;
    }

    console.log('\n=== Tech Stack Complete ===\n');

    return answers;
  }

  /**
   * Request approval for generated documents
   */
  async requestApproval(
    prd: PRD,
    taskList: string,
    prs: any[]
  ): Promise<boolean> {
    console.log('\n=== Generated Documents ===\n');
    console.log('PRD Preview:');
    console.log(`  Title: ${prd.title}`);
    console.log(`  Sections: ${prd.sections.length}`);
    console.log('\nTask List Preview:');
    console.log(`  PRs generated: ${prs.length}`);
    console.log(`  Complexity range: ${this.getComplexityRange(prs)}`);
    console.log(`  Estimated total time: ${this.getEstimatedTime(prs)} minutes`);

    // Show complexity distribution
    console.log('\nComplexity Distribution:');
    const dist = this.getComplexityDistribution(prs);
    console.log(`  Haiku (1-3): ${dist.haiku} PRs`);
    console.log(`  Sonnet (4-7): ${dist.sonnet} PRs`);
    console.log(`  Opus (8-10): ${dist.opus} PRs`);

    const approved = await this.promptYesNo(
      '\nDoes this look correct? Should I commit these documents?'
    );

    return approved;
  }

  /**
   * Ask question for specific tech stack category
   */
  private async askCategoryQuestion(
    category: string,
    suggestion?: TechStackSuggestion
  ): Promise<string> {
    console.log(`\n${category}:`);

    if (suggestion && suggestion.options.length > 0) {
      console.log('Suggestions:');
      suggestion.options.forEach((opt, index) => {
        console.log(`  ${index + 1}. ${opt.name} - ${opt.description} (${opt.popularity})`);
      });
      console.log(`  ${suggestion.options.length + 1}. Other (specify)`);

      const choice = await this.promptNumber(
        'Choose an option',
        1,
        suggestion.options.length + 1
      );

      if (choice <= suggestion.options.length) {
        return suggestion.options[choice - 1].name;
      }
    }

    // Manual input
    return await this.promptText(`Enter ${category}`);
  }

  /**
   * Check if spec has tech stack item
   */
  private hasTechStackItem(spec: Spec, item: string): boolean {
    const key = this.categoryToKey(item);
    return !!(spec.techStack && spec.techStack[key]);
  }

  /**
   * Convert category name to TechStack key
   */
  private categoryToKey(category: string): keyof TechStack {
    const mapping: Record<string, keyof TechStack> = {
      'Language/Runtime': 'language',
      'Web Framework': 'webFramework',
      'Database': 'database',
      'Build Tools': 'buildTools',
      'Testing Framework': 'testingFramework',
      'Deployment Target': 'deploymentTarget',
    };

    return mapping[category] || 'language';
  }

  /**
   * Get complexity range from PRs
   */
  private getComplexityRange(prs: any[]): string {
    if (prs.length === 0) return 'N/A';

    const scores = prs.map(pr => pr.complexity?.score || 0);
    const min = Math.min(...scores);
    const max = Math.max(...scores);

    return `${min}-${max}`;
  }

  /**
   * Get estimated total time
   */
  private getEstimatedTime(prs: any[]): number {
    return prs.reduce((sum, pr) => sum + (pr.complexity?.estimated_minutes || 0), 0);
  }

  /**
   * Get complexity distribution
   */
  private getComplexityDistribution(prs: any[]): {
    haiku: number;
    sonnet: number;
    opus: number;
  } {
    const dist = { haiku: 0, sonnet: 0, opus: 0 };

    for (const pr of prs) {
      const score = pr.complexity?.score || 0;
      if (score <= 3) dist.haiku++;
      else if (score <= 7) dist.sonnet++;
      else dist.opus++;
    }

    return dist;
  }

  /**
   * Prompt for yes/no answer
   */
  private async promptYesNo(question: string): Promise<boolean> {
    const answer = await this.promptText(`${question} (y/n)`);
    return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
  }

  /**
   * Prompt for number input
   */
  private async promptNumber(question: string, min: number, max: number): Promise<number> {
    while (true) {
      const answer = await this.promptText(`${question} (${min}-${max})`);
      const num = parseInt(answer, 10);

      if (!isNaN(num) && num >= min && num <= max) {
        return num;
      }

      console.log(`Please enter a number between ${min} and ${max}`);
    }
  }

  /**
   * Prompt for text input
   */
  private async promptText(question: string): Promise<string> {
    if (!this.rl) {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
    }

    return new Promise((resolve) => {
      this.rl!.question(`${question}: `, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  /**
   * Close readline interface
   */
  close(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}
