/**
 * Cost Adapter Factory
 *
 * Creates the appropriate cost adapter based on provider configuration.
 */

import { CostAdapter, LLMProvider, ModelPricing } from '../types/cost';
import { AnthropicAdapter } from './adapters/AnthropicAdapter';
import { OpenAIAdapter } from './adapters/OpenAIAdapter';
import { SelfHostedAdapter } from './adapters/SelfHostedAdapter';

export class AdapterFactory {
  /**
   * Create cost adapter for the specified provider
   */
  static createAdapter(
    provider: LLMProvider,
    customPricing?: ModelPricing
  ): CostAdapter {
    switch (provider) {
      case 'anthropic':
        return new AnthropicAdapter(customPricing);

      case 'openai':
        return new OpenAIAdapter(customPricing);

      case 'self-hosted':
      case 'opencode':
        return new SelfHostedAdapter(provider);

      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }
}
