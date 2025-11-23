/**
 * Anthropic LLM Client
 *
 * Wrapper for Anthropic's API to generate completions.
 */

import { LLMClient, LLMRequest, LLMResponse, LLMMessage } from './types';

export interface AnthropicClientConfig {
  apiKey?: string;
  oauthToken?: string;
  baseURL?: string;
}

export class AnthropicClient implements LLMClient {
  private apiKey?: string;
  private oauthToken?: string;
  private baseURL: string;

  constructor(config: AnthropicClientConfig) {
    this.apiKey = config.apiKey;
    this.oauthToken = config.oauthToken;
    this.baseURL = config.baseURL || 'https://api.anthropic.com/v1';

    // Must have either API key or OAuth token
    if (!this.apiKey && !this.oauthToken) {
      throw new Error('AnthropicClient requires either apiKey or oauthToken');
    }
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const messages = request.messages.map(msg => ({
      role: msg.role === 'system' ? 'user' : msg.role,
      content: msg.content,
    }));

    const body: any = {
      model: request.model,
      messages,
      max_tokens: request.maxTokens || 4096,
    };

    if (request.system) {
      body.system = request.system;
    }

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    if (request.stopSequences) {
      body.stop_sequences = request.stopSequences;
    }

    // Build headers based on auth type
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };

    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    } else if (this.oauthToken) {
      headers['authorization'] = `Bearer ${this.oauthToken}`;
    }

    const response = await fetch(`${this.baseURL}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${error}`);
    }

    const data: any = await response.json();

    return {
      content: data.content[0].text,
      model: data.model,
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
      stopReason: data.stop_reason,
    };
  }
}
