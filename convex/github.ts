import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

export const handleWebhook = internalAction({
  args: {
    event: v.string(),
    deliveryId: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const { event, payload } = args;

    if (event === "issues" && payload?.action && payload.issue) {
      const issue = payload.issue;
      await ctx.runMutation(internal.issues.ingestGithubIssue, {
        issue: {
          repoId: payload.repository?.node_id ?? payload.repository?.id?.toString?.() ?? "",
          repoFullName: payload.repository?.full_name ?? "",
          githubIssueId: issue.node_id ?? String(issue.id),
          issueNumber: issue.number,
          title: issue.title,
          body: issue.body,
          labels: (issue.labels ?? []).map((label: any) => label.name).filter(Boolean),
          severity: inferSeverity(issue),
          priorityHint: undefined,
          status: inferStatus(payload.action),
          assignedLogin: issue.assignee?.login,
          githubUpdatedAt: new Date(issue.updated_at ?? Date.now()).getTime(),
        },
      });
      return;
    }

    if (event === "pull_request" && payload?.pull_request) {
      // TODO: persist PR event details once PR table handlers are in place.
      return;
    }

    console.warn(`Unhandled GitHub webhook event: ${event}`);
  },
});

function inferSeverity(issue: any): string | undefined {
  const labelNames: string[] = (issue.labels ?? []).map((label: any) => label.name?.toLowerCase?.()).filter(Boolean);
  if (labelNames.some((label) => label.includes("critical") || label.includes("p0"))) {
    return "critical";
  }
  if (labelNames.some((label) => label.includes("high") || label.includes("p1"))) {
    return "high";
  }
  if (labelNames.some((label) => label.includes("medium") || label.includes("p2"))) {
    return "medium";
  }
  if (labelNames.some((label) => label.includes("low") || label.includes("p3"))) {
    return "low";
  }
  return undefined;
}

function inferStatus(action: string): string {
  switch (action) {
    case "opened":
    case "reopened":
      return "triaged";
    case "closed":
      return "closed";
    default:
      return "triaged";
  }
}
