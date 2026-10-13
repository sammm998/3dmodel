import { z } from 'zod';
import { analyzeDrawing } from '@/server/ai/orchestrator';
import { ProviderError } from '@/server/ai/providers';
import { getRepository } from '@/server/storage';
import { handle, json, readJson } from '@/server/http';
import { consumeAiRequest, requireProject, requireUser } from '@/server/auth';
import { aiStatus } from '@/server/ai/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const Body = z.object({
  image: z.string().max(12_000_000).regex(/^data:image\/(png|jpeg|webp);base64,/),
  width: z.number().int().positive().max(10000),
  height: z.number().int().positive().max(10000),
  hint: z.string().max(500).optional(),
  assetId: z.string().max(64).optional(),
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser(req);
  const body = Body.parse(await readJson(req));
  if (body.assetId) {
    const a = await getRepository().getAsset(body.assetId);
    if (a) await requireProject(req, a.projectId);
  }
  if (aiStatus().configured) await consumeAiRequest(user);
  try {
    const analysis = await analyzeDrawing(body.image, body.width, body.height, body.hint);
    if (body.assetId) await getRepository().updateAssetAnalysis(body.assetId, { ai: analysis, at: new Date().toISOString() }).catch(() => {});
    return json({ analysis });
  } catch (e) {
    if (e instanceof Error && e.message === 'not_configured') return json({ error: 'not_configured', message: 'Automatic drawing recognition needs a vision-capable LLM provider. You can still trace the plan manually.' }, 503);
    if (e instanceof ProviderError) return json({ error: 'provider_error', message: e.message }, 502);
    if (e instanceof z.ZodError) return json({ error: 'invalid_model_output', message: 'The model output did not match the floor-plan schema.' }, 502);
    throw e;
  }
});
