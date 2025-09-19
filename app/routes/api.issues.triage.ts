import { json } from '@vercel/remix';
import type { LoaderFunctionArgs } from '@vercel/remix';
import { getTriagedIssues } from '~/lib/.server/issues';

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status') ?? undefined;
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

  const issues = await getTriagedIssues({ status, limit });
  return json({ issues });
}

