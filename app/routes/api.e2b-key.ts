import type { LoaderFunctionArgs } from '@vercel/remix';
import { json } from '@vercel/remix';
import { getEnv } from '~/lib/.server/env';

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const apiKey = getEnv('E2B_API_KEY');
  if (!apiKey) {
    return json({ error: 'E2B API key is not configured.' }, { status: 404 });
  }

  return json({ apiKey });
}

export function headers() {
  return {
    'cache-control': 'no-store',
  };
}
