import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

export const ingestGithubWebhook = internalMutation({
  args: { event: v.string(), payload: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.event !== "issues") return null;
    const p = args.payload as unknown;
    if (!isIssuesEventPayload(p)) return null;

    const issue = p.issue;
    const repoId = p.repository?.node_id ?? (p.repository?.id ? String(p.repository.id) : "");
    const repoFullName = p.repository?.full_name ?? "";
    const githubIssueId = issue.node_id ?? (issue.id ? String(issue.id) : "");
    const issueNumber = issue.number;
    const title = issue.title;
    const body = issue.body ?? undefined;
    const labels: Array<string> = (issue.labels ?? [])
      .map((l) => (l?.name ? String(l.name) : ""))
      .filter((s): s is string => Boolean(s));
    const severity = inferSeverityFromLabels(labels);
    const status = inferStatusFromAction(p.action);
    const assignedLogin = issue.assignee?.login;
    const githubUpdatedAt = new Date(issue.updated_at ?? Date.now()).getTime();

    const existing = await ctx.db
      .query("issues")
      .withIndex("byGithubId", (q) => q.eq("githubIssueId", githubIssueId))
      .first();

    const baseDoc = {
      repoId,
      repoFullName,
      githubIssueId,
      issueNumber,
      title,
      body,
      labels,
      severity,
      status: status ?? "triaged",
      priorityScore: existing?.priorityScore,
      priorityReason: existing?.priorityReason,
      assignedAgentId: existing?.assignedAgentId,
      clusterId: existing?.clusterId,
      lastActivityAt: Date.now(),
      githubUpdatedAt,
      metadata: existing?.metadata ?? { assignedLogin },
    } as const;

    if (existing) {
      await ctx.db.patch(existing._id, baseDoc);
    } else {
      await ctx.db.insert("issues", baseDoc);
    }
    return null;
  },
});

export const listTriagedIssues = internalQuery({
  args: { status: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("issues"),
      githubIssueId: v.string(),
      issueNumber: v.number(),
      title: v.string(),
      priorityScore: v.optional(v.number()),
      status: v.string(),
      assignedAgentId: v.optional(v.id("aiAgents")),
    }),
  ),
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("issues")
      .withIndex("byStatusAndPriority", (qi) => qi.eq("status", args.status ?? "triaged"))
      .order("desc")
      .take(args.limit ?? 25);
    return docs.map((doc) => ({
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

export const assignIssue = internalMutation({
  args: { issueId: v.id("issues"), agentId: v.id("aiAgents") },
  returns: v.object({ issueId: v.id("issues"), agentId: v.id("aiAgents") }),
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

export const listActiveTasks = internalQuery({
  args: { type: v.optional(v.string()) },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const queued = await ctx.db
      .query("taskQueue")
      .withIndex("byStatus", (index) => index.eq("status", "queued"))
      .collect();
    const running = await ctx.db
      .query("taskQueue")
      .withIndex("byStatus", (index) => index.eq("status", "running"))
      .collect();
    const tasks = [...queued, ...running];
    if (!args.type) return tasks;
    return tasks.filter((t) => t.type === args.type);
  },
});

export const listAgentsStatus = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("aiAgents"),
      name: v.string(),
      kind: v.union(v.literal("human"), v.literal("ai")),
      capabilities: v.array(v.string()),
      status: v.union(v.literal("available"), v.literal("busy"), v.literal("offline")),
      currentTaskId: v.optional(v.id("taskQueue")),
      loadFactor: v.optional(v.number()),
      performanceMetrics: v.optional(
        v.object({
          successRate: v.optional(v.number()),
          avgCycleTimeMinutes: v.optional(v.number()),
          lastAssignmentAt: v.optional(v.number()),
        }),
      ),
      avatarUrl: v.optional(v.string()),
      contact: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) => {
    const agents = await ctx.db.query("aiAgents").collect();
    return agents.map((a) => ({
      _id: a._id,
      name: a.name,
      kind: a.kind,
      capabilities: a.capabilities,
      status: a.status,
      currentTaskId: a.currentTaskId,
      loadFactor: a.loadFactor,
      performanceMetrics: a.performanceMetrics,
      avatarUrl: a.avatarUrl,
      contact: a.contact,
    }));
  },
});

// Code generation scaffold
export const enqueueCodeGeneration = internalMutation({
  args: {
    issueId: v.id("issues"),
    language: v.string(),
    priority: v.optional(v.number()),
  },
  returns: v.id("taskQueue"),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("taskQueue", {
      type: "code.generate",
      payload: { issueId: args.issueId, language: args.language },
      status: "queued",
      priority: args.priority,
      attempts: 0,
      scheduledFor: undefined,
      createdAt: Date.now(),
      startedAt: undefined,
      completedAt: undefined,
      resultSummary: undefined,
      lastError: undefined,
    });
    return id;
  },
});

export const enqueueCodeTest = internalMutation({
  args: {
    codeGenerationId: v.id("codeGenerations"),
    runtime: v.string(),
  },
  returns: v.id("taskQueue"),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("taskQueue", {
      type: "code.test",
      payload: { codeGenerationId: args.codeGenerationId, runtime: args.runtime },
      status: "queued",
      priority: undefined,
      attempts: 0,
      scheduledFor: undefined,
      createdAt: Date.now(),
      startedAt: undefined,
      completedAt: undefined,
      resultSummary: undefined,
      lastError: undefined,
    });
    return id;
  },
});

export const enqueueCodeReview = internalMutation({
  args: {
    codeGenerationId: v.id("codeGenerations"),
  },
  returns: v.id("taskQueue"),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("taskQueue", {
      type: "code.review",
      payload: { codeGenerationId: args.codeGenerationId },
      status: "queued",
      priority: undefined,
      attempts: 0,
      scheduledFor: undefined,
      createdAt: Date.now(),
      startedAt: undefined,
      completedAt: undefined,
      resultSummary: undefined,
      lastError: undefined,
    });
    return id;
  },
});

// GitHub PR scaffold
export const enqueuePrCreate = internalMutation({
  args: {
    issueId: v.id("issues"),
    branchName: v.string(),
  },
  returns: v.id("taskQueue"),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("taskQueue", {
      type: "github.pr.create",
      payload: { issueId: args.issueId, branchName: args.branchName },
      status: "queued",
      priority: undefined,
      attempts: 0,
      scheduledFor: undefined,
      createdAt: Date.now(),
      startedAt: undefined,
      completedAt: undefined,
      resultSummary: undefined,
      lastError: undefined,
    });
    return id;
  },
});

export const enqueuePrUpdate = internalMutation({
  args: { pullRequestId: v.id("pullRequests") },
  returns: v.id("taskQueue"),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("taskQueue", {
      type: "github.pr.update",
      payload: { pullRequestId: args.pullRequestId },
      status: "queued",
      priority: undefined,
      attempts: 0,
      scheduledFor: undefined,
      createdAt: Date.now(),
      startedAt: undefined,
      completedAt: undefined,
      resultSummary: undefined,
      lastError: undefined,
    });
    return id;
  },
});

// E2B action scaffold (no secrets)
export const runInSandbox = internalMutation({
  args: {
    codeGenerationId: v.id("codeGenerations"),
    runtime: v.string(),
    command: v.string(),
  },
  returns: v.id("taskQueue"),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("taskQueue", {
      type: "e2b.run",
      payload: { codeGenerationId: args.codeGenerationId, runtime: args.runtime, command: args.command },
      status: "queued",
      priority: undefined,
      attempts: 0,
      scheduledFor: undefined,
      createdAt: Date.now(),
      startedAt: undefined,
      completedAt: undefined,
      resultSummary: undefined,
      lastError: undefined,
    });
    return id;
  },
});

function isIssuesEventPayload(p: unknown): p is {
  action: string;
  issue: {
    id?: number;
    node_id?: string;
    number: number;
    title: string;
    body?: string | null;
    labels?: Array<{ name?: string | null } | null> | null;
    assignee?: { login?: string } | null;
    updated_at?: string;
  };
  repository?: { id?: number; node_id?: string; full_name?: string };
} {
  if (typeof p !== "object" || p === null) return false;
  const obj = p as Record<string, unknown>;
  if (typeof obj.action !== "string") return false;
  const issue = obj.issue as Record<string, unknown> | undefined;
  if (!issue || typeof issue.number !== "number" || typeof issue.title !== "string") return false;
  return true;
}

function inferSeverityFromLabels(labelNames: Array<string>): string | undefined {
  const lower = labelNames.map((l) => l.toLowerCase());
  if (lower.some((label) => label.includes("critical") || label.includes("p0"))) return "critical";
  if (lower.some((label) => label.includes("high") || label.includes("p1"))) return "high";
  if (lower.some((label) => label.includes("medium") || label.includes("p2"))) return "medium";
  if (lower.some((label) => label.includes("low") || label.includes("p3"))) return "low";
  return undefined;
}

function inferStatusFromAction(action: string): string {
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


