'use client';
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, FileImage, FileUp, History, Layers3, Library, ListTree, Palette, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useEditor } from '../store/editor';
import { Badge, Button, IconButton, Switch, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip } from '../ui/primitives';
import { ElementIcon } from './icons';
import { MaterialGrid } from './MaterialPicker';
import { ELEMENT_TYPES, ELEMENT_TYPE_LABELS, type Element, type ElementType, type FurnitureKind } from '@/core/schema/elements';
import { FURNITURE_DEFAULTS } from '@/core/generator/furnish';
import { ROOM_TEMPLATES, roomTemplateOps } from '@/core/scene/rooms';
import { resolveFurnitureClashes } from '@/core/scene/clashes';
import { applyOperations } from '@/core/ops/apply';
import { findElement, levelOf, roomContaining } from '@/core/scene/query';
import type { OperationInput } from '@/core/ops/operations';
import { api } from '../lib/api';
import { cn, timeAgo } from '../lib/utils';
import type { AssetRecord, VersionRecord } from '@/server/storage/types';
import { captureThumbnail } from './capture';
import { viewportHandles } from '../three/registry';
import { round } from '@/core/geometry/math2d';

function Row({ el, depth = 0, children }: { el: Element; depth?: number; children?: React.ReactNode }) {
  const selected = useEditor((s) => s.selection.includes(el.id));
  const hover = useEditor((s) => s.hoverId === el.id);
  const [open, setOpen] = useState(false);
  const hasChildren = !!children;
  return (
    <>
      <div
        className={cn(
          'group flex h-6 cursor-default items-center gap-1 rounded-md pr-1 text-[11.5px] transition',
          selected ? 'bg-accent-soft text-accent' : hover ? 'bg-white/[0.05] text-ink-100' : 'text-ink-200 hover:bg-white/[0.04]',
          el.hidden && 'opacity-50',
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={(e) => useEditor.getState().select(el.id, e.shiftKey || e.metaKey)}
        onMouseEnter={() => useEditor.getState().setHover(el.id)}
        onMouseLeave={() => useEditor.getState().setHover(null)}
        data-testid={`tree-${el.id}`}
      >
        <button
          className={cn('grid h-4 w-4 place-items-center text-ink-400', !hasChildren && 'invisible')}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        <ElementIcon type={el.type} className="h-3 w-3 shrink-0 opacity-70" />
        <span className="flex-1 truncate">{el.name}</span>
        <button
          className="hidden text-ink-400 hover:text-ink-100 group-hover:block"
          onClick={(e) => {
            e.stopPropagation();
            useEditor.getState().apply([{ op: 'modify', id: el.id, set: { hidden: !el.hidden } }], el.hidden ? `Show ${el.name}` : `Hide ${el.name}`);
          }}
          aria-label="Toggle visibility"
        >
          {el.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        </button>
      </div>
      {open ? children : null}
    </>
  );
}

function SceneTree() {
  const scene = useEditor((s) => s.scene);
  const activeLevelId = useEditor((s) => s.activeLevelId);
  const [q, setQ] = useState('');
  const [openTypes, setOpenTypes] = useState<Record<string, boolean>>({ wall: true });
  const byLevel = useMemo(() => {
    const out = new Map<string, Map<ElementType, Element[]>>();
    for (const el of scene.elements) {
      if ('hostId' in el && el.type !== 'skylight') continue;
      if (q && !`${el.name} ${el.id}`.toLowerCase().includes(q.toLowerCase())) continue;
      const lid = levelOf(scene, el).id;
      const m = out.get(lid) ?? new Map();
      m.set(el.type, [...(m.get(el.type) ?? []), el]);
      out.set(lid, m);
    }
    return out;
  }, [scene, q]);
  const hosted = (id: string) => scene.elements.filter((e) => 'hostId' in e && e.hostId === id);

  const addLevel = () => {
    const below = scene.levels[scene.levels.length - 1];
    const r = useEditor.getState().apply([{ op: 'add_level', copyWallsFrom: below.id }], 'Add level');
    if (!r.ok) useEditor.getState().notify(r.errors[0], 'danger');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-2 pb-2">
        <input className="field" placeholder="Search objects…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      <div className="flex items-center justify-between px-3 pb-1">
        <span className="panel-title">Levels</span>
        <IconButton label="Add level (copies exterior walls)" size="iconSm" onClick={addLevel}>
          <Plus className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <div className="space-y-0.5 px-2 pb-2">
        {[...scene.levels].reverse().map((l) => (
          <button
            key={l.id}
            onClick={() => useEditor.getState().set({ activeLevelId: l.id })}
            className={cn('flex w-full items-center justify-between rounded-md px-2 py-1 text-[11.5px]', l.id === activeLevelId ? 'bg-white/[0.07] text-ink-100' : 'text-ink-300 hover:bg-white/[0.04]')}
          >
            <span>{l.name}</span>
            <span className="font-mono text-[10px] text-ink-400">
              +{l.elevation.toFixed(2)} · {l.height.toFixed(2)} m
            </span>
          </button>
        ))}
      </div>
      <div className="px-3 pb-1">
        <span className="panel-title">Hierarchy</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3" data-testid="scene-tree">
        {scene.elements.length === 0 ? <div className="px-2 py-3 text-[11.5px] text-ink-400">The scene is empty. Ask the assistant to create something, import a drawing or add objects from the library.</div> : null}
        {scene.levels.map((lvl) => {
          const types = byLevel.get(lvl.id);
          if (!types) return null;
          return (
            <div key={lvl.id} className="mb-1">
              <div className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">{lvl.name}</div>
              {ELEMENT_TYPES.filter((t) => types.has(t)).map((t) => {
                const key = `${lvl.id}:${t}`;
                const open = openTypes[key] ?? openTypes[t] ?? false;
                const list = types.get(t)!;
                return (
                  <div key={t}>
                    <button className="flex h-6 w-full items-center gap-1 rounded-md px-1.5 text-[11.5px] text-ink-300 hover:bg-white/[0.04]" onClick={() => setOpenTypes((o) => ({ ...o, [key]: !open }))}>
                      {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      <ElementIcon type={t} className="h-3 w-3" />
                      <span className="flex-1 text-left">{ELEMENT_TYPE_LABELS[t]}s</span>
                      <span className="text-[10px] text-ink-500">{list.length}</span>
                    </button>
                    {open
                      ? list.map((el) => {
                          const kids = hosted(el.id);
                          return (
                            <Row key={el.id} el={el} depth={1}>
                              {kids.length ? kids.map((k) => <Row key={k.id} el={k} depth={2} />) : undefined}
                            </Row>
                          );
                        })
                      : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LayersPanel() {
  const scene = useEditor((s) => s.scene);
  const hiddenTypes = useEditor((s) => s.hiddenTypes);
  const hideRoofs = useEditor((s) => s.hideRoofs);
  const levelFilter = useEditor((s) => s.levelFilter);
  const showLabels = useEditor((s) => s.showLabels);
  const counts = useMemo(() => {
    const c: Partial<Record<ElementType, number>> = {};
    for (const e of scene.elements) c[e.type] = (c[e.type] ?? 0) + 1;
    return c;
  }, [scene]);
  const setSettings = (patch: Partial<typeof scene.settings>) => {
    const st = useEditor.getState();
    st.commitScene({ ...st.scene, settings: { ...st.scene.settings, ...patch } }, 'Change scene settings');
  };
  return (
    <div className="space-y-4 overflow-y-auto px-3 pb-4">
      <div>
        <div className="panel-title mb-1.5">Element layers</div>
        <div className="space-y-0.5">
          {ELEMENT_TYPES.filter((t) => counts[t]).map((t) => {
            const hidden = hiddenTypes.includes(t);
            return (
              <div key={t} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[11.5px] text-ink-200 hover:bg-white/[0.03]">
                <ElementIcon type={t} className="h-3.5 w-3.5 text-ink-400" />
                <span className="flex-1">{ELEMENT_TYPE_LABELS[t]}s</span>
                <span className="text-[10px] text-ink-500">{counts[t]}</span>
                <Switch checked={!hidden} label={`Show ${t}`} onChange={(v) => useEditor.getState().set({ hiddenTypes: v ? hiddenTypes.filter((x) => x !== t) : [...hiddenTypes, t] })} />
              </div>
            );
          })}
        </div>
      </div>
      <div className="space-y-2">
        <div className="panel-title">Visibility</div>
        <label className="flex items-center justify-between text-[11.5px] text-ink-200">
          Cut away roofs
          <Switch checked={hideRoofs} onChange={(v) => useEditor.getState().set({ hideRoofs: v })} />
        </label>
        <label className="flex items-center justify-between text-[11.5px] text-ink-200">
          Room & dimension labels
          <Switch checked={showLabels} onChange={(v) => useEditor.getState().set({ showLabels: v })} />
        </label>
        <div className="flex items-center justify-between text-[11.5px] text-ink-200">
          Levels shown
          <select className="field w-36" value={levelFilter} onChange={(e) => useEditor.getState().set({ levelFilter: e.target.value as 'all' })}>
            <option value="all">All levels</option>
            <option value="active">Active level only</option>
            <option value="below">Active and below</option>
          </select>
        </div>
      </div>
      <div className="space-y-2">
        <div className="panel-title">Environment</div>
        <div className="grid grid-cols-4 gap-1">
          {(['day', 'sunset', 'overcast', 'night'] as const).map((env) => (
            <button key={env} onClick={() => setSettings({ environment: env })} className={cn('rounded-md border px-1 py-1 text-[11px] capitalize', scene.settings.environment === env ? 'border-accent/50 bg-accent-soft text-accent' : 'border-white/[0.06] text-ink-300 hover:bg-white/[0.04]')}>
              {env}
            </button>
          ))}
        </div>
        <label className="block text-[11px] text-ink-300">
          Sun azimuth {Math.round(scene.settings.sunAzimuth)}°
          <input type="range" min={0} max={360} value={scene.settings.sunAzimuth} onChange={(e) => useEditor.setState((s) => ({ scene: { ...s.scene, settings: { ...s.scene.settings, sunAzimuth: Number(e.target.value) } }, dirty: true }))} className="w-full accent-[#cdab74]" />
        </label>
        <label className="block text-[11px] text-ink-300">
          Sun elevation {Math.round(scene.settings.sunElevation)}°
          <input type="range" min={2} max={89} value={scene.settings.sunElevation} onChange={(e) => useEditor.setState((s) => ({ scene: { ...s.scene, settings: { ...s.scene.settings, sunElevation: Number(e.target.value) } }, dirty: true }))} className="w-full accent-[#cdab74]" />
        </label>
        <div className="flex items-center justify-between text-[11.5px] text-ink-200">
          Display units
          <select className="field w-24" value={scene.settings.displayUnits} onChange={(e) => setSettings({ displayUnits: e.target.value as 'm' })}>
            <option value="m">meters</option>
            <option value="cm">centimeters</option>
            <option value="mm">millimeters</option>
            <option value="ft">feet</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function MaterialsPanel() {
  const selection = useEditor((s) => s.selection);
  const scene = useEditor((s) => s.scene);
  const [q, setQ] = useState('');
  const [base, setBase] = useState('plaster_white');
  const [color, setColor] = useState('#7a8b6f');
  const [name, setName] = useState('');
  const apply = (id: string) => {
    if (!selection.length) return useEditor.getState().notify('Select objects first, then pick a material', 'warn');
    const r = useEditor.getState().apply([{ op: 'set_material', ids: selection, material: id }], 'Set material', { scopeIds: selection });
    if (!r.ok) useEditor.getState().notify(r.errors[0], 'danger');
  };
  const define = () => {
    const id = `custom_${(name || color).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`.slice(0, 60);
    const r = useEditor.getState().apply([{ op: 'define_material', material: { id, name: name || `Custom ${color}`, base, color } }], 'Define material');
    if (r.ok) {
      useEditor.getState().notify(`Material "${name || color}" created`, 'success');
      if (selection.length) apply(id);
    }
  };
  return (
    <div className="space-y-3 overflow-y-auto px-3 pb-4">
      <div className="text-[11px] text-ink-300">{selection.length ? `Click to apply to ${selection.length} selected object(s).` : 'Select objects, then click a material.'}</div>
      <input className="field" placeholder="Search materials…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      <MaterialGrid onPick={apply} custom={scene.materials} filter={q} />
      <div className="space-y-1.5 rounded-lg border border-white/[0.06] p-2">
        <div className="panel-title">Custom material</div>
        <input className="field" placeholder="Name (e.g. Sage green)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <div className="flex gap-1.5">
          <select className="field" value={base} onChange={(e) => setBase(e.target.value)}>
            {['plaster_white', 'paint_white', 'oak', 'concrete', 'aluminium', 'fabric_beige', 'tile_white', 'stone_light'].map((b) => (
              <option key={b} value={b}>
                based on {b.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-7 w-10 shrink-0 cursor-pointer rounded border border-white/10 bg-transparent" />
        </div>
        <Button size="sm" variant="subtle" className="w-full" onClick={define}>
          <Palette className="h-3.5 w-3.5" /> Create{selection.length ? ' & apply' : ''}
        </Button>
      </div>
    </div>
  );
}

const LIB_FURNITURE: FurnitureKind[] = ['sofa', 'armchair', 'coffee_table', 'dining_table', 'chair', 'bed', 'nightstand', 'wardrobe', 'kitchen_counter', 'kitchen_island', 'desk', 'office_chair', 'shelf', 'rug', 'plant', 'floor_lamp', 'pendant_lamp', 'tv_unit', 'bathtub', 'shower', 'toilet', 'vanity', 'lounger'];

function LibraryPanel() {
  const target = () => {
    const t = viewportHandles.controls?.target;
    return { x: round(t?.x ?? 0, 2), z: round(t?.z ?? 0, 2) };
  };
  const add = (ops: OperationInput[], label: string) => {
    const st = useEditor.getState();
    const r = st.apply(ops, label);
    if (!r.ok) return st.notify(r.errors[0], 'danger');
    const created = r.changes.find((c) => c.kind === 'created');
    if (created) st.select(created.id);
  };
  const addFurniture = (kind: FurnitureKind) => {
    const st = useEditor.getState();
    const sel = st.selection[0] ? findElement(st.scene, st.selection[0]) : undefined;
    const room = sel ? (sel.type === 'room' ? sel : roomContaining(st.scene, sel)) : undefined;
    let p = target();
    if (room && room.type === 'room') {
      const cx = room.polygon.reduce((a, q) => a + q.x, 0) / room.polygon.length;
      const cz = room.polygon.reduce((a, q) => a + q.z, 0) / room.polygon.length;
      p = { x: round(cx, 2), z: round(cz, 2) };
    }
    const d = FURNITURE_DEFAULTS[kind];
    const element = { type: 'furniture' as const, kind, name: d.label, levelId: room && room.type === 'room' ? room.levelId : st.activeLevelId, position: { x: p.x, y: kind === 'pendant_lamp' ? 1.9 : 0, z: p.z }, rotation: 0, width: d.w, depth: d.d, height: d.h, material: d.m, secondaryMaterial: d.m2 };
    // Drop it on the nearest free spot instead of into a wall, a doorway or other furniture.
    const trial = applyOperations(st.scene, [{ op: 'create', element }]);
    const id = trial.ok ? trial.changes.find((c) => c.kind === 'created')?.id : undefined;
    const placed = id ? resolveFurnitureClashes(trial.scene, { only: [id], keep: true }).scene.elements.find((e) => e.id === id) : undefined;
    if (placed && placed.type === 'furniture') {
      element.position = placed.position;
      element.rotation = placed.rotation;
    }
    add([{ op: 'create', element }], `Add ${d.label}`);
  };
  const addRoom = (templateId: string) => {
    const st = useEditor.getState();
    const t = ROOM_TEMPLATES.find((x) => x.id === templateId)!;
    const before = new Set(st.scene.elements.map((e) => e.id));
    const r = st.apply(roomTemplateOps(st.scene, templateId), `Add ${t.name.toLowerCase()}`);
    if (!r.ok) return st.notify(r.errors[0], 'danger');
    const room = useEditor.getState().scene.elements.find((e) => e.type === 'room' && !before.has(e.id));
    if (room) {
      useEditor.getState().select(room.id);
      useEditor.getState().requestView('iso');
      useEditor.getState().notify(`${t.name} added beside the building. Select it and use Move to place it.`, 'info');
    }
  };
  const addOpening = (type: 'window' | 'door') => {
    const st = useEditor.getState();
    const sel = st.selection[0] ? findElement(st.scene, st.selection[0]) : undefined;
    const wall = sel?.type === 'wall' ? sel : sel && 'hostId' in sel ? findElement(st.scene, sel.hostId) : undefined;
    if (!wall || wall.type !== 'wall') return st.notify('Select a wall first', 'warn');
    add([{ op: 'create', element: { type, hostId: wall.id } }], `Add ${type}`);
  };
  const p = () => target();
  const st = () => useEditor.getState();
  const items: { label: string; type: ElementType; onAdd: () => void }[] = [
    { label: 'Wall (4 m)', type: 'wall', onAdd: () => add([{ op: 'create', element: { type: 'wall', levelId: st().activeLevelId, start: { x: p().x - 2, z: p().z }, end: { x: p().x + 2, z: p().z }, height: st().scene.levels.find((l) => l.id === st().activeLevelId)?.height ?? 2.7 } }], 'Add wall') },
    { label: 'Window on wall', type: 'window', onAdd: () => addOpening('window') },
    { label: 'Door on wall', type: 'door', onAdd: () => addOpening('door') },
    { label: 'Column', type: 'column', onAdd: () => add([{ op: 'create', element: { type: 'column', levelId: st().activeLevelId, position: p() } }], 'Add column') },
    { label: 'Beam', type: 'beam', onAdd: () => add([{ op: 'create', element: { type: 'beam', levelId: st().activeLevelId, start: { x: p().x - 2, y: 2.6, z: p().z }, end: { x: p().x + 2, y: 2.6, z: p().z } } }], 'Add beam') },
    { label: 'Stair', type: 'stair', onAdd: () => add([{ op: 'create', element: { type: 'stair', levelId: st().activeLevelId, position: p() } }], 'Add stair') },
    { label: 'Floor slab 4×4', type: 'slab', onAdd: () => add([{ op: 'create', element: { type: 'slab', levelId: st().activeLevelId, material: 'oak_floor', polygon: [{ x: p().x - 2, z: p().z - 2 }, { x: p().x + 2, z: p().z - 2 }, { x: p().x + 2, z: p().z + 2 }, { x: p().x - 2, z: p().z + 2 }] } }], 'Add slab') },
    { label: 'Gable roof', type: 'roof', onAdd: () => add([{ op: 'create', element: { type: 'roof', levelId: st().activeLevelId, center: p() } }], 'Add roof') },
    { label: 'Pool', type: 'pool', onAdd: () => add([{ op: 'create', element: { type: 'pool', levelId: st().activeLevelId, center: p() } }], 'Add pool') },
    { label: 'Box', type: 'box', onAdd: () => add([{ op: 'create', element: { type: 'box', levelId: st().activeLevelId, position: { ...p(), y: 0 } } }], 'Add box') },
  ];
  return (
    <div className="space-y-3 overflow-y-auto px-3 pb-4">
      <div>
        <div className="panel-title mb-1.5">Ready-made rooms</div>
        <div className="grid grid-cols-1 gap-1">
          {ROOM_TEMPLATES.map((t) => (
            <button key={t.id} data-testid={`room-template-${t.id}`} onClick={() => addRoom(t.id)} className="flex items-center gap-2 rounded-md border border-white/[0.05] px-2 py-1.5 text-left transition hover:border-accent/30 hover:bg-white/[0.04]">
              <ElementIcon type="room" className="h-3.5 w-3.5 shrink-0 text-ink-400" />
              <span className="min-w-0">
                <span className="block text-[11px] text-ink-100">{t.name}</span>
                <span className="block truncate text-[10px] text-ink-400">{t.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="panel-title mb-1.5">Building elements</div>
        <div className="grid grid-cols-2 gap-1">
          {items.map((it) => (
            <button key={it.label} onClick={it.onAdd} className="flex items-center gap-1.5 rounded-md border border-white/[0.05] px-2 py-1.5 text-left text-[11px] text-ink-200 transition hover:border-accent/30 hover:bg-white/[0.04]">
              <ElementIcon type={it.type} className="h-3.5 w-3.5 text-ink-400" />
              {it.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="panel-title mb-1.5">Furniture & fixtures</div>
        <div className="grid grid-cols-2 gap-1">
          {LIB_FURNITURE.map((k) => (
            <button key={k} onClick={() => addFurniture(k)} className="flex items-center gap-1.5 rounded-md border border-white/[0.05] px-2 py-1.5 text-left text-[11px] text-ink-200 transition hover:border-accent/30 hover:bg-white/[0.04]">
              <ElementIcon type="furniture" className="h-3.5 w-3.5 text-ink-400" />
              {FURNITURE_DEFAULTS[k].label}
            </button>
          ))}
        </div>
        <div className="mt-2 text-[10.5px] text-ink-400">Furniture is placed in the selected room, or at the orbit centre.</div>
      </div>
    </div>
  );
}

function DrawingsPanel() {
  const projectId = useEditor((s) => s.projectId);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const refresh = () => {
    if (projectId) api.listAssets(projectId).then((r) => setAssets(r.assets)).catch(() => {});
  };
  useEffect(refresh, [projectId]);
  useEffect(() => {
    const h = () => refresh();
    window.addEventListener('ai3d:assets-changed', h);
    return () => window.removeEventListener('ai3d:assets-changed', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  return (
    <div className="space-y-3 overflow-y-auto px-3 pb-4">
      <Button variant="subtle" size="sm" className="w-full" onClick={() => window.dispatchEvent(new CustomEvent('ai3d:import-drawing'))}>
        <FileUp className="h-3.5 w-3.5" /> Import floor plan / drawing
      </Button>
      <div className="text-[10.5px] leading-relaxed text-ink-400">PNG, JPG, PDF (first page) and DXF. Calibrate the scale, trace or auto-detect walls, then generate editable 3D.</div>
      {assets.length === 0 ? <div className="text-[11.5px] text-ink-400">No drawings uploaded yet.</div> : null}
      <div className="space-y-1.5">
        {assets.map((a) => (
          <div key={a.id} className="group flex items-center gap-2 rounded-md border border-white/[0.05] p-1.5">
            {a.mime.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/assets/${a.id}`} alt={a.filename} className="h-10 w-10 rounded object-cover" />
            ) : (
              <div className="grid h-10 w-10 place-items-center rounded bg-white/5">
                <FileImage className="h-4 w-4 text-ink-400" />
              </div>
            )}
            <button className="min-w-0 flex-1 text-left" onClick={() => window.dispatchEvent(new CustomEvent('ai3d:import-drawing', { detail: { assetId: a.id } }))}>
              <div className="truncate text-[11.5px] text-ink-100">{a.filename}</div>
              <div className="text-[10px] text-ink-400">
                {(a.size / 1024).toFixed(0)} KB · {timeAgo(a.createdAt)} {a.analysis ? '· analysed' : ''}
              </div>
            </button>
            <IconButton label="Delete" size="iconSm" className="opacity-0 group-hover:opacity-100" onClick={() => api.deleteAsset(a.id).then(refresh)}>
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  );
}

function VersionsPanel() {
  const projectId = useEditor((s) => s.projectId);
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    if (projectId) api.listVersions(projectId).then((r) => setVersions(r.versions)).catch(() => {});
  };
  useEffect(refresh, [projectId]);
  const save = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      await api.createVersion(projectId, label || `Version ${versions.length + 1}`, useEditor.getState().scene, captureThumbnail(320));
      setLabel('');
      refresh();
      useEditor.getState().notify('Version saved', 'success');
    } finally {
      setBusy(false);
    }
  };
  const restore = async (v: VersionRecord) => {
    if (!projectId || !confirm(`Restore "${v.label}"? The current state stays available via Undo.`)) return;
    const { version } = await api.getVersion(projectId, v.id);
    if (version.scene) {
      useEditor.getState().commitScene(version.scene, `Restore ${v.label}`);
      useEditor.getState().notify(`Restored "${v.label}"`, 'success');
    }
  };
  return (
    <div className="space-y-3 overflow-y-auto px-3 pb-4">
      <div className="flex gap-1.5">
        <input className="field" placeholder="Version label" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <Button size="sm" variant="subtle" onClick={save} loading={busy} disabled={!projectId}>
          <Save className="h-3.5 w-3.5" /> Save
        </Button>
      </div>
      {versions.length === 0 ? <div className="text-[11.5px] text-ink-400">No saved versions. Versions are full scene snapshots you can restore later.</div> : null}
      <div className="space-y-1.5">
        {versions.map((v) => (
          <div key={v.id} className="flex items-center gap-2 rounded-md border border-white/[0.05] p-1.5">
            {v.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={v.thumbnail} alt="" className="h-10 w-14 rounded object-cover" />
            ) : (
              <div className="h-10 w-14 rounded bg-white/5" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11.5px] text-ink-100">{v.label}</div>
              <div className="text-[10px] text-ink-400">
                {timeAgo(v.createdAt)} · {v.elementCount} objects
              </div>
            </div>
            <Tooltip content="Restore this version">
              <Button size="iconSm" variant="ghost" onClick={() => restore(v)}>
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LeftSidebar() {
  const count = useEditor((s) => s.scene.elements.length);
  return (
    <Tabs defaultValue="scene" className="flex h-full min-h-0 flex-col">
      <div className="px-2 pt-2">
        <TabsList className="grid grid-cols-6">
          <TabsTrigger value="scene" title="Scene">
            <ListTree className="h-3.5 w-3.5" />
          </TabsTrigger>
          <TabsTrigger value="layers" title="Layers">
            <Layers3 className="h-3.5 w-3.5" />
          </TabsTrigger>
          <TabsTrigger value="materials" title="Materials">
            <Palette className="h-3.5 w-3.5" />
          </TabsTrigger>
          <TabsTrigger value="library" title="Asset library">
            <Library className="h-3.5 w-3.5" />
          </TabsTrigger>
          <TabsTrigger value="drawings" title="Drawings">
            <FileImage className="h-3.5 w-3.5" />
          </TabsTrigger>
          <TabsTrigger value="versions" title="Versions">
            <History className="h-3.5 w-3.5" />
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="scene" className="mt-2 min-h-0 flex-1">
        <SceneTree />
      </TabsContent>
      <TabsContent value="layers" className="mt-2 min-h-0 flex-1 overflow-auto">
        <LayersPanel />
      </TabsContent>
      <TabsContent value="materials" className="mt-2 min-h-0 flex-1 overflow-auto">
        <MaterialsPanel />
      </TabsContent>
      <TabsContent value="library" className="mt-2 min-h-0 flex-1 overflow-auto">
        <LibraryPanel />
      </TabsContent>
      <TabsContent value="drawings" className="mt-2 min-h-0 flex-1 overflow-auto">
        <DrawingsPanel />
      </TabsContent>
      <TabsContent value="versions" className="mt-2 min-h-0 flex-1 overflow-auto">
        <VersionsPanel />
      </TabsContent>
      <div className="border-t border-white/[0.05] px-3 py-1.5 text-[10px] text-ink-500">
        <Badge>{count} objects</Badge>
      </div>
    </Tabs>
  );
}
