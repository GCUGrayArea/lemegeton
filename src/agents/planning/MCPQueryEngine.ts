/**
 * MCP Query Engine
 *
 * Integrates with MCP servers to provide tech stack suggestions,
 * package information, and documentation lookups for planning.
 */

import { MCPClient } from '../../mcp/client';
import { GitHubAdapter } from '../../mcp/adapters/github';
import { NpmAdapter } from '../../mcp/adapters/npm';
import { Spec, TechStackSuggestion, TechOption } from './types';

/**
 * Queries MCP for tech stack decisions and documentation
 */
export class MCPQueryEngine {
  private github: GitHubAdapter | null = null;
  private npm: NpmAdapter | null = null;

  constructor(private mcp: MCPClient | null) {
    if (mcp) {
      this.github = new GitHubAdapter(mcp);
      this.npm = new NpmAdapter(mcp);
    }
  }

  /**
   * Get tech stack suggestions using MCP
   *
   * Queries npm for package info, GitHub for popular repos,
   * and generates suggestions for missing tech stack components.
   */
  async getTechStackSuggestions(
    spec: Spec,
    missing: string[]
  ): Promise<Map<string, TechStackSuggestion>> {
    const suggestions = new Map<string, TechStackSuggestion>();

    if (!this.mcp) {
      // MCP not available, return empty suggestions
      return suggestions;
    }

    for (const category of missing) {
      try {
        const suggestion = await this.getSuggestionForCategory(category, spec);
        if (suggestion) {
          suggestions.set(category, suggestion);
        }
      } catch (error) {
        // Log error but continue with other categories
        console.warn(`MCP query failed for ${category}:`, (error as Error).message);
      }
    }

    return suggestions;
  }

  /**
   * Get suggestion for specific category
   */
  private async getSuggestionForCategory(
    category: string,
    spec: Spec
  ): Promise<TechStackSuggestion | null> {
    switch (category) {
      case 'Language/Runtime':
        return this.getLanguageSuggestions(spec);
      case 'Web Framework':
        return this.getWebFrameworkSuggestions(spec);
      case 'Database':
        return this.getDatabaseSuggestions(spec);
      case 'Build Tools':
        return this.getBuildToolsSuggestions(spec);
      case 'Testing Framework':
        return this.getTestingFrameworkSuggestions(spec);
      case 'Deployment Target':
        return this.getDeploymentSuggestions(spec);
      default:
        return null;
    }
  }

  /**
   * Language/Runtime suggestions
   */
  private async getLanguageSuggestions(spec: Spec): Promise<TechStackSuggestion> {
    return {
      category: 'Language/Runtime',
      options: [
        {
          name: 'Node.js',
          description: 'JavaScript/TypeScript runtime built on V8',
          popularity: 'Most popular for web applications',
        },
        {
          name: 'Python',
          description: 'General-purpose language great for data and web',
          popularity: 'Popular for APIs and data processing',
        },
        {
          name: 'Rust',
          description: 'Systems language focused on safety and performance',
          popularity: 'Growing for performance-critical applications',
        },
        {
          name: 'Go',
          description: 'Statically typed language designed for scalability',
          popularity: 'Popular for backend services and CLIs',
        },
      ],
    };
  }

  /**
   * Web Framework suggestions (requires language context)
   */
  private async getWebFrameworkSuggestions(spec: Spec): Promise<TechStackSuggestion> {
    const language = spec.techStack?.language || '';
    const options: TechOption[] = [];

    if (language.includes('Node') || language.includes('JavaScript') || language.includes('TypeScript')) {
      // Node.js frameworks
      if (this.npm) {
        try {
          const reactInfo = await this.npm.getPackageInfo('react');
          const reactDownloads = typeof reactInfo.downloads === 'number' ? reactInfo.downloads : 0;
          options.push({
            name: 'React',
            description: 'Component-based UI library',
            popularity: reactDownloads > 0
              ? `${(reactDownloads / 1000000).toFixed(1)}M weekly downloads`
              : 'Most popular',
            latestVersion: reactInfo.version,
          });

          const nextInfo = await this.npm.getPackageInfo('next');
          const nextDownloads = typeof nextInfo.downloads === 'number' ? nextInfo.downloads : 0;
          options.push({
            name: 'Next.js',
            description: 'React framework with SSR and routing',
            popularity: nextDownloads > 0
              ? `${(nextDownloads / 1000000).toFixed(1)}M weekly downloads`
              : 'Very popular',
            latestVersion: nextInfo.version,
          });
        } catch {
          // Fallback if npm queries fail
          options.push(
            {
              name: 'React',
              description: 'Component-based UI library',
              popularity: 'Most popular',
            },
            {
              name: 'Next.js',
              description: 'React framework with SSR',
              popularity: 'Growing fast',
            }
          );
        }
      }

      options.push(
        {
          name: 'Vue',
          description: 'Progressive JavaScript framework',
          popularity: 'Popular alternative to React',
        },
        {
          name: 'Svelte',
          description: 'Compiler-based framework with no runtime',
          popularity: 'Emerging framework',
        }
      );
    } else if (language.includes('Python')) {
      options.push(
        {
          name: 'FastAPI',
          description: 'Modern Python web framework',
          popularity: 'Popular for APIs',
        },
        {
          name: 'Django',
          description: 'Full-featured web framework',
          popularity: 'Mature, batteries-included',
        },
        {
          name: 'Flask',
          description: 'Lightweight micro-framework',
          popularity: 'Simple and flexible',
        }
      );
    } else if (language.includes('Rust')) {
      options.push(
        {
          name: 'Actix',
          description: 'Powerful, pragmatic web framework',
          popularity: 'Most popular Rust framework',
        },
        {
          name: 'Rocket',
          description: 'Type-safe web framework',
          popularity: 'Developer-friendly',
        }
      );
    }

    return {
      category: 'Web Framework',
      options,
    };
  }

  /**
   * Database suggestions
   */
  private async getDatabaseSuggestions(spec: Spec): Promise<TechStackSuggestion> {
    return {
      category: 'Database',
      options: [
        {
          name: 'PostgreSQL',
          description: 'Powerful, open-source relational database',
          popularity: 'Industry standard for production apps',
        },
        {
          name: 'SQLite',
          description: 'Lightweight, serverless SQL database',
          popularity: 'Great for simple apps and development',
        },
        {
          name: 'MongoDB',
          description: 'Document-oriented NoSQL database',
          popularity: 'Popular for flexible schemas',
        },
        {
          name: 'Redis',
          description: 'In-memory data store',
          popularity: 'Great for caching and real-time',
        },
        {
          name: 'None',
          description: 'No database required',
          popularity: 'For stateless applications',
        },
      ],
    };
  }

  /**
   * Build Tools suggestions (based on language)
   */
  private async getBuildToolsSuggestions(spec: Spec): Promise<TechStackSuggestion> {
    const language = spec.techStack?.language || '';
    const options: TechOption[] = [];

    if (language.includes('Node')) {
      options.push(
        {
          name: 'Vite',
          description: 'Next-generation frontend tooling',
          popularity: 'Fast and modern',
        },
        {
          name: 'esbuild',
          description: 'Extremely fast bundler',
          popularity: 'Best performance',
        },
        {
          name: 'Webpack',
          description: 'Mature, flexible bundler',
          popularity: 'Industry standard',
        }
      );
    } else if (language.includes('Rust')) {
      options.push({
        name: 'cargo',
        description: 'Rust package manager and build tool',
        popularity: 'Standard Rust tooling',
      });
    } else if (language.includes('Go')) {
      options.push({
        name: 'go build',
        description: 'Native Go build tool',
        popularity: 'Standard Go tooling',
      });
    }

    return {
      category: 'Build Tools',
      options,
    };
  }

  /**
   * Testing Framework suggestions
   */
  private async getTestingFrameworkSuggestions(spec: Spec): Promise<TechStackSuggestion> {
    const language = spec.techStack?.language || '';
    const options: TechOption[] = [];

    if (language.includes('Node') || language.includes('JavaScript')) {
      options.push(
        {
          name: 'Jest',
          description: 'Delightful JavaScript testing',
          popularity: 'Most popular',
        },
        {
          name: 'Vitest',
          description: 'Blazing fast unit test framework',
          popularity: 'Modern, Vite-powered',
        }
      );
    } else if (language.includes('Python')) {
      options.push(
        {
          name: 'pytest',
          description: 'Feature-rich Python testing framework',
          popularity: 'Industry standard',
        },
        {
          name: 'unittest',
          description: 'Built-in Python testing framework',
          popularity: 'No dependencies',
        }
      );
    } else if (language.includes('Rust')) {
      options.push({
        name: 'cargo test',
        description: 'Built-in Rust testing',
        popularity: 'Standard Rust testing',
      });
    } else if (language.includes('Go')) {
      options.push({
        name: 'go test',
        description: 'Built-in Go testing',
        popularity: 'Standard Go testing',
      });
    }

    return {
      category: 'Testing Framework',
      options,
    };
  }

  /**
   * Deployment suggestions
   */
  private async getDeploymentSuggestions(spec: Spec): Promise<TechStackSuggestion> {
    return {
      category: 'Deployment Target',
      options: [
        {
          name: 'Docker',
          description: 'Containerized deployment',
          popularity: 'Most flexible',
        },
        {
          name: 'Vercel',
          description: 'Serverless platform for frontend',
          popularity: 'Great for Next.js/React',
        },
        {
          name: 'AWS',
          description: 'Full cloud platform',
          popularity: 'Enterprise standard',
        },
        {
          name: 'Native Binary',
          description: 'Compiled executable',
          popularity: 'For CLI tools',
        },
        {
          name: 'Self-hosted',
          description: 'Deploy on own servers',
          popularity: 'Full control',
        },
      ],
    };
  }
}
