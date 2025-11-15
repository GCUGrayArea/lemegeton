/**
 * npm MCP Adapter
 *
 * Adapter for npm MCP server providing package information,
 * version lookup, dependency trees, and documentation links.
 */

import { BaseMCPAdapter } from './base';
import { MCPClient } from '../client';
import { NpmPackage, NpmVersions } from '../types';

/**
 * npm adapter for MCP
 */
export class NpmAdapter extends BaseMCPAdapter {
  constructor(client: MCPClient) {
    super(client, 'npm');
  }

  /**
   * Get package information
   */
  async getPackageInfo(packageName: string): Promise<NpmPackage> {
    return await this.query<NpmPackage>('getPackageInfo', {
      package: packageName,
    });
  }

  /**
   * Get package versions
   */
  async getVersions(packageName: string): Promise<NpmVersions> {
    return await this.query<NpmVersions>('getVersions', {
      package: packageName,
    });
  }

  /**
   * Get latest version
   */
  async getLatestVersion(packageName: string): Promise<string> {
    const versions = await this.getVersions(packageName);
    return versions.latest;
  }

  /**
   * Get package dependencies
   */
  async getDependencies(
    packageName: string,
    version?: string
  ): Promise<Record<string, string>> {
    return await this.query<Record<string, string>>('getDependencies', {
      package: packageName,
      version: version || 'latest',
    });
  }

  /**
   * Get dependency tree
   */
  async getDependencyTree(
    packageName: string,
    version?: string,
    depth?: number
  ): Promise<any> {
    return await this.query('getDependencyTree', {
      package: packageName,
      version: version || 'latest',
      depth: depth || 1,
    });
  }

  /**
   * Search packages
   */
  async searchPackages(query: string, limit?: number): Promise<any[]> {
    return await this.query<any[]>('searchPackages', {
      query,
      limit: limit || 20,
    });
  }

  /**
   * Get package README
   */
  async getReadme(packageName: string, version?: string): Promise<string> {
    return await this.query<string>('getReadme', {
      package: packageName,
      version: version || 'latest',
    });
  }

  /**
   * Get package downloads
   */
  async getDownloads(packageName: string): Promise<{
    weekly: number;
    monthly: number;
    yearly: number;
  }> {
    return await this.query('getDownloads', {
      package: packageName,
    });
  }

  /**
   * Get package maintainers
   */
  async getMaintainers(packageName: string): Promise<any[]> {
    return await this.query<any[]>('getMaintainers', {
      package: packageName,
    });
  }

  /**
   * Get package repository info
   */
  async getRepository(packageName: string): Promise<{
    type: string;
    url: string;
  } | null> {
    return await this.query('getRepository', {
      package: packageName,
    });
  }

  /**
   * Get package keywords
   */
  async getKeywords(packageName: string): Promise<string[]> {
    return await this.query<string[]>('getKeywords', {
      package: packageName,
    });
  }

  /**
   * Check if package exists
   */
  async exists(packageName: string): Promise<boolean> {
    try {
      await this.getPackageInfo(packageName);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Compare versions
   */
  async compareVersions(
    packageName: string,
    version1: string,
    version2: string
  ): Promise<{
    newer: string;
    older: string;
    major: boolean;
    minor: boolean;
    patch: boolean;
  }> {
    return await this.query('compareVersions', {
      package: packageName,
      version1,
      version2,
    });
  }
}
