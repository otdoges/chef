import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export const enqueueTask = mutation({
  args: {
    type: v.string(),
    payload: v.any(),
    priority: v.optional(v.number()),
    scheduledFor: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("taskQueue", {
      type: args.type,
      payload: args.payload,
      status: "queued" as TaskStatus,
      priority: args.priority,
      attempts: 0,
      scheduledFor: args.scheduledFor,
      createdAt: now,
      startedAt: undefined,
      completedAt: undefined,
      resultSummary: undefined,
      lastError: undefined,
    });

    return id;
  },
});

export const markTaskRunning = mutation({
  args: {
    taskId: v.id("taskQueue"),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    await ctx.db.patch(args.taskId, {
      status: "running" as TaskStatus,
      attempts: task.attempts + 1,
      startedAt: Date.now(),
    });
  },
});

export const markTaskCompleted = mutation({
  args: {
    taskId: v.id("taskQueue"),
    resultSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.taskId, {
      status: "completed" as TaskStatus,
      completedAt: now,
      resultSummary: args.resultSummary,
      lastError: undefined,
    });
  },
});

export const markTaskFailed = mutation({
  args: {
    taskId: v.id("taskQueue"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.taskId, {
      status: "failed" as TaskStatus,
      completedAt: Date.now(),
      lastError: args.error,
    });
  },
});

export const listActiveTasks = query({
  args: {
    type: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const q = ctx.db
      .query("taskQueue")
      .withIndex("byStatus", (index) => index.eq("status", "queued" as TaskStatus));

    const queued = await q.collect();
    const running = await ctx.db
      .query("taskQueue")
      .withIndex("byStatus", (index) => index.eq("status", "running" as TaskStatus))
      .collect();

    const tasks = [...queued, ...running];
    if (!args.type) {
      return tasks;
    }
    return tasks.filter((task) => task.type === args.type);
  },
});

export const claimNextTask = mutation({
  args: {
    type: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const candidates = await ctx.db
      .query("taskQueue")
      .withIndex("byStatus", (index) => index.eq("status", "queued" as TaskStatus))
      .take(25);

    const filtered = candidates
      .filter((task) => (!args.type || task.type === args.type) && (task.scheduledFor === undefined || task.scheduledFor <= now))
      .sort((a, b) => {
        const priorityA = a.priority ?? 0;
        const priorityB = b.priority ?? 0;
        if (priorityA !== priorityB) {
          return priorityB - priorityA;
        }
        return a.createdAt - b.createdAt;
      });

    for (const task of filtered) {
      const fresh = await ctx.db.get(task._id);
      if (!fresh || fresh.status !== "queued") {
        continue;
      }

      await ctx.db.patch(task._id, {
        status: "running" as TaskStatus,
        attempts: fresh.attempts + 1,
        startedAt: now,
      });

      return task._id as Id<"taskQueue">;
    }

    return null;
  },
});
