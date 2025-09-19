import type { LanguageModelV1 } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { captureException } from '@sentry/remix';
import { logger } from 'zapdev-agent/utils/logger';
import type { ProviderType } from '~/lib/common/annotations';
import { getEnv } from '~/lib/.server/env';
// workaround for Vercel environment from
// https://github.com/vercel/ai/issues/199#issuecomment-1605245593
import { fetch } from '~/lib/.server/fetch';

export type ModelProvider = Exclude<ProviderType, 'Unknown'>;
type Provider = {
  maxTokens: number;
  model: LanguageModelV1;
  options?: Record<string, any>;
};

// OpenRouter model mappings for common model selections
export function modelForProvider(provider: ModelProvider, modelChoice: string | undefined) {
  if (modelChoice) {
    // Direct model choice - use as-is for OpenRouter format
    return modelChoice;
  }
  
  // Default model mappings based on legacy provider names (for backward compatibility)
  if (provider === 'OpenRouter') {
    return getEnv('OPENROUTER_MODEL') || 'anthropic/claude-3.5-sonnet';
  }
  
  // Fallback to Claude Sonnet
  return 'anthropic/claude-3.5-sonnet';
}

// Map model selections to OpenRouter format using ModelSelector mapping
export function mapModelSelectionToOpenRouter(modelChoice: string | undefined): string {
  if (!modelChoice) {
    return 'anthropic/claude-3.5-sonnet';
  }

  // Import from ModelSelector would create circular dependency, so duplicate the mapping here
  const modelMap: Record<string, string> = {
    'auto': 'anthropic/claude-3.5-sonnet',
    'claude-4-sonnet': 'anthropic/claude-3.5-sonnet',
    'claude-3-5-haiku': 'anthropic/claude-3.5-haiku',
    'gemini-2.5-pro': 'google/gemini-2.0-flash-exp',
    'gpt-4.1': 'openai/gpt-4-turbo',
    'gpt-4o': 'openai/gpt-4o',
    'grok-3-mini': 'x-ai/grok-beta',
    'gpt-4.1-mini': 'openai/gpt-4o-mini',
    
    // Legacy mappings for backward compatibility
    'claude-3-5-sonnet-20241022': 'anthropic/claude-3.5-sonnet',
    'claude-3-5-haiku-latest': 'anthropic/claude-3.5-haiku',
    'claude-sonnet-4-0': 'anthropic/claude-3.5-sonnet',
    'gpt-5': 'openai/gpt-4o',
    'gemini-pro': 'google/gemini-pro',
    'grok-2': 'x-ai/grok-beta',
  };

  return modelMap[modelChoice] || modelChoice;
}

function getMaxTokensForModel(model: string): number {
  // Set reasonable defaults based on model families
  if (model.includes('claude')) {
    return 8192; // Claude models typically support 8K tokens
  }
  if (model.includes('gpt-4')) {
    return 8192; // GPT-4 models
  }
  if (model.includes('gemini')) {
    return 8192; // Gemini models
  }
  if (model.includes('grok')) {
    return 8192; // Grok models
  }
  
  // Default fallback
  return 4096;
}

export function getProvider(
  userApiKey: string | undefined,
  modelProvider: ModelProvider,
  modelChoice: string | undefined,
): Provider {
  const model = mapModelSelectionToOpenRouter(modelForProvider(modelProvider, modelChoice));
  
  const openrouter = createOpenRouter({
    apiKey: userApiKey || getEnv('OPENROUTER_API_KEY'),
    fetch: userApiKey ? userKeyApiFetch('OpenRouter') : fetch,
  });

  const provider: Provider = {
    model: openrouter.chat(model),
    maxTokens: getMaxTokensForModel(model),
  };

  return provider;
}

const userKeyApiFetch = (provider: ModelProvider) => {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const result = await fetch(input, init);
    if (result.status === 401) {
      const text = await result.text();
      throw new Error(JSON.stringify({ error: 'Invalid API key', details: text }));
    }
    if (result.status === 413) {
      const text = await result.text();
      throw new Error(
        JSON.stringify({
          error: 'Request exceeds the maximum allowed number of bytes.',
          details: text,
        }),
      );
    }
    if (result.status === 429) {
      const text = await result.text();
      throw new Error(
        JSON.stringify({
          error: `${provider} is rate limiting your requests`,
          details: text,
        }),
      );
    }
    if (result.status === 529) {
      const text = await result.text();
      throw new Error(
        JSON.stringify({
          error: `${provider}'s API is temporarily overloaded`,
          details: text,
        }),
      );
    }
    if (!result.ok) {
      const text = await result.text();
      // Provide helpful error for OpenRouter
      let errorMessage = `${provider} returned an error (${result.status} ${result.statusText}) when using your provided API key: ${text}`;
      
      if (result.status === 402) {
        errorMessage = 'Insufficient credits on your OpenRouter account. Please add credits at https://openrouter.ai/credits';
      } else if (result.status === 400) {
        errorMessage = 'Invalid request to OpenRouter. Check your model selection and request format.';
      }
      
      throw new Error(
        JSON.stringify({
          error: errorMessage,
          details: text,
        }),
      );
    }
    return result;
  };
};