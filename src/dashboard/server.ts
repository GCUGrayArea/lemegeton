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
  private redisClient: RedisClient | null = null;
  private clients: Map<string, ClientState> = new Map();
  private config: Required<DashboardServerConfig>;
  private updateInterval: NodeJS.Timeout | null = null;
  private isRedisConnected = false;

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
        redis: this.isRedisConnected,
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
      // Try to connect to Redis (optional)
      try {
        this.redisClient = new RedisClient();
        await this.redisClient.connect();
        this.isRedisConnected = true;
        console.log('[Dashboard] Connected to Redis');

        // Subscribe to Redis channels for live updates
        await this.subscribeToRedisChannels();
      } catch (error) {
        console.warn('[Dashboard] Running without Redis connection:', error);
        console.warn('[Dashboard] Dashboard will work but without live data from hub');
        this.isRedisConnected = false;
      }

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

    // Disconnect Redis
    if (this.redisClient) {
      await this.redisClient.disconnect();
    }

    // Close HTTP server
    await new Promise<void>((resolve) => {
      this.httpServer.close(() => resolve());
    });

    console.log('[Dashboard] Server stopped');
  }

  /**
   * Subscribe to Redis channels for updates
   */
  private async subscribeToRedisChannels(): Promise<void> {
    if (!this.redisClient || !this.isRedisConnected) return;

    try {
      // Subscribe to hub broadcasts
      await this.redisClient.subscribe('hub-broadcast', (message: string) => {
        try {
          const data = JSON.parse(message);
          this.broadcastToClients({
            type: 'hub-message',
            data,
          });
        } catch (error) {
          console.error('[Dashboard] Failed to parse hub message:', error);
        }
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
    } catch (error) {
      console.error('[Dashboard] Failed to subscribe to channels:', error);
    }
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
      if (!this.redisClient || !this.isRedisConnected) {
        return {
          timestamp: Date.now(),
          mode: 'DISCONNECTED',
          redis: {
            connected: false,
            state: 'disconnected',
          },
          agents: {
            active: 0,
            details: {},
          },
          prs: {
            total: 0,
            details: {},
          },
        };
      }

      const client = this.redisClient.getClient();

      // Get agent registry
      const agentsData = await client.get('agents:registry');
      const agents = agentsData ? JSON.parse(agentsData) : {};

      // Get active PRs
      const prsData = await client.get('state:prs');
      const prs = prsData ? JSON.parse(prsData) : {};

      // Get coordination mode
      const modeData = await client.get('coordination:mode');
      const mode = modeData || 'UNKNOWN';

      return {
        timestamp: Date.now(),
        mode,
        redis: {
          connected: true,
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
      };
    } catch (error) {
      console.error('[Dashboard] Error getting current state:', error);
      return {
        timestamp: Date.now(),
        mode: 'ERROR',
        redis: {
          connected: false,
          state: 'error',
        },
        error: error instanceof Error ? error.message : 'Unknown error',
        agents: { active: 0, details: {} },
        prs: { total: 0, details: {} },
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
      redis: this.isRedisConnected ? 'connected' : 'disconnected',
      uptime: process.uptime(),
    };
  }
}
