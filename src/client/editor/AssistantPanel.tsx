'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  CircleAlert,
  CircleSlash,
  Cpu,
  ImagePlus,
  Mic,
  MicOff,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Sparkles,
  Square,
  Undo2,
  Volume2,
  X,
} from 'lucide-react';
import { useEditor } from '../store/editor';
import { applyPending, cancelPending, sendPrompt } from '../ai/assistant';
import { useVoiceInput } from '../ai/voice';
import { Badge, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, IconButton, Spinner, Switch, Tooltip } from '../ui/primitives';
import { cn } from '../lib/utils';
import { describeElement, findElement } from '@/core/scene/query';
import { ELEMENT_TYPE_LABELS, type Element } from '@/core/schema/elements';
import { formatLength } from '@/core/schema/units';
import type { ChangeRecord } from '@/core/ops/apply';
import { ElementIcon } from './icons';

function suggestionsFor(sel: Element[], empty: boolean): string[] {
  if (!sel.length) {
    return empty
      ? [
          'Create a rectangular room that is 6m long, 4m wide, and 2.7m high, with a door and two windows.',
          'Create a modern Scandinavian villa, 240 square meters, two floors, floor-to-ceiling windows, white plaster and a swimming pool.',
          'Build a minimalist living room with oak flooring, beige walls, a large sofa and warm lighting.',
        ]
      : ['Change all windows to black aluminium frames', 'Make the roof a little steeper', 'Add two skylights'];
  }
  const t = sel[0].type;
  if (sel.length > 1) return ['Change only these objects to oak', 'Make these 20% taller', 'Delete these'];
  switch (t) {
    case 'window':
      return ['Make this window 30% wider and use black aluminium frames', 'Move it 50 cm to the left', 'Make it floor-to-ceiling', 'Replace this window with a door'];
    case 'door':
      return ['Replace this door with a sliding glass door', 'Make it 1.2 m wide', 'Change the door to walnut'];
    case 'wall':
      return ['Move this wall one meter backward and make it slightly taller', 'Change it to red brick', 'Add a window to this wall', 'Make it 30 cm thick'];
    case 'roof':
      return ['Make the roof a little steeper, change it to dark gray metal, and add two skylights', 'Make it a hip roof', 'Make the roof flatter'];
    case 'slab':
    case 'room':
      return ['Change the floor to marble', 'Remove the furniture in this room', 'Increase the ceiling height to 3 m but preserve the window proportions'];
    case 'furniture':
      return ['Make it 20% larger', 'Change it to green velvet', 'Rotate 90 degrees', 'Delete this'];
    default:
      return ['Make it 20% larger', 'Change the material to concrete', 'Move it 1 m to the right'];
  }
}

function fmtVal(v: unknown): string {
  if (typeof v === 'number') return Number(v.toFixed(3)).toString();
  if (typeof v === 'string') return v.replace(/_/g, ' ');
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('x' in o && 'z' in o) return `(${fmtVal(o.x)}, ${'y' in o ? `${fmtVal(o.y)}, ` : ''}${fmtVal(o.z)})`;
    if (Array.isArray(v)) return `${v.length} pts`;
    return '…';
  }
  return String(v);
}

function ChangeRow({ c }: { c: ChangeRecord }) {
  const tone = c.kind === 'created' ? 'text-success' : c.kind === 'deleted' ? 'text-danger' : 'text-ink-100';
  return (
    <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-2 py-1.5">
      <div className="flex items-center gap-1.5 text-[11.5px]">
        <span className={cn('font-medium', tone)}>{c.kind === 'created' ? '+' : c.kind === 'deleted' ? '−' : '~'}</span>
        <span className="truncate text-ink-100">{c.name}</span>
        <span className="font-mono text-[10px] text-ink-400">{c.id}</span>
        {c.dependent ? <Badge tone="info">dependent</Badge> : null}
        {c.outOfScope ? <Badge tone="warn">outside selection</Badge> : null}
      </div>
      {c.fields.length ? (
        <div className="mt-1 space-y-0.5">
          {c.fields
            .filter((f) => !['bim'].includes(f.field))
            .slice(0, 5)
            .map((f) => (
              <div key={f.field} className="flex items-center gap-1.5 font-mono text-[10.5px]">
                <span className="text-ink-300">{f.field}</span>
                <span className="text-ink-400 line-through decoration-ink-500">{fmtVal(f.before)}</span>
                <span className="text-ink-400">→</span>
                <span className="text-accent">{fmtVal(f.after)}</span>
              </div>
            ))}
        </div>
      ) : null}
    </div>
  );
}

function ProposalCard({ onRefine }: { onRefine: (text: string) => void }) {
  const pending = useEditor((s) => s.pending);
  if (!pending) return null;
  const r = pending.result;
  const shown = r.changes.filter((c) => !c.dependent || c.kind !== 'modified').slice(0, 8);
  const deps = r.changes.filter((c) => c.dependent).length;
  return (
    <div className="mx-3 mb-2 rounded-xl border border-accent/25 bg-gradient-to-b from-accent/[0.07] to-transparent p-3 shadow-glow animate-fade-in" data-testid="proposal">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-accent" />
        <span className="text-[12px] font-semibold text-ink-100">Proposed change</span>
        <span className="text-[11px] text-ink-300">{r.summary}</span>
        {r.destructive ? <Badge tone="danger">destructive</Badge> : null}
      </div>
      <div className="max-h-48 space-y-1 overflow-auto pr-1">
        {shown.map((c) => (
          <ChangeRow key={c.id + c.kind} c={c} />
        ))}
        {r.changes.length > shown.length ? <div className="text-[11px] text-ink-400">+ {r.changes.length - shown.length} more ({deps} dependent updates)</div> : null}
      </div>
      {r.warnings.length ? (
        <div className="mt-2 space-y-0.5">
          {r.warnings.slice(0, 3).map((w) => (
            <div key={w} className="flex items-start gap-1.5 text-[11px] text-warn">
              <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
              {w}
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-3 flex gap-1.5">
        <Button variant="primary" size="sm" onClick={applyPending} data-testid="apply-proposal">
          <Check className="h-3.5 w-3.5" /> Apply changes
        </Button>
        <Button size="sm" variant="secondary" onClick={() => cancelPending()}>
          Cancel
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onRefine(pending.prompt)}>
          <Pencil className="h-3.5 w-3.5" /> Refine
        </Button>
      </div>
    </div>
  );
}

function SelectionContext() {
  const selection = useEditor((s) => s.selection);
  const scene = useEditor((s) => s.scene);
  const els = selection.map((id) => findElement(scene, id)).filter((e): e is Element => !!e);
  if (!els.length) return null;
  const units = scene.settings.displayUnits;
  const first = els[0];
  const d = describeElement(scene, first);
  return (
    <div className="mx-3 mb-2 flex items-start gap-2 rounded-lg border border-white/[0.07] bg-ink-800/80 px-2.5 py-2" data-testid="selection-context">
      <div className="mt-0.5 rounded-md bg-accent-soft p-1 text-accent">
        <ElementIcon type={first.type} className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-ink-400">Selected {els.length > 1 ? `· ${els.length} objects` : `· ${ELEMENT_TYPE_LABELS[first.type]}`}</div>
        <div className="truncate text-[12.5px] font-medium text-ink-100">
          {els.length > 1 ? els.map((e) => e.name).join(', ') : first.name} <span className="font-mono text-[10.5px] text-ink-400">{els.length === 1 ? first.id : ''}</span>
        </div>
        {els.length === 1 ? (
          <div className="mt-0.5 truncate text-[11px] text-ink-300">
            {Object.entries(d.dimensions)
              .filter(([k]) => k !== 'offset')
              .slice(0, 4)
              .map(([k, v]) => `${k} ${k === 'area' ? `${v} m²` : k === 'pitchDeg' ? `${v}°` : k === 'steps' ? v : formatLength(v, units)}`)
              .join(' · ')}
          </div>
        ) : null}
      </div>
      <button className="rounded p-0.5 text-ink-400 hover:bg-white/5 hover:text-ink-100" onClick={() => useEditor.getState().select(null)} aria-label="Clear selection">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function StatusLine({ status, summary }: { status?: string; summary?: string }) {
  if (!status || status === 'info') return null;
  const map: Record<string, { tone: 'success' | 'accent' | 'neutral' | 'danger'; label: string; icon: React.ReactNode }> = {
    applied: { tone: 'success', label: 'Applied', icon: <Check className="h-3 w-3" /> },
    proposed: { tone: 'accent', label: 'Awaiting approval', icon: <Sparkles className="h-3 w-3" /> },
    cancelled: { tone: 'neutral', label: 'Cancelled', icon: <CircleSlash className="h-3 w-3" /> },
    failed: { tone: 'danger', label: 'Not applied', icon: <CircleAlert className="h-3 w-3" /> },
  };
  const m = map[status];
  if (!m) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <Badge tone={m.tone}>
        {m.icon}
        {m.label}
      </Badge>
      {summary ? <span className="text-[10.5px] text-ink-400">{summary}</span> : null}
      {status === 'applied' ? (
        <button className="inline-flex items-center gap-1 text-[10.5px] text-ink-300 hover:text-accent" onClick={() => useEditor.getState().undo()}>
          <Undo2 className="h-3 w-3" /> Undo
        </button>
      ) : null}
    </div>
  );
}

export function AssistantPanel() {
  const chat = useEditor((s) => s.chat);
  const busy = useEditor((s) => s.aiBusy);
  const aiInfo = useEditor((s) => s.aiInfo);
  const aiMode = useEditor((s) => s.aiMode);
  const autoApply = useEditor((s) => s.autoApplySimple);
  const speakReplies = useEditor((s) => s.speakReplies);
  const selection = useEditor((s) => s.selection);
  const scene = useEditor((s) => s.scene);
  const readOnly = useEditor((s) => s.readOnly);
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const voice = useVoiceInput((t) => {
    setText('');
    void sendPrompt(t, { voice: true });
  });

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [chat.length, busy]);

  const selEls = useMemo(() => selection.map((id) => findElement(scene, id)).filter((e): e is Element => !!e), [selection, scene]);
  const suggestions = suggestionsFor(selEls, scene.elements.length === 0);
  const usingLLM = aiMode === 'auto' && aiInfo?.configured;

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    const imgs = images;
    setImages([]);
    void sendPrompt(t, { images: imgs });
  };

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (f.type.startsWith('image/')) {
        const url = await new Promise<string>((res) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result));
          r.readAsDataURL(f);
        });
        setImages((x) => [...x, url].slice(0, 4));
      } else {
        window.dispatchEvent(new CustomEvent('ai3d:import-drawing', { detail: f }));
      }
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="assistant">
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <div className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-accent to-[#b98a3e] text-ink-950">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="text-[12.5px] font-semibold leading-tight text-ink-100">AI Design Assistant</div>
            <Tooltip
              side="bottom"
              content={
                usingLLM
                  ? `Requests are interpreted by ${aiInfo?.provider} (${aiInfo?.model}) and executed as validated operations.`
                  : aiInfo?.configured
                    ? 'Built-in interpreter forced (settings).'
                    : 'No LLM configured on the server. The built-in interpreter understands common English/Swedish modelling commands. Set OPENAI_API_KEY or ANTHROPIC_API_KEY for free-form requests.'
              }
            >
              <div className="flex cursor-help items-center gap-1 text-[10.5px] text-ink-400" data-testid="ai-provider">
                <span className={cn('h-1.5 w-1.5 rounded-full', usingLLM ? 'bg-success' : 'bg-warn')} />
                {usingLLM ? `${aiInfo?.provider} · ${aiInfo?.model}` : 'Built-in interpreter (rules)'}
              </div>
            </Tooltip>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="iconSm" aria-label="Assistant settings">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Assistant</DropdownMenuLabel>
            <div className="flex items-center justify-between px-2 py-1.5 text-[12px] text-ink-100">
              Auto-apply simple edits
              <Switch checked={autoApply} onChange={(v) => useEditor.getState().set({ autoApplySimple: v })} />
            </div>
            <div className="flex items-center justify-between px-2 py-1.5 text-[12px] text-ink-100">
              <span className="flex items-center gap-1.5">
                <Volume2 className="h-3.5 w-3.5" /> Speak replies
              </span>
              <Switch checked={speakReplies} onChange={(v) => useEditor.getState().set({ speakReplies: v })} />
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Interpreter</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => useEditor.getState().set({ aiMode: 'auto' })} disabled={!aiInfo?.configured}>
              <Cpu className="h-3.5 w-3.5" /> LLM {aiInfo?.configured ? `(${aiInfo.model})` : '(not configured)'} {aiMode === 'auto' && aiInfo?.configured ? <Check className="ml-auto h-3.5 w-3.5" /> : null}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => useEditor.getState().set({ aiMode: 'rules' })}>
              <Square className="h-3.5 w-3.5" /> Built-in rules only {aiMode === 'rules' || !aiInfo?.configured ? <Check className="ml-auto h-3.5 w-3.5" /> : null}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-2" data-testid="chat">
        {chat.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-white/10 p-4 text-center">
            <div className="mx-auto mb-2 grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-accent">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="text-[13px] font-medium text-ink-100">Describe what you want to build</div>
            <div className="mt-1 text-[11.5px] leading-relaxed text-ink-300">Then click any wall, window, roof or object and tell me how to change it — by typing or speaking.</div>
          </div>
        ) : null}
        {chat.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end animate-fade-in">
              <div className="max-w-[88%] rounded-2xl rounded-br-md bg-white/[0.08] px-3 py-2 text-[12.5px] leading-relaxed text-ink-100">
                {m.voice ? <Mic className="mr-1 inline h-3 w-3 text-accent" /> : null}
                {m.text}
              </div>
            </div>
          ) : m.role === 'system' ? (
            <div key={m.id} className="rounded-md border border-warn/15 bg-warn/[0.06] px-2.5 py-1.5 text-[11px] text-warn/90">
              {m.text}
            </div>
          ) : (
            <div key={m.id} className="animate-fade-in" data-testid="assistant-message">
              <div className="max-w-[95%] whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-100">{m.text}</div>
              <div className="mt-0.5 text-[10px] text-ink-500">{m.provider}</div>
              <StatusLine status={m.status} summary={m.summary} />
            </div>
          ),
        )}
        {busy ? (
          <div className="flex items-center gap-2 text-[12px] text-ink-300">
            <Spinner className="h-3.5 w-3.5" /> Interpreting request…
          </div>
        ) : null}
      </div>

      <ProposalCard
        onRefine={(t) => {
          cancelPending('Refining');
          setText(t);
          inputRef.current?.focus();
        }}
      />
      <SelectionContext />

      {!readOnly ? (
        <div className="px-3 pb-3">
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5">
            {suggestions.slice(0, 4).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setText(s);
                  inputRef.current?.focus();
                }}
                className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] text-ink-200 transition hover:border-accent/40 hover:text-accent"
                title={s}
              >
                {s.length > 42 ? `${s.slice(0, 40)}…` : s}
              </button>
            ))}
          </div>
          {images.length ? (
            <div className="mb-2 flex gap-1.5">
              {images.map((src, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="attachment" className="h-12 w-12 rounded-md border border-white/10 object-cover" />
                  <button className="absolute -right-1 -top-1 rounded-full bg-ink-700 p-0.5" onClick={() => setImages((x) => x.filter((_, j) => j !== i))} aria-label="Remove image">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className={cn('rounded-xl border bg-ink-900/80 transition focus-within:border-accent/50', voice.state === 'listening' ? 'border-accent/60 shadow-glow' : 'border-white/[0.08]')}>
            <textarea
              ref={inputRef}
              value={voice.state === 'listening' && voice.interim ? voice.interim : text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={selEls.length ? `Tell me how to change ${selEls.length > 1 ? 'these objects' : selEls[0].name}…` : 'Describe a building, room or change…'}
              rows={2}
              className="block max-h-40 min-h-[52px] w-full resize-none bg-transparent px-3 pt-2.5 text-[12.5px] text-ink-100 outline-none placeholder:text-ink-400"
              data-testid="prompt-input"
            />
            <div className="flex items-center justify-between px-1.5 pb-1.5">
              <div className="flex items-center gap-0.5">
                <input ref={fileRef} type="file" accept="image/*,.pdf,.dxf" multiple hidden onChange={(e) => onFiles(e.target.files)} />
                <IconButton label={usingLLM ? 'Attach image or drawing' : 'Attach drawing (images need an LLM)'} size="iconSm" onClick={() => fileRef.current?.click()}>
                  {usingLLM ? <ImagePlus className="h-4 w-4" /> : <Paperclip className="h-4 w-4" />}
                </IconButton>
                <IconButton
                  label={voice.state === 'listening' ? 'Stop & send' : `Speak (${voice.lang === 'sv-SE' ? 'Svenska' : 'English'})`}
                  size="iconSm"
                  active={voice.state === 'listening'}
                  onClick={() => (voice.state === 'listening' ? voice.stop() : voice.start())}
                  disabled={!voice.supported || voice.state === 'transcribing'}
                  data-testid="mic"
                >
                  {voice.state === 'transcribing' ? <Spinner className="h-3.5 w-3.5" /> : voice.supported ? <Mic className={cn('h-4 w-4', voice.state === 'listening' && 'animate-pulse2')} /> : <MicOff className="h-4 w-4" />}
                </IconButton>
                <button className="rounded px-1.5 py-0.5 font-mono text-[10px] text-ink-400 hover:bg-white/5 hover:text-ink-100" onClick={() => voice.setLang(voice.lang === 'sv-SE' ? 'en-US' : 'sv-SE')} title="Speech language">
                  {voice.lang === 'sv-SE' ? 'SV' : 'EN'}
                </button>
              </div>
              <Button variant="primary" size="iconSm" onClick={submit} disabled={!text.trim() || busy} aria-label="Send" data-testid="send">
                <ArrowUp className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {voice.error ? <div className="mt-1.5 text-[11px] text-danger">{voice.error}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
