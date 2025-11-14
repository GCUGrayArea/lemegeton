/**
 * Tests for PromptLoader service
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient, RedisClientType } from 'redis';
import { PromptLoader } from '../PromptLoader';
import { PromptName, AgentDefaultsPrompt, CommitPolicyPrompt, CostGuidelinesPrompt } from '../../types/prompts';

describe('PromptLoader', () => {
  let redis: RedisClientType;
  let promptLoader: PromptLoader;
  const testPromptsDir = path.join(__dirname, '../../../prompts');

  beforeAll(async () => {
    // Connect to Redis for testing
    redis = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });

    try {
      await redis.connect();
    } catch (error) {
      console.warn('Redis not available for testing. Skipping PromptLoader tests.');
      console.warn('To run these tests, start Redis: docker run -p 6379:6379 redis:7');
    }
  }, 10000);

  afterAll(async () => {
    if (redis.isOpen) {
      await redis.quit();
    }
  }, 10000);

  beforeEach(async () => {
    // Clear Redis before each test
    await redis.flushDb();
    // Create fresh PromptLoader instance
    promptLoader = new PromptLoader(redis, testPromptsDir);
  });

  describe('loadAllPrompts', () => {
    it('should load all prompts successfully', async () => {
      await promptLoader.loadAllPrompts();

      // Verify all prompts are cached in Redis
      expect(await promptLoader.hasPrompt(PromptName.AgentDefaults)).toBe(true);
      expect(await promptLoader.hasPrompt(PromptName.CommitPolicy)).toBe(true);
      expect(await promptLoader.hasPrompt(PromptName.CostGuidelines)).toBe(true);
    });

    it('should throw error if prompt file missing', async () => {
      // Create loader with non-existent directory
      const badLoader = new PromptLoader(redis, '/nonexistent/path');

      await expect(badLoader.loadAllPrompts()).rejects.toThrow('Prompt file not found');
    });
  });

  describe('loadPrompt', () => {
    it('should load agent-defaults prompt', async () => {
      await promptLoader.loadPrompt(PromptName.AgentDefaults);

      const prompt = await promptLoader.getPrompt(PromptName.AgentDefaults);
      expect(prompt.name).toBe('agent-defaults');
      expect(prompt.version).toBeDefined();
      expect(prompt.description).toBeDefined();
    });

    it('should load commit-policy prompt', async () => {
      await promptLoader.loadPrompt(PromptName.CommitPolicy);

      const prompt = await promptLoader.getPrompt(PromptName.CommitPolicy);
      expect(prompt.name).toBe('commit-policy');
      expect(prompt.version).toBeDefined();
      expect(prompt.description).toBeDefined();
    });

    it('should load cost-guidelines prompt', async () => {
      await promptLoader.loadPrompt(PromptName.CostGuidelines);

      const prompt = await promptLoader.getPrompt(PromptName.CostGuidelines);
      expect(prompt.name).toBe('cost-guidelines');
      expect(prompt.version).toBeDefined();
      expect(prompt.description).toBeDefined();
    });

    it('should cache prompt in Redis', async () => {
      await promptLoader.loadPrompt(PromptName.AgentDefaults);

      const key = 'prompt:agent-defaults';
      const cached = await redis.get(key);
      expect(cached).toBeDefined();
      expect(JSON.parse(cached!).name).toBe('agent-defaults');
    });
  });

  describe('getPrompt', () => {
    beforeEach(async () => {
      await promptLoader.loadAllPrompts();
    });

    it('should retrieve agent-defaults prompt from cache', async () => {
      const prompt = await promptLoader.getPrompt(PromptName.AgentDefaults);

      expect(prompt.name).toBe('agent-defaults');
      expect(prompt.workClaiming).toBeDefined();
      expect(prompt.stateModel).toBeDefined();
      expect(prompt.redisCoordination).toBeDefined();
      expect(prompt.codingStandards).toBeDefined();
      expect(prompt.emergency).toBeDefined();
    });

    it('should retrieve commit-policy prompt from cache', async () => {
      const prompt = await promptLoader.getPrompt(PromptName.CommitPolicy);

      expect(prompt.name).toBe('commit-policy');
      expect(prompt.gitSync).toBeDefined();
      expect(prompt.planningPhase).toBeDefined();
      expect(prompt.implementationPhase).toBeDefined();
      expect(prompt.stateCommitRules).toBeDefined();
      expect(prompt.readOnly).toBeDefined();
    });

    it('should retrieve cost-guidelines prompt from cache', async () => {
      const prompt = await promptLoader.getPrompt(PromptName.CostGuidelines);

      expect(prompt.name).toBe('cost-guidelines');
      expect(prompt.modelRouting).toBeDefined();
      expect(prompt.budgetEnforcement).toBeDefined();
      expect(prompt.fallbackStrategies).toBeDefined();
      expect(prompt.toolSupport).toBeDefined();
    });

    it('should throw error if prompt not cached', async () => {
      await promptLoader.clearCache();

      await expect(promptLoader.getPrompt(PromptName.AgentDefaults)).rejects.toThrow(
        'Prompt not found in cache'
      );
    });
  });

  describe('hasPrompt', () => {
    it('should return true if prompt is cached', async () => {
      await promptLoader.loadPrompt(PromptName.AgentDefaults);

      expect(await promptLoader.hasPrompt(PromptName.AgentDefaults)).toBe(true);
    });

    it('should return false if prompt is not cached', async () => {
      expect(await promptLoader.hasPrompt(PromptName.AgentDefaults)).toBe(false);
    });
  });

  describe('clearCache', () => {
    it('should remove all cached prompts', async () => {
      await promptLoader.loadAllPrompts();

      expect(await promptLoader.hasPrompt(PromptName.AgentDefaults)).toBe(true);
      expect(await promptLoader.hasPrompt(PromptName.CommitPolicy)).toBe(true);
      expect(await promptLoader.hasPrompt(PromptName.CostGuidelines)).toBe(true);

      await promptLoader.clearCache();

      expect(await promptLoader.hasPrompt(PromptName.AgentDefaults)).toBe(false);
      expect(await promptLoader.hasPrompt(PromptName.CommitPolicy)).toBe(false);
      expect(await promptLoader.hasPrompt(PromptName.CostGuidelines)).toBe(false);
    });
  });

  describe('prompt validation', () => {
    it('should validate agent-defaults structure', async () => {
      await promptLoader.loadPrompt(PromptName.AgentDefaults);
      const prompt = await promptLoader.getPrompt(PromptName.AgentDefaults);

      // Verify required sections exist
      expect(prompt.workClaiming).toBeDefined();
      expect(prompt.workClaiming.checkAvailability).toBeDefined();
      expect(prompt.workClaiming.priority).toBeInstanceOf(Array);
      expect(prompt.workClaiming.leaseChecking).toBeDefined();

      expect(prompt.stateModel).toBeDefined();
      expect(prompt.stateModel.hotStates).toBeInstanceOf(Array);
      expect(prompt.stateModel.coldStates).toBeInstanceOf(Array);

      expect(prompt.codingStandards).toBeDefined();
      expect(prompt.codingStandards.maxFunctionLines).toBe(75);
      expect(prompt.codingStandards.maxFileLines).toBe(750);
    });

    it('should validate commit-policy structure', async () => {
      await promptLoader.loadPrompt(PromptName.CommitPolicy);
      const prompt = await promptLoader.getPrompt(PromptName.CommitPolicy);

      // Verify required sections exist
      expect(prompt.gitSync).toBeDefined();
      expect(prompt.gitSync.pullBeforeCommit).toBeDefined();

      expect(prompt.planningPhase).toBeDefined();
      expect(prompt.planningPhase.autonomous).toBe(true);
      expect(prompt.planningPhase.autoCommitTriggers).toBeInstanceOf(Array);

      expect(prompt.implementationPhase).toBeDefined();
      expect(prompt.implementationPhase.requiresApproval).toBe(true);

      expect(prompt.readOnly).toBeInstanceOf(Array);
      expect(prompt.readOnly.length).toBeGreaterThan(0);
    });

    it('should validate cost-guidelines structure', async () => {
      await promptLoader.loadPrompt(PromptName.CostGuidelines);
      const prompt = await promptLoader.getPrompt(PromptName.CostGuidelines);

      // Verify required sections exist
      expect(prompt.modelRouting).toBeDefined();
      expect(prompt.modelRouting.tiers).toBeInstanceOf(Array);
      expect(prompt.modelRouting.tiers.length).toBe(3);
      expect(prompt.modelRouting.expectedDistribution).toBeDefined();

      expect(prompt.budgetEnforcement).toBeDefined();
      expect(prompt.budgetEnforcement.tokensPerPR).toBeDefined();
      expect(prompt.budgetEnforcement.tokensPerPR.warning).toBeGreaterThan(0);
      expect(prompt.budgetEnforcement.tokensPerPR.hard).toBeGreaterThan(0);

      expect(prompt.toolSupport).toBeDefined();
      expect(prompt.toolSupport.providers).toBeInstanceOf(Array);
    });

    it('should reject prompt with wrong name', async () => {
      // Create a temporary bad YAML file
      const badYamlPath = path.join(testPromptsDir, 'temp-bad.yml');
      const badYaml = `
name: wrong-name
version: "1.0"
description: Test
`;
      fs.writeFileSync(badYamlPath, badYaml);

      try {
        const badLoader = new PromptLoader(redis, testPromptsDir);
        // Try to load with wrong expected name
        await expect(
          async () => {
            await badLoader.loadPrompt(PromptName.AgentDefaults);
          }
        ).rejects.toThrow('Prompt name mismatch');
      } finally {
        // Clean up temp file
        if (fs.existsSync(badYamlPath)) {
          fs.unlinkSync(badYamlPath);
        }
      }
    });
  });

  describe('YAML parsing', () => {
    it('should parse YAML with nested structures', async () => {
      await promptLoader.loadPrompt(PromptName.AgentDefaults);
      const prompt = await promptLoader.getPrompt(PromptName.AgentDefaults);

      // Verify nested structures are parsed correctly
      expect(typeof prompt.workClaiming.checkAvailability).toBe('string');
      expect(Array.isArray(prompt.workClaiming.priority)).toBe(true);
      expect(prompt.workClaiming.priority).toContain('broken');
      expect(prompt.workClaiming.priority).toContain('ready');
    });

    it('should parse YAML with multiline strings', async () => {
      await promptLoader.loadPrompt(PromptName.CommitPolicy);
      const prompt = await promptLoader.getPrompt(PromptName.CommitPolicy);

      // Verify multiline strings preserve content
      expect(prompt.gitSync.pullBeforeCommit).toContain('git pull');
      expect(prompt.gitSync.pullBeforeCommit.length).toBeGreaterThan(50);
    });

    it('should parse YAML with arrays of objects', async () => {
      await promptLoader.loadPrompt(PromptName.CostGuidelines);
      const prompt = await promptLoader.getPrompt(PromptName.CostGuidelines);

      // Verify arrays of objects are parsed correctly
      expect(prompt.modelRouting.tiers).toHaveLength(3);
      expect(prompt.modelRouting.tiers[0]).toHaveProperty('complexityRange');
      expect(prompt.modelRouting.tiers[0]).toHaveProperty('model');
      expect(prompt.modelRouting.tiers[0]).toHaveProperty('description');
    });
  });

  describe('integration with Redis', () => {
    it('should persist prompts across PromptLoader instances', async () => {
      // Load with first instance
      await promptLoader.loadAllPrompts();

      // Create second instance
      const promptLoader2 = new PromptLoader(redis, testPromptsDir);

      // Should retrieve from cache without loading files
      const prompt = await promptLoader2.getPrompt(PromptName.AgentDefaults);
      expect(prompt.name).toBe('agent-defaults');
    });

    it('should use correct Redis key prefix', async () => {
      await promptLoader.loadPrompt(PromptName.AgentDefaults);

      const keys = await redis.keys('prompt:*');
      expect(keys).toContain('prompt:agent-defaults');
    });
  });
});
