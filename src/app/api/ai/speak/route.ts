import { z } from 'zod';
import { ProviderError, speechConfigured, synthesize } from '@/server/ai/providers';
import { handle, json, readJson } from '@/server/http';
import { requireUser } from '@/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ text: z.string().min(1).max(4000), voice: z.string().max(20).optional() });

export const POST = handle(async (req: Request) => {
  await requireUser(req);
  if (!speechConfigured()) return json({ error: 'not_configured' }, 503);
  const { text, voice } = Body.parse(await readJson(req));
  try {
    const audio = await synthesize(text, voice);
    return new Response(audio, { headers: { 'content-type': 'audio/mpeg' } });
  } catch (e) {
    if (e instanceof ProviderError) return json({ error: 'provider_error', message: e.message }, 502);
    throw e;
  }
});
