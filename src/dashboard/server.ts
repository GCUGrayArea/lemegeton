/**
 * Dashboard WebSocket Server
 *
 * Provides real-time updates to web clients by subscribing to Redis channels
 * and streaming state changes over WebSocket connections.
 */

import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { RedisClient } from '../redis/client';
import { RedisHealthChecker } from '../redis/health';
import { MessageBus } from '../communication/messageBus';
import { CoordinationModeManager } from '../core/coordinationMode';
import { getConfig } from '../config';
import * as path from 'path';

export interface DashboardServerConfig {
  port?: number;
  host?: string;
  staticPath?: string;
}

export interface ClientState {
  id: string;
  ws: WebSocket;
  subscriptions: Set<string>;
  connectedAt: number;
}

/**
 * Dashboard Server
 *
 * Serves the React frontend and provides WebSocket connections for real-time updates
 */
export class DashboardServer {
  private app: express.Application;
  private httpServer: ReturnType<typeof createServer>;
  private wss: WebSocketServer;
  private redisClient: RedisClient;
  private healthChecker: RedisHealthChecker | null = null;
  private messageBus: MessageBus | null = null;
  private modeManager: CoordinationModeManager | null = null;
  private clients: Map<string, ClientState> = new Map();
  private config: Required<DashboardServerConfig>;
  private updateInterval: NodeJS.Timeout | null = null;

  constructor(config: DashboardServerConfig = {}) {
    // Resolve static path relative to project root
    const defaultStaticPath = path.resolve(__dirname, '../../dashboard/dist');

    this.config = {
      port: config.port || 3000,
      host: config.host || 'localhost',
      staticPath: config.staticPath || defaultStaticPath,
    };

    // Setup Express
    this.app = express();
    this.httpServer = createServer(this.app);

    // Setup WebSocket server
    this.wss = new WebSocketServer({ server: this.httpServer });

    // Setup Redis
    this.redisClient = new RedisClient();

    this.setupRoutes();
    this.setupWebSocket();
  }

  /**
   * Setup HTTP routes
   */
  private setupRoutes(): void {
    // Serve static files (React build)
    this.app.use(express.static(this.config.staticPath));

    // Health check
    this.app.get('/api/health', (req: Request, res: Response) => {
      res.json({
        status: 'ok',
        redis: this.redisClient.isConnected(),
        clients: this.clients.size,
        uptime: process.uptime(),
      });
    });

    // API endpoint for initial state
    this.app.get('/api/state', async (req: Request, res: Response) => {
      try {
        const state = await this.getCurrentState();
        res.json(state);
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch state' });
      }
    });

    // SPA fallback - serve index.html for all other routes
    this.app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(this.config.staticPath, 'index.html'));
    });
  }

  /**
   * Setup WebSocket handlers
   */
  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      const clientId = this.generateClientId();
      const client: ClientState = {
        id: clientId,
        ws,
        subscriptions: new Set(),
        connectedAt: Date.now(),
      };

      this.clients.set(clientId, client);
      console.log(`[Dashboard] Client connected: ${clientId} (total: ${this.clients.size})`);

      // Send initial state
      this.sendInitialState(client).catch((error: Error) => {
        console.error('[Dashboard] Failed to send initial state:', error);
      });

      // Handle messages from client
      ws.on('message', (data: Buffer) => {
        this.handleClientMessage(client, data).catch((error: Error) => {
          console.error('[Dashboard] Error handling client message:', error);
        });
      });

      // Handle client disconnect
      ws.on('close', () => {
        this.clients.delete(clientId);
        console.log(`[Dashboard] Client disconnected: ${clientId} (total: ${this.clients.size})`);
      });

      // Handle errors
      ws.on('error', (error: Error) => {
        console.error(`[Dashboard] Client error (${clientId}):`, error);
      });
    });
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    try {
      // Connect to Redis
      await this.redisClient.connect();
      console.log('[Dashboard] Connected to Redis');

      // Create health checker and mode manager
      try {
        this.healthChecker = new RedisHealthChecker(this.redisClient);
        this.modeManager = new CoordinationModeManager(
          this.redisClient,
          this.healthChecker
        );
        await this.modeManager.start();
      } catch (error) {
        console.warn('[Dashboard] Running without coordination mode manager:', error);
      }

      // Create message bus
      this.messageBus = new MessageBus(this.redisClient, this.modeManager!, {});
      await this.messageBus.start();

      // Subscribe to relevant channels
      await this.subscribeToChannels();

      // Start periodic state updates
      this.startPeriodicUpdates();

      // Start HTTP server
      await new Promise<void>((resolve) => {
        this.httpServer.listen(this.config.port, this.config.host, () => {
          console.log(`[Dashboard] Server running at http://${this.config.host}:${this.config.port}`);
          resolve();
        });
      });
    } catch (error) {
      console.error('[Dashboard] Failed to start:', error);
      throw error;
    }
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    // Stop periodic updates
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    // Close all client connections
    this.clients.forEach((client) => {
      client.ws.close();
    });
    this.clients.clear();

    // Close WebSocket server
    this.wss.close();

    // Stop mode manager
    if (this.modeManager) {
      await this.modeManager.stop();
    }

    // Stop message bus
    if (this.messageBus) {
      await this.messageBus.stop();
    }

    // Disconnect Redis
    await this.redisClient.disconnect();

    // Close HTTP server
    await new Promise<void>((resolve) => {
      this.httpServer.close(() => resolve());
    });

    console.log('[Dashboard] Server stopped');
  }

  /**
   * Subscribe to Redis channels for updates
   */
  private async subscribeToChannels(): Promise<void> {
    if (!this.messageBus) return;

    // Subscribe to hub broadcasts
    await this.messageBus.subscribe('hub-broadcast', (message) => {
      this.broadcastToClients({
        type: 'hub-message',
        data: message,
      });
    });

    // Subscribe to TUI updates (if available)
    await this.messageBus.subscribe('tui-updates', (message) => {
      this.broadcastToClients({
        type: 'tui-update',
        data: message,
      });
    });

    // Subscribe to agent updates
    await this.redisClient.pSubscribe('agent:*', (channel: string, message: string) => {
      try {
        const data = JSON.parse(message);
        this.broadcastToClients({
          type: 'agent-update',
          channel,
          data,
        });
      } catch (error) {
        console.error('[Dashboard] Failed to parse agent update:', error);
      }
    });

    console.log('[Dashboard] Subscribed to Redis channels');
  }

  /**
   * Start periodic state updates
   */
  private startPeriodicUpdates(): void {
    // Send full state update every 5 seconds
    this.updateInterval = setInterval(() => {
      this.broadcastStateUpdate().catch((error: Error) => {
        console.error('[Dashboard] Failed to broadcast state update:', error);
      });
    }, 5000);
  }

  /**
   * Get current system state
   */
  private async getCurrentState(): Promise<any> {
    try {
      const client = this.redisClient.getClient();

      // Get coordination mode
      const mode = this.modeManager?.getMode() || 'UNKNOWN';

      // Get agent registry
      const agentsData = await client.get('agents:registry');
      const agents = agentsData ? JSON.parse(agentsData) : {};

      // Get active PRs
      const prsData = await client.get('state:prs');
      const prs = prsData ? JSON.parse(prsData) : {};

      // Get message bus stats
      const messageBusStats = this.messageBus?.getStats() || null;

      return {
        timestamp: Date.now(),
        mode,
        redis: {
          connected: this.redisClient.isConnected(),
          state: this.redisClient.getState(),
        },
        agents: {
          active: Object.keys(agents).length,
          details: agents,
        },
        prs: {
          total: Object.keys(prs).length,
          details: prs,
        },
        messageBus: messageBusStats,
      };
    } catch (error) {
      console.error('[Dashboard] Error getting current state:', error);
      return {
        timestamp: Date.now(),
        mode: 'ERROR',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Send initial state to newly connected client
   */
  private async sendInitialState(client: ClientState): Promise<void> {
    const state = await this.getCurrentState();
    this.sendToClient(client, {
      type: 'initial-state',
      data: state,
    });
  }

  /**
   * Broadcast state update to all clients
   */
  private async broadcastStateUpdate(): Promise<void> {
    const state = await this.getCurrentState();
    this.broadcastToClients({
      type: 'state-update',
      data: state,
    });
  }

  /**
   * Handle message from client
   */
  private async handleClientMessage(client: ClientState, data: Buffer): Promise<void> {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'ping':
          this.sendToClient(client, { type: 'pong' });
          break;

        case 'subscribe':
          // Add custom subscription handling if needed
          client.subscriptions.add(message.channel);
          this.sendToClient(client, {
            type: 'subscribed',
            channel: message.channel,
          });
          break;

        case 'unsubscribe':
          client.subscriptions.delete(message.channel);
          this.sendToClient(client, {
            type: 'unsubscribed',
            channel: message.channel,
          });
          break;

        case 'get-state':
          const state = await this.getCurrentState();
          this.sendToClient(client, {
            type: 'state',
            data: state,
          });
          break;

        default:
          console.warn(`[Dashboard] Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('[Dashboard] Error handling client message:', error);
      this.sendToClient(client, {
        type: 'error',
        error: 'Failed to process message',
      });
    }
  }

  /**
   * Send message to specific client
   */
  private sendToClient(client: ClientState, message: any): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast message to all connected clients
   */
  private broadcastToClients(message: any): void {
    const payload = JSON.stringify(message);
    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
      }
    });
  }

  /**
   * Generate unique client ID
   */
  private generateClientId(): string {
    return `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get server stats
   */
  getStats() {
    return {
      clients: this.clients.size,
      redis: this.redisClient.getState(),
      uptime: process.uptime(),
    };
  }
}
