/**
 * LLM Client Types
 *
 * Abstractions for interacting with LLM APIs (Anthropic, OpenAI, etc.)
 */

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMRequest {
  model: string;
  messages: LLMMessage[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

export interface LLMResponse {
  content: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  stopReason?: 'end_turn' | 'max_tokens' | 'stop_sequence';
}

export interface LLMClient {
  generate(request: LLMRequest): Promise<LLMResponse>;
  streamGenerate?(request: LLMRequest): AsyncIterableIterator<string>;
}
