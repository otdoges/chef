import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

const githubIssueValidator = v.object({
  repoId: v.string(),
  repoFullName: v.string(),
  githubIssueId: v.string(),
  issueNumber: v.number(),
  title: v.string(),
  body: v.optional(v.string()),
  labels: v.array(v.string()),
  severity: v.optional(v.string()),
  priorityHint: v.optional(v.number()),
  status: v.optional(v.string()),
  assignedLogin: v.optional(v.string()),
  githubUpdatedAt: v.number(),
});

type IssueDoc = Doc<"issues">;

export const ingestGithubIssue = internalMutation({
  args: {
    issue: githubIssueValidator,
  },
  handler: async (ctx, args) => {
    const { issue } = args;
    const existing = await ctx.db
      .query("issues")
      .withIndex("byGithubId", (q) => q.eq("githubIssueId", issue.githubIssueId))
      .first();

    const baseDoc = {
      repoId: issue.repoId,
      repoFullName: issue.repoFullName,
      githubIssueId: issue.githubIssueId,
      issueNumber: issue.issueNumber,
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
      severity: issue.severity,
      status: issue.status ?? "triaged",
      priorityScore: issue.priorityHint,
      priorityReason: undefined,
      assignedAgentId: existing?.assignedAgentId,
      clusterId: existing?.clusterId,
      lastActivityAt: Date.now(),
      githubUpdatedAt: issue.githubUpdatedAt,
      metadata: existing?.metadata ?? { assignedLogin: issue.assignedLogin },
    } as const;

    if (existing) {
      await ctx.db.patch(existing._id, baseDoc);
      return existing._id;
    }

    return await ctx.db.insert("issues", baseDoc);
  },
});

export const listTriagedIssues = query({
  args: {
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const status = args.status ?? "triaged";
    const cursor = ctx.db
      .query("issues")
      .withIndex("byStatusAndPriority", (q) => q.eq("status", status))
      .order("desc");

    const results = await cursor.take(args.limit ?? 25);
    return results.map((doc) => ({
      _id: doc._id,
      githubIssueId: doc.githubIssueId,
      issueNumber: doc.issueNumber,
      title: doc.title,
      priorityScore: doc.priorityScore ?? undefined,
      status: doc.status,
      assignedAgentId: doc.assignedAgentId,
    }));
  },
});

export const assignIssue = mutation({
  args: {
    issueId: v.id("issues"),
    agentId: v.id("aiAgents"),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) {
      throw new Error("Issue not found");
    }
    const agent = await ctx.db.get(args.agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }

    await ctx.db.patch(args.issueId, {
      assignedAgentId: args.agentId,
      status: issue.status === "triaged" ? "assigned" : issue.status,
      lastActivityAt: Date.now(),
    });

    return { issueId: args.issueId, agentId: args.agentId };
  },
});

export const updatePriorityScore = mutation({
  args: {
    issueId: v.id("issues"),
    priorityScore: v.number(),
    priorityReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { issueId, priorityScore, priorityReason } = args;
    const issue = await ctx.db.get(issueId);
    if (!issue) {
      throw new Error("Issue not found");
    }

    await ctx.db.patch(issueId, {
      priorityScore,
      priorityReason,
      lastActivityAt: Date.now(),
    });
  },
});
