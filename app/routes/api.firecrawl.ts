import type { ActionFunctionArgs } from '@vercel/remix';
import { getEnv } from '~/lib/.server/env';

const DEFAULT_API_BASE = 'https://api.firecrawl.dev/v0';

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = getEnv('FIRECRAWL_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Firecrawl API key is not configured.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (typeof body !== 'object' || body === null) {
    return new Response(JSON.stringify({ error: 'Invalid request body.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { url, format = 'markdown', includeMetadata = true } = body as {
    url?: string;
    format?: 'markdown' | 'html';
    includeMetadata?: boolean;
  };

  if (!url || typeof url !== 'string') {
    return new Response(JSON.stringify({ error: 'A valid URL is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const formats = new Set<string>([format]);
  if (includeMetadata) {
    formats.add('metadata');
  }

  const apiBase = getEnv('FIRECRAWL_API_BASE_URL') || DEFAULT_API_BASE;

  const response = await fetch(`${apiBase}/scrape`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      url,
      formats: Array.from(formats),
    }),
  });

  const text = await response.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  if (!response.ok) {
    const errorMessage = typeof json?.error === 'string' ? json.error : text || 'Firecrawl request failed.';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const data = json?.data ?? json ?? {};
  const contentPreference = format === 'html' ? ['html', 'markdown', 'content'] : ['markdown', 'html', 'content'];
  const content = contentPreference.map((key) => data?.[key]).find((value) => typeof value === 'string') ?? '';
  const metadata = includeMetadata ? data?.metadata ?? data?.meta ?? undefined : undefined;

  return new Response(
    JSON.stringify({
      url,
      content,
      metadata,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
