import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { getConvexClient } from './convex-client';
import { E2BSandboxClient, type SandboxExecutionRequest, type SandboxExecutionResult } from './services';

type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

type EnqueueTaskInput = {
  type: string;
  payload: unknown;
  priority?: number;
  scheduledFor?: number;
};

export async function enqueueTask(input: EnqueueTaskInput) {
  const convex = getConvexClient();
  const taskQueueApi = api as any;
  return await convex.mutation(taskQueueApi.taskQueue.enqueueTask, input);
}

export async function listActiveTasks(type?: string) {
  const convex = getConvexClient();
  const taskQueueApi = api as any;
  return await convex.query(taskQueueApi.taskQueue.listActiveTasks, { type });
}

export async function markTaskRunning(taskId: Id<'taskQueue'>) {
  const convex = getConvexClient();
  const taskQueueApi = api as any;
  await convex.mutation(taskQueueApi.taskQueue.markTaskRunning, { taskId });
}

export async function markTaskCompleted(taskId: Id<'taskQueue'>, resultSummary?: string) {
  const convex = getConvexClient();
  const taskQueueApi = api as any;
  await convex.mutation(taskQueueApi.taskQueue.markTaskCompleted, { taskId, resultSummary });
}

export async function markTaskFailed(taskId: Id<'taskQueue'>, error: string) {
  const convex = getConvexClient();
  const taskQueueApi = api as any;
  await convex.mutation(taskQueueApi.taskQueue.markTaskFailed, { taskId, error });
}

export type TaskQueueRecord = {
  _id: Id<'taskQueue'>;
  type: string;
  status: TaskStatus;
  priority?: number;
  attempts: number;
  scheduledFor?: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  resultSummary?: string;
  lastError?: string;
};

export async function executeSandboxRun(request: SandboxExecutionRequest): Promise<SandboxExecutionResult> {
  const client = E2BSandboxClient.fromEnv();
  return await client.execute(request);
}
