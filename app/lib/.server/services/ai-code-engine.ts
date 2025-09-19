import type { Id } from '@convex/_generated/dataModel';

export type CodeGenerationRequest = {
  issueId: Id<'issues'>;
  language: string;
  instructions: string;
  testStrategy?: 'unit' | 'integration' | 'e2e';
};

export type CodeGenerationArtifacts = {
  code: string;
  tests?: string;
  documentation?: string;
  model: string;
};

export class AICodeEngine {
  constructor(private readonly model: string) {}

  static default(): AICodeEngine {
    return new AICodeEngine('anthropic/claude-3-7-sonnet');
  }

  async generate(request: CodeGenerationRequest): Promise<CodeGenerationArtifacts> {
    console.warn('AICodeEngine.generate is not yet implemented', request);
    return {
      code: '// TODO: generated code placeholder',
      tests: '// TODO: generated tests placeholder',
      documentation: 'Generated documentation placeholder',
      model: this.model,
    };
  }
}

