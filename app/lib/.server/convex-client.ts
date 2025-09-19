import { ConvexHttpClient } from 'convex/browser';
import { getEnv } from './env';
import { fetch } from './fetch';

let convexClient: ConvexHttpClient | null = null;

export function getConvexClient() {
  if (!convexClient) {
    const convexUrl = getEnv('CONVEX_URL') ?? getEnv('VITE_CONVEX_URL');
    if (!convexUrl) {
      throw new Error('Missing CONVEX_URL environment variable');
    }
    convexClient = new ConvexHttpClient(convexUrl, { fetch });
  }
  return convexClient;
}

