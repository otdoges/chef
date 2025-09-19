import { api, internal } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { getConvexClient } from './convex-client';
import { GitHubService, type GitHubRepoRef } from './services';

export async function getTriagedIssues(params: { status?: string; limit?: number } = {}) {
  const convex = getConvexClient();
  const issuesApi = api as any;
  return await convex.query(issuesApi.issues.listTriagedIssues, params);
}

export async function assignIssue(issueId: Id<'issues'>, agentId: Id<'aiAgents'>) {
  const convex = getConvexClient();
  const issuesApi = api as any;
  return await convex.mutation(issuesApi.issues.assignIssue, { issueId, agentId });
}

export async function updatePriority(issueId: Id<'issues'>, priorityScore: number, priorityReason?: string) {
  const convex = getConvexClient();
  const issuesApi = api as any;
  await convex.mutation(issuesApi.issues.updatePriorityScore, {
    issueId,
    priorityScore,
    priorityReason,
  });
}

export async function refreshIssueFromGitHub(repo: GitHubRepoRef, issueNumber: number) {
  const github = GitHubService.fromEnv();
  const issue = await github.fetchIssue(repo, issueNumber);
  if (!issue) {
    console.warn('GitHub returned no data for issue', repo, issueNumber);
    return null;
  }

  const convex = getConvexClient();
  const issuesApi = internal as any;
  await convex.mutation(issuesApi.issues.ingestGithubIssue, {
    issue: {
      repoId: `${repo.owner}/${repo.name}`,
      repoFullName: `${repo.owner}/${repo.name}`,
      githubIssueId: issue.id,
      issueNumber: issue.number,
      title: issue.title,
      body: undefined,
      labels: issue.labels,
      severity: undefined,
      priorityHint: undefined,
      status: issue.state === 'open' ? 'triaged' : 'closed',
      assignedLogin: undefined,
      githubUpdatedAt: Date.now(),
    },
  });

  return issue;
}
