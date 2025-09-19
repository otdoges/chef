import type { Tool } from 'ai';
import { z } from 'zod';

export const firecrawlToolParameters = z
  .object({
    url: z
      .string({ description: 'URL to crawl' })
      .url('Please provide a valid URL that Firecrawl can access.'),
    format: z
      .enum(['markdown', 'html'], {
        description: 'Preferred response format returned from Firecrawl.',
      })
      .default('markdown')
      .optional(),
    includeMetadata: z
      .boolean({ description: 'Include metadata from Firecrawl in the response.' })
      .default(true)
      .optional(),
  })
  .describe('Parameters for fetching external content via Firecrawl.');

export function firecrawlTool(): Tool {
  return {
    description:
      'Use Firecrawl to fetch and summarize the content of a public webpage. Provide the exact URL you want to inspect.',
    parameters: firecrawlToolParameters,
  };
}

export type FirecrawlParameters = typeof firecrawlToolParameters;
