import type { Doc } from '@convex/_generated/dataModel';
import { type ModelSelection } from '~/utils/constants';

export function hasApiKeySet(
  modelSelection: ModelSelection,
  useGeminiAuto: boolean, // Keep for backward compatibility but not used
  apiKey?: Doc<'convexMembers'>['apiKey'] | null,
) {
  if (!apiKey) {
    return false;
  }

  // All models now use OpenRouter, so check for OpenRouter API key
  return !!(apiKey.openrouter?.trim() || apiKey.value?.trim()); // Support legacy 'value' field
}

export function hasAnyApiKeySet(apiKey?: Doc<'convexMembers'>['apiKey'] | null) {
  if (!apiKey) {
    return false;
  }
  return Object.entries(apiKey).some(([key, value]) => {
    if (key === 'preference') {
      return false;
    }
    if (typeof value === 'string') {
      return value.trim() !== '';
    }
    return false;
  });
}