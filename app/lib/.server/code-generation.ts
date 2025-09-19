import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { getConvexClient } from './convex-client';
import { AICodeEngine, type CodeGenerationRequest } from './services';

export async function enqueueCodeGeneration(request: CodeGenerationRequest) {
  const engine = AICodeEngine.default();
  const artifacts = await engine.generate(request);
  const convex = getConvexClient();

  const taskQueueApi = api as any;

  await convex.mutation(taskQueueApi.taskQueue.enqueueTask, {
    type: 'code-generation',
    payload: {
      issueId: request.issueId,
      language: request.language,
      artifacts,
    },
  });

  return artifacts;
}

export async function attachGenerationResults(taskId: Id<'taskQueue'>, summary: string) {
  const convex = getConvexClient();
  const taskQueueApi = api as any;

  await convex.mutation(taskQueueApi.taskQueue.markTaskCompleted, {
    taskId,
    resultSummary: summary,
  });
}
