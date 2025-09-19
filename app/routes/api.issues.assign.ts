import { json } from '@vercel/remix';
import type { ActionFunctionArgs } from '@vercel/remix';
import type { Id } from '@convex/_generated/dataModel';
import { assignIssue } from '~/lib/.server/issues';

export async function action({ request }: ActionFunctionArgs) {
  const payload = await request.json();
  const issueId = payload.issueId as Id<'issues'> | undefined;
  const agentId = payload.agentId as Id<'aiAgents'> | undefined;

  if (!issueId || !agentId) {
    return json({ error: 'issueId and agentId are required' }, { status: 400 });
  }

  const result = await assignIssue(issueId, agentId);
  return json({ success: true, result });
}

