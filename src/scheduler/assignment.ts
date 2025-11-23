/**
 * Work Assignment Manager
 *
 * Manages the assignment of PRs to agents based on availability,
 * capability matching, and load balancing.
 */

import { PRNode, Assignment, Priority, WorkType } from './types';
import { AgentInfo, AgentType } from '../hub/agentRegistry';
import { mergeConfig } from '../utils/config';

/**
 * Agent capability profile
 */
interface AgentCapability {
  /** Maximum complexity the agent can handle */
  maxComplexity: number;

  /** Preferred model for the agent */
  preferredModel?: string;

  /** Average time to complete per complexity point (minutes) */
  avgTimePerComplexity: number;

  /** Success rate (0-1) */
  successRate: number;
}

/**
 * Assignment strategy
 */
export enum AssignmentStrategy {
  /** Assign to first available agent */
  FIRST_AVAILABLE = 'first_available',

  /** Balance load across agents */
  LOAD_BALANCED = 'load_balanced',

  /** Match complexity to agent capability */
  CAPABILITY_MATCHED = 'capability_matched',

  /** Round-robin assignment */
  ROUND_ROBIN = 'round_robin',
}

/**
 * Work assignment configuration
 */
export interface AssignmentConfig {
  /** Assignment strategy to use */
  strategy?: AssignmentStrategy;

  /** Whether to consider agent specialization */
  useSpecialization?: boolean;

  /** Maximum assignments per agent */
  maxAssignmentsPerAgent?: number;

  /** Minimum time between assignments (ms) */
  minAssignmentInterval?: number;
}

/**
 * Default assignment configuration
 */
const DEFAULT_CONFIG: Required<AssignmentConfig> = {
  strategy: AssignmentStrategy.CAPABILITY_MATCHED,
  useSpecialization: true,
  maxAssignmentsPerAgent: 3,
  minAssignmentInterval: 1000, // 1 second
};

/**
 * Work assignment manager
 */
export class AssignmentManager {
  private config: Required<AssignmentConfig>;
  private assignments: Map<string, Assignment> = new Map();
  private agentAssignments: Map<string, Set<string>> = new Map();
  private agentCapabilities: Map<string, AgentCapability> = new Map();
  private lastAssignmentTime: Map<string, number> = new Map();
  private roundRobinIndex = 0;

  constructor(config: AssignmentConfig = {}) {
    this.config = mergeConfig(DEFAULT_CONFIG, config);
    this.initializeDefaultCapabilities();
  }

  /**
   * Initialize default agent capabilities
   */
  private initializeDefaultCapabilities(): void {
    // Default capabilities by agent type
    const defaults: Record<AgentType, AgentCapability> = {
      planning: {
        maxComplexity: 10,
        preferredModel: 'opus',
        avgTimePerComplexity: 10,
        successRate: 0.95,
      },
      worker: {
        maxComplexity: 7,
        preferredModel: 'sonnet',
        avgTimePerComplexity: 8,
        successRate: 0.90,
      },
      qc: {
        maxComplexity: 5,
        preferredModel: 'haiku',
        avgTimePerComplexity: 5,
        successRate: 0.85,
      },
      review: {
        maxComplexity: 8,
        preferredModel: 'sonnet',
        avgTimePerComplexity: 6,
        successRate: 0.92,
      },
    };

    // Store as template (actual agents will override)
    for (const [type, capability] of Object.entries(defaults)) {
      this.agentCapabilities.set(`template:${type}`, capability);
    }
  }

  /**
   * Map agent type to work type
   */
  private getWorkTypeForAgent(agentType: AgentType): WorkType {
    switch (agentType) {
      case 'planning':
        return WorkType.PLANNING;
      case 'worker':
        return WorkType.IMPLEMENTATION;
      case 'qc':
        return WorkType.QC;
      case 'review':
        return WorkType.REVIEW;
      default:
        return WorkType.IMPLEMENTATION;
    }
  }

  /**
   * Check if PR is appropriate for agent's work type
   */
  private isPRAppropriateForAgent(pr: PRNode, agent: AgentInfo): boolean {
    const workType = this.getWorkTypeForAgent(agent.type);

    switch (workType) {
      case WorkType.PLANNING:
        return pr.state === 'new' || pr.state === 'ready';
      case WorkType.IMPLEMENTATION:
        return pr.state === 'planned';
      case WorkType.QC:
      case WorkType.REVIEW:
        return pr.state === 'completed';
      default:
        return false;
    }
  }

  /**
   * Assign PRs to available agents
   */
  assignWork(
    prs: PRNode[],
    availableAgents: AgentInfo[]
  ): Assignment[] {
    const assignments: Assignment[] = [];

    // Filter agents that can accept work
    const eligibleAgents = this.filterEligibleAgents(availableAgents);
    if (eligibleAgents.length === 0) {
      return assignments;
    }

    // Filter PRs to only those appropriate for available agent types
    const appropriatePRs = prs.filter(pr =>
      eligibleAgents.some(agent => this.isPRAppropriateForAgent(pr, agent))
    );

    // Sort PRs by priority for assignment
    const sortedPRs = this.sortPRsForAssignment(appropriatePRs);

    // Assign based on strategy
    switch (this.config.strategy) {
      case AssignmentStrategy.FIRST_AVAILABLE:
        return this.assignFirstAvailable(sortedPRs, eligibleAgents);

      case AssignmentStrategy.LOAD_BALANCED:
        return this.assignLoadBalanced(sortedPRs, eligibleAgents);

      case AssignmentStrategy.CAPABILITY_MATCHED:
        return this.assignCapabilityMatched(sortedPRs, eligibleAgents);

      case AssignmentStrategy.ROUND_ROBIN:
        return this.assignRoundRobin(sortedPRs, eligibleAgents);

      default:
        return this.assignCapabilityMatched(sortedPRs, eligibleAgents);
    }
  }

  /**
   * First available assignment strategy
   */
  private assignFirstAvailable(
    prs: PRNode[],
    agents: AgentInfo[]
  ): Assignment[] {
    const assignments: Assignment[] = [];

    for (const pr of prs) {
      // Find first available agent that can do this type of work
      const agent = agents.find(a =>
        this.canAssign(a.id, pr) && this.isPRAppropriateForAgent(pr, a)
      );

      if (agent) {
        const assignment = this.createAssignment(pr, agent);
        assignments.push(assignment);
        this.recordAssignment(assignment);

        // Stop if agent is at capacity
        if (!this.canAcceptMoreWork(agent.id)) {
          const index = agents.indexOf(agent);
          agents.splice(index, 1);
        }
      }
    }

    return assignments;
  }

  /**
   * Load balanced assignment strategy
   */
  private assignLoadBalanced(
    prs: PRNode[],
    agents: AgentInfo[]
  ): Assignment[] {
    const assignments: Assignment[] = [];
    const agentLoad = new Map<string, number>();

    // Initialize load tracking
    for (const agent of agents) {
      const currentAssignments = this.agentAssignments.get(agent.id)?.size || 0;
      agentLoad.set(agent.id, currentAssignments);
    }

    for (const pr of prs) {
      // Find agent with lowest load that can handle this PR
      let bestAgent: AgentInfo | null = null;
      let minLoad = Infinity;

      for (const agent of agents) {
        if (!this.canAssign(agent.id, pr) || !this.isPRAppropriateForAgent(pr, agent)) {
          continue;
        }

        const load = agentLoad.get(agent.id) || 0;
        if (load < minLoad) {
          minLoad = load;
          bestAgent = agent;
        }
      }

      if (bestAgent) {
        const assignment = this.createAssignment(pr, bestAgent);
        assignments.push(assignment);
        this.recordAssignment(assignment);

        // Update load
        agentLoad.set(bestAgent.id, minLoad + 1);

        // Remove agent if at capacity
        if (!this.canAcceptMoreWork(bestAgent.id)) {
          const index = agents.indexOf(bestAgent);
          agents.splice(index, 1);
        }
      }
    }

    return assignments;
  }

  /**
   * Capability matched assignment strategy
   */
  private assignCapabilityMatched(
    prs: PRNode[],
    agents: AgentInfo[]
  ): Assignment[] {
    const assignments: Assignment[] = [];

    for (const pr of prs) {
      // Find best matching agent
      let bestAgent: AgentInfo | null = null;
      let bestScore = -1;

      for (const agent of agents) {
        if (!this.canAssign(agent.id, pr) || !this.isPRAppropriateForAgent(pr, agent)) {
          continue;
        }

        const score = this.calculateMatchScore(agent, pr);
        if (score > bestScore) {
          bestScore = score;
          bestAgent = agent;
        }
      }

      if (bestAgent) {
        const assignment = this.createAssignment(pr, bestAgent);
        assignments.push(assignment);
        this.recordAssignment(assignment);

        // Remove agent if at capacity
        if (!this.canAcceptMoreWork(bestAgent.id)) {
          const index = agents.indexOf(bestAgent);
          agents.splice(index, 1);
        }
      }
    }

    return assignments;
  }

  /**
   * Round-robin assignment strategy
   */
  private assignRoundRobin(
    prs: PRNode[],
    agents: AgentInfo[]
  ): Assignment[] {
    const assignments: Assignment[] = [];

    for (const pr of prs) {
      let assigned = false;
      let attempts = 0;

      while (!assigned && attempts < agents.length) {
        const agent = agents[this.roundRobinIndex % agents.length];
        this.roundRobinIndex++;
        attempts++;

        if (this.canAssign(agent.id, pr) && this.isPRAppropriateForAgent(pr, agent)) {
          const assignment = this.createAssignment(pr, agent);
          assignments.push(assignment);
          this.recordAssignment(assignment);
          assigned = true;

          // Remove agent if at capacity
          if (!this.canAcceptMoreWork(agent.id)) {
            const index = agents.indexOf(agent);
            agents.splice(index, 1);
            if (this.roundRobinIndex > index) {
              this.roundRobinIndex--;
            }
          }
        }
      }
    }

    return assignments;
  }

  /**
   * Calculate match score between agent and PR
   */
  private calculateMatchScore(agent: AgentInfo, pr: PRNode): number {
    const capability = this.getAgentCapability(agent);

    let score = 0;

    // Complexity match (higher score for better match)
    const complexityDiff = Math.abs(capability.maxComplexity - pr.complexity);
    score += (10 - complexityDiff) * 2;

    // Model match
    if (capability.preferredModel === pr.suggestedModel) {
      score += 5;
    }

    // Success rate factor
    score *= capability.successRate;

    // Priority boost
    if (pr.priority === Priority.CRITICAL) {
      score *= 1.5;
    } else if (pr.priority === Priority.HIGH) {
      score *= 1.2;
    }

    // Agent type specialization
    if (this.config.useSpecialization) {
      score += this.getSpecializationScore(agent.type, pr);
    }

    return score;
  }

  /**
   * Get specialization score
   */
  private getSpecializationScore(agentType: AgentType, pr: PRNode): number {
    // Planning agents better for high complexity
    if (agentType === 'planning' && pr.complexity >= 8) {
      return 10;
    }

    // QC agents better for testing/validation PRs
    if (agentType === 'qc' && pr.title.toLowerCase().includes('test')) {
      return 8;
    }

    // Review agents better for documentation
    if (agentType === 'review' && pr.title.toLowerCase().includes('doc')) {
      return 8;
    }

    // Workers are generalists
    if (agentType === 'worker') {
      return 5;
    }

    return 0;
  }

  /**
   * Filter agents eligible for assignment
   */
  private filterEligibleAgents(agents: AgentInfo[]): AgentInfo[] {
    return agents.filter(agent => {
      // Check if agent is idle
      if (agent.status !== 'idle') return false;

      // Check if agent can accept more work
      if (!this.canAcceptMoreWork(agent.id)) return false;

      // Check assignment interval
      const lastAssignment = this.lastAssignmentTime.get(agent.id) || 0;
      const timeSinceLastAssignment = Date.now() - lastAssignment;
      if (timeSinceLastAssignment < this.config.minAssignmentInterval) {
        return false;
      }

      return true;
    });
  }

  /**
   * Sort PRs for assignment priority
   */
  private sortPRsForAssignment(prs: PRNode[]): PRNode[] {
    return [...prs].sort((a, b) => {
      // Priority first
      const priorityOrder = {
        [Priority.CRITICAL]: 0,
        [Priority.HIGH]: 1,
        [Priority.MEDIUM]: 2,
        [Priority.LOW]: 3,
      };

      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;

      // Then by estimated time (shorter first for quick wins)
      return a.estimatedMinutes - b.estimatedMinutes;
    });
  }

  /**
   * Check if agent can be assigned to PR
   */
  private canAssign(agentId: string, pr: PRNode): boolean {
    const capability = this.getAgentCapabilityById(agentId);

    // Check complexity limit
    if (pr.complexity > capability.maxComplexity) {
      return false;
    }

    return true;
  }

  /**
   * Check if agent can accept more work
   */
  private canAcceptMoreWork(agentId: string): boolean {
    const currentAssignments = this.agentAssignments.get(agentId)?.size || 0;
    return currentAssignments < this.config.maxAssignmentsPerAgent;
  }

  /**
   * Create an assignment
   */
  private createAssignment(pr: PRNode, agent: AgentInfo): Assignment {
    const capability = this.getAgentCapability(agent);
    const estimatedDuration = pr.complexity * capability.avgTimePerComplexity;

    return {
      prId: pr.id,
      agentId: agent.id,
      assignedAt: Date.now(),
      estimatedDuration,
      priority: pr.priority,
      complexity: pr.complexity,
    };
  }

  /**
   * Record an assignment
   */
  private recordAssignment(assignment: Assignment): void {
    this.assignments.set(assignment.prId, assignment);

    if (assignment.agentId) {
      if (!this.agentAssignments.has(assignment.agentId)) {
        this.agentAssignments.set(assignment.agentId, new Set());
      }
      this.agentAssignments.get(assignment.agentId)!.add(assignment.prId);
      this.lastAssignmentTime.set(assignment.agentId, assignment.assignedAt);
    }
  }

  /**
   * Complete an assignment
   */
  completeAssignment(prId: string): void {
    const assignment = this.assignments.get(prId);
    if (!assignment) return;

    if (assignment.agentId) {
      const agentAssignments = this.agentAssignments.get(assignment.agentId);
      if (agentAssignments) {
        agentAssignments.delete(prId);
      }
    }

    this.assignments.delete(prId);
  }

  /**
   * Get agent capability
   */
  private getAgentCapability(agent: AgentInfo): AgentCapability {
    // Check if we have specific capability for this agent
    const specific = this.agentCapabilities.get(agent.id);
    if (specific) return specific;

    // Use template based on agent type
    const template = this.agentCapabilities.get(`template:${agent.type}`);
    if (template) return template;

    // Default capability
    return {
      maxComplexity: 5,
      preferredModel: 'haiku',
      avgTimePerComplexity: 10,
      successRate: 0.8,
    };
  }

  /**
   * Get agent capability by ID
   */
  private getAgentCapabilityById(agentId: string): AgentCapability {
    const specific = this.agentCapabilities.get(agentId);
    if (specific) return specific;

    // Default capability
    return {
      maxComplexity: 5,
      preferredModel: 'haiku',
      avgTimePerComplexity: 10,
      successRate: 0.8,
    };
  }

  /**
   * Update agent capability
   */
  updateAgentCapability(agentId: string, capability: AgentCapability): void {
    this.agentCapabilities.set(agentId, capability);
  }

  /**
   * Get current assignments
   */
  getAssignments(): Assignment[] {
    return Array.from(this.assignments.values());
  }

  /**
   * Get assignments for an agent
   */
  getAgentAssignments(agentId: string): string[] {
    return Array.from(this.agentAssignments.get(agentId) || []);
  }

  /**
   * Clear all assignments
   */
  clearAssignments(): void {
    this.assignments.clear();
    this.agentAssignments.clear();
    this.lastAssignmentTime.clear();
  }

  /**
   * Get statistics
   */
  getStats(): import('./types').AssignmentStats {
    const totalAssignments = this.assignments.size;
    const activeAgents = this.agentAssignments.size;

    let totalComplexity = 0;
    let totalEstimatedTime = 0;

    for (const assignment of this.assignments.values()) {
      totalComplexity += assignment.complexity;
      totalEstimatedTime += assignment.estimatedDuration;
    }

    return {
      totalAssignments,
      activeAgents,
      avgComplexity: totalAssignments > 0 ? totalComplexity / totalAssignments : 0,
      totalEstimatedTime,
      strategy: this.config.strategy,
    };
  }
}