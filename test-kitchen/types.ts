import { LanguageModelUsage, LanguageModelV1 } from 'ai';

export type ZapdevModel = {
  name: string;
  model_slug: string;
  ai: LanguageModelV1;
  maxTokens: number;
};

export type ZapdevResult = {
  success: boolean;
  numDeploys: number;
  usage: LanguageModelUsage;
  files: Record<string, string>;
};
