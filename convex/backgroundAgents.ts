import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { CHAT_NOT_FOUND_ERROR, getChatByIdOrUrlIdEnsuringAccess } from "./messages";
import type { Doc } from "./_generated/dataModel";
import { ConvexError } from "convex/values";

type Trigger = "github" | "figma";

const TOP_LEVEL_STATUSES = ["pending", "running", "completed", "failed"] as const;
const TASK_STATUSES = ["pending", "in-progress", "done"] as const;

type TopLevelStatus = (typeof TOP_LEVEL_STATUSES)[number];
type TaskStatus = (typeof TASK_STATUSES)[number];

type StoredTask = Doc<"backgroundAgentTasks">;

type TaskTemplate = { description: string };

function createDefaultTaskList(trigger: Trigger, link: string) {
  const sourceLabel = trigger === "github" ? "GitHub" : "Figma";
  const templates: TaskTemplate[] = [
    {
      description: `Review the ${sourceLabel} import at ${link} and sync any required assets or code into the workspace.`,
    },
    {
      description: "Install or refresh project dependencies if needed (e.g. \`pnpm install\`).",
    },
    {
      description: "Run the project's lint command in autofix mode (e.g. \`pnpm lint:fix\`) and collect any remaining issues.",
    },
    {
      description: "Resolve any remaining lint errors or formatting violations that require manual intervention.",
    },
    {
      description: "Re-run lint to verify a clean result and summarize the fixes that were applied.",
    },
  ];

  return templates.map((template, index) => ({
    taskId: `task-${index + 1}`,
    description: template.description,
    status: TASK_STATUSES[0],
  }));
}

function mapTask(task: StoredTask) {
  return {
    id: task._id,
    chatId: task.chatId,
    trigger: task.trigger,
    link: task.link,
    status: task.status,
    tasks: task.tasks,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    lastInstructionMessageId: task.lastInstructionMessageId ?? null,
    error: task.error ?? null,
  } as const;
}

export const enqueue = mutation({
  args: {
    sessionId: v.id("sessions"),
    chatId: v.string(),
    link: v.string(),
    trigger: v.union(v.literal("github"), v.literal("figma")),
  },
  returns: v.object({
    taskId: v.id("backgroundAgentTasks"),
    alreadyExists: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { sessionId, chatId, link, trigger } = args;
    const chat = await getChatByIdOrUrlIdEnsuringAccess(ctx, { id: chatId, sessionId });

    if (!chat) {
      throw CHAT_NOT_FOUND_ERROR;
    }

    const existing = await ctx.db
      .query("backgroundAgentTasks")
      .withIndex("byChatAndLink", (q) => q.eq("chatId", chat._id).eq("link", link))
      .first();

    if (existing) {
      return { taskId: existing._id, alreadyExists: true } as const;
    }

    const now = Date.now();
    const tasks = createDefaultTaskList(trigger, link);

    const taskId = await ctx.db.insert("backgroundAgentTasks", {
      chatId: chat._id,
      sessionId,
      trigger,
      link,
      status: TOP_LEVEL_STATUSES[0],
      tasks,
      createdAt: now,
      updatedAt: now,
    });

    return { taskId, alreadyExists: false } as const;
  },
});

export const listForChat = query({
  args: {
    sessionId: v.id("sessions"),
    chatId: v.string(),
  },
  returns: v.array(
    v.object({
      id: v.id("backgroundAgentTasks"),
      chatId: v.id("chats"),
      trigger: v.union(v.literal("github"), v.literal("figma")),
      link: v.string(),
      status: v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed"),
      ),
      tasks: v.array(
        v.object({
          taskId: v.string(),
          description: v.string(),
          status: v.union(v.literal("pending"), v.literal("in-progress"), v.literal("done")),
        }),
      ),
      createdAt: v.number(),
      updatedAt: v.number(),
      lastInstructionMessageId: v.union(v.string(), v.null()),
      error: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const { sessionId, chatId } = args;
    const chat = await getChatByIdOrUrlIdEnsuringAccess(ctx, { id: chatId, sessionId });

    if (!chat) {
      throw CHAT_NOT_FOUND_ERROR;
    }

    const tasks = await ctx.db
      .query("backgroundAgentTasks")
      .withIndex("byChat", (q) => q.eq("chatId", chat._id))
      .order("desc")
      .collect();

    return tasks.map(mapTask);
  },
});

export const updateStatus = mutation({
  args: {
    sessionId: v.id("sessions"),
    taskId: v.id("backgroundAgentTasks"),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    taskStatusUpdates: v.optional(
      v.array(
        v.object({
          taskId: v.string(),
          status: v.union(v.literal("pending"), v.literal("in-progress"), v.literal("done")),
        }),
      ),
    ),
    error: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { sessionId, taskId, status, taskStatusUpdates, error } = args;
    const task = await ctx.db.get(taskId);
    if (!task) {
      throw new ConvexError({ code: "NotFound", message: "Background agent task not found" });
    }
    if (task.sessionId !== sessionId) {
      throw new ConvexError({ code: "Unauthorized", message: "Cannot modify task for different session" });
    }
    const updated: Partial<StoredTask> = {
      status: status as TopLevelStatus,
      updatedAt: Date.now(),
    };

    if (taskStatusUpdates) {
      const statusLookup = new Map(taskStatusUpdates.map((update) => [update.taskId, update.status as TaskStatus]));
      updated.tasks = task.tasks.map((item) => {
        const newStatus = statusLookup.get(item.taskId);
        if (!newStatus) {
          return item;
        }
        return { ...item, status: newStatus };
      });
    }

    if (error !== undefined) {
      updated.error = error ?? undefined;
    }

    await ctx.db.patch(task._id, updated);

    return null;
  },
});
