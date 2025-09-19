import { Combobox } from '@ui/Combobox';
import { MagicWandIcon } from '@radix-ui/react-icons';
import type { ModelSelection } from '~/utils/constants';
import React from 'react';
import { Tooltip } from '@ui/Tooltip';
import { HandThumbUpIcon, KeyIcon } from '@heroicons/react/24/outline';
import { useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import type { Doc } from '@convex/_generated/dataModel';
import { captureMessage } from '@sentry/remix';
import { useLaunchDarkly } from '~/lib/hooks/useLaunchDarkly';

export type ModelProvider = 'openrouter' | 'auto';

export function displayModelProviderName(provider: ModelProvider) {
  switch (provider) {
    case 'openrouter':
      return 'OpenRouter';
    case 'auto':
      return 'Auto';
    default: {
      const exhaustiveCheck: never = provider;
      throw new Error(`Unknown model provider: ${exhaustiveCheck}`);
    }
  }
}

function svgIcon(url: string) {
  return <img className="size-4" height="16" width="16" src={url} alt="" />;
}

export interface ModelSelectorProps {
  modelSelection: ModelSelection;
  setModelSelection: (modelSelection: ModelSelection) => void;
  size?: 'sm' | 'md';
}

const providerToIcon: Record<string, React.ReactNode> = {
  auto: <MagicWandIcon />,
  'anthropic/claude': svgIcon('/icons/claude.svg'),
  'openai/gpt': svgIcon('/icons/openai.svg'),
  'google/gemini': svgIcon('/icons/gemini.svg'),
  'x-ai/grok': (
    <svg width="16" height="16" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M395.479 633.828L735.91 381.105C752.599 368.715 776.454 373.548 784.406 392.792C826.26 494.285 807.561 616.253 724.288 699.996C641.016 783.739 525.151 802.104 419.247 760.277L303.556 814.143C469.49 928.202 670.987 899.995 796.901 773.282C896.776 672.843 927.708 535.937 898.785 412.476L899.047 412.739C857.105 231.37 909.358 158.874 1016.4 10.6326C1018.93 7.11771 1021.47 3.60279 1024 0L883.144 141.651V141.212L395.392 633.916"
        fill="currentColor"
      />
      <path
        d="M325.226 695.251C206.128 580.84 226.662 403.776 328.285 301.668C403.431 226.097 526.549 195.254 634.026 240.596L749.454 186.994C728.657 171.88 702.007 155.623 671.424 144.2C533.19 86.9942 367.693 115.465 255.323 228.382C147.234 337.081 113.244 504.215 171.613 646.833C215.216 753.423 143.739 828.818 71.7385 904.916C46.2237 931.893 20.6216 958.87 0 987.429L325.139 695.339"
        fill="currentColor"
      />
    </svg>
  ),
};

// OpenRouter models available through single API
export const models: Partial<
  Record<
    ModelSelection,
    {
      name: string;
      openRouterModel: string;
      recommended?: boolean;
      requireKey?: boolean;
      provider: ModelProvider;
      iconKey?: string;
    }
  >
> = {
  auto: {
    name: 'Auto (Claude 3.5 Sonnet)',
    openRouterModel: 'anthropic/claude-3.5-sonnet',
    recommended: true,
    provider: 'auto',
    iconKey: 'auto',
  },
  'claude-4-sonnet': {
    name: 'Claude 3.5 Sonnet',
    openRouterModel: 'anthropic/claude-3.5-sonnet',
    provider: 'openrouter',
    recommended: true,
    requireKey: false,
    iconKey: 'anthropic/claude',
  },
  'claude-3-5-haiku': {
    name: 'Claude 3.5 Haiku',
    openRouterModel: 'anthropic/claude-3.5-haiku',
    provider: 'openrouter',
    requireKey: false,
    iconKey: 'anthropic/claude',
  },
  'gemini-2.5-pro': {
    name: 'Gemini 2.0 Flash',
    openRouterModel: 'google/gemini-2.0-flash-exp',
    recommended: false,
    provider: 'openrouter',
    iconKey: 'google/gemini',
  },
  'gpt-4.1': {
    name: 'GPT-4 Turbo',
    openRouterModel: 'openai/gpt-4-turbo',
    provider: 'openrouter',
    iconKey: 'openai/gpt',
  },
  'gpt-4o': {
    name: 'GPT-4o',
    openRouterModel: 'openai/gpt-4o',
    provider: 'openrouter',
    iconKey: 'openai/gpt',
  },
  'grok-3-mini': {
    name: 'Grok Beta',
    openRouterModel: 'x-ai/grok-beta',
    provider: 'openrouter',
    iconKey: 'x-ai/grok',
  },
  'gpt-4.1-mini': {
    name: 'GPT-4o Mini',
    openRouterModel: 'openai/gpt-4o-mini',
    provider: 'openrouter',
    requireKey: false,
    iconKey: 'openai/gpt',
  },
} as const;

export const ModelSelector = React.memo(function ModelSelector({
  modelSelection,
  setModelSelection,
  size = 'md',
}: ModelSelectorProps) {
  const apiKey = useQuery(api.apiKeys.apiKeyForCurrentMember);
  const selectedModel = models[modelSelection];
  const { enableGpt5 } = useLaunchDarkly();
  
  if (!selectedModel) {
    captureMessage(`Model ${modelSelection} not found`);
    setModelSelection('auto');
  }

  const availableModels = Object.entries(models).filter(([key]) => {
    // Filter models based on feature flags if needed
    return true;
  });

  return (
    <Combobox
      searchPlaceholder="Search models..."
      label="Select model"
      options={availableModels.map(([value, model]) => ({
        label: model.name,
        value: value as ModelSelection,
      }))}
      buttonClasses="w-fit"
      size={size}
      selectedOption={modelSelection}
      setSelectedOption={(option) => {
        if (!option) {
          throw new Error('Model selection set to null');
        }

        setModelSelection(option);
      }}
      Option={({ value, inButton }) => {
        const model = models[value as ModelSelection];
        if (!model) {
          return null;
        }
        const prefersAlwaysUseApiKey = apiKey?.preference === 'always';
        const key = apiKey ? keyForProvider(apiKey, model.provider) : undefined;
        const canUseModel = !(model.requireKey && !key) && !(prefersAlwaysUseApiKey && !key);
        const iconKey = model.iconKey || model.provider;
        
        return (
          <div className={'flex items-center gap-2'}>
            {providerToIcon[iconKey]}
            <div className="max-w-48 truncate">{model?.name}</div>

            {!inButton && (
              <div className="ml-auto flex gap-1">
                {model.recommended && (
                  <Tooltip
                    tip="This model is recommended for most use cases. Other models may be more expensive or less accurate."
                    side="right"
                  >
                    <HandThumbUpIcon className="size-4 text-content-secondary" />
                  </Tooltip>
                )}
                {!canUseModel && (
                  <Tooltip
                    tip={
                      model.requireKey
                        ? 'You must set an OpenRouter API key to use this model.'
                        : 'Your preferences require an API key to be set to use this model. You may change your preferences or set an OpenRouter API key.'
                    }
                    side="right"
                  >
                    <KeyIcon className="size-4 text-content-secondary" />
                  </Tooltip>
                )}
              </div>
            )}
          </div>
        );
      }}
    />
  );
});

const keyForProvider = (apiKeys: Doc<'convexMembers'>['apiKey'], provider: ModelProvider) => {
  // All models now use OpenRouter, so check for OpenRouter API key
  if (provider === 'openrouter' || provider === 'auto') {
    return apiKeys?.openrouter || apiKeys?.value; // Support legacy 'value' field
  }
  return undefined;
};