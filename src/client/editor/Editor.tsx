'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Camera, ChevronDown, ChevronUp, CloudOff, Download, Eye, FileUp, Loader2, Plus, Share2, Sparkles, X } from 'lucide-react';
import * as THREE from 'three';
import { useEditor, type ViewMode } from '../store/editor';
import { Viewport } from '../three/Viewport';
import { LeftSidebar } from './LeftSidebar';
import { AssistantPanel } from './AssistantPanel';
import { Inspector } from './Inspector';
import { BottomToolbar, ViewControls } from './Toolbar';
import { ExportDialog, ShareDialog } from './Dialogs';
import { DrawingImportDialog } from './DrawingImport';
import { Button, IconButton, TooltipProvider } from '../ui/primitives';
import { api } from '../lib/api';
import { cn, downloadBlob, timeAgo } from '../lib/utils';
import { captureImage, captureThumbnail } from './capture';
import { sendPrompt } from '../ai/assistant';
import { viewportHandles } from '../three/registry';
import { round } from '@/core/geometry/math2d';
import type { OperationInput } from '@/core/ops/operations';

const MODES: { id: ViewMode; label: string }[] = [
  { id: 'modeling', label: 'Modeling' },
  { id: 'realistic', label: 'Realistic' },
  { id: 'presentation', label: 'Presentation' },
];

function ModeSwitch() {
  const mode = useEditor((s) => s.viewMode);
  return (
    <div className="flex rounded-lg bg-white/[0.05] p-0.5" data-testid="mode-switch">
      {MODES.map((m) => (
        <button
          key={m.id}
          onClick={() => useEditor.getState().set({ viewMode: m.id, tool: m.id === 'presentation' ? 'select' : useEditor.getState().tool })}
          className={cn('rounded-md px-3 py-1 text-[11.5px] font-medium transition', mode === m.id ? 'bg-white/[0.1] text-ink-100 shadow-sm' : 'text-ink-300 hover:text-ink-100')}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

function SaveStatus() {
  const saveState = useEditor((s) => s.saveState);
  const dirty = useEditor((s) => s.dirty);
  const lastSavedAt = useEditor((s) => s.lastSavedAt);
  const readOnly = useEditor((s) => s.readOnly);
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 15000);
    return () => clearInterval(t);
  }, []);
  if (readOnly) return <span className="text-[11px] text-ink-400">Read-only view</span>;
  if (saveState === 'saving') return <span className="flex items-center gap-1 text-[11px] text-ink-300"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span>;
  if (saveState === 'error') return <span className="flex items-center gap-1 text-[11px] text-danger"><CloudOff className="h-3 w-3" /> Save failed — retrying</span>;
  if (dirty) return <span className="text-[11px] text-ink-400">Unsaved changes</span>;
  return <span className="text-[11px] text-ink-400" data-testid="save-status">{lastSavedAt ? `Saved ${timeAgo(new Date(lastSavedAt).toISOString())}` : 'All changes saved'}</span>;
}

function TopBar({ onShare, onExport }: { onShare: () => void; onExport: () => void }) {
  const name = useEditor((s) => s.projectName);
  const readOnly = useEditor((s) => s.readOnly);
  const [editing, setEditing] = useState(false);
  return (
    <header className="relative z-20 flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] bg-ink-900/90 px-3 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2">
        {!readOnly ? (
          <Link href="/" className="rounded-md p-1.5 text-ink-300 hover:bg-white/5 hover:text-ink-100" aria-label="Back to projects">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        ) : null}
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-accent to-[#a7793a] text-ink-950 shadow-glow">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          {editing && !readOnly ? (
            <input
              autoFocus
              defaultValue={name}
              className="field h-6 w-56 text-[13px] font-semibold"
              onBlur={(e) => {
                setEditing(false);
                if (e.target.value.trim()) useEditor.getState().setProjectName(e.target.value.trim());
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          ) : (
            <button className="block max-w-[260px] truncate text-left text-[13px] font-semibold text-ink-100 hover:text-accent" onClick={() => setEditing(true)} data-testid="project-name">
              {name}
            </button>
          )}
          <SaveStatus />
        </div>
      </div>
      <div className="absolute left-1/2 -translate-x-1/2">
        <ModeSwitch />
      </div>
      <div className="flex items-center gap-1.5">
        {!readOnly ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => window.dispatchEvent(new CustomEvent('ai3d:import-drawing'))}>
              <FileUp className="h-3.5 w-3.5" /> Import drawing
            </Button>
            <Button size="sm" variant="ghost" onClick={onShare}>
              <Share2 className="h-3.5 w-3.5" /> Share
            </Button>
          </>
        ) : null}
        <Button size="sm" variant="primary" onClick={onExport}>
          <Download className="h-3.5 w-3.5" /> Export
        </Button>
      </div>
    </header>
  );
}

function Notice() {
  const notice = useEditor((s) => s.notice);
  if (!notice) return null;
  const tone = { info: 'border-white/10', success: 'border-success/30 text-success', warn: 'border-warn/30 text-warn', danger: 'border-danger/30 text-danger' }[notice.tone];
  return (
    <div className={cn('glass pointer-events-auto absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-lg px-3 py-1.5 text-[12px] text-ink-100 animate-fade-in', tone)} data-testid="notice">
      {notice.text}
    </div>
  );
}

function EmptyState() {
  const empty = useEditor((s) => s.scene.elements.length === 0);
  const busy = useEditor((s) => s.aiBusy);
  const readOnly = useEditor((s) => s.readOnly);
  if (!empty || readOnly) return null;
  const prompts = [
    'Create a rectangular room that is 6m long, 4m wide, and 2.7m high, with a door and two windows.',
    'Create a modern Scandinavian villa, 240 square meters, two floors, floor-to-ceiling windows, white plaster exterior and a swimming pool.',
    'Create a contemporary office building with six floors and a glass facade.',
  ];
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="glass pointer-events-auto w-[min(560px,90%)] rounded-2xl p-6 text-center animate-fade-in">
        <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="text-[17px] font-semibold text-ink-100">What would you like to build?</div>
        <div className="mt-1 text-[12.5px] text-ink-300">Describe it to the assistant, or import a floor plan. Everything is generated as editable, parametric building elements.</div>
        <div className="mt-4 space-y-1.5 text-left">
          {prompts.map((p) => (
            <button key={p} disabled={busy} onClick={() => void sendPrompt(p)} className="block w-full rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-[12px] text-ink-200 transition hover:border-accent/40 hover:text-ink-100">
              {p}
            </button>
          ))}
        </div>
        <Button className="mt-3" variant="ghost" size="sm" onClick={() => window.dispatchEvent(new CustomEvent('ai3d:import-drawing'))}>
          <FileUp className="h-3.5 w-3.5" /> Import a floor plan instead
        </Button>
      </div>
    </div>
  );
}

function PresentationBar() {
  const views = useEditor((s) => s.scene.views);
  const readOnly = useEditor((s) => s.readOnly);
  const saveView = () => {
    const cam = viewportHandles.camera as THREE.PerspectiveCamera | undefined;
    const tgt = viewportHandles.controls?.target;
    if (!cam || !tgt) return;
    const st = useEditor.getState();
    const view = { id: `view_${Date.now().toString(36)}`, name: `View ${st.scene.views.length + 1}`, position: { x: round(cam.position.x, 3), y: round(cam.position.y, 3), z: round(cam.position.z, 3) }, target: { x: round(tgt.x, 3), y: round(tgt.y, 3), z: round(tgt.z, 3) }, fov: cam.fov ?? 45 };
    st.commitScene({ ...st.scene, views: [...st.scene.views, view] }, 'Save viewpoint');
  };
  const goto = (v: (typeof views)[number]) => {
    const cam = viewportHandles.camera;
    const c = viewportHandles.controls;
    if (!cam || !c) return;
    const from = cam.position.clone();
    const fromT = c.target.clone();
    const to = new THREE.Vector3(v.position.x, v.position.y, v.position.z);
    const toT = new THREE.Vector3(v.target.x, v.target.y, v.target.z);
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / 900);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      cam.position.lerpVectors(from, to, e);
      c.target.lerpVectors(fromT, toT, e);
      c.update();
      if (t < 1) requestAnimationFrame(step);
    };
    step();
  };
  return (
    <div className="glass pointer-events-auto flex max-w-[90%] items-center gap-1.5 overflow-x-auto rounded-xl px-2 py-1.5">
      {views.map((v) => (
        <Button key={v.id} size="sm" variant="ghost" onClick={() => goto(v)}>
          <Eye className="h-3.5 w-3.5" /> {v.name}
        </Button>
      ))}
      {!readOnly ? (
        <Button size="sm" variant="ghost" onClick={saveView}>
          <Plus className="h-3.5 w-3.5" /> Save viewpoint
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="subtle"
        onClick={async () => {
          const b = await captureImage(2);
          if (b) downloadBlob(b, `${useEditor.getState().projectName.replace(/\W+/g, '_')}.png`, 'image/png');
        }}
      >
        <Camera className="h-3.5 w-3.5" /> Capture still
      </Button>
      <IconButton label="Exit presentation" onClick={() => useEditor.getState().set({ viewMode: 'realistic' })}>
        <X className="h-4 w-4" />
      </IconButton>
    </div>
  );
}

function useAutosave() {
  const saving = useRef(false);
  const save = useCallback(async (manual = false) => {
    const st = useEditor.getState();
    if (!st.projectId || st.readOnly || saving.current) return;
    saving.current = true;
    const rev = st.revision;
    st.set({ saveState: 'saving' });
    try {
      await api.updateProject(st.projectId, { name: st.projectName, scene: st.scene, chat: st.chat, thumbnail: captureThumbnail(480) });
      useEditor.getState().markSaved(true, rev);
      if (manual) useEditor.getState().notify('Project saved', 'success');
    } catch (e) {
      useEditor.getState().markSaved(false);
      if (manual) useEditor.getState().notify(`Save failed: ${(e as Error).message}`, 'danger');
    } finally {
      saving.current = false;
    }
  }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useEditor.subscribe((s, prev) => {
      if (!s.dirty || s.readOnly) return;
      if (s.scene === prev.scene && s.chat === prev.chat && s.projectName === prev.projectName && s.dirty === prev.dirty) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void save(), 1500);
    });
    const retry = setInterval(() => {
      const st = useEditor.getState();
      if (st.dirty && st.saveState === 'error') void save();
    }, 10000);
    const warn = (e: BeforeUnloadEvent) => {
      if (useEditor.getState().dirty && !useEditor.getState().readOnly) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      unsub();
      clearInterval(retry);
      if (timer) clearTimeout(timer);
      window.removeEventListener('beforeunload', warn);
    };
  }, [save]);
  return save;
}

function useShortcuts(save: (manual?: boolean) => void, openExport: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const st = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        st.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save(true);
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        st.setSelection(st.scene.elements.filter((x) => (x.levelId ?? st.scene.levels[0].id) === st.activeLevelId && x.type !== 'terrain').map((x) => x.id));
        return;
      }
      if (mod) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        if (st.pending) return st.set({ pending: null });
        if (st.measure.points.length) return st.set({ measure: { points: [] } });
        if (st.tool !== 'select') return st.set({ tool: 'select' });
        return st.select(null);
      }
      if ((k === 'delete' || k === 'backspace') && st.selection.length && !st.readOnly) {
        e.preventDefault();
        const ops: OperationInput[] = st.selection.map((id) => ({ op: 'delete', id }));
        const r = st.apply(ops, `Delete ${st.selection.length} object(s)`);
        if (r.ok) st.notify(`Deleted ${r.changes.filter((c) => c.kind === 'deleted').length} object(s) — ⌘Z to undo`);
        return;
      }
      const tools: Record<string, typeof st.tool> = { v: 'select', g: 'move', r: 'rotate', s: 'scale', m: 'measure' };
      if (tools[k] && !st.readOnly) return st.set({ tool: tools[k], measure: { points: [] } });
      const views: Record<string, Parameters<typeof st.requestView>[0]> = { '1': 'iso', '2': 'top', '3': 'front', '4': 'right', f: 'fit' };
      if (views[k]) return st.requestView(views[k]);
      if (k === 'e') return openExport();
      if (k === 'p') return st.set({ viewMode: st.viewMode === 'presentation' ? 'realistic' : 'presentation' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, openExport]);
}

export function Editor({ projectId, shareToken }: { projectId?: string; shareToken?: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const viewMode = useEditor((s) => s.viewMode);
  const readOnly = useEditor((s) => s.readOnly);
  const selectionCount = useEditor((s) => s.selection.length);
  const save = useAutosave();
  const openExport = useCallback(() => setExportOpen(true), []);
  useShortcuts(save, openExport);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (shareToken) {
          const { project } = await api.getShared(shareToken);
          if (cancelled) return;
          useEditor.getState().load({ id: null, name: project.name, scene: project.scene, readOnly: true });
          useEditor.getState().set({ viewMode: 'realistic' });
        } else if (projectId) {
          const [{ project }, ai] = await Promise.all([api.getProject(projectId), api.aiStatus().catch(() => null)]);
          if (cancelled) return;
          useEditor.getState().load({ id: project.id, name: project.name, scene: project.scene, chat: project.chat });
          useEditor.getState().set({ aiInfo: ai, saveState: 'saved', lastSavedAt: new Date(project.updatedAt).getTime() });
          setToken(project.shareToken);
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, shareToken]);

  if (error) {
    return (
      <div className="grid h-screen place-items-center bg-ink-900">
        <div className="text-center">
          <div className="text-[15px] font-semibold text-ink-100">Could not open project</div>
          <div className="mt-1 text-[12.5px] text-ink-300">{error}</div>
          <Link href="/" className="mt-4 inline-block text-[12.5px] text-accent hover:underline">
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  const presentation = viewMode === 'presentation';
  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-ink-900">
        {!presentation ? <TopBar onShare={() => setShareOpen(true)} onExport={() => setExportOpen(true)} /> : null}
        <div className="relative flex min-h-0 flex-1">
          {!presentation ? (
            <aside className="relative z-10 flex w-[264px] shrink-0 flex-col border-r border-white/[0.06] bg-ink-850">
              <LeftSidebar />
            </aside>
          ) : null}
          <main className="relative min-w-0 flex-1 bg-ink-950">
            {loading ? (
              <div className="grid h-full place-items-center">
                <Loader2 className="h-6 w-6 animate-spin text-accent" />
              </div>
            ) : (
              <Viewport interactive={!readOnly || true} />
            )}
            <div className="pointer-events-none absolute inset-0">
              <Notice />
              <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
                <ViewControls />
              </div>
              {!loading ? <EmptyState /> : null}
              <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 justify-center">
                {presentation ? <PresentationBar /> : readOnly ? null : <BottomToolbar onExport={() => setExportOpen(true)} onSave={() => save(true)} />}
              </div>
            </div>
          </main>
          {!presentation ? (
            <aside className="relative z-10 flex w-[360px] shrink-0 flex-col border-l border-white/[0.06] bg-ink-850">
              <div className={cn('flex flex-col border-b border-white/[0.06]', inspectorOpen && selectionCount ? 'max-h-[46%]' : '')}>
                <button className="flex items-center justify-between px-3 py-2 text-left" onClick={() => setInspectorOpen(!inspectorOpen)}>
                  <span className="panel-title">Properties</span>
                  {inspectorOpen ? <ChevronUp className="h-3.5 w-3.5 text-ink-400" /> : <ChevronDown className="h-3.5 w-3.5 text-ink-400" />}
                </button>
                {inspectorOpen ? (
                  <div className="min-h-0 overflow-y-auto">
                    <Inspector />
                  </div>
                ) : null}
              </div>
              <div className="min-h-0 flex-1">
                <AssistantPanel />
              </div>
            </aside>
          ) : null}
        </div>
        <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
        <ShareDialog open={shareOpen} onOpenChange={setShareOpen} token={token} setToken={setToken} />
        {!readOnly ? <DrawingImportDialog /> : null}
      </div>
    </TooltipProvider>
  );
}
