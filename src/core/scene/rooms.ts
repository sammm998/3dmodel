/**
 * Whole-room editing: what belongs to a room (its walls, openings, floor and
 * furniture), moving a free-standing room as one piece, copying a room next to
 * the building, and ready-made room templates.
 */
import type { Element, FurnitureElement, RoomElement, SlabElement, Vec2, WallElement } from '../schema/elements';
import type { Scene } from '../schema/scene';
import type { OperationInput } from '../ops/operations';
import type { BuildingProgramInput } from '../generator/program';
import { pointInPolygon, polygonArea, polygonCentroid, round } from '../geometry/math2d';
import { findElement, hostedChildren, pointAlongWall, sceneBounds, wallFrame } from './query';

function distToSegment(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
}

function onBoundary(p: Vec2, poly: Vec2[], tol = 0.03) {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (distToSegment(p, poly[j], poly[i]) <= tol) return true;
  return false;
}

/** The part of a wall that runs along a room's outline (offsets along the wall). */
export interface WallSpan {
  wall: WallElement;
  t0: number;
  t1: number;
}

export interface RoomParts {
  room: RoomElement;
  /** Walls whose centreline runs along the room outline. */
  walls: WallElement[];
  /** Every stretch of wall along the outline, including parts of longer walls. */
  spans: WallSpan[];
  /** Doors and windows in those walls. */
  openings: Element[];
  /** Floor slab(s) of the room. */
  slabs: SlabElement[];
  furniture: FurnitureElement[];
  /** True when no other room on the storey shares any of the walls. */
  freeStanding: boolean;
}

export function roomParts(scene: Scene, room: RoomElement): RoomParts {
  const level = room.levelId;
  const poly = room.polygon;
  const walls = scene.elements.filter((e): e is WallElement => {
    if (e.type !== 'wall' || e.levelId !== level) return false;
    const mid = { x: (e.start.x + e.end.x) / 2, z: (e.start.z + e.end.z) / 2 };
    return onBoundary(e.start, poly) && onBoundary(e.end, poly) && onBoundary(mid, poly);
  });
  const spans: WallSpan[] = [];
  for (const e of scene.elements) {
    if (e.type !== 'wall' || e.levelId !== level) continue;
    const f = wallFrame(e);
    if (f.length < 1e-6) continue;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j];
      const b = poly[i];
      // Edge collinear with the wall's centreline?
      const da = { x: a.x - e.start.x, z: a.z - e.start.z };
      const db = { x: b.x - e.start.x, z: b.z - e.start.z };
      const pa = da.x * f.normal.x + da.z * f.normal.z;
      const pb = db.x * f.normal.x + db.z * f.normal.z;
      if (Math.abs(pa) > 0.03 || Math.abs(pb) > 0.03) continue;
      const ta = da.x * f.dir.x + da.z * f.dir.z;
      const tb = db.x * f.dir.x + db.z * f.dir.z;
      const t0 = Math.max(0, Math.min(ta, tb));
      const t1 = Math.min(f.length, Math.max(ta, tb));
      if (t1 - t0 > 0.05) spans.push({ wall: e, t0: round(t0, 4), t1: round(t1, 4) });
    }
  }
  const openings = walls.flatMap((w) => hostedChildren(scene, w.id));
  const area = Math.abs(polygonArea(poly));
  const slabs = scene.elements.filter((e): e is SlabElement => {
    if (e.type !== 'slab' || e.levelId !== level || (e.role !== 'floor' && e.role !== 'foundation')) return false;
    const c = polygonCentroid(e.polygon);
    return pointInPolygon(c, poly) && Math.abs(polygonArea(e.polygon)) <= area * 1.6;
  });
  const furniture = scene.elements.filter((e): e is FurnitureElement => e.type === 'furniture' && e.levelId === level && pointInPolygon({ x: e.position.x, z: e.position.z }, poly));
  const others = scene.elements.filter((e): e is RoomElement => e.type === 'room' && e.id !== room.id && e.levelId === level);
  const freeStanding = !walls.some((w) => {
    const mid = { x: (w.start.x + w.end.x) / 2, z: (w.start.z + w.end.z) / 2 };
    return others.some((o) => onBoundary(mid, o.polygon));
  });
  return { room, walls, spans, openings, slabs, furniture, freeStanding };
}

/**
 * Operations that move a room with everything in it. A free-standing room moves
 * with its walls (rigidly, so nothing else stretches); a room inside a building
 * cannot leave its walls behind, so there only the furniture moves and the room
 * is resized by dragging its walls instead.
 */
export function moveRoomOps(scene: Scene, roomId: string, dx: number, dz: number): { ops: OperationInput[]; wholeRoom: boolean } {
  const room = findElement(scene, roomId);
  if (!room || room.type !== 'room') return { ops: [], wholeRoom: false };
  const parts = roomParts(scene, room);
  const t = { x: round(dx, 4), z: round(dz, 4) };
  const ops: OperationInput[] = parts.furniture.map((f) => ({ op: 'modify', id: f.id, translate: t }));
  if (!parts.freeStanding) return { ops, wholeRoom: false };
  ops.push({ op: 'modify', id: room.id, translate: t });
  for (const w of parts.walls) ops.push({ op: 'modify', id: w.id, translate: t, rigid: true });
  for (const sl of parts.slabs) ops.push({ op: 'modify', id: sl.id, translate: t });
  return { ops, wholeRoom: true };
}

/** Where a copy of something `width` wide goes: beside the building on the east, with a gap. */
function besideBuilding(scene: Scene, roomBox: { minX: number; maxX: number; minZ: number }, gap = 2) {
  const b = sceneBounds({ ...scene, elements: scene.elements.filter((e) => e.type !== 'terrain') });
  const right = b ? b.max.x : roomBox.maxX;
  return { dx: round(right + gap - roomBox.minX, 3), dz: 0 };
}

/**
 * Operations that copy a room (walls, doors, windows, floor, furniture) to a free
 * spot beside the building, or by the given offset. The copy is independent of the
 * original: its walls are new walls.
 */
export function duplicateRoomOps(scene: Scene, roomId: string, offset?: { dx: number; dz: number }): OperationInput[] {
  const room = findElement(scene, roomId);
  if (!room || room.type !== 'room') return [];
  const parts = roomParts(scene, room);
  const xs = room.polygon.map((p) => p.x);
  const zs = room.polygon.map((p) => p.z);
  const { dx, dz } = offset ?? besideBuilding(scene, { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs) });
  const mv = (p: Vec2) => ({ x: round(p.x + dx, 4), z: round(p.z + dz, 4) });
  const strip = (e: Element) => {
    const c = structuredClone(e) as Record<string, unknown>;
    delete c.id;
    delete c.groupId;
    return c;
  };
  const ops: OperationInput[] = [];
  parts.spans.forEach(({ wall: w, t0, t1 }, i) => {
    const ref = `$w${i}`;
    const c = strip(w);
    c.start = mv(pointAlongWall(w, t0));
    c.end = mv(pointAlongWall(w, t1));
    // A copied partition stands on its own: it becomes an outside wall of the copy.
    c.exterior = true;
    if (t0 > 0 || t1 < wallFrame(w).length) c.name = `${w.name} (copy)`;
    ops.push({ op: 'create', element: c as never, ref });
    // Doors and windows within the copied stretch, re-measured from its start.
    for (const o of hostedChildren(scene, w.id)) {
      if (o.type !== 'door' && o.type !== 'window') continue;
      if (o.offset - o.width / 2 < t0 - 0.01 || o.offset + o.width / 2 > t1 + 0.01) continue;
      const oc = strip(o);
      oc.hostId = ref;
      oc.offset = round(o.offset - t0, 4);
      ops.push({ op: 'create', element: oc as never });
    }
  });
  for (const sl of parts.slabs) {
    const c = strip(sl);
    c.polygon = sl.polygon.map(mv);
    ops.push({ op: 'create', element: c as never });
  }
  const rc = strip(room);
  rc.polygon = room.polygon.map(mv);
  rc.name = `${room.name} copy`;
  ops.push({ op: 'create', element: rc as never, ref: '$room' });
  for (const f of parts.furniture) {
    const c = strip(f);
    c.position = { ...f.position, x: round(f.position.x + dx, 4), z: round(f.position.z + dz, 4) };
    ops.push({ op: 'create', element: c as never });
  }
  return ops;
}

// ---- templates --------------------------------------------------------------------

export interface RoomTemplate {
  id: string;
  name: string;
  nameSv: string;
  description: string;
  width: number;
  depth: number;
  windows: number;
  furniture?: string[];
}

/** Ready-made, furnished rooms: dimensions follow common good practice. */
export const ROOM_TEMPLATES: RoomTemplate[] = [
  { id: 'bedroom', name: 'Bedroom', nameSv: 'Sovrum', description: 'Double bed, nightstands, wardrobe · 3.6 × 3.4 m', width: 3.6, depth: 3.4, windows: 1 },
  { id: 'master-bedroom', name: 'Master bedroom', nameSv: 'Huvudsovrum', description: 'King bed, wardrobe wall · 4.4 × 4.0 m', width: 4.4, depth: 4.0, windows: 2 },
  { id: 'bathroom', name: 'Bathroom', nameSv: 'Badrum', description: 'Basin, WC and walk-in shower · 2.6 × 2.4 m', width: 2.6, depth: 2.4, windows: 0 },
  { id: 'family-bathroom', name: 'Family bathroom', nameSv: 'Familjebadrum', description: 'Bath, basin and WC · 2.8 × 3.2 m', width: 2.8, depth: 3.2, windows: 1 },
  { id: 'kitchen', name: 'Kitchen', nameSv: 'Kök', description: 'Worktop wall and island · 4.2 × 3.8 m', width: 4.2, depth: 3.8, windows: 1 },
  { id: 'living-room', name: 'Living room', nameSv: 'Vardagsrum', description: 'Sofa, armchair, TV wall · 5.0 × 4.2 m', width: 5.0, depth: 4.2, windows: 2 },
  { id: 'dining-room', name: 'Dining room', nameSv: 'Matsal', description: 'Table for six with pendant · 4.0 × 3.6 m', width: 4.0, depth: 3.6, windows: 1 },
  { id: 'home-office', name: 'Home office', nameSv: 'Hemmakontor', description: 'Desk and shelving · 3.0 × 2.8 m', width: 3.0, depth: 2.8, windows: 1, furniture: ['shelf'] },
];

/** Building program for a template, generated beside the existing building. */
export function roomTemplateProgram(t: RoomTemplate, settings?: { floorHeight?: number; wallThickness?: number }): BuildingProgramInput {
  return {
    name: t.name,
    kind: 'room',
    blocks: [{ name: t.name, x: 0, z: 0, width: t.width, depth: t.depth, floors: 1 }],
    floorHeight: settings?.floorHeight ?? 2.7,
    wallThickness: settings?.wallThickness ?? 0.2,
    windows: { count: t.windows },
    doors: { count: 1 },
    furnish: true,
    furniture: t.furniture,
    roof: { type: 'flat' },
  } as BuildingProgramInput;
}

/** Operations that drop a template room beside the building (furnished, with a door and windows). */
export function roomTemplateOps(scene: Scene, templateId: string): OperationInput[] {
  const t = ROOM_TEMPLATES.find((x) => x.id === templateId);
  if (!t) return [];
  const b = sceneBounds({ ...scene, elements: scene.elements.filter((e) => e.type !== 'terrain') });
  const origin = b ? { x: round(b.max.x + 2 + t.width / 2, 3), z: round((b.min.z + b.max.z) / 2, 3) } : { x: 0, z: 0 };
  return [{ op: 'generate_building', program: roomTemplateProgram(t), mode: 'append', origin }];
}
