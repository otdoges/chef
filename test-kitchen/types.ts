import { LanguageModelUsage, LanguageModelV1 } from 'ai';

export type ZapDevModel = {
  name: string;
  model_slug: string;
  ai: LanguageModelV1;
  maxTokens: number;
};

export type ZapDevResult = {
  success: boolean;
  numDeploys: number;
  usage: LanguageModelUsage;
  files: Record<string, string>;
};
