import { api } from '@convex/_generated/api';
import { getConvexClient } from './convex-client';

export async function listAgents(status?: string) {
  const convex = getConvexClient();
  const agentsApi = api as any;
  return await convex.query(agentsApi.agents.listAgents, { status });
}

