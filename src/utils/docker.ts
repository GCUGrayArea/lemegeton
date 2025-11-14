/**
 * Docker utilities for Lemegeton
 *
 * This module provides cross-platform Docker detection and container
 * lifecycle management. It handles WSL2 vs native Docker on Windows,
 * port availability checking, and graceful fallbacks.
 */

import { exec, spawn, SpawnOptions } from 'child_process';
import { promisify } from 'util';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

const execAsync = promisify(exec);

/**
 * Docker container information
 */
export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string[];
}

/**
 * Docker availability result
 */
export interface DockerAvailability {
  available: boolean;
  version?: string;
  error?: string;
  platform?: string;
}

/**
 * Checks if Docker is available on the system
 */
export async function checkDockerAvailability(): Promise<DockerAvailability> {
  try {
    // Try to get Docker version
    const { stdout, stderr } = await execAsync('docker --version', {
      timeout: 5000,
      windowsHide: true,
    });

    if (stderr && !stdout) {
      return {
        available: false,
        error: stderr.trim(),
      };
    }

    // Parse version from output
    const versionMatch = stdout.match(/Docker version ([0-9.]+)/);
    const version = versionMatch ? versionMatch[1] : 'unknown';

    // Check if Docker daemon is running
    const { stdout: infoStdout } = await execAsync('docker info --format "{{.OSType}}"', {
      timeout: 5000,
      windowsHide: true,
    });

    return {
      available: true,
      version,
      platform: infoStdout.trim(),
    };

  } catch (error: any) {
    // Check specific error cases
    if (error.message?.includes('not found') || error.message?.includes('not recognized')) {
      return {
        available: false,
        error: 'Docker not installed',
      };
    }

    if (error.message?.includes('Cannot connect to the Docker daemon')) {
      return {
        available: false,
        error: 'Docker daemon not running',
      };
    }

    return {
      available: false,
      error: error.message || 'Unknown error checking Docker availability',
    };
  }
}

/**
 * Checks if a port is available
 */
export async function isPortAvailable(port: number, host: string = 'localhost'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        // Other errors, assume port is available
        resolve(true);
      }
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port, host);
  });
}

/**
 * Finds an available port starting from a given port
 */
export async function findAvailablePort(startPort: number, maxAttempts: number = 10): Promise<number | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  return null;
}

/**
 * Gets the Docker socket path for the current platform
 */
export function getDockerSocketPath(): string {
  const platform = os.platform();

  if (platform === 'win32') {
    // Check for WSL2
    if (process.env.WSL_DISTRO_NAME) {
      return '/var/run/docker.sock';
    }
    // Native Windows Docker Desktop
    return '//./pipe/docker_engine';
  }

  // Unix-like systems
  return '/var/run/docker.sock';
}

/**
 * Lists running Docker containers
 */
export async function listContainers(filters?: { name?: string; image?: string }): Promise<DockerContainer[]> {
  try {
    let command = 'docker ps --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}"';

    if (filters?.name) {
      command += ` --filter "name=${filters.name}"`;
    }
    if (filters?.image) {
      command += ` --filter "ancestor=${filters.image}"`;
    }

    const { stdout } = await execAsync(command, {
      timeout: 5000,
      windowsHide: true,
    });

    const lines = stdout.trim().split('\n').filter(line => line);
    return lines.map(line => {
      const [id, name, image, status, ports] = line.split('|');
      return {
        id,
        name,
        image,
        status,
        ports: ports ? ports.split(',') : [],
      };
    });

  } catch (error) {
    // Return empty array if Docker is not available
    return [];
  }
}

/**
 * Runs a Docker container
 */
export async function runContainer(options: {
  image: string;
  name?: string;
  ports?: { host: number; container: number }[];
  detached?: boolean;
  remove?: boolean;
  env?: Record<string, string>;
  volumes?: { host: string; container: string }[];
  command?: string[];
}): Promise<{ containerId: string; success: boolean; error?: string }> {
  try {
    const args = ['run'];

    // Add flags
    if (options.detached !== false) args.push('-d');
    if (options.remove) args.push('--rm');

    // Add name
    if (options.name) {
      args.push('--name', options.name);
    }

    // Add port mappings
    if (options.ports) {
      for (const port of options.ports) {
        args.push('-p', `${port.host}:${port.container}`);
      }
    }

    // Add environment variables
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    // Add volume mounts
    if (options.volumes) {
      for (const volume of options.volumes) {
        args.push('-v', `${volume.host}:${volume.container}`);
      }
    }

    // Add image
    args.push(options.image);

    // Add command
    if (options.command) {
      args.push(...options.command);
    }

    const { stdout, stderr } = await execAsync(`docker ${args.join(' ')}`, {
      timeout: 30000, // 30 seconds for pulling image if needed
      windowsHide: true,
    });

    const containerId = stdout.trim();

    return {
      containerId,
      success: true,
    };

  } catch (error: any) {
    return {
      containerId: '',
      success: false,
      error: error.message || 'Failed to run container',
    };
  }
}

/**
 * Stops a Docker container
 */
export async function stopContainer(containerIdOrName: string, timeout: number = 10): Promise<boolean> {
  try {
    await execAsync(`docker stop -t ${timeout} ${containerIdOrName}`, {
      timeout: (timeout + 5) * 1000,
      windowsHide: true,
    });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Removes a Docker container
 */
export async function removeContainer(containerIdOrName: string, force: boolean = false): Promise<boolean> {
  try {
    const forceFlag = force ? '-f' : '';
    await execAsync(`docker rm ${forceFlag} ${containerIdOrName}`, {
      timeout: 5000,
      windowsHide: true,
    });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Checks if a container is running
 */
export async function isContainerRunning(containerIdOrName: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      `docker inspect -f "{{.State.Running}}" ${containerIdOrName}`,
      {
        timeout: 5000,
        windowsHide: true,
      }
    );
    return stdout.trim() === 'true';
  } catch (error) {
    return false;
  }
}

/**
 * Gets container logs
 */
export async function getContainerLogs(
  containerIdOrName: string,
  lines: number = 50
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execAsync(
      `docker logs --tail ${lines} ${containerIdOrName}`,
      {
        timeout: 5000,
        windowsHide: true,
      }
    );
    return { stdout, stderr };
  } catch (error: any) {
    return { stdout: '', stderr: error.message || 'Failed to get logs' };
  }
}

/**
 * Waits for a container to be healthy or ready
 */
export async function waitForContainer(
  containerIdOrName: string,
  options: {
    timeout?: number;
    checkInterval?: number;
    healthCheck?: () => Promise<boolean>;
  } = {}
): Promise<boolean> {
  const timeout = options.timeout ?? 30000;
  const checkInterval = options.checkInterval ?? 1000;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    // Check if container is running
    if (!(await isContainerRunning(containerIdOrName))) {
      return false;
    }

    // Run custom health check if provided
    if (options.healthCheck) {
      try {
        if (await options.healthCheck()) {
          return true;
        }
      } catch (error) {
        // Continue waiting
      }
    } else {
      // Default: just check if container is running
      return true;
    }

    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }

  return false;
}

/**
 * Pulls a Docker image
 */
export async function pullImage(image: string): Promise<boolean> {
  try {
    await execAsync(`docker pull ${image}`, {
      timeout: 120000, // 2 minutes for pulling
      windowsHide: true,
    });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Checks if a Docker image exists locally
 */
export async function imageExists(image: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`docker images -q ${image}`, {
      timeout: 5000,
      windowsHide: true,
    });
    return stdout.trim().length > 0;
  } catch (error) {
    return false;
  }
}