import { json } from '@vercel/remix';
import type { LoaderFunctionArgs, MetaFunction } from '@vercel/remix';
import { useLoaderData } from '@remix-run/react';
import { getTriagedIssues } from '~/lib/.server/issues';
import { listActiveTasks } from '~/lib/.server/tasks';
import { listAgents } from '~/lib/.server/agents';

export const meta: MetaFunction = () => [
  { title: 'Scout Dashboard | Chef by Convex' },
  { name: 'description', content: 'Real-time view of Scout.ai triage, task queue, and agent activity.' },
];

export async function loader(_args: LoaderFunctionArgs) {
  const [issues, tasks, agents] = await Promise.all([
    getTriagedIssues({ limit: 10 }),
    listActiveTasks(),
    listAgents(),
  ]);

  return json({ issues, tasks, agents });
}

export default function ScoutDashboardRoute() {
  const { issues, tasks, agents } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-8 p-6">
      <section className="rounded-md border border-border-subtle bg-surface-primary p-4 shadow-sm">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Active Issues</h2>
          <span className="text-sm text-content-secondary">{issues.length} triaged</span>
        </header>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border-subtle text-sm">
            <thead className="text-left text-content-secondary">
              <tr>
                <th className="px-3 py-2 font-medium">Issue</th>
                <th className="px-3 py-2 font-medium">Priority</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Assignee</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {issues.map((issue) => (
                <tr key={issue._id}>
                  <td className="px-3 py-2">
                    <div className="font-medium">#{issue.issueNumber}</div>
                    <div className="text-content-secondary">{issue.title}</div>
                  </td>
                  <td className="px-3 py-2">{issue.priorityScore ?? '—'}</td>
                  <td className="px-3 py-2">{issue.status}</td>
                  <td className="px-3 py-2">{issue.assignedAgentId ?? 'Unassigned'}</td>
                </tr>
              ))}
              {issues.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-content-secondary">
                    No issues triaged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-md border border-border-subtle bg-surface-primary p-4 shadow-sm">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Task Queue</h2>
          <span className="text-sm text-content-secondary">{tasks.length} active</span>
        </header>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border-subtle text-sm">
            <thead className="text-left text-content-secondary">
              <tr>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Attempts</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {tasks.map((task) => (
                <tr key={task._id}>
                  <td className="px-3 py-2">{task.type}</td>
                  <td className="px-3 py-2">{task.status}</td>
                  <td className="px-3 py-2">{task.attempts}</td>
                  <td className="px-3 py-2">{new Date(task.createdAt).toLocaleTimeString()}</td>
                </tr>
              ))}
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-content-secondary">
                    No active tasks in the queue.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-md border border-border-subtle bg-surface-primary p-4 shadow-sm">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Agents</h2>
          <span className="text-sm text-content-secondary">{agents.length} registered</span>
        </header>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <article key={agent._id} className="rounded border border-border-subtle p-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-medium">{agent.name}</h3>
                <span className="rounded bg-surface-secondary px-2 py-0.5 text-xs uppercase tracking-wide">
                  {agent.status}
                </span>
              </div>
              <p className="mt-1 text-sm text-content-secondary">{agent.kind === 'ai' ? 'AI Agent' : 'Human'}</p>
              <p className="mt-2 text-xs text-content-secondary">Capabilities: {agent.capabilities.join(', ') || '—'}</p>
            </article>
          ))}
          {agents.length === 0 && (
            <div className="text-center text-content-secondary">No agents registered.</div>
          )}
        </div>
      </section>
    </div>
  );
}

