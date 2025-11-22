/**
 * Hub Communication Manager
 */

import { EventEmitter } from 'events';
import {
  AgentMessage,
  MessageHandler,
  AssignmentHandler,
  CommandHandler,
  HubResponse,
  Assignment,
} from './types';

/**
 * Communication manager for Hub-Agent interaction
 */
export class CommunicationManager extends EventEmitter {
  private subscriptions: Map<string, MessageHandler[]> = new Map();

  constructor(
    private agentId: string,
    private publishFn: (channel: string, message: any) => Promise<void>,
    private subscribeFn: (channel: string, handler: MessageHandler) => Promise<void>
  ) {
    super();
  }

  /**
   * Publish message to Hub
   */
  async publishToHub(message: AgentMessage): Promise<void> {
    const channel = 'hub:messages';
    try {
      // Wrap AgentMessage in Message format for MessageBus
      const wrappedMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        timestamp: Date.now(),
        type: message.type as any, // AgentMessage.type maps to MessageType
        from: this.agentId,
        to: 'hub',
        payload: message,
      };

      await this.publishFn(channel, wrappedMessage);
      this.emit('messageSent', message);
    } catch (error) {
      this.emit('error', { type: 'publish', error, message });
      throw error;
    }
  }

  /**
   * Subscribe to assignment channel
   */
  async subscribeToAssignments(handler: AssignmentHandler): Promise<void> {
    const channel = `agent:${this.agentId}:assignments`;
    const wrappedHandler: MessageHandler = async (message: any) => {
      // Extract payload from Message wrapper if present
      const assignment = message.payload || message;

      if (this.isValidAssignment(assignment)) {
        await handler(assignment as Assignment);
      }
    };

    await this.subscribe(channel, wrappedHandler);
  }

  /**
   * Subscribe to commands channel
   */
  async subscribeToCommands(handler: CommandHandler): Promise<void> {
    const channel = `agent:${this.agentId}:commands`;
    await this.subscribe(channel, handler);
  }

  /**
   * Request data from Hub (request-response pattern)
   */
  async requestFromHub(request: any): Promise<HubResponse> {
    const requestChannel = 'hub:requests';
    const responseChannel = `agent:${this.agentId}:responses`;

    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Hub request timeout'));
      }, 5000);

      // Subscribe to response
      const responseHandler = (response: any) => {
        clearTimeout(timeout);
        resolve(response as HubResponse);
      };

      await this.subscribe(responseChannel, responseHandler);

      // Send request
      try {
        await this.publishFn(requestChannel, {
          agentId: this.agentId,
          ...request,
        });
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * Subscribe to a channel
   */
  private async subscribe(channel: string, handler: MessageHandler): Promise<void> {
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, []);
      await this.subscribeFn(channel, async (message: any) => {
        const handlers = this.subscriptions.get(channel) || [];
        for (const h of handlers) {
          await h(message);
        }
      });
    }

    this.subscriptions.get(channel)!.push(handler);
  }

  /**
   * Unsubscribe from all channels
   */
  async unsubscribeAll(): Promise<void> {
    this.subscriptions.clear();
    this.emit('unsubscribed');
  }

  /**
   * Validate assignment message
   */
  private isValidAssignment(message: any): boolean {
    return (
      message &&
      typeof message === 'object' &&
      typeof message.prId === 'string' &&
      typeof message.assignedAt === 'number'
    );
  }
}
