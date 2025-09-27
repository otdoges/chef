import type { LanguageModelV1 } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { fetch } from '~/lib/.server/fetch';
import { getEnv } from '~/lib/.server/env';

export type GatewayProvider = {
  model: LanguageModelV1;
  maxTokens: number;
  options?: Record<string, unknown>;
};

export function getGatewayProvider(modelOverride?: string): GatewayProvider {
  const baseURL = getEnv('VERCEL_AI_GATEWAY_BASE_URL') || 'https://ai-gateway.vercel.sh/v1';
  const apiKey = getEnv('VERCEL_AI_GATEWAY_API_KEY');
  if (!apiKey) {
    throw new Error('Missing VERCEL_AI_GATEWAY_API_KEY');
  }
  const model = modelOverride || getEnv('AI_MODEL') || 'gpt-4.1-mini';

  const openai = createOpenAI({ apiKey, baseURL, fetch, compatibility: 'strict' });
  return {
    model: openai(model),
    maxTokens: 24576,
  };
}
