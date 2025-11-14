/**
 * Type definitions for the prompt system.
 *
 * Prompts are YAML files bundled in the package that guide agent behavior.
 * They are loaded at Hub startup and cached in Redis for agent access.
 */

/**
 * Available prompt names that can be loaded by the PromptLoader.
 */
export enum PromptName {
  AgentDefaults = 'agent-defaults',
  CommitPolicy = 'commit-policy',
  CostGuidelines = 'cost-guidelines',
  PlanningAgent = 'planning-agent',
  MemoryBank = 'memory-bank',
}

/**
 * Base structure for all prompts.
 * Each prompt type extends this with specific sections.
 */
export interface BasePrompt {
  /** Prompt name/identifier */
  name: string;
  /** Version of the prompt format */
  version: string;
  /** Brief description of the prompt's purpose */
  description: string;
}

/**
 * Agent Defaults Prompt
 *
 * Defines core coordination workflow for agents, including:
 * - Work claiming process
 * - Hot vs cold state behavior
 * - Redis coordination primitives
 * - File lease checking
 * - Priority rules
 * - Coding standards
 */
export interface AgentDefaultsPrompt extends BasePrompt {
  name: 'agent-defaults';

  /** Rules for claiming work */
  workClaiming: {
    /** How to check Redis for available work */
    checkAvailability: string;
    /** Priority order for work selection */
    priority: string[];
    /** How to verify no file lease conflicts */
    leaseChecking: string;
  };

  /** Hot and cold state behaviors */
  stateModel: {
    /** Ephemeral states coordinated via Redis only */
    hotStates: string[];
    /** Durable states that trigger git commits */
    coldStates: string[];
    /** How hot agents coordinate in real-time */
    hotCoordination: string;
    /** How cold state transitions work */
    coldTransitions: string;
  };

  /** Redis coordination primitives */
  redisCoordination: {
    /** How to acquire locks */
    locking: string;
    /** How to use transactions */
    transactions: string;
    /** How to use pub/sub for notifications */
    pubsub: string;
  };

  /** Coding standards */
  codingStandards: {
    /** Maximum lines per function */
    maxFunctionLines: number;
    /** Maximum lines per file */
    maxFileLines: number;
    /** Strategies for decomposition */
    decompositionStrategies: string[];
  };

  /** Emergency procedures */
  emergency: {
    /** How to check for halt signal */
    haltChecking: string;
    /** What to do when halt detected */
    haltResponse: string;
  };
}

/**
 * Commit Policy Prompt
 *
 * Defines when and how agents commit changes, including:
 * - Planning phase auto-commits
 * - Implementation phase bundled commits
 * - Hot vs cold state commit rules
 * - Git pull requirements
 * - Approval requirements
 */
export interface CommitPolicyPrompt extends BasePrompt {
  name: 'commit-policy';

  /** Git synchronization rules */
  gitSync: {
    /** Always pull before committing */
    pullBeforeCommit: string;
    /** Expected merge behavior */
    expectedMerge: string;
  };

  /** Planning phase commit rules */
  planningPhase: {
    /** When to auto-commit */
    autoCommitTriggers: string[];
    /** What files to include */
    includedFiles: string[];
    /** Commit message format */
    messageFormat: string;
    /** No approval needed */
    autonomous: boolean;
  };

  /** Implementation phase commit rules */
  implementationPhase: {
    /** When to request approval */
    approvalTriggers: string[];
    /** Bundle code with coordination updates */
    bundledCommit: string;
    /** Commit message format */
    messageFormat: string;
    /** Requires user approval */
    requiresApproval: boolean;
  };

  /** State-specific commit rules */
  stateCommitRules: {
    /** Hot states: Redis only, no commits */
    hotStates: string;
    /** Cold states: Redis + git commit */
    coldStates: string;
  };

  /** Files that cannot be modified */
  readOnly: string[];
}

/**
 * Cost Guidelines Prompt
 *
 * Defines cost control and model selection for heterogeneous agent pools:
 * - Complexity-based routing
 * - Budget enforcement
 * - Fallback strategies
 */
export interface CostGuidelinesPrompt extends BasePrompt {
  name: 'cost-guidelines';

  /** Model tier routing based on PR complexity */
  modelRouting: {
    /** Complexity score ranges and assigned models */
    tiers: Array<{
      complexityRange: string;
      model: string;
      description: string;
    }>;
    /** Expected distribution across tiers */
    expectedDistribution: {
      haiku: string;
      sonnet: string;
      opus: string;
    };
  };

  /** Budget limits and enforcement */
  budgetEnforcement: {
    /** Token limits per PR */
    tokensPerPR: {
      warning: number;
      hard: number;
    };
    /** Token limits per hour */
    tokensPerHour: {
      warning: number;
      hard: number;
    };
    /** Cost limits per day */
    costPerDay: {
      warning: number;
      hard: number;
    };
  };

  /** Fallback strategies when approaching limits */
  fallbackStrategies: {
    /** What to do when approaching warning threshold */
    approachingLimit: string;
    /** What to do when hitting hard limit */
    limitExceeded: string;
    /** How to alert user */
    userAlert: string;
  };

  /** Tool-agnostic design */
  toolSupport: {
    /** Supported LLM providers */
    providers: string[];
    /** How to calculate costs for each provider */
    costCalculation: string;
  };
}

/**
 * Planning Agent Prompt
 *
 * Guide for the Planning Agent to transform specifications into PRD and task list:
 * - Tech stack clarification
 * - PRD structure
 * - Task list with YAML frontmatter
 * - Complexity scoring
 * - Dependency management
 */
export interface PlanningAgentPrompt extends BasePrompt {
  name: 'planning-agent';

  /** Role description */
  role: string;

  /** Input processing instructions */
  input: {
    process: string;
  };

  /** Tech stack clarification requirements */
  techStackClarification: {
    critical: boolean;
    requiredDetails: Array<{
      name: string;
      condition?: string;
      examples: string[];
    }>;
    clarificationProcess: string;
    afterClarification: string;
  };

  /** Output documents structure */
  outputDocuments: {
    prd: {
      path: string;
      description: string;
      sections: {
        productOverview: string[];
        functionalRequirements: string[];
        technicalRequirements: string[];
        nonFunctionalRequirements: string[];
        acceptanceCriteria: { description: string };
        outOfScope: { description: string };
      };
    };
    taskList: {
      path: string;
      description: string;
      structure: string;
    };
  };

  /** Task list structure guidelines */
  taskListStructure: {
    documentMetadata: string;
    firstPR: {
      always: boolean;
      prId: string;
      title: string;
      purpose: string;
      complexity: number;
      model: string;
      template: string;
    };
  };

  /** PR template with YAML frontmatter */
  prTemplate: {
    structure: string;
    requiredFields: string[];
    optionalFields: string[];
  };

  /** Complexity scoring guidelines */
  complexityScoring: {
    simple: {
      range: string;
      model: string;
      examples: string[];
    };
    moderate: {
      range: string;
      model: string;
      examples: string[];
    };
    complex: {
      range: string;
      model: string;
      examples: string[];
    };
    critical: {
      range: string;
      model: string;
      examples: string[];
    };
    factors: any; // Complex nested structure
  };

  /** Special PR types */
  specialPRTypes: {
    testPR: { example: string };
    crossCuttingConcern: { example: string };
    finalArchitectureDocs: {
      always: boolean;
      position: string;
      example: string;
    };
  };

  /** .gitignore review guidelines */
  gitignoreSection: {
    lemegetonExclusions: string;
    languageSpecific: {
      description: string;
      examples: string[];
    };
    alwaysExclude: string[];
    reference: string;
  };

  /** Quality checklist */
  qualityChecklist: {
    beforePresenting: string[];
  };

  /** Post-generation workflow */
  postGeneration: {
    steps: Array<{
      step: number;
      action: string;
    }>;
    commitMessage: {
      format: string;
    };
  };

  /** YAML parsing notes */
  yamlParsingNotes: {
    rationale: string;
    hubBehavior: string[];
    result: string;
  };
}

/**
 * Memory Bank Prompt
 *
 * Defines the memory bank system for persistent institutional knowledge:
 * - Four core files (systemPatterns, techContext, activeContext, progress)
 * - Update triggers and workflows
 * - Reading order for agents
 * - Integration with Lemegeton coordination
 * - Adapter pattern for future vector DB migration
 */
export interface MemoryBankPrompt extends BasePrompt {
  name: 'memory-bank';

  /** Purpose and overview */
  purpose: {
    overview: string;
    keyBenefits: string[];
  };

  /** Core memory files */
  coreFiles: {
    systemPatterns: any;
    techContext: any;
    activeContext: any;
    progress: any;
  };

  /** Reading order for agents */
  readingOrder: {
    description: string;
    sequence: any[];
    rationale: string;
  };

  /** Update triggers */
  updateTriggers: {
    description: string;
    triggers: any[];
  };

  /** Update process */
  updateProcess: {
    guidelines: string[];
    commitRules: any;
    exampleWorkflow: string;
    avoidance: string[];
  };

  /** Key principles */
  keyPrinciples: {
    aiOptimized: string;
    committedToRepo: string;
    noRuleModifications: string;
    accumulationOverReset: string;
    adapterPattern: string;
  };

  /** Integration with Lemegeton */
  integrationWithLemegeton: {
    hubUsage: string;
    agentUsage: string;
    redisCaching: string;
  };

  /** Vector DB migration (future) */
  vectorDBMigration: {
    overview: string;
    queryExamples: any;
    implementation: string;
  };

  /** API reference */
  apiReference: {
    memoryBankService: string;
    fileMemoryAdapter: string;
    vectorMemoryAdapter: string;
  };
}

/**
 * Union type of all prompt types.
 */
export type Prompt = AgentDefaultsPrompt | CommitPolicyPrompt | CostGuidelinesPrompt | PlanningAgentPrompt | MemoryBankPrompt;

/**
 * Type guard to check if a prompt is AgentDefaultsPrompt.
 */
export function isAgentDefaultsPrompt(prompt: Prompt): prompt is AgentDefaultsPrompt {
  return prompt.name === 'agent-defaults';
}

/**
 * Type guard to check if a prompt is CommitPolicyPrompt.
 */
export function isCommitPolicyPrompt(prompt: Prompt): prompt is CommitPolicyPrompt {
  return prompt.name === 'commit-policy';
}

/**
 * Type guard to check if a prompt is CostGuidelinesPrompt.
 */
export function isCostGuidelinesPrompt(prompt: Prompt): prompt is CostGuidelinesPrompt {
  return prompt.name === 'cost-guidelines';
}

/**
 * Type guard to check if a prompt is PlanningAgentPrompt.
 */
export function isPlanningAgentPrompt(prompt: Prompt): prompt is PlanningAgentPrompt {
  return prompt.name === 'planning-agent';
}

/**
 * Type guard to check if a prompt is MemoryBankPrompt.
 */
export function isMemoryBankPrompt(prompt: Prompt): prompt is MemoryBankPrompt {
  return prompt.name === 'memory-bank';
}
