import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCommand, PROPOSE_TOOL, systemPrompt } from '@/server/ai/orchestrator';
import { buildAiContext } from '@/core/ai/context';
import { generateBuilding } from '@/core/generator/generateBuilding';
import { applyOperations } from '@/core/ops/apply';

const scene = generateBuilding({ kind: 'room', blocks: [{ width: 6, depth: 4 }], windows: { count: 2 }, doors: { count: 1 } }).scene;
const win = scene.elements.find((e) => e.type === 'window')!;

function mockOpenAI(args: unknown) {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    expect(body.tool_choice.function.name).toBe('propose_scene_operations');
    expect(body.messages[0].role).toBe('system');
    return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'propose_scene_operations', arguments: JSON.stringify(args) } }] } }] }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('AI orchestration (mocked provider)', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.AI_PROVIDER = 'openai';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
    delete process.env.AI_PROVIDER;
  });

  it('keeps schema-valid operations and reports invalid ones', async () => {
    mockOpenAI({
      message: 'Making the window 1.8 m wide with a black frame.',
      needsConfirmation: false,
      operations: [
        { op: 'modify', id: win.id, set: { width: 1.8 } },
        { op: 'set_material', ids: [win.id], material: 'aluminium_black', slot: 'frameMaterial' },
        { op: 'run_python', code: 'import os' },
        { op: 'modify' },
      ],
    });
    const ctx = buildAiContext(scene, [win.id]);
    const r = await runCommand('Make this window 1.8m wide and black', ctx, []);
    expect(r.operations).toHaveLength(2);
    expect(r.invalidOperations.map((e) => e.index)).toEqual([2, 3]);
    const applied = applyOperations(scene, r.operations, { scopeIds: [win.id] });
    expect(applied.ok).toBe(true);
    expect(applied.changes.map((c) => c.id)).toEqual([win.id]);
  });

  it('rejects operations that reference unknown ids at execution time', async () => {
    mockOpenAI({ message: 'ok', needsConfirmation: false, operations: [{ op: 'modify', id: 'window_999', set: { width: 2 } }] });
    const r = await runCommand('x', buildAiContext(scene, []), []);
    const applied = applyOperations(scene, r.operations);
    expect(applied.ok).toBe(false);
    expect(applied.scene).toBe(scene);
  });

  it('flags model edits outside the selection', async () => {
    const other = scene.elements.filter((e) => e.type === 'window')[1];
    mockOpenAI({ message: 'ok', needsConfirmation: false, operations: [{ op: 'modify', id: other.id, set: { width: 1.0 } }] });
    const r = await runCommand('make this smaller', buildAiContext(scene, [win.id]), []);
    const applied = applyOperations(scene, r.operations, { scopeIds: [win.id] });
    expect(applied.requiresConfirmation).toBe(true);
    expect(applied.changes[0].outOfScope).toBe(true);
  });

  it('sends compact context (selection + neighbours + index), not the raw scene', () => {
    const ctx = buildAiContext(scene, [win.id]);
    expect(ctx.selection[0].element.id).toBe(win.id);
    expect(ctx.related.some((r) => r.type === 'wall')).toBe(true);
    expect(JSON.stringify(ctx).length).toBeLessThan(JSON.stringify(scene).length * 2);
  });

  it('exposes a JSON-schema tool and a system prompt containing material ids', () => {
    expect(PROPOSE_TOOL.parameters.type).toBe('object');
    expect(JSON.stringify(PROPOSE_TOOL.parameters)).toContain('set_material');
    expect(systemPrompt()).toContain('aluminium_black');
  });

  it('surfaces provider errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Incorrect API key' } }), { status: 401 })));
    await expect(runCommand('x', buildAiContext(scene, []), [])).rejects.toThrow(/401/);
  });
});

describe('Anthropic provider (mocked HTTP)', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.AI_PROVIDER = 'anthropic';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_PROVIDER;
  });

  it('uses auto tool_choice (forced tool use is rejected by current models) and parses the tool call', async () => {
    let sent: any = null;
    let headers: Headers | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        headers = new Headers(init.headers);
        return new Response(
          JSON.stringify({
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: sent.model,
            stop_reason: 'tool_use',
            content: [{ type: 'tool_use', id: 'tu_1', name: 'propose_scene_operations', input: { message: 'ok', needsConfirmation: false, operations: [{ op: 'modify', id: win.id, set: { width: 1.8 } }] } }],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const r = await runCommand('make it wider', buildAiContext(scene, [win.id]), []);
    expect(r.provider).toBe('anthropic');
    expect(r.operations).toHaveLength(1);
    expect(sent.model).toBe('claude-opus-5-5');
    expect(sent.tool_choice.type).toBe('auto');
    expect(sent.fallbacks).toBe('default');
    expect(sent.tools[0].input_schema.type).toBe('object');
    expect(JSON.stringify(sent.tools[0].input_schema)).not.toContain('"$schema"');
    expect(headers!.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
  });

  it('treats a text-only reply as a message without operations', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Which window do you mean?' }], usage: { input_tokens: 1, output_tokens: 1 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const r = await runCommand('make it wider', buildAiContext(scene, []), []);
    expect(r.operations).toHaveLength(0);
    expect(r.message).toMatch(/Which window/);
  });
});
