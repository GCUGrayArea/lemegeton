/**
 * PromptLoader Service
 *
 * Loads YAML prompts from the bundled prompts directory and caches them in Redis.
 * Agents retrieve prompts from Redis for consistent, fast access.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import {
  Prompt,
  PromptName,
  AgentDefaultsPrompt,
  CommitPolicyPrompt,
  CostGuidelinesPrompt,
  PlanningAgentPrompt,
} from '../types/prompts';

/**
 * Redis key prefix for cached prompts
 */
const PROMPT_KEY_PREFIX = 'prompt:';

/**
 * Service for loading and caching prompts
 */
export class PromptLoader {
  private redis: any; // Use any to avoid complex Redis type issues
  private promptsDir: string;

  /**
   * Creates a new PromptLoader instance.
   *
   * @param redis - Connected Redis client
   * @param promptsDir - Optional path to prompts directory (defaults to bundled prompts)
   */
  constructor(redis: any, promptsDir?: string) {
    this.redis = redis;
    // Default to bundled prompts directory (relative to compiled dist)
    this.promptsDir = promptsDir || path.join(__dirname, '../../prompts');
  }

  /**
   * Loads all prompts from disk and caches them in Redis.
   * Called during Hub startup.
   *
   * @throws Error if any prompt fails to load or validate
   */
  async loadAllPrompts(): Promise<void> {
    const prompts = [
      PromptName.AgentDefaults,
      PromptName.CommitPolicy,
      PromptName.CostGuidelines,
      PromptName.PlanningAgent,
    ];

    for (const promptName of prompts) {
      await this.loadPrompt(promptName);
    }
  }

  /**
   * Loads a specific prompt from disk and caches it in Redis.
   *
   * @param promptName - Name of the prompt to load
   * @throws Error if prompt file doesn't exist or is invalid
   */
  async loadPrompt(promptName: PromptName): Promise<void> {
    const filePath = this.getPromptPath(promptName);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`Prompt file not found: ${filePath}`);
    }

    // Read and parse YAML
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const parsed = yaml.load(fileContent) as Prompt;

    // Validate prompt structure
    this.validatePrompt(parsed, promptName);

    // Cache in Redis
    const key = this.getRedisKey(promptName);
    await this.redis.set(key, JSON.stringify(parsed));
  }

  /**
   * Retrieves a prompt from Redis cache.
   *
   * @param promptName - Name of the prompt to retrieve
   * @returns The parsed prompt object
   * @throws Error if prompt not found in cache
   */
  async getPrompt(promptName: PromptName.AgentDefaults): Promise<AgentDefaultsPrompt>;
  async getPrompt(promptName: PromptName.CommitPolicy): Promise<CommitPolicyPrompt>;
  async getPrompt(promptName: PromptName.CostGuidelines): Promise<CostGuidelinesPrompt>;
  async getPrompt(promptName: PromptName.PlanningAgent): Promise<PlanningAgentPrompt>;
  async getPrompt(promptName: PromptName): Promise<Prompt> {
    const key = this.getRedisKey(promptName);
    const cached = await this.redis.get(key);

    if (!cached) {
      throw new Error(
        `Prompt not found in cache: ${promptName}. Did you call loadAllPrompts()?`
      );
    }

    return JSON.parse(cached) as Prompt;
  }

  /**
   * Checks if a prompt exists in Redis cache.
   *
   * @param promptName - Name of the prompt to check
   * @returns True if prompt is cached
   */
  async hasPrompt(promptName: PromptName): Promise<boolean> {
    const key = this.getRedisKey(promptName);
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  /**
   * Clears all cached prompts from Redis.
   * Useful for testing or forcing a reload.
   */
  async clearCache(): Promise<void> {
    const keys = Object.values(PromptName).map((name) => this.getRedisKey(name));
    if (keys.length > 0) {
      await this.redis.del(keys);
    }
  }

  /**
   * Gets the file path for a prompt.
   *
   * @param promptName - Name of the prompt
   * @returns Full path to the YAML file
   */
  private getPromptPath(promptName: PromptName): string {
    return path.join(this.promptsDir, `${promptName}.yml`);
  }

  /**
   * Gets the Redis key for a prompt.
   *
   * @param promptName - Name of the prompt
   * @returns Redis key
   */
  private getRedisKey(promptName: PromptName): string {
    return `${PROMPT_KEY_PREFIX}${promptName}`;
  }

  /**
   * Validates a parsed prompt against expected structure.
   *
   * @param prompt - Parsed prompt object
   * @param expectedName - Expected prompt name
   * @throws Error if validation fails
   */
  private validatePrompt(prompt: Prompt, expectedName: PromptName): void {
    if (!prompt) {
      throw new Error('Prompt is null or undefined');
    }

    if (!prompt.name) {
      throw new Error('Prompt missing required field: name');
    }

    if (prompt.name !== expectedName) {
      throw new Error(
        `Prompt name mismatch: expected ${expectedName}, got ${prompt.name}`
      );
    }

    if (!prompt.version) {
      throw new Error(`Prompt ${expectedName} missing required field: version`);
    }

    if (!prompt.description) {
      throw new Error(`Prompt ${expectedName} missing required field: description`);
    }

    // Type-specific validation
    switch (prompt.name) {
      case PromptName.AgentDefaults:
        this.validateAgentDefaultsPrompt(prompt as AgentDefaultsPrompt);
        break;
      case PromptName.CommitPolicy:
        this.validateCommitPolicyPrompt(prompt as CommitPolicyPrompt);
        break;
      case PromptName.CostGuidelines:
        this.validateCostGuidelinesPrompt(prompt as CostGuidelinesPrompt);
        break;
      case PromptName.PlanningAgent:
        this.validatePlanningAgentPrompt(prompt as PlanningAgentPrompt);
        break;
    }
  }

  /**
   * Validates AgentDefaultsPrompt structure.
   */
  private validateAgentDefaultsPrompt(prompt: AgentDefaultsPrompt): void {
    if (!prompt.workClaiming) {
      throw new Error('AgentDefaultsPrompt missing required field: workClaiming');
    }
    if (!prompt.stateModel) {
      throw new Error('AgentDefaultsPrompt missing required field: stateModel');
    }
    if (!prompt.redisCoordination) {
      throw new Error('AgentDefaultsPrompt missing required field: redisCoordination');
    }
    if (!prompt.codingStandards) {
      throw new Error('AgentDefaultsPrompt missing required field: codingStandards');
    }
    if (!prompt.emergency) {
      throw new Error('AgentDefaultsPrompt missing required field: emergency');
    }
  }

  /**
   * Validates CommitPolicyPrompt structure.
   */
  private validateCommitPolicyPrompt(prompt: CommitPolicyPrompt): void {
    if (!prompt.gitSync) {
      throw new Error('CommitPolicyPrompt missing required field: gitSync');
    }
    if (!prompt.planningPhase) {
      throw new Error('CommitPolicyPrompt missing required field: planningPhase');
    }
    if (!prompt.implementationPhase) {
      throw new Error('CommitPolicyPrompt missing required field: implementationPhase');
    }
    if (!prompt.stateCommitRules) {
      throw new Error('CommitPolicyPrompt missing required field: stateCommitRules');
    }
    if (!prompt.readOnly) {
      throw new Error('CommitPolicyPrompt missing required field: readOnly');
    }
  }

  /**
   * Validates CostGuidelinesPrompt structure.
   */
  private validateCostGuidelinesPrompt(prompt: CostGuidelinesPrompt): void {
    if (!prompt.modelRouting) {
      throw new Error('CostGuidelinesPrompt missing required field: modelRouting');
    }
    if (!prompt.budgetEnforcement) {
      throw new Error('CostGuidelinesPrompt missing required field: budgetEnforcement');
    }
    if (!prompt.fallbackStrategies) {
      throw new Error('CostGuidelinesPrompt missing required field: fallbackStrategies');
    }
    if (!prompt.toolSupport) {
      throw new Error('CostGuidelinesPrompt missing required field: toolSupport');
    }
  }

  /**
   * Validates PlanningAgentPrompt structure.
   */
  private validatePlanningAgentPrompt(prompt: PlanningAgentPrompt): void {
    if (!prompt.role) {
      throw new Error('PlanningAgentPrompt missing required field: role');
    }
    if (!prompt.input) {
      throw new Error('PlanningAgentPrompt missing required field: input');
    }
    if (!prompt.techStackClarification) {
      throw new Error('PlanningAgentPrompt missing required field: techStackClarification');
    }
    if (!prompt.outputDocuments) {
      throw new Error('PlanningAgentPrompt missing required field: outputDocuments');
    }
    if (!prompt.taskListStructure) {
      throw new Error('PlanningAgentPrompt missing required field: taskListStructure');
    }
    if (!prompt.prTemplate) {
      throw new Error('PlanningAgentPrompt missing required field: prTemplate');
    }
    if (!prompt.complexityScoring) {
      throw new Error('PlanningAgentPrompt missing required field: complexityScoring');
    }
  }
}

/**
 * Creates a PromptLoader instance with a connected Redis client.
 *
 * @param redisUrl - Optional Redis connection URL (defaults to localhost:6379)
 * @param promptsDir - Optional path to prompts directory
 * @returns Promise resolving to PromptLoader instance
 */
export async function createPromptLoader(
  redisUrl?: string,
  promptsDir?: string
): Promise<PromptLoader> {
  const redis = createClient({
    url: redisUrl || 'redis://localhost:6379',
  });

  await redis.connect();

  return new PromptLoader(redis, promptsDir);
}
