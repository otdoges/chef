import { getEnv } from '../env';

export type SandboxRuntime = 'node' | 'python' | 'go' | 'rust';

export type SandboxExecutionRequest = {
  runtime: SandboxRuntime;
  files: Record<string, string>;
  command: string;
  timeoutMs?: number;
};

export type SandboxExecutionResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTimeMs: number;
};

export class E2BSandboxClient {
  constructor(private readonly apiKey: string) {}

  static fromEnv(): E2BSandboxClient {
    const key = getEnv('E2B_API_KEY');
    if (!key) {
      throw new Error('Missing E2B_API_KEY environment variable');
    }
    return new E2BSandboxClient(key);
  }

  async execute(_request: SandboxExecutionRequest): Promise<SandboxExecutionResult> {
    console.warn('E2BSandboxClient.execute is not yet implemented');
    return {
      stdout: 'sandbox execution stub output',
      stderr: '',
      exitCode: 0,
      executionTimeMs: 0,
    };
  }
}

