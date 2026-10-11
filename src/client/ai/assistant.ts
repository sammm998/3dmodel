'use client';
import { useEditor, editor } from '../store/editor';
import { interpret } from '@/core/ai/interpreter';
import { buildAiContext } from '@/core/ai/context';
import type { Operation, OperationInput } from '@/core/ops/operations';
import { uid } from '../lib/utils';

interface Proposal {
  provider: string;
  message: string;
  operations: (Operation | OperationInput)[];
  needsConfirmation: boolean;
  clarifyingQuestion?: string;
  invalidOperations?: { index: number; message: string }[];
  note?: string;
}

async function callLLM(prompt: string, images: string[]): Promise<Proposal> {
  const st = editor();
  const context = buildAiContext(st.scene, st.selection, { activeLevelId: st.activeLevelId, view: st.viewVectors });
  const history = st.chat
    .filter((m) => m.role !== 'system')
    .slice(-8)
    .map((m) => ({ role: m.role as 'user' | 'assistant', text: m.text }));
  const res = await fetch('/api/ai/command', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, context, history, images }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? data.error ?? `AI request failed (${res.status})`);
  return { provider: `${data.provider} · ${data.model}`, message: data.message, operations: data.operations, needsConfirmation: data.needsConfirmation, clarifyingQuestion: data.clarifyingQuestion, invalidOperations: data.invalidOperations };
}

function runInterpreter(prompt: string): Proposal {
  const st = editor();
  const r = interpret(prompt, { scene: st.scene, selectedIds: st.selection, viewRight: st.viewVectors.right, viewForward: st.viewVectors.forward, activeLevelId: st.activeLevelId });
  return { provider: 'built-in interpreter', message: r.message, operations: r.operations, needsConfirmation: r.needsConfirmation, clarifyingQuestion: r.clarifyingQuestion };
}

export function speak(text: string) {
  if (!editor().speakReplies || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = /[åäö]|\b(och|jag|det|är)\b/i.test(text) ? 'sv-SE' : 'en-US';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

export async function sendPrompt(prompt: string, opts: { voice?: boolean; images?: string[] } = {}) {
  const st = editor();
  if (!prompt.trim() || st.aiBusy) return;
  if (st.pending) cancelPending('Superseded by a new request');
  st.addChat({ role: 'user', text: prompt, voice: opts.voice });
  st.set({ aiBusy: true });
  const scopeIds = [...st.selection];
  let proposal: Proposal;
  try {
    const useLLM = st.aiMode === 'auto' && st.aiInfo?.configured;
    if (useLLM) {
      try {
        proposal = await callLLM(prompt, opts.images ?? []);
      } catch (e) {
        proposal = runInterpreter(prompt);
        proposal.note = `LLM unavailable (${(e as Error).message}). Used the built-in interpreter instead.`;
      }
    } else {
      proposal = runInterpreter(prompt);
    }
  } finally {
    useEditor.getState().set({ aiBusy: false });
  }

  const s = editor();
  if (proposal.note) s.addChat({ role: 'system', text: proposal.note, status: 'info' });
  if (proposal.invalidOperations?.length) {
    s.addChat({ role: 'system', text: `Ignored ${proposal.invalidOperations.length} invalid operation(s) from the model: ${proposal.invalidOperations.map((i) => i.message).join(' | ').slice(0, 400)}`, status: 'info' });
  }
  if (!proposal.operations.length) {
    const text = proposal.clarifyingQuestion && proposal.clarifyingQuestion !== proposal.message ? `${proposal.message}\n\n${proposal.clarifyingQuestion}`.trim() : proposal.message;
    s.addChat({ role: 'assistant', text, provider: proposal.provider, status: 'info' });
    speak(text);
    return;
  }
  const dry = s.dryRun(proposal.operations, scopeIds);
  if (!dry.ok) {
    s.addChat({ role: 'assistant', text: `${proposal.message}\n\nI couldn't apply this: ${dry.errors.slice(0, 3).join(' · ')}`, provider: proposal.provider, status: 'failed' });
    return;
  }
  // Building into an empty scene loses nothing (and is undoable): apply directly.
  const intoEmptyScene = s.scene.elements.length === 0 && !dry.changes.some((c) => c.kind !== 'created');
  const needsConfirm = !intoEmptyScene && (proposal.needsConfirmation || dry.requiresConfirmation || !s.autoApplySimple);
  if (!needsConfirm) {
    s.commitScene(dry.scene, truncate(prompt));
    s.addChat({ role: 'assistant', text: proposal.message, provider: proposal.provider, status: 'applied', summary: dry.summary + (dry.warnings.length ? ` · ${dry.warnings[0]}` : '') });
    if (/generate_building/.test(JSON.stringify(proposal.operations.map((o) => o.op)))) s.requestView('iso');
    speak(proposal.message);
    return;
  }
  const msgId = s.addChat({ role: 'assistant', text: proposal.message, provider: proposal.provider, status: 'proposed', summary: dry.summary });
  s.set({ pending: { id: msgId, prompt, message: proposal.message, operations: proposal.operations, result: dry, provider: proposal.provider, scopeIds } });
  speak(proposal.message);
}

export function applyPending() {
  const s = editor();
  const p = s.pending;
  if (!p) return;
  // Re-validate against the current scene in case it changed.
  const r = s.dryRun(p.operations, p.scopeIds);
  if (!r.ok) {
    s.updateChat(p.id, { status: 'failed', summary: r.errors[0] });
    s.set({ pending: null });
    s.notify(r.errors[0] ?? 'Could not apply', 'danger');
    return;
  }
  s.commitScene(r.scene, truncate(p.prompt));
  s.updateChat(p.id, { status: 'applied', summary: r.summary });
  s.set({ pending: null });
  if (p.operations.some((o) => o.op === 'generate_building')) s.requestView('iso');
}

export function cancelPending(reason = 'Cancelled') {
  const s = editor();
  if (!s.pending) return;
  s.updateChat(s.pending.id, { status: 'cancelled', summary: reason });
  s.set({ pending: null });
}

function truncate(s: string) {
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

export const newId = uid;
