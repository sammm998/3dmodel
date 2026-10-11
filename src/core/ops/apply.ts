/**
 * Transactional, deterministic execution of scene operations.
 *
 * `applyOperations` never mutates its input. It returns the new scene, a
 * per-element change list (for previews and history), validation issues and a
 * risk classification. If any error occurs the caller must not commit.
 */
import { Element, HOSTED_TYPES, type Vec2, type WallElement } from '../schema/elements';
import { emptyScene, type Scene } from '../schema/scene';
import { generateBuilding } from '../generator/generateBuilding';
import { materialExists } from '../materials/library';
import { add2, dot2, polygonCentroid, rotate2, round, scale2, sub2 } from '../geometry/math2d';
import {
  elementAnchor,
  elementsInRoom,
  findElement,
  hostedChildren,
  materialSlots,
  pointAlongWall,
  sceneBounds,
  wallFrame,
  wallsTouchingPoint,
} from '../scene/query';
import { createElement } from '../scene/factory';
import { validateScene, type SceneIssue } from './validate';
import { Operation, type OperationInput } from './operations';

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface ChangeRecord {
  id: string;
  type: string;
  name: string;
  kind: 'created' | 'modified' | 'deleted';
  fields: FieldChange[];
  /** Changed as a consequence of another change (joined walls, hosted openings). */
  dependent: boolean;
  /** Directly targeted although it was not part of the selection scope. */
  outOfScope: boolean;
}

export interface ApplyOptions {
  /** Selected element ids; edits outside this scope are flagged. */
  scopeIds?: string[];
  activeLevelId?: string;
}

export interface ApplyResult {
  ok: boolean;
  scene: Scene;
  changes: ChangeRecord[];
  errors: string[];
  warnings: string[];
  issues: SceneIssue[];
  destructive: boolean;
  requiresConfirmation: boolean;
  refs: Record<string, string>;
  /** Short human readable summary. */
  summary: string;
}

class OpError extends Error {}

export function applyOperations(input: Scene, rawOps: (Operation | OperationInput)[], opts: ApplyOptions = {}): ApplyResult {
  const s: Scene = structuredClone(input);
  const refs: Record<string, string> = {};
  const errors: string[] = [];
  const warnings: string[] = [];
  const explicit = new Set<string>();
  let destructive = false;

  const resolve = (id: string) => (id.startsWith('$') ? refs[id] ?? id : id);
  const get = (id: string) => {
    const el = findElement(s, resolve(id));
    if (!el) throw new OpError(`Element "${id}" does not exist`);
    return el;
  };
  const put = (el: Element) => {
    const idx = s.elements.findIndex((e) => e.id === el.id);
    if (idx < 0) s.elements.push(el);
    else s.elements[idx] = el;
  };
  const remove = (id: string) => {
    const children = hostedChildren(s, id);
    s.elements = s.elements.filter((e) => e.id !== id);
    for (const c of children) remove(c.id);
  };
  const parseEl = (obj: unknown, label: string): Element => {
    const r = Element.safeParse(obj);
    if (!r.success) throw new OpError(`${label}: ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    return r.data;
  };
  const resolveDraft = (draft: Record<string, unknown>) => {
    const d = { ...draft };
    if (typeof d.hostId === 'string') d.hostId = resolve(d.hostId);
    if (typeof d.levelId === 'string' && !s.levels.some((l) => l.id === d.levelId)) {
      throw new OpError(`Unknown level ${d.levelId}`);
    }
    return d as Record<string, unknown> & { type: Element['type'] };
  };

  /** Moves a wall's endpoints, stretching joined walls and keeping openings in place. */
  const moveWall = (before: WallElement, after: WallElement, propagate = true) => {
    for (const key of ['start', 'end'] as const) {
      const oldP = before[key];
      const newP = after[key];
      if (Math.abs(oldP.x - newP.x) < 1e-9 && Math.abs(oldP.z - newP.z) < 1e-9) continue;
      if (!propagate) continue;
      const disp = sub2(newP, oldP);
      const dl = Math.hypot(disp.x, disp.z);
      for (const { wall, end } of wallsTouchingPoint(s, oldP, before.levelId, before.id)) {
        // Stretch joined walls only along their own axis so they stay straight;
        // otherwise the joint is released and reported.
        const dir = wallFrame(wall).dir;
        if (Math.abs(dot2(disp, dir)) / dl > 0.999) {
          const stretched = { ...wall, [end]: { ...newP } } as WallElement;
          keepOpeningsInPlace(wall, stretched);
          put(stretched);
        } else {
          warnings.push(`${wall.name} is no longer joined to ${before.name}`);
        }
      }
    }
    keepOpeningsInPlace(before, after);
  };

  const keepOpeningsInPlace = (before: WallElement, after: WallElement) => {
    const fb = wallFrame(before);
    const fa = wallFrame(after);
    const parallel = dot2(fb.dir, fa.dir) > 0.999;
    for (const child of hostedChildren(s, before.id)) {
      if (child.type !== 'window' && child.type !== 'door') continue;
      if (!parallel) continue;
      const p = pointAlongWall(before, child.offset);
      // Project onto the new line; perpendicular moves keep the offset.
      const newOffset = dot2(sub2(p, after.start), fa.dir);
      if (Math.abs(newOffset - child.offset) > 1e-9) put({ ...child, offset: round(newOffset) });
    }
  };

  const setWallLength = (w: WallElement, length: number, anchor: 'start' | 'center' | 'end'): WallElement => {
    if (!(length > 0)) throw new OpError(`Wall length must be positive`);
    const f = wallFrame(w);
    let start = w.start;
    let end = w.end;
    if (anchor === 'start') end = add2(w.start, scale2(f.dir, length));
    else if (anchor === 'end') start = sub2(w.end, scale2(f.dir, length));
    else {
      const mid = { x: (w.start.x + w.end.x) / 2, z: (w.start.z + w.end.z) / 2 };
      start = sub2(mid, scale2(f.dir, length / 2));
      end = add2(mid, scale2(f.dir, length / 2));
    }
    return { ...w, start: roundV(start), end: roundV(end) };
  };

  const ops: Operation[] = [];
  rawOps.forEach((raw, i) => {
    const r = Operation.safeParse(raw);
    if (r.success) ops.push(r.data);
    else errors.push(`Operation ${i + 1} is invalid: ${r.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`);
  });

  if (!errors.length) {
    for (const [i, op] of ops.entries()) {
      try {
        switch (op.op) {
          case 'create': {
            const draft = resolveDraft(op.element as Record<string, unknown>);
            if (HOSTED_TYPES.has(draft.type)) {
              const host = typeof draft.hostId === 'string' ? findElement(s, draft.hostId) : undefined;
              if (!host) throw new OpError(`A ${draft.type} needs an existing hostId`);
            }
            const el = createElement(s, draft, { levelId: opts.activeLevelId });
            s.elements.push(el);
            if (op.ref) refs[op.ref] = el.id;
            break;
          }
          case 'modify': {
            const el = get(op.id);
            explicit.add(el.id);
            const next = modifyElement(s, el, op, setWallLength);
            const parsed = parseEl(next, el.name);
            if (parsed.type === 'wall' && el.type === 'wall') moveWall(el, parsed);
            put(parsed);
            break;
          }
          case 'delete': {
            const el = get(op.id);
            explicit.add(el.id);
            remove(el.id);
            destructive = true;
            break;
          }
          case 'delete_where': {
            destructive = true;
            let candidates = s.elements.filter((e) => op.types.includes(e.type));
            if (op.roomId) {
              const room = get(op.roomId);
              if (room.type !== 'room') throw new OpError(`${op.roomId} is not a room`);
              const inRoom = new Set(elementsInRoom(s, room, op.types).map((e) => e.id));
              candidates = candidates.filter((e) => inRoom.has(e.id));
            }
            if (op.levelId) candidates = candidates.filter((e) => (e.levelId ?? s.levels[0].id) === op.levelId);
            for (const c of candidates) {
              explicit.add(c.id);
              remove(c.id);
            }
            if (!candidates.length) warnings.push('No matching elements to remove');
            break;
          }
          case 'replace': {
            const old = get(op.id);
            explicit.add(old.id);
            destructive = true;
            const draft = resolveDraft(op.element as Record<string, unknown>);
            const placement: Record<string, unknown> = { levelId: old.levelId };
            if ('hostId' in old && HOSTED_TYPES.has(draft.type) && draft.type !== 'skylight') {
              placement.hostId = old.hostId;
              placement.offset = 'offset' in old ? old.offset : undefined;
            }
            if ('position' in old && ('position' in draft || ['furniture', 'box', 'column', 'stair'].includes(draft.type))) {
              placement.position = old.position;
            }
            if ('rotation' in old) placement.rotation = old.rotation;
            const children = hostedChildren(s, old.id);
            s.elements = s.elements.filter((e) => e.id !== old.id);
            const el = createElement(s, { ...placement, ...draft, type: draft.type }, { levelId: opts.activeLevelId });
            s.elements.push(el);
            // Re-host children when a wall is replaced by a wall.
            for (const c of children) {
              if (el.type === 'wall' && (c.type === 'window' || c.type === 'door')) put({ ...c, hostId: el.id });
              else s.elements = s.elements.filter((e) => e.id !== c.id);
            }
            refs[`$replaced_${old.id}`] = el.id;
            break;
          }
          case 'set_material': {
            const mat = op.material;
            if (!materialExists(mat, s.materials)) throw new OpError(`Unknown material "${mat}"`);
            for (const rawId of op.ids) {
              const el = get(rawId);
              explicit.add(el.id);
              const slots = materialSlots(el);
              let slot = op.slot ?? slots[0];
              if (!slots.includes(slot)) {
                if (op.slot === 'material' || op.slot === undefined) slot = slots[0];
                else throw new OpError(`${el.name} has no material slot "${op.slot}" (available: ${slots.join(', ')})`);
              }
              put(parseEl({ ...el, [slot]: mat }, el.name));
            }
            break;
          }
          case 'define_material': {
            const idx = s.materials.findIndex((m) => m.id === op.material.id);
            if (idx >= 0) s.materials[idx] = op.material;
            else s.materials.push(op.material);
            break;
          }
          case 'set_level': {
            const lvl = s.levels.find((l) => l.id === op.id);
            if (!lvl) throw new OpError(`Unknown level ${op.id}`);
            if (op.name) lvl.name = op.name;
            if (op.height && Math.abs(op.height - lvl.height) > 1e-9) {
              const old = lvl.height;
              const ratio = op.height / old;
              const delta = op.height - old;
              for (const other of s.levels) if (other.elevation > lvl.elevation + 1e-6) other.elevation = round(other.elevation + delta);
              lvl.height = op.height;
              const near = (a: number, b: number) => Math.abs(a - b) < 0.02;
              for (const el of [...s.elements]) {
                if ((el.levelId ?? s.levels[0].id) !== lvl.id) continue;
                if (el.type === 'wall' && near(el.height + el.baseOffset, old)) put({ ...el, height: round(op.height - el.baseOffset) });
                if (el.type === 'roof' && near(el.baseOffset, old)) put({ ...el, baseOffset: op.height });
                if (el.type === 'stair' && near(el.totalRise, old)) put({ ...el, totalRise: op.height });
                if (el.type === 'column' && near(el.height, old)) put({ ...el, height: op.height });
              }
              if (op.preserveOpeningProportions) {
                for (const el of [...s.elements]) {
                  if (el.type !== 'window') continue;
                  const host = findElement(s, el.hostId);
                  if (!host || (host.levelId ?? s.levels[0].id) !== lvl.id) continue;
                  put({ ...el, height: round(el.height * ratio), width: round(el.width * ratio), sillHeight: round(el.sillHeight * ratio) });
                }
              }
            }
            break;
          }
          case 'add_level': {
            const top = [...s.levels].sort((a, b) => b.elevation - a.elevation)[0];
            const id = `level_${s.levels.length}`;
            const lvl = { id, name: op.name ?? `Floor ${s.levels.length}`, elevation: round(top.elevation + top.height), height: op.height ?? top.height };
            s.levels.push(lvl);
            if (op.copyWallsFrom) {
              const src = s.levels.find((l) => l.id === op.copyWallsFrom);
              if (!src) throw new OpError(`Unknown level ${op.copyWallsFrom}`);
              for (const w of s.elements.filter((e): e is WallElement => e.type === 'wall' && e.levelId === src.id && e.exterior)) {
                s.elements.push(createElement(s, { ...w, type: 'wall', id: undefined, name: `${w.name.split(' · ')[0]} · ${lvl.name}`, levelId: id, height: lvl.height }));
              }
              for (const r of s.elements.filter((e) => e.type === 'roof' && e.levelId === top.id)) put({ ...r, levelId: id } as Element);
            }
            break;
          }
          case 'generate_building': {
            if (op.mode === 'replace') {
              destructive = s.elements.length > 0;
              const base: Scene = { ...emptyScene(), counters: s.counters, materials: s.materials, settings: s.settings, views: [] };
              const g = generateBuilding(op.program, { scene: base, origin: op.origin });
              s.elements = g.scene.elements;
              s.levels = g.scene.levels;
              s.counters = g.scene.counters;
            } else {
              const b = sceneBounds(s);
              const width = Math.max(...op.program.blocks.map((bl) => bl.x + bl.width)) - Math.min(...op.program.blocks.map((bl) => bl.x));
              const origin = op.origin ?? (b ? { x: b.max.x + 4 + width / 2, z: (b.min.z + b.max.z) / 2 } : { x: 0, z: 0 });
              const g = generateBuilding(op.program, { scene: s, origin });
              s.elements = g.scene.elements;
              s.levels = g.scene.levels;
              s.counters = g.scene.counters;
            }
            break;
          }
          case 'group': {
            const gid = `group_${(s.counters.group ?? 0) + 1}`;
            s.counters.group = (s.counters.group ?? 0) + 1;
            s.groups.push({ id: gid, name: op.name });
            for (const id of op.ids) {
              const el = get(id);
              put({ ...el, groupId: gid });
            }
            break;
          }
        }
      } catch (e) {
        errors.push(`Operation ${i + 1} (${op.op}): ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
    }
  }

  const issues = errors.length ? [] : validateScene(s);
  for (const iss of issues) {
    if (iss.severity === 'error') errors.push(iss.message);
  }
  // Only report warnings that are new compared to the input scene.
  const before = new Set(validateScene(input).map((i) => i.message));
  for (const iss of issues) if (iss.severity === 'warning' && !before.has(iss.message)) warnings.push(iss.message);

  const changes = diffScenes(input, s, explicit, opts.scopeIds);
  const outOfScope = changes.some((c) => c.outOfScope);
  if (changes.some((c) => c.kind === 'deleted')) destructive = true;
  if (outOfScope) warnings.push('Some changes affect objects outside the current selection');
  const requiresConfirmation = destructive || outOfScope || changes.length > 25;

  return {
    ok: errors.length === 0,
    scene: errors.length ? input : s,
    changes,
    errors,
    warnings,
    issues,
    destructive,
    requiresConfirmation,
    refs,
    summary: summarize(changes),
  };
}

function roundV(p: Vec2): Vec2 {
  return { x: round(p.x), z: round(p.z) };
}

type ModifyOpT = Extract<Operation, { op: 'modify' }>;

/** Pure property-level modification of one element (no dependency handling). */
function modifyElement(
  s: Scene,
  el: Element,
  op: ModifyOpT,
  setWallLength: (w: WallElement, length: number, anchor: 'start' | 'center' | 'end') => WallElement,
): Record<string, unknown> {
  let next: Record<string, unknown> = structuredClone(el) as Record<string, unknown>;
  const anchor = op.anchor ?? (el.type === 'wall' ? 'start' : 'center');
  const VEC_KEYS = new Set(['position', 'center', 'start', 'end']);
  const slots = materialSlots(el);

  // --- set ------------------------------------------------------------------
  let wallLength: number | undefined;
  for (const [k, v] of Object.entries(op.set ?? {})) {
    if (k === 'id' || k === 'type') throw new OpError(`"${k}" cannot be changed; use replace instead`);
    if (k === 'length' && el.type === 'wall') {
      if (typeof v !== 'number') throw new OpError('length must be a number');
      wallLength = v;
      continue;
    }
    let key = k;
    if (k === 'material' && !slots.includes('material')) key = slots[0];
    if (VEC_KEYS.has(key) && v && typeof v === 'object') {
      next[key] = { ...(next[key] as object), ...(v as object) };
    } else if (key === 'width' && el.type === 'window' && anchor !== 'center') {
      next[key] = v;
    } else {
      if (!(key in next) && !isKnownOptionalKey(el.type, key)) throw new OpError(`${el.name} has no property "${k}"`);
      next[key] = v;
    }
  }

  // --- scale / add ------------------------------------------------------------
  const numeric = (key: string) => {
    if (key === 'length' && el.type === 'wall') return wallLength ?? wallFrame(el).length;
    const v = next[key];
    if (typeof v !== 'number') throw new OpError(`${el.name} has no numeric property "${key}"`);
    return v;
  };
  const assign = (key: string, value: number) => {
    if (key === 'length' && el.type === 'wall') wallLength = value;
    else if (key === 'steps') next[key] = Math.max(2, Math.round(value));
    else next[key] = round(value);
  };
  for (const [k, f] of Object.entries(op.scale ?? {})) {
    if (!(f > 0)) throw new OpError(`Scale factor for ${k} must be positive`);
    assign(k, numeric(k) * f);
  }
  for (const [k, d] of Object.entries(op.add ?? {})) assign(k, numeric(k) + d);

  // Openings: keep the chosen anchor when width changes.
  if ((el.type === 'window' || el.type === 'door') && typeof next.width === 'number' && next.width !== el.width) {
    if (anchor === 'start') next.offset = round(el.offset - el.width / 2 + (next.width as number) / 2);
    else if (anchor === 'end') next.offset = round(el.offset + el.width / 2 - (next.width as number) / 2);
  }

  if (wallLength !== undefined && el.type === 'wall') {
    next = { ...next, ...setWallLength(next as WallElement, wallLength, anchor) };
  }

  // --- translate ------------------------------------------------------------
  const t = op.translate;
  if (t && (t.x || t.y || t.z)) {
    const dx = t.x ?? 0;
    const dy = t.y ?? 0;
    const dz = t.z ?? 0;
    const mv = (p: Vec2) => roundV({ x: p.x + dx, z: p.z + dz });
    switch (el.type) {
      case 'wall':
        next.start = mv(next.start as Vec2);
        next.end = mv(next.end as Vec2);
        if (dy) next.baseOffset = round((next.baseOffset as number) + dy);
        break;
      case 'window':
      case 'door': {
        const host = findElement(s, el.hostId);
        if (host?.type === 'wall') {
          const f = wallFrame(host);
          next.offset = round((next.offset as number) + dx * f.dir.x + dz * f.dir.z);
        }
        if (dy && el.type === 'window') next.sillHeight = round((next.sillHeight as number) + dy);
        break;
      }
      case 'slab':
      case 'room':
        next.polygon = (next.polygon as Vec2[]).map(mv);
        if (dy && el.type === 'slab') next.elevation = round((next.elevation as number) + dy);
        break;
      case 'roof':
      case 'terrain':
      case 'pool':
        next.center = mv(next.center as Vec2);
        if (dy && el.type === 'roof') next.baseOffset = round((next.baseOffset as number) + dy);
        if (dy && el.type === 'terrain') next.elevation = round((next.elevation as number) + dy);
        break;
      case 'skylight':
        next.u = round((next.u as number) + dx);
        next.v = round((next.v as number) + dz);
        break;
      case 'stair':
      case 'column':
        next.position = mv(next.position as Vec2);
        if (dy) next.baseOffset = round((next.baseOffset as number) + dy);
        break;
      case 'beam': {
        const a = next.start as { x: number; y: number; z: number };
        const b = next.end as { x: number; y: number; z: number };
        next.start = { x: round(a.x + dx), y: round(a.y + dy), z: round(a.z + dz) };
        next.end = { x: round(b.x + dx), y: round(b.y + dy), z: round(b.z + dz) };
        break;
      }
      case 'furniture':
      case 'box': {
        const p = next.position as { x: number; y: number; z: number };
        next.position = { x: round(p.x + dx), y: round(p.y + dy), z: round(p.z + dz) };
        break;
      }
    }
  }

  if (op.moveAlongHost) {
    if (el.type !== 'window' && el.type !== 'door') throw new OpError('moveAlongHost only applies to windows and doors');
    next.offset = round((next.offset as number) + op.moveAlongHost);
  }
  if (op.moveNormal) {
    if (el.type !== 'wall') throw new OpError('moveNormal only applies to walls');
    const n = wallFrame(next as WallElement).normal;
    next.start = roundV(add2(next.start as Vec2, scale2(n, op.moveNormal)));
    next.end = roundV(add2(next.end as Vec2, scale2(n, op.moveNormal)));
  }

  // --- rotate ---------------------------------------------------------------
  if (op.rotateDeg) {
    const a = (op.rotateDeg * Math.PI) / 180;
    switch (el.type) {
      case 'wall': {
        const mid = { x: ((next.start as Vec2).x + (next.end as Vec2).x) / 2, z: ((next.start as Vec2).z + (next.end as Vec2).z) / 2 };
        next.start = roundV(rotate2(next.start as Vec2, a, mid));
        next.end = roundV(rotate2(next.end as Vec2, a, mid));
        break;
      }
      case 'slab':
      case 'room': {
        const c = polygonCentroid(next.polygon as Vec2[]);
        next.polygon = (next.polygon as Vec2[]).map((p) => roundV(rotate2(p, a, c)));
        break;
      }
      case 'beam': {
        const sp = next.start as { x: number; y: number; z: number };
        const ep = next.end as { x: number; y: number; z: number };
        const mid = { x: (sp.x + ep.x) / 2, z: (sp.z + ep.z) / 2 };
        const rs = rotate2({ x: sp.x, z: sp.z }, a, mid);
        const re = rotate2({ x: ep.x, z: ep.z }, a, mid);
        next.start = { ...sp, x: round(rs.x), z: round(rs.z) };
        next.end = { ...ep, x: round(re.x), z: round(re.z) };
        break;
      }
      case 'window':
      case 'door':
      case 'skylight':
        throw new OpError(`${el.name} is hosted and follows its host's orientation`);
      default:
        if ('rotation' in next) next.rotation = round((next.rotation as number) + a, 6);
        else throw new OpError(`${el.name} cannot be rotated`);
    }
  }
  void elementAnchor;
  return next;
}

const OPTIONAL_KEYS: Record<string, string[]> = {
  '*': ['levelId', 'groupId', 'layer', 'hidden', 'locked', 'tags', 'bim', 'name'],
  wall: ['interiorMaterial'],
  roof: ['gableMaterial'],
  room: ['floorMaterial'],
  furniture: ['secondaryMaterial'],
};

function isKnownOptionalKey(type: string, key: string) {
  return OPTIONAL_KEYS['*'].includes(key) || (OPTIONAL_KEYS[type] ?? []).includes(key);
}

/** Compares two scenes element by element. */
export function diffScenes(a: Scene, b: Scene, explicit: Set<string> = new Set(), scopeIds?: string[]): ChangeRecord[] {
  const scope = scopeIds && scopeIds.length ? new Set(scopeIds) : null;
  const mapA = new Map(a.elements.map((e) => [e.id, e]));
  const mapB = new Map(b.elements.map((e) => [e.id, e]));
  const out: ChangeRecord[] = [];
  const inScope = (id: string) => !scope || scope.has(id);
  for (const [id, eb] of mapB) {
    const ea = mapA.get(id);
    if (!ea) {
      out.push({ id, type: eb.type, name: eb.name, kind: 'created', fields: [], dependent: false, outOfScope: false });
      continue;
    }
    const fields: FieldChange[] = [];
    const keys = new Set([...Object.keys(ea), ...Object.keys(eb)]);
    for (const k of keys) {
      const va = (ea as Record<string, unknown>)[k];
      const vb = (eb as Record<string, unknown>)[k];
      if (JSON.stringify(va) !== JSON.stringify(vb)) fields.push({ field: k, before: va, after: vb });
    }
    if (fields.length) {
      const isExplicit = explicit.has(id);
      out.push({ id, type: eb.type, name: eb.name, kind: 'modified', fields, dependent: !isExplicit, outOfScope: isExplicit && !inScope(id) });
    }
  }
  for (const [id, ea] of mapA) {
    if (!mapB.has(id)) {
      const isExplicit = explicit.has(id);
      out.push({ id, type: ea.type, name: ea.name, kind: 'deleted', fields: [], dependent: !isExplicit, outOfScope: isExplicit && !inScope(id) });
    }
  }
  return out;
}

function summarize(changes: ChangeRecord[]): string {
  const c = changes.filter((x) => x.kind === 'created').length;
  const m = changes.filter((x) => x.kind === 'modified').length;
  const d = changes.filter((x) => x.kind === 'deleted').length;
  const parts: string[] = [];
  if (c) parts.push(`${c} created`);
  if (m) parts.push(`${m} modified`);
  if (d) parts.push(`${d} removed`);
  return parts.join(', ') || 'No changes';
}
