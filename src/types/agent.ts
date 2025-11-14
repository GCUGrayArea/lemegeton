/**
 * Agent Types and Interfaces
 *
 * Defines types for agent lifecycle, capabilities, and communication.
 * Supports heterogeneous agent pools with different model tiers.
 */

/**
 * Agent types supported by Lemegeton.
 * Each type has specific responsibilities and capabilities.
 */
export type AgentType = 'coding' | 'qc' | 'review' | 'planning';

/**
 * Model tiers for cost optimization.
 * Maps to Claude models or equivalent from other providers.
 */
export type ModelTier = 'haiku' | 'sonnet' | 'opus';

/**
 * Agent capabilities and configuration.
 * Used for intelligent work assignment and pool management.
 */
export interface AgentCapabilities {
  /** Type of agent (determines responsibilities) */
  type: AgentType;

  /** Programming languages this agent can work with */
  languages: string[];

  /** Whether this agent can create implementation plans */
  can_plan: boolean;

  /** Whether this agent can implement code */
  can_implement: boolean;

  /** Whether this agent can write and run tests */
  can_test: boolean;

  /** Model tier for cost tracking and routing */
  model_tier: ModelTier;

  /** Cost per token for this agent's model (optional, for tracking) */
  cost_per_token?: number;

  /** Maximum context window size (tokens) */
  max_context?: number;
}

/**
 * Current state of an agent process.
 * Tracked by the Hub for monitoring and coordination.
 */
export interface AgentState {
  /** Unique agent identifier */
  agent_id: string;

  /** Agent type and capabilities */
  capabilities: AgentCapabilities;

  /** Current status of the agent */
  status: AgentStatus;

  /** PR currently assigned to this agent */
  current_pr?: string;

  /** Timestamp of agent process start */
  started_at: Date;

  /** Timestamp of last heartbeat received */
  last_heartbeat: Date;

  /** Current working directory */
  working_directory: string;

  /** Process ID of agent */
  process_id?: number;

  /** Model being used by this agent */
  model: string;

  /** Total tokens used by this agent session */
  tokens_used: number;

  /** Total cost incurred by this agent (USD) */
  total_cost: number;
}

/**
 * Agent status values.
 * Used to track agent lifecycle and availability.
 */
export type AgentStatus =
  | 'initializing'   // Agent process starting up
  | 'idle'           // Agent ready for work assignment
  | 'busy'           // Agent actively working on PR
  | 'paused'         // Agent paused by user or system
  | 'crashed'        // Agent process terminated unexpectedly
  | 'stopped';       // Agent gracefully shut down

/**
 * Heartbeat message sent by agents to Hub.
 * Proves liveness and provides status updates.
 */
export interface AgentHeartbeat {
  /** Agent sending the heartbeat */
  agent_id: string;

  /** Timestamp of heartbeat */
  timestamp: Date;

  /** Current agent status */
  status: AgentStatus;

  /** Current PR being worked on */
  current_pr?: string;

  /** Current activity description */
  activity?: string;

  /** Health check status */
  healthy: boolean;

  /** Error message if unhealthy */
  error?: string;

  /** Memory usage in MB */
  memory_usage?: number;

  /** CPU usage percentage */
  cpu_usage?: number;
}

/**
 * Message sent from Hub to Agent.
 * Used for work assignment and control commands.
 */
export interface HubToAgentMessage {
  /** Message type discriminator */
  type: HubMessageType;

  /** Target agent ID */
  agent_id: string;

  /** Message payload */
  payload: any;

  /** Timestamp of message */
  timestamp: Date;

  /** Message ID for tracking */
  message_id: string;
}

/**
 * Types of messages Hub can send to Agents.
 */
export type HubMessageType =
  | 'ASSIGN_PR'              // Assign PR to agent
  | 'CANCEL_PR'              // Cancel current PR work
  | 'PAUSE'                  // Pause agent activity
  | 'RESUME'                 // Resume agent activity
  | 'SHUTDOWN'               // Gracefully shut down agent
  | 'SWITCH_TO_BRANCHES'     // Enter degraded mode
  | 'MERGE_TO_MAIN'          // Exit degraded mode
  | 'WORK_ISOLATED'          // Enter isolated mode
  | 'RESUME_COORDINATION'    // Exit isolated mode
  | 'UPDATE_CONFIG';         // Update agent configuration

/**
 * Message sent from Agent to Hub.
 * Used for status updates and requesting resources.
 */
export interface AgentToHubMessage {
  /** Message type discriminator */
  type: AgentMessageType;

  /** Sending agent ID */
  agent_id: string;

  /** Message payload */
  payload: any;

  /** Timestamp of message */
  timestamp: Date;

  /** Message ID for tracking */
  message_id: string;
}

/**
 * Types of messages Agents can send to Hub.
 */
export type AgentMessageType =
  | 'HEARTBEAT'              // Regular heartbeat
  | 'PR_STATE_CHANGE'        // PR transitioned to new state
  | 'REQUEST_LEASE'          // Request file lease
  | 'RELEASE_LEASE'          // Release file lease
  | 'ERROR'                  // Error occurred
  | 'COMPLETE'               // PR work completed
  | 'BLOCKED'                // Blocked on dependencies or conflicts
  | 'NEED_INPUT';            // User input required

/**
 * Agent pool configuration.
 * Defines how many agents of each tier to maintain.
 */
export interface AgentPoolConfig {
  /** Number of Haiku agents (fast, cheap, for simple tasks) */
  haiku_count: number;

  /** Number of Sonnet agents (balanced, for most tasks) */
  sonnet_count: number;

  /** Number of Opus agents (powerful, for complex tasks) */
  opus_count: number;

  /** Maximum total agents */
  max_total_agents: number;

  /** Whether to auto-scale agent pools */
  auto_scale: boolean;

  /** Fallback strategy when preferred tier unavailable */
  fallback_strategy: 'upgrade' | 'downgrade' | 'wait';
}

/**
 * Agent allocation result.
 * Returned when assigning an agent to a PR.
 */
export interface AgentAllocation {
  /** Whether allocation succeeded */
  success: boolean;

  /** Allocated agent (if successful) */
  agent?: AgentState;

  /** Reason for failure (if unsuccessful) */
  reason?: string;

  /** Suggested retry delay in seconds */
  retry_after?: number;
}
