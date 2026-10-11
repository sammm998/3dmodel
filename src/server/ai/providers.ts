/**
 * Provider-agnostic LLM access with forced structured tool calls.
 *
 * Configure with environment variables (see .env.example):
 *   AI_PROVIDER=openai|anthropic   (auto-detected from available keys)
 *   OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_VISION_MODEL
 *   ANTHROPIC_API_KEY, ANTHROPIC_MODEL
 * OPENAI_BASE_URL allows any OpenAI-compatible endpoint (Azure, vLLM, Ollama…).
 */

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMMessage {
  role: 'user' | 'assistant';
  text: string;
  /** data: URLs of images attached to this message */
  images?: string[];
}

export interface LLMRequest {
  system: string;
  messages: LLMMessage[];
  tool: ToolSpec;
  maxTokens?: number;
  vision?: boolean;
}

export interface LLMProvider {
  id: 'openai' | 'anthropic';
  model: string;
  callTool(req: LLMRequest): Promise<unknown>;
}

export class ProviderError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 90000);

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* non-JSON error body */
    }
    if (!res.ok) {
      const msg = data?.error?.message ?? data?.message ?? text.slice(0, 300);
      throw new ProviderError(`Provider request failed (${res.status}): ${msg}`, res.status);
    }
    return data;
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if ((e as Error).name === 'AbortError') throw new ProviderError('Provider request timed out');
    throw new ProviderError(`Provider request failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

class OpenAIProvider implements LLMProvider {
  id = 'openai' as const;
  constructor(
    private key: string,
    public model: string,
    private visionModel: string,
    private base: string,
  ) {}
  async callTool(req: LLMRequest) {
    const messages: any[] = [{ role: 'system', content: req.system }];
    for (const m of req.messages) {
      if (m.images?.length && m.role === 'user') {
        messages.push({ role: 'user', content: [{ type: 'text', text: m.text }, ...m.images.map((url) => ({ type: 'image_url', image_url: { url, detail: 'high' } }))] });
      } else messages.push({ role: m.role, content: m.text });
    }
    const data = await post(
      `${this.base.replace(/\/$/, '')}/chat/completions`,
      { authorization: `Bearer ${this.key}` },
      {
        model: req.vision ? this.visionModel : this.model,
        messages,
        tools: [{ type: 'function', function: { name: req.tool.name, description: req.tool.description, parameters: req.tool.parameters } }],
        tool_choice: { type: 'function', function: { name: req.tool.name } },
        temperature: 0.1,
        max_tokens: req.maxTokens ?? 4096,
      },
    );
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) throw new ProviderError('Model did not return a tool call');
    try {
      return JSON.parse(call.function.arguments);
    } catch {
      throw new ProviderError('Model returned malformed JSON arguments');
    }
  }
}

class AnthropicProvider implements LLMProvider {
  id = 'anthropic' as const;
  constructor(
    private key: string,
    public model: string,
  ) {}
  async callTool(req: LLMRequest) {
    const messages = req.messages.map((m) => {
      const content: any[] = [];
      for (const url of m.images ?? []) {
        const match = /^data:(image\/[a-z]+);base64,(.*)$/.exec(url);
        if (match) content.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
      }
      content.push({ type: 'text', text: m.text });
      return { role: m.role, content };
    });
    const data = await post(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': this.key, 'anthropic-version': '2023-06-01' },
      {
        model: this.model,
        max_tokens: req.maxTokens ?? 4096,
        system: req.system,
        messages,
        tools: [{ name: req.tool.name, description: req.tool.description, input_schema: req.tool.parameters }],
        tool_choice: { type: 'tool', name: req.tool.name },
      },
    );
    const block = (data?.content ?? []).find((b: any) => b.type === 'tool_use');
    if (!block) throw new ProviderError('Model did not return a tool call');
    return block.input;
  }
}

export function getProvider(): LLMProvider | null {
  const pref = (process.env.AI_PROVIDER ?? '').toLowerCase();
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (pref === 'none') return null;
  if ((pref === 'anthropic' || (!pref && !openaiKey)) && anthropicKey) {
    return new AnthropicProvider(anthropicKey, process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5');
  }
  if ((pref === 'openai' || !pref) && openaiKey) {
    const model = process.env.OPENAI_MODEL ?? 'gpt-4.1';
    return new OpenAIProvider(openaiKey, model, process.env.OPENAI_VISION_MODEL ?? model, process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1');
  }
  return null;
}

export function speechConfigured() {
  return !!process.env.OPENAI_API_KEY && (process.env.AI_PROVIDER ?? '').toLowerCase() !== 'none';
}

export function aiStatus() {
  const p = getProvider();
  return {
    configured: !!p,
    provider: p?.id ?? null,
    model: p?.model ?? null,
    vision: !!p,
    serverSpeechToText: speechConfigured(),
    serverTextToSpeech: speechConfigured(),
  };
}

/** OpenAI audio transcription (Whisper-family models). */
export async function transcribe(audio: Blob, filename: string, language?: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new ProviderError('Speech-to-text is not configured', 503);
  const form = new FormData();
  form.append('file', audio, filename);
  form.append('model', process.env.OPENAI_TRANSCRIBE_MODEL ?? 'gpt-4o-mini-transcribe');
  if (language) form.append('language', language);
  const res = await fetch(`${(process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form,
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new ProviderError(`Transcription failed (${res.status}): ${data?.error?.message ?? 'unknown error'}`, res.status);
  return String(data.text ?? '');
}

/** OpenAI text-to-speech; returns MP3 bytes. */
export async function synthesize(text: string, voice = 'alloy'): Promise<ArrayBuffer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new ProviderError('Text-to-speech is not configured', 503);
  const res = await fetch(`${(process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/audio/speech`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts', voice, input: text.slice(0, 4000), response_format: 'mp3' }),
  });
  if (!res.ok) {
    const data: any = await res.json().catch(() => ({}));
    throw new ProviderError(`Speech synthesis failed (${res.status}): ${data?.error?.message ?? 'unknown error'}`, res.status);
  }
  return res.arrayBuffer();
}
