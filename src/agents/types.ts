/**
 * Agent-specific types
 */

import { Priority, ColdState } from '../types/pr';

/**
 * Agent statistics
 */
export interface AgentStats {
  agentId: string;
  agentType: string;
  state: AgentState;
  uptime: number;
  currentPR: string | null;
  heartbeat: HeartbeatStats;
  recovery: RecoveryStats;
}

/**
 * Heartbeat statistics
 */
export interface HeartbeatStats {
  lastSent: number;
  lastAck: number;
  missedAcks: number;
  isAlive: boolean;
  timeSinceLastAck: number;
}

/**
 * Recovery statistics
 */
export interface RecoveryStats {
  retryAttempts: Map<string, number>;
}

/**
 * Agent state during lifecycle
 */
export enum AgentState {
  INITIALIZING = 'initializing',
  IDLE = 'idle',
  WORKING = 'working',
  COMPLETING = 'completing',
  FAILED = 'failed',
  SHUTTING_DOWN = 'shutting_down',
  STOPPED = 'stopped',
}

/**
 * Work assignment from Hub
 */
export interface Assignment {
  prId: string;
  assignedAt: number;
  priority: Priority;
  complexity: number;
  estimatedDuration?: number;
  files?: string[];
}

/**
 * Work result returned to Hub
 */
export interface WorkResult {
  success: boolean;
  prId: string;
  output?: string;
  error?: string;
  filesModified?: string[];
  testsRun?: number;
  testsPassed?: number;
  duration?: number;
}

/**
 * Progress update during work
 */
export interface ProgressUpdate {
  prId: string;
  percentComplete: number;
  message: string;
  timestamp: number;
}

/**
 * Error information for failure reporting
 */
export interface ErrorInfo {
  message: string;
  stack?: string;
  code?: string;
  category: ErrorCategory;
}

/**
 * Error categories for recovery
 */
export enum ErrorCategory {
  TRANSIENT = 'transient',
  ASSIGNMENT = 'assignment',
  EXECUTION = 'execution',
  FATAL = 'fatal',
}

/**
 * Agent message types for Hub communication
 */
export type AgentMessage =
  | AgentRegistration
  | AgentHeartbeat
  | AgentProgress
  | AgentComplete
  | AgentFailed
  | AgentRequest;

export interface AgentRegistration {
  type: 'registration';
  agentId: string;
  agentType: string;
  capabilities: {
    maxComplexity: number;
    preferredModel?: string;
  };
  timestamp: number;
}

export interface AgentHeartbeat {
  type: 'heartbeat';
  agentId: string;
  state: AgentState;
  prId: string | null;
  memoryUsage: number;
  timestamp: number;
}

export interface AgentProgress {
  type: 'progress';
  agentId: string;
  prId: string;
  percentComplete: number;
  message: string;
  timestamp: number;
}

export interface AgentComplete {
  type: 'complete';
  agentId: string;
  prId: string;
  result: WorkResult;
  timestamp: number;
}

export interface AgentFailed {
  type: 'failed';
  agentId: string;
  prId: string;
  error: ErrorInfo;
  recoverable: boolean;
  timestamp: number;
}

export interface AgentRequest {
  type: 'request';
  agentId: string;
  requestType: string;
  data: any;
  timestamp: number;
}

/**
 * Hub response to agent request
 */
export interface HubResponse {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Heartbeat acknowledgment
 */
export interface HeartbeatAck {
  agentId: string;
  timestamp: number;
}

/**
 * Message handler type
 */
export type MessageHandler = (message: any) => Promise<void> | void;

/**
 * Assignment handler type
 */
export type AssignmentHandler = (assignment: Assignment) => Promise<void> | void;

/**
 * Command handler type
 */
export type CommandHandler = (command: any) => Promise<void> | void;
