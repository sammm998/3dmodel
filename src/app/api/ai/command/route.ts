import { z } from 'zod';
import { runCommand } from '@/server/ai/orchestrator';
import { ProviderError } from '@/server/ai/providers';
import { handle, json, readJson } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const Body = z.object({
  prompt: z.string().min(1).max(4000),
  context: z.record(z.unknown()),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(8000) })).max(20).default([]),
  images: z.array(z.string().max(8_000_000).regex(/^data:image\/(png|jpeg|webp|gif);base64,/)).max(4).default([]),
});

export const POST = handle(async (req: Request) => {
  const body = Body.parse(await readJson(req));
  if (JSON.stringify(body.context).length > 400_000) return json({ error: 'Context too large' }, 413);
  try {
    const result = await runCommand(body.prompt, body.context as never, body.history, body.images);
    return json(result);
  } catch (e) {
    if (e instanceof Error && e.message === 'not_configured') return json({ error: 'not_configured', message: 'No LLM provider is configured on the server.' }, 503);
    if (e instanceof ProviderError) return json({ error: 'provider_error', message: e.message }, 502);
    if (e instanceof z.ZodError) return json({ error: 'invalid_model_output', message: 'The model returned output that did not match the operation schema.' }, 502);
    throw e;
  }
});
