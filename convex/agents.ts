import { query } from "./_generated/server";
import { v } from "convex/values";

export const listAgents = query({
  args: {
    status: v.optional(v.union(v.literal("available"), v.literal("busy"), v.literal("offline"))),
  },
  handler: async (ctx, args) => {
    const status = args.status;
    const q = status
      ? ctx.db
          .query("aiAgents")
          .withIndex("byStatus", (index) => index.eq("status", status))
      : ctx.db.query("aiAgents");

    const agents = await q.take(100);
    return agents.map((agent) => ({
      _id: agent._id,
      name: agent.name,
      kind: agent.kind,
      status: agent.status,
      capabilities: agent.capabilities,
      currentTaskId: agent.currentTaskId,
      loadFactor: agent.loadFactor,
    }));
  },
});

