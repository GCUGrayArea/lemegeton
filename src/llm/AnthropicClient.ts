/**
 * Anthropic LLM Client
 *
 * Wrapper for Anthropic's API to generate completions.
 */

import { LLMClient, LLMRequest, LLMResponse, LLMMessage } from './types';

export interface AnthropicClientConfig {
  apiKey: string;
  baseURL?: string;
}

/**
 * Anthropic API request payload
 */
interface AnthropicAPIRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens: number;
  system?: string;
  temperature?: number;
  stop_sequences?: string[];
}

/**
 * Anthropic API response structure
 */
interface AnthropicAPIResponse {
  content: Array<{ text: string; type: string }>;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  stop_reason: string;
}

export class AnthropicClient implements LLMClient {
  private apiKey: string;
  private baseURL: string;

  constructor(config: AnthropicClientConfig) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL || 'https://api.anthropic.com/v1';
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const messages = request.messages.map(msg => ({
      role: msg.role === 'system' ? 'user' : msg.role,
      content: msg.content,
    }));

    const body: AnthropicAPIRequest = {
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

    const response = await fetch(`${this.baseURL}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${error}`);
    }

    const data: AnthropicAPIResponse = await response.json();

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
