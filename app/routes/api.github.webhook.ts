import { json } from '@vercel/remix';
import type { ActionFunctionArgs } from '@vercel/remix';
import { internal } from '@convex/_generated/api';
import { getConvexClient } from '~/lib/.server/convex-client';

export async function action({ request }: ActionFunctionArgs) {
  const event = request.headers.get('x-github-event') ?? 'unknown';
  const deliveryId = request.headers.get('x-github-delivery') ?? 'unknown-delivery';
  const payload = await request.json();

  const convex = getConvexClient();
  await convex.action(internal.github.handleWebhook, {
    event,
    deliveryId,
    payload,
  });

  return json({ ok: true }, { status: 202 });
}

