import { httpRouter } from "convex/server";
import { httpAction, type ActionCtx, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ConvexError, v } from "convex/values";
import { openaiProxy } from "./openaiProxy";
import { corsRouter } from "convex-helpers/server/cors";
import { resendProxy } from "./resendProxy";

const http = httpRouter();
const httpWithCors = corsRouter(http, {
  allowedHeaders: ["Content-Type", "X-Chef-Admin-Token"],
});

// This is particularly useful with CORS, where an unhandled error won't have CORS
// headers applied to it.
function httpActionWithErrorHandling(handler: (ctx: ActionCtx, request: Request) => Promise<Response>) {
  return httpAction(async (ctx, request) => {
    try {
      return await handler(ctx, request);
    } catch (e) {
      console.error(e);
      return new Response(
        JSON.stringify({ error: e instanceof ConvexError ? e.message : "An unknown error occurred" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }
  });
}
httpWithCors.route({
  path: "/upload_snapshot",
  method: "POST",
  handler: httpActionWithErrorHandling(async (ctx, request) => {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId) {
      throw new ConvexError("sessionId is required");
    }
    const chatId = url.searchParams.get("chatId");
    if (!chatId) {
      throw new ConvexError("chatId is required");
    }

    const blob = await request.blob();
    const storageId = await ctx.storage.store(blob);

    await ctx.runMutation(internal.snapshot.saveSnapshot, {
      sessionId: sessionId as Id<"sessions">,
      chatId: chatId as Id<"chats">,
      storageId,
    });

    return new Response(JSON.stringify({ snapshotId: storageId }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }),
});

http.route({
  pathPrefix: "/openai-proxy/",
  method: "POST",
  handler: openaiProxy,
});

http.route({
  path: "/github/webhook",
  method: "POST",
  handler: httpActionWithErrorHandling(async (ctx, request) => {
    const event = request.headers.get("x-github-event") ?? "unknown";
    const deliveryId = request.headers.get("x-github-delivery") ?? "unknown-delivery";
    const signature = request.headers.get("x-hub-signature-256") ?? undefined;
    const payloadText = await request.text();

    const isValid = await verifyGithubSignatureWeb(signature ?? null, payloadText);
    if (!isValid) {
      console.warn("Rejected GitHub webhook with invalid signature", { event, deliveryId });
      return new Response(null, { status: 401 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      throw new ConvexError("Invalid JSON payload");
    }

    await ctx.runMutation(internal.http.ingestGithubWebhookInternal, { event, payload });
    return new Response(null, { status: 202 });
  }),
});

// Alias under /api prefix for consistency with app routing
http.route({
  path: "/api/github/webhook",
  method: "POST",
  handler: httpActionWithErrorHandling(async (ctx, request) => {
    const event = request.headers.get("x-github-event") ?? "unknown";
    const deliveryId = request.headers.get("x-github-delivery") ?? "unknown-delivery";
    const signature = request.headers.get("x-hub-signature-256") ?? undefined;
    const payloadText = await request.text();

    const isValid = await verifyGithubSignatureWeb(signature ?? null, payloadText);
    if (!isValid) {
      console.warn("Rejected GitHub webhook with invalid signature", { event, deliveryId });
      return new Response(null, { status: 401 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      throw new ConvexError("Invalid JSON payload");
    }

    await ctx.runMutation(internal.http.ingestGithubWebhookInternal, { event, payload });
    return new Response(null, { status: 202 });
  }),
});

httpWithCors.route({
  path: "/api/issues/triage",
  method: "GET",
  handler: httpActionWithErrorHandling(async (ctx, request) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? undefined;
    const limitStr = url.searchParams.get("limit");
    const limit = limitStr ? Number(limitStr) : undefined;

    const issues = await ctx.runQuery(internal.http.listTriagedIssuesInternal, {
      status: status ?? undefined,
      limit: limit ?? undefined,
    });
    return new Response(JSON.stringify({ issues }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

httpWithCors.route({
  path: "/api/issues/assign",
  method: "POST",
  handler: httpActionWithErrorHandling(async (ctx, request) => {
    const body = await request.json();
    const issueId = body.issueId as Id<"issues"> | undefined;
    const agentId = body.agentId as Id<"aiAgents"> | undefined;
    if (!issueId || !agentId) {
      throw new ConvexError("issueId and agentId are required");
    }

    const result = await ctx.runMutation(internal.http.assignIssueInternal, {
      issueId,
      agentId,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

httpWithCors.route({
  path: "/api/tasks/queue",
  method: "GET",
  handler: httpActionWithErrorHandling(async (ctx, request) => {
    const url = new URL(request.url);
    const type = url.searchParams.get("type") ?? undefined;
    const tasks = await ctx.runQuery(internal.http.listActiveTasksInternal, { type: type ?? undefined });
    return new Response(JSON.stringify({ tasks }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

httpWithCors.route({
  path: "/api/code/generate",
  method: "POST",
  handler: httpActionWithErrorHandling(async (ctx, request) => {
    const body = await request.json();
    const issueId = body.issueId as Id<"issues"> | undefined;
    const language = body.language as string | undefined;
    const priority = body.priority as number | undefined;
    if (!issueId || !language) {
      throw new ConvexError("issueId and language are required");
    }
    const taskId = await ctx.runMutation(internal.http.enqueueCodeGenerationInternal, { issueId, language, priority });
    return new Response(JSON.stringify({ taskId }), { status: 202, headers: { "Content-Type": "application/json" } });
  }),
});

httpWithCors.route({
  path: "/api/code/test",
  method: "POST",
  handler: httpActionWithErrorHandling(async (ctx, request) => {
    const body = await request.json();
    const codeGenerationId = body.codeGenerationId as Id<"codeGenerations"> | undefined;
    const runtime = body.runtime as string | undefined;
    if (!codeGenerationId || !runtime) {
      throw new ConvexError("codeGenerationId and runtime are required");
    }
    const taskId = await ctx.runMutation(internal.http.enqueueCodeTestInternal, { codeGenerationId, runtime });
    return new Response(JSON.stringify({ taskId }), { status: 202, headers: { "Content-Type": "application/json" } });
  }),
});

httpWithCors.route({
  path: "/api/code/review",
  method: "POST",
  handler: httpActionWithErrorHandling(async (ctx, request) => {
    const body = await request.json();
    const codeGenerationId = body.codeGenerationId as Id<"codeGenerations"> | undefined;
    if (!codeGenerationId) {
      throw new ConvexError("codeGenerationId is required");
    }
    const taskId = await ctx.runMutation(internal.http.enqueueCodeReviewInternal, { codeGenerationId });
    return new Response(JSON.stringify({ taskId }), { status: 202, headers: { "Content-Type": "application/json" } });
  }),
});

httpWithCors.route({
  path: "/api/github/pr/create",
  method: "POST",
  handler: httpActionWithErrorHandling(async (ctx, request) => {
    const body = await request.json();
    const issueId = body.issueId as Id<"issues"> | undefined;
    const branchName = body.branchName as string | undefined;
    if (!issueId || !branchName) {
      throw new ConvexError("issueId and branchName are required");
    }
    const taskId = await ctx.runMutation(internal.http.enqueuePrCreateInternal, { issueId, branchName });
    return new Response(JSON.stringify({ taskId }), { status: 202, headers: { "Content-Type": "application/json" } });
  }),
});

httpWithCors.route({
  path: "/api/github/pr/update",
  method: "POST",
  handler: httpActionWithErrorHandling(async (ctx, request) => {
    const body = await request.json();
    const pullRequestId = body.pullRequestId as Id<"pullRequests"> | undefined;
    if (!pullRequestId) {
      throw new ConvexError("pullRequestId is required");
    }
    const taskId = await ctx.runMutation(internal.http.enqueuePrUpdateInternal, { pullRequestId });
    return new Response(JSON.stringify({ taskId }), { status: 202, headers: { "Content-Type": "application/json" } });
  }),
});

httpWithCors.route({
  path: "/api/agents/status",
  method: "GET",
  handler: httpActionWithErrorHandling(async (ctx) => {
    const agents = await ctx.runQuery(internal.http.listAgentsStatusInternal, {});
    return new Response(JSON.stringify({ agents }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

httpWithCors.route({
  path: "/initial_messages",
  method: "POST",
  handler: httpActionWithErrorHandling(async (ctx, request) => {
    const body = await request.json();
    const sessionId = body.sessionId;
    const chatId = body.chatId;
    const subchatIndex = body.subchatIndex ?? 0;
    if (!sessionId) {
      throw new ConvexError("sessionId is required");
    }
    if (!chatId) {
      throw new ConvexError("chatId is required");
    }
    const storageInfo = await ctx.runQuery(internal.messages.getInitialMessagesStorageInfo, {
      sessionId,
      chatId,
      subchatIndex,
    });
    if (!storageInfo) {
      return new Response(`Chat not found: ${chatId}`, {
        status: 404,
      });
    }
    if (!storageInfo.storageId) {
      return new Response(null, {
        status: 204,
      });
    }
    const blob = await ctx.storage.get(storageInfo.storageId);
    return new Response(blob, {
      status: 200,
    });
  }),
});

httpWithCors.route({
  path: "/store_chat",
  method: "POST",
  handler: httpActionWithErrorHandling(async (ctx, request) => {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");
    const chatId = url.searchParams.get("chatId");
    const lastMessageRank = url.searchParams.get("lastMessageRank");
    const lastSubchatIndex = url.searchParams.get("lastSubchatIndex");
    const partIndex = url.searchParams.get("partIndex");
    const formData = await request.formData();
    let firstMessage = url.searchParams.get("firstMessage");
    let messageStorageId: Id<"_storage"> | null = null;
    let snapshotStorageId: Id<"_storage"> | null = null;
    if (formData.has("messages")) {
      const messageBlob = formData.get("messages") as Blob;
      messageStorageId = await ctx.storage.store(messageBlob);
    }
    if (formData.has("snapshot")) {
      const snapshotBlob = formData.get("snapshot") as Blob;
      snapshotStorageId = await ctx.storage.store(snapshotBlob);
    }
    if (formData.has("firstMessage")) {
      firstMessage = formData.get("firstMessage") as string;
    }
    const maybeStorageStateId = await ctx.runMutation(internal.messages.updateStorageState, {
      sessionId: sessionId as Id<"sessions">,
      chatId: chatId as Id<"chats">,
      lastMessageRank: parseInt(lastMessageRank!),
      // Default to the first feature if not provided
      subchatIndex: parseInt(lastSubchatIndex ?? "0"),
      partIndex: parseInt(partIndex!),
      storageId: messageStorageId,
      snapshotId: snapshotStorageId,
    });
    if (firstMessage && maybeStorageStateId) {
      await ctx.scheduler.runAfter(0, internal.summarize.firstMessage, {
        chatMessageId: maybeStorageStateId,
        message: firstMessage,
      });
    }
    return new Response(null, {
      status: 200,
    });
  }),
});

http.route({
  path: "/__debug/download_messages",
  method: "OPTIONS",
  handler: httpActionWithErrorHandling(async (ctx, request) => {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": request.headers.get("Origin") ?? "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Chef-Admin-Token",
        "Access-Control-Allow-Credentials": "true",
      },
    });
  }),
});

http.route({
  path: "/__debug/download_messages",
  method: "POST",
  handler: httpActionWithErrorHandling(async (ctx, request) => {
    const body = await request.json();
    // We auth either via the WorkOS token or with a custom header
    const header = request.headers.get("X-Chef-Admin-Token");
    const authHeader = request.headers.get("Authorization");
    if (authHeader === null) {
      if (header !== process.env.CHEF_ADMIN_TOKEN) {
        return new Response(JSON.stringify({ code: "Unauthorized", message: "Invalid admin token" }), {
          status: 401,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }
    }
    const chatUuid = body.chatUuid;
    const storageId = await ctx.runQuery(internal.messages.getMessagesByChatInitialIdBypassingAccessControl, {
      id: chatUuid,
      ensureAdmin: authHeader !== null,
      // TODO: Add subchatIndex that is passed in the body
      subchatIndex: 0,
    });
    if (!storageId) {
      return new Response(null, {
        status: 204,
      });
    }
    const blob = await ctx.storage.get(storageId);
    return new Response(blob, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": request.headers.get("Origin") ?? "*",
        Vary: "Origin",
      },
    });
  }),
});

httpWithCors.route({
  path: "/upload_debug_prompt",
  method: "POST",
  handler: httpActionWithErrorHandling(async (ctx, request) => {
    const formData = await request.formData();
    const metadataStr = formData.get("metadata");
    const messagesBlob = formData.get("promptCoreMessages") as Blob;

    if (!metadataStr || !messagesBlob) {
      throw new ConvexError("metadata and messages are required in form data");
    }

    let metadata;
    try {
      metadata = JSON.parse(metadataStr as string);
    } catch (_e) {
      throw new ConvexError("Invalid metadata: must be valid JSON");
    }

    const promptCoreMessagesStorageId = await ctx.storage.store(messagesBlob);
    try {
      await ctx.runMutation(internal.debugPrompt.storeDebugPrompt, { ...metadata, promptCoreMessagesStorageId });
    } catch (e) {
      await ctx.storage.delete(promptCoreMessagesStorageId);
      throw e;
    }

    return new Response(JSON.stringify({ promptCoreMessagesStorageId }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }),
});

httpWithCors.route({
  path: "/upload_thumbnail",
  method: "POST",
  handler: httpActionWithErrorHandling(async (ctx, request) => {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");
    const urlId = url.searchParams.get("chatId");

    if (!sessionId || !urlId) {
      return new Response("Missing sessionId or chatId", { status: 400 });
    }

    const imageBlob = await request.blob();

    // Validate content type
    const contentType = imageBlob.type;
    if (!contentType.startsWith("image/")) {
      return new Response(JSON.stringify({ error: "Invalid file type. Only images are allowed." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const MAX_THUMBNAIL_SIZE = 5 * 1024 * 1024;
    if (imageBlob.size > MAX_THUMBNAIL_SIZE) {
      return new Response(JSON.stringify({ error: "Thumbnail image exceeds maximum size of 5MB" }), {
        status: 413, // Payload Too Large
        headers: { "Content-Type": "application/json" },
      });
    }

    const storageId = await ctx.storage.store(imageBlob);

    await ctx.runMutation(internal.socialShare.saveThumbnail, {
      sessionId: sessionId as Id<"sessions">,
      urlId,
      storageId,
    });

    return new Response(JSON.stringify({ storageId }), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// Internal helpers used by HTTP handlers (DB access)
export const ingestGithubWebhookInternal = internalMutation({
  args: { event: v.string(), payload: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { event, payload } = args;
    if (event !== "issues") return null;
    const p = payload as Record<string, any>;
    if (!p || !p.issue) return null;

    const issue = p.issue as Record<string, any>;
    const repoId = p.repository?.node_id ?? (p.repository?.id ? String(p.repository.id) : "");
    const repoFullName = p.repository?.full_name ?? "";
    const githubIssueId = issue.node_id ?? (issue.id ? String(issue.id) : "");
    const issueNumber = issue.number as number;
    const title = issue.title as string;
    const body = (issue.body ?? undefined) as string | undefined;
    const labels: Array<string> = ((issue.labels ?? []) as Array<any>)
      .map((l) => (l?.name ? String(l.name) : ""))
      .filter((s): s is string => Boolean(s));
    const severity = inferSeverityFromLabels(labels);
    const status = inferStatusFromAction(p.action as string);
    const assignedLogin = issue.assignee?.login as string | undefined;
    const githubUpdatedAt = new Date((issue.updated_at as string | undefined) ?? Date.now()).getTime();

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

export const listTriagedIssuesInternal = internalQuery({
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

export const assignIssueInternal = internalMutation({
  args: { issueId: v.id("issues"), agentId: v.id("aiAgents") },
  returns: v.object({ issueId: v.id("issues"), agentId: v.id("aiAgents") }),
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) {
      throw new ConvexError("Issue not found");
    }
    const agent = await ctx.db.get(args.agentId);
    if (!agent) {
      throw new ConvexError("Agent not found");
    }
    await ctx.db.patch(args.issueId, {
      assignedAgentId: args.agentId,
      status: issue.status === "triaged" ? "assigned" : issue.status,
      lastActivityAt: Date.now(),
    });
    return { issueId: args.issueId, agentId: args.agentId };
  },
});

export const listActiveTasksInternal = internalQuery({
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

export const listAgentsStatusInternal = internalQuery({
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

async function verifyGithubSignatureWeb(signature: string | null, payloadText: string): Promise<boolean> {
  const secret = (globalThis as any).process?.env?.GITHUB_WEBHOOK_SECRET as string | undefined;
  if (!secret) return true;
  if (!signature) return false;

  const enc = new TextEncoder();
  const keyData = enc.encode(secret);
  const data = enc.encode(payloadText);
  // Web Crypto subtle API
  const subtle = (globalThis as any).crypto?.subtle;
  if (!subtle) return false;
  const cryptoKey = await subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await subtle.sign("HMAC", cryptoKey, data));
  const hex = Array.from(sig)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const expected = `sha256=${hex}`;
  return constantTimeEqual(expected, signature);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export default httpWithCors.http;

// Enqueue scaffolds
export const enqueueCodeGenerationInternal = internalMutation({
  args: { issueId: v.id("issues"), language: v.string(), priority: v.optional(v.number()) },
  returns: v.id("taskQueue"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("taskQueue", {
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
  },
});

export const enqueueCodeTestInternal = internalMutation({
  args: { codeGenerationId: v.id("codeGenerations"), runtime: v.string() },
  returns: v.id("taskQueue"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("taskQueue", {
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
  },
});

export const enqueueCodeReviewInternal = internalMutation({
  args: { codeGenerationId: v.id("codeGenerations") },
  returns: v.id("taskQueue"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("taskQueue", {
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
  },
});

export const enqueuePrCreateInternal = internalMutation({
  args: { issueId: v.id("issues"), branchName: v.string() },
  returns: v.id("taskQueue"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("taskQueue", {
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
  },
});

export const enqueuePrUpdateInternal = internalMutation({
  args: { pullRequestId: v.id("pullRequests") },
  returns: v.id("taskQueue"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("taskQueue", {
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
  },
});
