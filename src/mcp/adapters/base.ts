/**
 * Base MCP Adapter
 *
 * Abstract base class for MCP server adapters.
 */

import { MCPClient } from '../client';
import { MCPRequest, MCPResponse } from '../types';

/**
 * Base adapter for MCP servers
 */
export abstract class BaseMCPAdapter {
  protected client: MCPClient;
  protected serverName: string;

  constructor(client: MCPClient, serverName: string) {
    this.client = client;
    this.serverName = serverName;
  }

  /**
   * Make a request to the MCP server
   */
  protected async query<T = any>(
    tool: string,
    parameters: Record<string, any>
  ): Promise<T> {
    const request: MCPRequest = {
      tool: `${this.serverName}.${tool}`,
      parameters,
    };

    const response = await this.client.query<T>(request);

    if (response.error) {
      throw new Error(
        `${this.serverName} query failed: ${response.error.message}`
      );
    }

    return response.content;
  }

  /**
   * Check if server is available
   */
  protected isAvailable(): boolean {
    const health = this.client.getServerHealth(this.serverName);
    return health?.available || false;
  }

  /**
   * Get server name
   */
  getServerName(): string {
    return this.serverName;
  }
}
