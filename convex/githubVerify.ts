"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { createHmac, timingSafeEqual } from "node:crypto";

export const verifySignature = internalAction({
  args: {
    signature: v.union(v.string(), v.null()),
    payload: v.string(),
  },
  returns: v.boolean(),
  handler: async (_ctx, { signature, payload }) => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) return true;
    if (!signature) return false;

    const hmac = createHmac("sha256", secret);
    hmac.update(payload, "utf8");
    const digest = `sha256=${hmac.digest("hex")}`;

    const provided = Buffer.from(signature);
    const expected = Buffer.from(digest);
    if (provided.length !== expected.length) return false;
    try {
      return timingSafeEqual(provided, expected);
    } catch {
      return false;
    }
  },
});


