import { ProviderError, speechConfigured, transcribe } from '@/server/ai/providers';
import { handle, HttpError, json } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request) => {
  if (!speechConfigured()) return json({ error: 'not_configured', message: 'Server speech-to-text is not configured.' }, 503);
  const form = await req.formData();
  const audio = form.get('audio');
  const language = (form.get('language') as string | null) ?? undefined;
  if (!(audio instanceof Blob)) throw new HttpError(400, 'Missing audio');
  if (audio.size > 20 * 1024 * 1024) throw new HttpError(413, 'Audio too large');
  try {
    const text = await transcribe(audio, (audio as File).name || 'speech.webm', language && /^(sv|en)$/.test(language) ? language : undefined);
    return json({ text });
  } catch (e) {
    if (e instanceof ProviderError) return json({ error: 'provider_error', message: e.message }, 502);
    throw e;
  }
});
