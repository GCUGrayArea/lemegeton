/**
 * GitHub MCP Adapter
 *
 * Adapter for GitHub MCP server providing repository information,
 * README retrieval, issue search, and documentation access.
 */

import { BaseMCPAdapter } from './base';
import { MCPClient } from '../client';
import { GitHubRepository } from '../types';

/**
 * GitHub adapter for MCP
 */
export class GitHubAdapter extends BaseMCPAdapter {
  constructor(client: MCPClient) {
    super(client, 'github');
  }

  /**
   * Get repository information
   */
  async getRepository(owner: string, repo: string): Promise<GitHubRepository> {
    return await this.query<GitHubRepository>('getRepository', {
      owner,
      repo,
    });
  }

  /**
   * Get repository README
   */
  async getReadme(owner: string, repo: string): Promise<string> {
    return await this.query<string>('getReadme', {
      owner,
      repo,
    });
  }

  /**
   * Search issues
   */
  async searchIssues(
    owner: string,
    repo: string,
    query: string
  ): Promise<any[]> {
    return await this.query<any[]>('searchIssues', {
      owner,
      repo,
      query,
    });
  }

  /**
   * Get file content
   */
  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    branch?: string
  ): Promise<string> {
    return await this.query<string>('getFileContent', {
      owner,
      repo,
      path,
      branch: branch || 'main',
    });
  }

  /**
   * Get release notes
   */
  async getReleases(owner: string, repo: string): Promise<any[]> {
    return await this.query<any[]>('getReleases', {
      owner,
      repo,
    });
  }

  /**
   * Get latest release
   */
  async getLatestRelease(owner: string, repo: string): Promise<any> {
    return await this.query<any>('getLatestRelease', {
      owner,
      repo,
    });
  }

  /**
   * Search code
   */
  async searchCode(
    owner: string,
    repo: string,
    query: string
  ): Promise<any[]> {
    return await this.query<any[]>('searchCode', {
      owner,
      repo,
      query,
    });
  }

  /**
   * Get pull requests
   */
  async getPullRequests(
    owner: string,
    repo: string,
    state?: 'open' | 'closed' | 'all'
  ): Promise<any[]> {
    return await this.query<any[]>('getPullRequests', {
      owner,
      repo,
      state: state || 'open',
    });
  }

  /**
   * Get repository topics
   */
  async getTopics(owner: string, repo: string): Promise<string[]> {
    return await this.query<string[]>('getTopics', {
      owner,
      repo,
    });
  }

  /**
   * Get repository contributors
   */
  async getContributors(owner: string, repo: string): Promise<any[]> {
    return await this.query<any[]>('getContributors', {
      owner,
      repo,
    });
  }
}
