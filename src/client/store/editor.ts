'use client';
import { create } from 'zustand';
import { emptyScene, type Scene } from '@/core/schema/scene';
import type { ElementType, Vec2 } from '@/core/schema/elements';
import { applyOperations, type ApplyResult } from '@/core/ops/apply';
import type { Operation, OperationInput } from '@/core/ops/operations';
import type { ChatMessage } from '@/server/storage/types';
import { HOSTED_TYPES } from '@/core/schema/elements';
import { findElement } from '@/core/scene/query';
import { uid } from '../lib/utils';

export type ViewMode = 'modeling' | 'realistic' | 'presentation';
export type Tool = 'select' | 'move' | 'rotate' | 'scale' | 'measure';
export type CameraKind = 'perspective' | 'orthographic';
export type ViewPreset = 'iso' | 'top' | 'front' | 'back' | 'left' | 'right' | 'fit';

interface Snapshot {
  scene: Scene;
  label: string;
  at: number;
}

export interface PendingProposal {
  id: string;
  prompt: string;
  message: string;
  operations: (Operation | OperationInput)[];
  result: ApplyResult;
  provider: string;
  scopeIds: string[];
}

export interface MeasureState {
  points: { x: number; y: number; z: number }[];
}

export interface EditorState {
  projectId: string | null;
  projectName: string;
  readOnly: boolean;
  scene: Scene;
  past: Snapshot[];
  future: Snapshot[];
  dirty: boolean;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: number | null;
  revision: number;

  selection: string[];
  hoverId: string | null;
  activeLevelId: string;
  levelFilter: 'all' | 'active' | 'below';
  hiddenTypes: ElementType[];
  hideRoofs: boolean;

  tool: Tool;
  viewMode: ViewMode;
  camera: CameraKind;
  viewRequest: { preset: ViewPreset; n: number } | null;
  walkMode: boolean;
  /** Progressive path-traced rendering (realistic/presentation modes). */
  pathTrace: boolean;
  pathTraceSamples: number;
  showGrid: boolean;
  showLabels: boolean;
  snap: boolean;
  gridSize: number;
  measure: MeasureState;
  viewVectors: { right: Vec2; forward: Vec2 };

  chat: ChatMessage[];
  aiBusy: boolean;
  pending: PendingProposal | null;
  autoApplySimple: boolean;
  aiMode: 'auto' | 'rules';
  speakReplies: boolean;
  aiInfo: { configured: boolean; provider: string | null; model: string | null; vision: boolean; serverSpeechToText: boolean; serverTextToSpeech: boolean } | null;
  notice: { id: string; text: string; tone: 'info' | 'success' | 'warn' | 'danger' } | null;

  // actions
  load: (p: { id: string | null; name: string; scene: Scene; chat?: ChatMessage[]; readOnly?: boolean }) => void;
  setProjectName: (name: string) => void;
  apply: (ops: (Operation | OperationInput)[], label: string, opts?: { scopeIds?: string[] }) => ApplyResult;
  commitScene: (scene: Scene, label: string) => void;
  dryRun: (ops: (Operation | OperationInput)[], scopeIds?: string[]) => ApplyResult;
  undo: () => void;
  redo: () => void;
  select: (id: string | null, additive?: boolean) => void;
  setSelection: (ids: string[]) => void;
  setHover: (id: string | null) => void;
  set: (patch: Partial<EditorState>) => void;
  requestView: (preset: ViewPreset) => void;
  addChat: (m: Omit<ChatMessage, 'id' | 'createdAt'> & { id?: string }) => string;
  updateChat: (id: string, patch: Partial<ChatMessage>) => void;
  notify: (text: string, tone?: 'info' | 'success' | 'warn' | 'danger') => void;
  markSaved: (ok: boolean, revisionAtStart?: number) => void;
}

const HISTORY_LIMIT = 150;

export const useEditor = create<EditorState>((set, get) => ({
  projectId: null,
  projectName: 'Untitled',
  readOnly: false,
  scene: emptyScene(),
  past: [],
  future: [],
  dirty: false,
  saveState: 'idle',
  lastSavedAt: null,
  revision: 0,

  selection: [],
  hoverId: null,
  activeLevelId: 'level_0',
  levelFilter: 'all',
  hiddenTypes: [],
  hideRoofs: false,

  tool: 'select',
  viewMode: 'realistic',
  camera: 'perspective',
  viewRequest: null,
  walkMode: false,
  pathTrace: false,
  pathTraceSamples: 0,
  showGrid: true,
  showLabels: true,
  snap: true,
  gridSize: 0.1,
  measure: { points: [] },
  viewVectors: { right: { x: 1, z: 0 }, forward: { x: 0, z: -1 } },

  chat: [],
  aiBusy: false,
  pending: null,
  autoApplySimple: true,
  aiMode: 'auto',
  speakReplies: false,
  aiInfo: null,
  notice: null,

  load: ({ id, name, scene, chat, readOnly }) =>
    set({
      projectId: id,
      projectName: name,
      scene,
      chat: chat ?? [],
      readOnly: !!readOnly,
      past: [],
      future: [],
      dirty: false,
      selection: [],
      pending: null,
      activeLevelId: scene.levels[0]?.id ?? 'level_0',
      viewRequest: { preset: 'iso', n: Date.now() },
      revision: get().revision + 1,
    }),

  setProjectName: (name) => set({ projectName: name, dirty: true }),

  dryRun: (ops, scopeIds) => applyOperations(get().scene, ops, { scopeIds, activeLevelId: get().activeLevelId }),

  apply: (ops, label, opts) => {
    const s = get();
    const result = applyOperations(s.scene, ops, { scopeIds: opts?.scopeIds, activeLevelId: s.activeLevelId });
    if (result.ok && result.changes.length) get().commitScene(result.scene, label);
    return result;
  },

  commitScene: (scene, label) => {
    const s = get();
    if (s.readOnly) return;
    const past = [...s.past, { scene: s.scene, label, at: Date.now() }].slice(-HISTORY_LIMIT);
    const alive = new Set(scene.elements.map((e) => e.id));
    set({
      scene,
      past,
      future: [],
      dirty: true,
      selection: s.selection.filter((id) => alive.has(id)),
      activeLevelId: scene.levels.some((l) => l.id === s.activeLevelId) ? s.activeLevelId : scene.levels[0].id,
      revision: s.revision + 1,
    });
  },

  undo: () => {
    const s = get();
    const prev = s.past[s.past.length - 1];
    if (!prev) return;
    set({
      scene: prev.scene,
      past: s.past.slice(0, -1),
      future: [{ scene: s.scene, label: prev.label, at: Date.now() }, ...s.future],
      dirty: true,
      selection: s.selection.filter((id) => prev.scene.elements.some((e) => e.id === id)),
      revision: s.revision + 1,
    });
    get().notify(`Undo: ${prev.label}`);
  },

  redo: () => {
    const s = get();
    const next = s.future[0];
    if (!next) return;
    set({
      scene: next.scene,
      future: s.future.slice(1),
      past: [...s.past, { scene: s.scene, label: next.label, at: Date.now() }],
      dirty: true,
      revision: s.revision + 1,
    });
    get().notify(`Redo: ${next.label}`);
  },

  select: (id, additive) => {
    const s = get();
    if (!id) return set({ selection: [] });
    const el = findElement(s.scene, id);
    if (el && !HOSTED_TYPES.has(el.type) && el.levelId && el.levelId !== s.activeLevelId) set({ activeLevelId: el.levelId });
    if (additive) {
      set({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] });
    } else set({ selection: [id] });
  },
  setSelection: (ids) => set({ selection: ids }),
  setHover: (id) => {
    if (get().hoverId !== id) set({ hoverId: id });
  },
  set: (patch) => set(patch),
  requestView: (preset) => set({ viewRequest: { preset, n: Date.now() } }),

  addChat: (m) => {
    const id = m.id ?? uid('msg');
    set({ chat: [...get().chat, { ...m, id, createdAt: new Date().toISOString() }].slice(-300), dirty: true });
    return id;
  },
  updateChat: (id, patch) => set({ chat: get().chat.map((c) => (c.id === id ? { ...c, ...patch } : c)), dirty: true }),
  notify: (text, tone = 'info') => {
    const id = uid('n');
    set({ notice: { id, text, tone } });
    setTimeout(() => {
      if (get().notice?.id === id) set({ notice: null });
    }, 3200);
  },
  markSaved: (ok, revisionAtStart) =>
    set({
      saveState: ok ? 'saved' : 'error',
      lastSavedAt: ok ? Date.now() : get().lastSavedAt,
      // Stay dirty if the scene changed while the save was in flight.
      dirty: ok ? revisionAtStart !== undefined && revisionAtStart !== get().revision : get().dirty,
    }),
}));

/** Non-reactive access for event handlers and tests. */
export const editor = () => useEditor.getState();
