'use client';
import { useEffect, useState } from 'react';
import { Copy, Eye, EyeOff, Lock, Trash2, Unlock } from 'lucide-react';
import { findClashes, resolveFurnitureClashes, type Clash } from '@/core/scene/clashes';
import { useEditor } from '../store/editor';
import { Badge, Button, IconButton } from '../ui/primitives';
import { MaterialPicker } from './MaterialPicker';
import { ElementIcon } from './icons';
import { ELEMENT_TYPE_LABELS, FurnitureKind, type Element, type ElementType } from '@/core/schema/elements';
import { describeElement, findElement, wallFrame } from '@/core/scene/query';
import { formatLength, fromDisplay, parseLength, toDisplay, type DisplayUnit } from '@/core/schema/units';
import type { OperationInput } from '@/core/ops/operations';
import { round } from '@/core/geometry/math2d';

type FieldKind = 'length' | 'number' | 'int' | 'deg' | 'rad' | 'enum' | 'material' | 'optMaterial' | 'text' | 'bool';
interface Field {
  key: string;
  label: string;
  kind: FieldKind;
  options?: readonly string[];
  min?: number;
}

const name: Field = { key: 'name', label: 'Name', kind: 'text' };
const FIELDS: Record<ElementType, Field[]> = {
  wall: [name, { key: 'length', label: 'Length', kind: 'length' }, { key: 'height', label: 'Height', kind: 'length' }, { key: 'thickness', label: 'Thickness', kind: 'length' }, { key: 'baseOffset', label: 'Base offset', kind: 'length' }, { key: 'material', label: 'Exterior / primary', kind: 'material' }, { key: 'interiorMaterial', label: 'Interior finish', kind: 'optMaterial' }, { key: 'exterior', label: 'Exterior wall', kind: 'bool' }],
  window: [name, { key: 'width', label: 'Width', kind: 'length' }, { key: 'height', label: 'Height', kind: 'length' }, { key: 'sillHeight', label: 'Sill height', kind: 'length' }, { key: 'offset', label: 'Offset on wall', kind: 'length' }, { key: 'style', label: 'Style', kind: 'enum', options: ['fixed', 'casement', 'sliding', 'curtain'] }, { key: 'mullionsVertical', label: 'Vertical mullions', kind: 'int' }, { key: 'mullionsHorizontal', label: 'Transoms', kind: 'int' }, { key: 'frameWidth', label: 'Frame width', kind: 'length' }, { key: 'frameDepth', label: 'Frame depth', kind: 'length' }, { key: 'frameMaterial', label: 'Frame', kind: 'material' }, { key: 'glazingMaterial', label: 'Glazing', kind: 'material' }],
  door: [name, { key: 'width', label: 'Width', kind: 'length' }, { key: 'height', label: 'Height', kind: 'length' }, { key: 'offset', label: 'Offset on wall', kind: 'length' }, { key: 'doorType', label: 'Type', kind: 'enum', options: ['hinged', 'double', 'sliding', 'sliding_glass', 'garage', 'opening'] }, { key: 'swing', label: 'Swing', kind: 'enum', options: ['left', 'right'] }, { key: 'leafMaterial', label: 'Leaf', kind: 'material' }, { key: 'frameMaterial', label: 'Frame', kind: 'material' }],
  slab: [name, { key: 'thickness', label: 'Thickness', kind: 'length' }, { key: 'elevation', label: 'Top elevation', kind: 'length' }, { key: 'role', label: 'Role', kind: 'enum', options: ['floor', 'ceiling', 'terrace', 'foundation', 'deck'] }, { key: 'material', label: 'Finish', kind: 'material' }],
  roof: [name, { key: 'roofType', label: 'Type', kind: 'enum', options: ['flat', 'gable', 'hip', 'shed'] }, { key: 'pitchDeg', label: 'Pitch (°)', kind: 'deg' }, { key: 'width', label: 'Width', kind: 'length' }, { key: 'depth', label: 'Depth', kind: 'length' }, { key: 'overhang', label: 'Overhang', kind: 'length' }, { key: 'thickness', label: 'Thickness', kind: 'length' }, { key: 'baseOffset', label: 'Eave height', kind: 'length' }, { key: 'ridgeAxis', label: 'Ridge axis', kind: 'enum', options: ['x', 'z'] }, { key: 'rotation', label: 'Rotation', kind: 'rad' }, { key: 'parapetHeight', label: 'Parapet', kind: 'length' }, { key: 'material', label: 'Covering', kind: 'material' }, { key: 'gableMaterial', label: 'Gables', kind: 'optMaterial' }],
  skylight: [name, { key: 'width', label: 'Width', kind: 'length' }, { key: 'length', label: 'Length', kind: 'length' }, { key: 'u', label: 'Offset X', kind: 'length' }, { key: 'v', label: 'Offset Z', kind: 'length' }, { key: 'frameMaterial', label: 'Frame', kind: 'material' }, { key: 'glazingMaterial', label: 'Glazing', kind: 'material' }],
  stair: [name, { key: 'width', label: 'Width', kind: 'length' }, { key: 'totalRise', label: 'Total rise', kind: 'length' }, { key: 'totalRun', label: 'Total run', kind: 'length' }, { key: 'steps', label: 'Steps', kind: 'int', min: 2 }, { key: 'rotation', label: 'Rotation', kind: 'rad' }, { key: 'material', label: 'Treads', kind: 'material' }],
  column: [name, { key: 'width', label: 'Width', kind: 'length' }, { key: 'depth', label: 'Depth', kind: 'length' }, { key: 'height', label: 'Height', kind: 'length' }, { key: 'shape', label: 'Shape', kind: 'enum', options: ['rect', 'round'] }, { key: 'rotation', label: 'Rotation', kind: 'rad' }, { key: 'material', label: 'Material', kind: 'material' }],
  beam: [name, { key: 'width', label: 'Width', kind: 'length' }, { key: 'depth', label: 'Depth', kind: 'length' }, { key: 'material', label: 'Material', kind: 'material' }],
  room: [name, { key: 'function', label: 'Function', kind: 'enum', options: ['living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'office', 'hall', 'storage', 'garage', 'terrace', 'other'] }, { key: 'floorMaterial', label: 'Floor finish', kind: 'optMaterial' }],
  furniture: [name, { key: 'kind', label: 'Kind', kind: 'enum', options: FurnitureKind.options }, { key: 'width', label: 'Width', kind: 'length' }, { key: 'depth', label: 'Depth', kind: 'length' }, { key: 'height', label: 'Height', kind: 'length' }, { key: 'rotation', label: 'Rotation', kind: 'rad' }, { key: 'material', label: 'Primary', kind: 'material' }, { key: 'secondaryMaterial', label: 'Secondary', kind: 'optMaterial' }],
  terrain: [name, { key: 'width', label: 'Width', kind: 'length' }, { key: 'depth', label: 'Depth', kind: 'length' }, { key: 'elevation', label: 'Elevation', kind: 'length' }, { key: 'material', label: 'Surface', kind: 'material' }],
  pool: [name, { key: 'width', label: 'Width', kind: 'length' }, { key: 'length', label: 'Length', kind: 'length' }, { key: 'waterDepth', label: 'Water depth', kind: 'length' }, { key: 'rotation', label: 'Rotation', kind: 'rad' }, { key: 'material', label: 'Basin', kind: 'material' }, { key: 'copingMaterial', label: 'Coping', kind: 'material' }],
  box: [name, { key: 'width', label: 'Width', kind: 'length' }, { key: 'depth', label: 'Depth', kind: 'length' }, { key: 'height', label: 'Height', kind: 'length' }, { key: 'rotation', label: 'Rotation', kind: 'rad' }, { key: 'material', label: 'Material', kind: 'material' }],
};

function valueOf(el: Element, key: string): unknown {
  if (key === 'length' && el.type === 'wall') return wallFrame(el).length;
  return (el as Record<string, unknown>)[key];
}

function NumberInput({ value, kind, unit, onCommit }: { value: number; kind: FieldKind; unit: DisplayUnit; onCommit: (v: number) => void }) {
  const display = kind === 'length' ? round(toDisplay(value, unit), unit === 'mm' ? 0 : 3) : kind === 'rad' ? round((value * 180) / Math.PI, 2) : round(value, 3);
  const [text, setText] = useState(String(display));
  useEffect(() => setText(String(display)), [display]);
  const commit = () => {
    let v: number | null;
    if (kind === 'length') {
      const parsed = parseLength(text);
      v = parsed === null ? null : /[a-z]/i.test(text) ? parsed : fromDisplay(parseFloat(text.replace(',', '.')), unit);
    } else v = parseFloat(text.replace(',', '.'));
    if (v === null || !Number.isFinite(v)) return setText(String(display));
    if (kind === 'rad') v = (v * Math.PI) / 180;
    if (kind === 'int') v = Math.round(v);
    if (Math.abs(v - value) > 1e-9) onCommit(v);
  };
  return (
    <div className="relative">
      <input
        className="field pr-8 font-mono"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setText(String(display));
        }}
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-ink-400">{kind === 'length' ? unit : kind === 'rad' || kind === 'deg' ? '°' : ''}</span>
    </div>
  );
}

function TextInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="field"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() && text !== value && onCommit(text.trim())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** Clashes involving one element (cached per scene revision). */
const clashCache = new WeakMap<object, Clash[]>();
function clashesFor(scene: import('@/core/schema/scene').Scene, id: string): Clash[] {
  let all = clashCache.get(scene);
  if (!all) {
    all = findClashes(scene);
    clashCache.set(scene, all);
  }
  return all.filter((c) => c.elementId === id || c.otherId === id);
}

export function Inspector() {
  const selection = useEditor((s) => s.selection);
  const scene = useEditor((s) => s.scene);
  const readOnly = useEditor((s) => s.readOnly);
  const unit = scene.settings.displayUnits;
  const els = selection.map((id) => findElement(scene, id)).filter((e): e is Element => !!e);

  const run = (ops: OperationInput[], label: string) => {
    const r = useEditor.getState().apply(ops, label, { scopeIds: selection });
    if (!r.ok) useEditor.getState().notify(r.errors[0] ?? 'Invalid value', 'danger');
    else if (r.warnings.length) useEditor.getState().notify(r.warnings[0], 'warn');
  };

  if (!els.length) {
    return (
      <div className="px-3 py-4 text-[11.5px] text-ink-400">
        Select an object in the viewport or the scene tree to edit its properties. <span className="kbd">Shift</span>-click to select several.
      </div>
    );
  }

  if (els.length > 1) {
    return (
      <div className="space-y-3 px-3 py-3">
        <div className="text-[12.5px] font-medium text-ink-100">{els.length} objects selected</div>
        <div className="flex flex-wrap gap-1">
          {els.slice(0, 12).map((e) => (
            <Badge key={e.id}>{e.name}</Badge>
          ))}
        </div>
        <label className="block space-y-1">
          <span className="text-[11px] text-ink-300">Apply material to all</span>
          <MaterialPicker custom={scene.materials} onChange={(m) => m && run([{ op: 'set_material', ids: els.map((e) => e.id), material: m }], 'Set material')} />
        </label>
        <Button variant="danger" size="sm" disabled={readOnly} onClick={() => run(els.map((e) => ({ op: 'delete', id: e.id }) as OperationInput), `Delete ${els.length} objects`)}>
          <Trash2 className="h-3.5 w-3.5" /> Delete selection
        </Button>
      </div>
    );
  }

  const el = els[0];
  const info = describeElement(scene, el);
  const fields = FIELDS[el.type];
  const setField = (key: string, v: unknown) => run([{ op: 'modify', id: el.id, set: { [key]: v }, ...(el.type === 'wall' && key === 'length' ? { anchor: 'start' as const } : {}) }], `Edit ${el.name} ${key}`);

  const duplicate = () => {
    const copy = structuredClone(el) as Record<string, unknown>;
    delete copy.id;
    copy.name = `${el.name} copy`;
    let after: OperationInput | null = null;
    if (el.type === 'window' || el.type === 'door') copy.offset = el.offset + el.width + 0.4;
    else if (el.type === 'wall') {
      copy.start = { x: el.start.x, z: el.start.z + 1 };
      copy.end = { x: el.end.x, z: el.end.z + 1 };
    } else after = null;
    const ops: OperationInput[] = [{ op: 'create', element: copy as never, ref: '$dup' }];
    if (!['window', 'door', 'wall'].includes(el.type)) ops.push({ op: 'modify', id: '$dup', translate: { x: 1, z: 1 } });
    if (after) ops.push(after);
    const r = useEditor.getState().apply(ops, `Duplicate ${el.name}`);
    if (!r.ok) useEditor.getState().notify(r.errors[0], 'danger');
    else if (r.refs.$dup) useEditor.getState().select(r.refs.$dup);
  };

  const clashes = clashesFor(scene, el.id);
  const fixPlacement = () => {
    const r = resolveFurnitureClashes(scene, { only: [el.id], keep: true });
    const moved = r.scene.elements.find((e) => e.id === el.id);
    if (!r.moved.length || !moved || moved.type !== 'furniture') {
      useEditor.getState().notify('No free spot nearby — try moving it to another part of the room.', 'warn');
      return;
    }
    run([{ op: 'modify', id: el.id, set: { position: moved.position, rotation: moved.rotation } }], `Move ${el.name} to a free spot`);
  };

  return (
    <div className="space-y-3 px-3 py-3" data-testid="inspector">
      {clashes.length ? (
        <div className="rounded-lg border border-warn/30 bg-warn/[0.07] px-2.5 py-2 text-[11.5px] text-warn" data-testid="clash-notice">
          {clashes.slice(0, 3).map((c) => (
            <div key={c.message}>{c.message}</div>
          ))}
          {el.type === 'furniture' && !readOnly ? (
            <button className="mt-1.5 rounded border border-warn/40 px-2 py-0.5 text-[11px] hover:bg-warn/10" onClick={fixPlacement} data-testid="fix-placement">
              Move to the nearest free spot
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-start gap-2">
        <div className="mt-0.5 rounded-md bg-accent-soft p-1.5 text-accent">
          <ElementIcon type={el.type} className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-ink-100">{el.name}</div>
          <div className="flex items-center gap-1.5 text-[10.5px] text-ink-400">
            <span>{ELEMENT_TYPE_LABELS[el.type]}</span>·<span className="font-mono">{el.id}</span>·<span>{info.level}</span>
          </div>
        </div>
        <div className="flex">
          <IconButton label="Duplicate" size="iconSm" onClick={duplicate} disabled={readOnly}>
            <Copy className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label={el.locked ? 'Unlock' : 'Lock'} size="iconSm" onClick={() => setField('locked', !el.locked)} disabled={readOnly}>
            {el.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
          </IconButton>
          <IconButton label={el.hidden ? 'Show' : 'Hide'} size="iconSm" onClick={() => setField('hidden', !el.hidden)} disabled={readOnly}>
            {el.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </IconButton>
          <IconButton label="Delete" size="iconSm" className="hover:text-danger" onClick={() => run([{ op: 'delete', id: el.id }], `Delete ${el.name}`)} disabled={readOnly}>
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>
      {info.room ? <div className="text-[11px] text-ink-300">In room: <span className="text-ink-100">{info.room.name}</span></div> : null}
      {'hostId' in el ? (
        <div className="text-[11px] text-ink-300">
          Hosted by{' '}
          <button className="text-accent hover:underline" onClick={() => useEditor.getState().select(el.hostId)}>
            {findElement(scene, el.hostId)?.name ?? el.hostId}
          </button>
        </div>
      ) : null}

      <fieldset disabled={readOnly || el.locked} className="grid grid-cols-[96px_1fr] items-center gap-x-2 gap-y-1.5 disabled:opacity-60">
        {fields.map((f) => {
          const v = valueOf(el, f.key);
          return (
            <div key={f.key} className="contents">
              <label className="truncate text-[11px] text-ink-300">{f.label}</label>
              {f.kind === 'text' ? (
                <TextInput value={String(v ?? '')} onCommit={(t) => setField(f.key, t)} />
              ) : f.kind === 'enum' ? (
                <select className="field" value={String(v)} onChange={(e) => setField(f.key, e.target.value)}>
                  {f.options!.map((o) => (
                    <option key={o} value={o}>
                      {o.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              ) : f.kind === 'bool' ? (
                <input type="checkbox" className="h-3.5 w-3.5 accent-[#cdab74]" checked={!!v} onChange={(e) => setField(f.key, e.target.checked)} />
              ) : f.kind === 'material' || f.kind === 'optMaterial' ? (
                <MaterialPicker value={v as string | undefined} custom={scene.materials} allowNone={f.kind === 'optMaterial'} onChange={(m) => (m ? run([{ op: 'set_material', ids: [el.id], material: m, slot: f.key }], `Set ${f.label}`) : setField(f.key, undefined))} />
              ) : (
                <NumberInput value={Number(v ?? 0)} kind={f.kind} unit={unit} onCommit={(n) => setField(f.key, n)} />
              )}
            </div>
          );
        })}
      </fieldset>

      {el.bim && Object.keys(el.bim).length ? (
        <div>
          <div className="panel-title mb-1">BIM data</div>
          <div className="grid grid-cols-[96px_1fr] gap-x-2 gap-y-0.5 text-[11px]">
            {Object.entries(el.bim).map(([k, val]) => (
              <div key={k} className="contents">
                <span className="text-ink-400">{k}</span>
                <span className="font-mono text-ink-200">{String(val)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="text-[10.5px] text-ink-500">Dimensions: {Object.entries(info.dimensions).map(([k, val]) => `${k} ${k === 'area' ? `${val} m²` : k === 'pitchDeg' || k === 'steps' ? val : formatLength(val, unit)}`).join(' · ')}</div>
    </div>
  );
}
