/**
 * Deterministic building generator: BuildingProgram → parametric elements.
 *
 * Pipeline per level:
 *   blocks + rooms (labelled rectangles) → cell grid → exterior/interior wall
 *   segments → walls; cell outlines → floor slabs and room zones; then doors,
 *   windows, stairs, roofs, furniture and site extras.
 */
import type { Element, Vec2, WallElement } from '../schema/elements';
import { resolveFurnitureClashes } from '../scene/clashes';
import { emptyScene, type Level, type Scene } from '../schema/scene';
import { buildGrid, extractEdges, mergeCollinear, offsetEdges, outlineLoops, type EdgeSegment, type LabeledRect } from '../geometry/rectilinear';
import { createElement } from '../scene/factory';
import { findElement, pointAlongWall, wallFrame } from '../scene/query';
import { BuildingProgram, type BuildingProgramInput, type ProgramRoom, type RoomFunction } from './program';
import { furnishRoom, type RoomOpening } from './furnish';
import { dist2, round } from '../geometry/math2d';

export interface GenerateOptions {
  /** Existing scene to append to. When omitted a new scene is created. */
  scene?: Scene;
  /** Plan offset applied after centring the program on the origin. */
  origin?: Vec2;
  /** Move/remove furniture that blocks doors, stairs or glazing (default true). */
  resolveClashes?: boolean;
}

export interface GenerateResult {
  scene: Scene;
  createdIds: string[];
  summary: string;
}

const OPEN_PLAN: RoomFunction[] = ['living', 'kitchen', 'dining'];

const AREA_WEIGHT: Record<RoomFunction, number> = {
  living: 32,
  kitchen: 14,
  dining: 12,
  bedroom: 13,
  bathroom: 6,
  office: 11,
  hall: 6,
  storage: 4,
  garage: 20,
  terrace: 10,
  other: 10,
};

const ROOM_NAMES: Record<RoomFunction, string> = {
  living: 'Living Room',
  kitchen: 'Kitchen',
  dining: 'Dining',
  bedroom: 'Bedroom',
  bathroom: 'Bathroom',
  office: 'Office',
  hall: 'Hall',
  storage: 'Storage',
  garage: 'Garage',
  terrace: 'Terrace',
  other: 'Room',
};

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

interface LevelRoom extends ProgramRoom {
  label: string;
}

export function generateBuilding(input: BuildingProgramInput, opts: GenerateOptions = {}): GenerateResult {
  const P = BuildingProgram.parse(input);
  const scene: Scene = opts.scene ? structuredClone(opts.scene) : emptyScene();
  const created: string[] = [];
  const add = (el: Element) => {
    scene.elements.push(el);
    created.push(el.id);
    return el;
  };
  const H = P.floorHeight;
  // A scene without elements is treated as fresh: its levels are re-initialised.
  const fresh = !opts.scene || opts.scene.elements.length === 0;
  if (fresh) scene.levels = scene.levels.slice(0, 1);
  // A single-storey apartment is an interior; a multi-storey one is a building.
  const interiorKind = P.kind === 'room' || P.kind === 'interior' || (P.kind === 'apartment' && Math.max(...P.blocks.map((b) => b.floors)) <= 1);

  // ---- centre blocks/rooms on origin (+ optional offset) -------------------
  const minX = Math.min(...P.blocks.map((b) => b.x));
  const minZ = Math.min(...P.blocks.map((b) => b.z));
  const maxX = Math.max(...P.blocks.map((b) => b.x + b.width));
  const maxZ = Math.max(...P.blocks.map((b) => b.z + b.depth));
  const ox = -(minX + maxX) / 2 + (opts.origin?.x ?? 0);
  const oz = -(minZ + maxZ) / 2 + (opts.origin?.z ?? 0);
  const blocks = P.blocks.map((b, i) => ({
    ...b,
    index: i,
    rect: { x0: round(b.x + ox), z0: round(b.z + oz), x1: round(b.x + ox + b.width), z1: round(b.z + oz + b.depth) } as Rect,
  }));
  const nLevels = Math.max(...blocks.map((b) => b.floors));

  // ---- levels ---------------------------------------------------------------
  const levels: Level[] = [];
  for (let i = 0; i < nLevels; i++) {
    const existing = scene.levels[i];
    if (existing) {
      if (fresh) existing.height = H;
      levels.push(existing);
    } else {
      const lvl: Level = { id: `level_${i}`, name: i === 0 ? 'Ground floor' : `Floor ${i}`, elevation: round(i * H), height: H };
      scene.levels.push(lvl);
      levels.push(lvl);
    }
  }
  if (fresh) {
    levels[0].name = 'Ground floor';
    levels[0].elevation = 0;
    levels[0].height = H;
  }

  // ---- rooms ------------------------------------------------------------------
  const mainBlock = [...blocks].filter((b) => !b.garage).sort((a, b) => b.width * b.depth - a.width * a.depth)[0] ?? blocks[0];
  const multiLevel = nLevels > 1;
  const wantStairs = multiLevel && P.extras.stairs;
  let rooms: LevelRoom[] = [];
  if (P.rooms?.length) {
    rooms = P.rooms.map((r, i) => ({ ...r, x: round(r.x + ox), z: round(r.z + oz), label: `r${i}` }));
  } else {
    rooms = autoLayout(P, blocks, mainBlock, nLevels, wantStairs);
  }

  // Stair + void per level (stairs from level L to L+1 sit in the hall).
  const stairRects: (Rect | null)[] = [];
  for (let L = 0; L < nLevels; L++) stairRects.push(null);
  const stairPlacements: { level: number; rect: Rect; x: number; zStart: number; run: number; steps: number }[] = [];
  if (wantStairs) {
    for (let L = 0; L < nLevels - 1; L++) {
      const hall =
        rooms.find((r) => r.level === L && r.function === 'hall') ??
        rooms.find((r) => r.level === L) ??
        ({ x: mainBlock.rect.x0, z: mainBlock.rect.z0, width: mainBlock.width, depth: mainBlock.depth } as ProgramRoom);
      const steps = Math.max(2, Math.ceil(H / 0.18));
      const usableDepth = hall.depth - 0.6;
      const going = Math.min(0.28, usableDepth / steps);
      const run = round(going * steps);
      const width = Math.min(1.0, Math.max(0.7, hall.width - 0.5));
      const x = round(hall.x + 0.1 + width / 2);
      const zStart = round(hall.z + hall.depth - 0.3);
      const rect = { x0: round(hall.x), z0: round(zStart - run), x1: round(hall.x + width + 0.2), z1: zStart };
      stairPlacements.push({ level: L, rect, x, zStart, run, steps });
      stairRects[L + 1] = rect;
    }
  }

  // ---- per level geometry -------------------------------------------------
  const roomLabel = new Map<string, LevelRoom>(rooms.map((r) => [r.label, r]));
  const sameGroup = (a: string, b: string) => {
    if (a === 'void' || b === 'void') return true;
    const ra = roomLabel.get(a);
    const rb = roomLabel.get(b);
    if (ra && rb && OPEN_PLAN.includes(ra.function) && OPEN_PLAN.includes(rb.function)) return true;
    // Hall and corridor are one circulation space.
    if (ra && rb && ra.function === 'hall' && rb.function === 'hall') return true;
    return a === b;
  };

  const exteriorWallsByLevel: { wall: WallElement; seg: EdgeSegment }[][] = [];
  const interiorWallsByLevel: { wall: WallElement; seg: EdgeSegment }[][] = [];

  for (let L = 0; L < nLevels; L++) {
    const lvl = levels[L];
    const active = blocks.filter((b) => b.floors > L);
    const rects: LabeledRect[] = active.map((b) => ({ ...b.rect, label: `b${b.index}` }));
    for (const r of rooms.filter((r) => r.level === L)) {
      rects.push({ x0: r.x, z0: r.z, x1: r.x + r.width, z1: r.z + r.depth, label: r.label });
    }
    const voidRect = stairRects[L];
    if (voidRect) rects.push({ ...voidRect, label: 'void' });
    const grid = buildGrid(rects);
    const insideFootprint = (lbl: string | null) => lbl !== null;
    if (!grid.cells.length) continue;
    const edges = extractEdges(grid, sameGroup);
    const ext = mergeCollinear(edges.filter((e) => e.kind === 'exterior'));
    const int = edges.filter((e) => e.kind === 'interior');
    const levelExt: { wall: WallElement; seg: EdgeSegment }[] = [];
    const levelInt: { wall: WallElement; seg: EdgeSegment }[] = [];

    const facadeName = (o?: Vec2) => (!o ? 'Wall' : o.z > 0 ? 'South façade' : o.z < 0 ? 'North façade' : o.x > 0 ? 'East façade' : 'West façade');
    const facadeCount = new Map<string, number>();
    for (const seg of ext) {
      if (dist2(seg.a, seg.b) < 0.05) continue;
      const fname = facadeName(seg.outward);
      const k = (facadeCount.get(fname) ?? 0) + 1;
      facadeCount.set(fname, k);
      const levelSuffix = multiLevel ? ` · ${lvl.name}` : '';
      // Orient walls so that the "left" normal points outward is not required;
      // we store outward direction in BIM data for exporters.
      const wall = add(
        createElement(scene, {
          type: 'wall',
          name: `${fname} wall${k > 1 ? ` ${k}` : ''}${levelSuffix}`,
          levelId: lvl.id,
          start: seg.a,
          end: seg.b,
          height: H,
          thickness: P.wallThickness,
          material: P.exteriorMaterial,
          interiorMaterial: P.interiorMaterial,
          exterior: true,
          bim: { isExternal: true, loadBearing: true, outwardX: seg.outward?.x ?? 0, outwardZ: seg.outward?.z ?? 0 },
        }),
      ) as WallElement;
      levelExt.push({ wall, seg });
    }
    for (const seg of int) {
      if (dist2(seg.a, seg.b) < 0.05) continue;
      const ra = seg.neg ? roomLabel.get(seg.neg) : undefined;
      const rb = seg.pos ? roomLabel.get(seg.pos) : undefined;
      const nm = ra && rb ? `${ra.name} / ${rb.name} wall` : ra ? `${ra.name} wall` : rb ? `${rb.name} wall` : 'Interior wall';
      const wall = add(
        createElement(scene, {
          type: 'wall',
          name: nm,
          levelId: lvl.id,
          start: seg.a,
          end: seg.b,
          height: H,
          thickness: P.interiorWallThickness,
          material: P.interiorMaterial,
          exterior: false,
          bim: { isExternal: false, loadBearing: false },
        }),
      ) as WallElement;
      levelInt.push({ wall, seg });
    }
    exteriorWallsByLevel.push(levelExt);
    interiorWallsByLevel.push(levelInt);

    // Floor slabs: one per room region, plus remaining block area.
    const labels = new Set<string>();
    for (const col of grid.cells) for (const c of col) if (c && c !== 'void') labels.add(c);
    for (const label of labels) {
      const loops = outlineLoops(grid, (l) => l === label);
      const room = roomLabel.get(label);
      const block = label.startsWith('b') ? blocks[Number(label.slice(1))] : undefined;
      const fn = room?.function;
      const floorMat =
        fn === 'bathroom' ? 'tile_grey' : fn === 'garage' || block?.garage ? 'concrete' : fn === 'terrace' ? 'wood_deck' : P.floorMaterial;
      for (const loop of loops) {
        if (loop.length < 3) continue;
        // Extend slab edges that lie under exterior walls to the outer wall face.
        const slabPoly = offsetEdges(
          loop,
          loop.map((p, i) => {
            const q = loop[(i + 1) % loop.length];
            const hit = ext.find((e) => {
              if (!e.outward) return false;
              const vertical = Math.abs(p.x - q.x) < 1e-9;
              if (vertical !== (Math.abs(e.a.x - e.b.x) < 1e-9)) return false;
              if (vertical) return Math.abs(e.a.x - p.x) < 1e-6 && Math.min(p.z, q.z) >= Math.min(e.a.z, e.b.z) - 1e-6 && Math.max(p.z, q.z) <= Math.max(e.a.z, e.b.z) + 1e-6;
              return Math.abs(e.a.z - p.z) < 1e-6 && Math.min(p.x, q.x) >= Math.min(e.a.x, e.b.x) - 1e-6 && Math.max(p.x, q.x) <= Math.max(e.a.x, e.b.x) + 1e-6;
            });
            return hit?.outward ? { normal: hit.outward, d: P.wallThickness / 2 - 0.01 } : { normal: { x: 0, z: 0 }, d: 0 };
          }),
        ).map((v) => ({ x: round(v.x), z: round(v.z) }));
        add(
          createElement(scene, {
            type: 'slab',
            name: `${room ? room.name : block?.name ?? 'Floor'} floor${multiLevel ? ` · ${lvl.name}` : ''}`,
            levelId: lvl.id,
            polygon: slabPoly,
            thickness: L === 0 ? 0.3 : 0.25,
            elevation: 0,
            material: floorMat,
            role: L === 0 ? 'floor' : 'floor',
          }),
        );
        if (room) {
          add(
            createElement(scene, {
              type: 'room',
              name: room.name,
              levelId: lvl.id,
              polygon: loop,
              function: room.function,
              floorMaterial: floorMat,
            }),
          );
        }
      }
    }
    void insideFootprint;
  }

  // ---- doors --------------------------------------------------------------------
  const doorW = P.doors.width ?? (P.doors.type === 'double' ? 1.6 : P.doors.type === 'sliding_glass' ? 2.4 : 1.0);
  const occupied = new Map<string, [number, number][]>();
  const occupy = (wallId: string, a: number, b: number) => {
    const list = occupied.get(wallId) ?? [];
    list.push([a, b]);
    occupied.set(wallId, list);
  };
  const wallLen = (w: WallElement) => Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z);
  const ground = exteriorWallsByLevel[0] ?? [];
  const facadeOrder = (o?: Vec2) => (o?.z === 1 ? 0 : o?.z === -1 ? 1 : o?.x === 1 ? 2 : 3);
  const doorWalls = [...ground].sort((a, b) => facadeOrder(a.seg.outward) - facadeOrder(b.seg.outward) || wallLen(b.wall) - wallLen(a.wall));
  let doorsPlaced = 0;
  const usedFacades = new Set<number>();
  const hallRoom0 = rooms.find((r) => r.level === 0 && r.function === 'hall');
  for (const { wall, seg } of doorWalls) {
    if (doorsPlaced >= P.doors.count) break;
    const L = wallLen(wall);
    if (L < doorW + 0.4) continue;
    if (usedFacades.has(facadeOrder(seg.outward))) continue;
    let offset = L / 2;
    const dir = { x: (wall.end.x - wall.start.x) / L, z: (wall.end.z - wall.start.z) / L };
    let t = L / 2;
    // Prefer the part of the wall in front of the entrance hall.
    if (doorsPlaced === 0 && hallRoom0) {
      const hallCenter = { x: hallRoom0.x + hallRoom0.width / 2, z: hallRoom0.z + hallRoom0.depth / 2 };
      t = (hallCenter.x - wall.start.x) * dir.x + (hallCenter.z - wall.start.z) * dir.z;
      if (t > doorW / 2 + 0.2 && t < L - doorW / 2 - 0.2) offset = t;
    }
    {
      // Keep the entrance clear of the stair in the hall and of interior walls meeting the façade:
      // take the free position along the wall closest to the hall's centre.
      const proj = (x: number, z: number) => (x - wall.start.x) * dir.x + (z - wall.start.z) * dir.z;
      const perp = (x: number, z: number) => Math.abs((x - wall.start.x) * dir.z - (z - wall.start.z) * dir.x);
      const blocked: [number, number][] = [];
      const stair = stairPlacements.find((sp) => sp.level === 0)?.rect;
      if (stair) {
        const corners: [number, number][] = [
          [stair.x0, stair.z0],
          [stair.x1, stair.z0],
          [stair.x0, stair.z1],
          [stair.x1, stair.z1],
        ];
        if (Math.min(...corners.map(([x, z]) => perp(x, z))) < 2) blocked.push([Math.min(...corners.map(([x, z]) => proj(x, z))) - 0.15, Math.max(...corners.map(([x, z]) => proj(x, z))) + 0.15]);
      }
      for (const e of scene.elements) {
        if (e.type !== 'wall' || e.id === wall.id || e.exterior || (e.levelId ?? levels[0].id) !== wall.levelId) continue;
        for (const q of [e.start, e.end]) if (perp(q.x, q.z) < 0.3) blocked.push([proj(q.x, q.z) - e.thickness / 2 - 0.15, proj(q.x, q.z) + e.thickness / 2 + 0.15]);
      }
      const free = (c: number) => c > doorW / 2 + 0.2 && c < L - doorW / 2 - 0.2 && blocked.every(([b0, b1]) => c + doorW / 2 <= b0 || c - doorW / 2 >= b1);
      if (!free(offset)) {
        let best: number | null = null;
        for (let c = doorW / 2 + 0.2; c <= L - doorW / 2 - 0.2; c += 0.05) if (free(c) && (best === null || Math.abs(c - t) < Math.abs(best - t))) best = c;
        if (best !== null) offset = best;
      }
    }
    const door = add(
      createElement(scene, {
        type: 'door',
        name: doorsPlaced === 0 ? 'Main entrance door' : `Exterior door ${doorsPlaced + 1}`,
        hostId: wall.id,
        offset: round(offset),
        width: doorW,
        height: Math.min(2.2, H - 0.3),
        doorType: P.doors.type,
        leafMaterial: P.doors.material,
        frameMaterial: P.doors.frameMaterial,
        bim: { isExternal: true },
      }),
    );
    occupy(wall.id, offset - doorW / 2, offset + doorW / 2);
    void door;
    usedFacades.add(facadeOrder(seg.outward));
    doorsPlaced++;
  }

  // Garage doors
  for (const b of blocks.filter((b) => b.garage)) {
    const cand = ground
      .filter(({ wall, seg }) => seg.outward?.z === 1 && wall.start.x >= b.rect.x0 - 0.01 && wall.end.x <= b.rect.x1 + 0.01)
      .concat(ground.filter(({ seg }) => seg.outward?.z === 1));
    const hit = cand.find(({ wall }) => {
      const mid = (Math.min(wall.start.x, wall.end.x) + Math.max(wall.start.x, wall.end.x)) / 2;
      return mid > b.rect.x0 && mid < b.rect.x1;
    });
    if (hit) {
      const L = wallLen(hit.wall);
      const gw = Math.min(b.width - 1, 5);
      const cx = (b.rect.x0 + b.rect.x1) / 2;
      const offset = Math.abs(cx - hit.wall.start.x);
      if (offset - gw / 2 > 0.1 && offset + gw / 2 < L - 0.1 && !overlaps(occupied.get(hit.wall.id), offset - gw / 2, offset + gw / 2)) {
        add(
          createElement(scene, {
            type: 'door',
            name: 'Garage door',
            hostId: hit.wall.id,
            offset: round(offset),
            width: gw,
            height: Math.min(2.4, H - 0.2),
            doorType: 'garage',
            leafMaterial: 'aluminium',
            frameMaterial: 'aluminium_black',
          }),
        );
        occupy(hit.wall.id, offset - gw / 2, offset + gw / 2);
      }
    }
  }

  // Sliding glass door from the living room to a terrace.
  if (P.extras.terrace && !interiorKind) {
    const living = rooms.find((r) => r.level === 0 && r.function === 'living');
    const side = P.extras.terrace.side;
    const outward = side === 'front' ? { x: 0, z: 1 } : side === 'back' ? { x: 0, z: -1 } : side === 'right' ? { x: 1, z: 0 } : { x: -1, z: 0 };
    const target = ground.find(({ seg }) => seg.outward?.x === outward.x && seg.outward?.z === outward.z && (!living || segTouchesRect(seg, living)));
    if (target) {
      const L = wallLen(target.wall);
      const w = Math.min(3.0, L - 1);
      let center = L / 2;
      if (living) {
        const lc = { x: living.x + living.width / 2, z: living.z + living.depth / 2 };
        const dir = { x: (target.wall.end.x - target.wall.start.x) / L, z: (target.wall.end.z - target.wall.start.z) / L };
        center = (lc.x - target.wall.start.x) * dir.x + (lc.z - target.wall.start.z) * dir.z;
      }
      center = Math.max(w / 2 + 0.3, Math.min(L - w / 2 - 0.3, center));
      if (w > 1.2 && !overlaps(occupied.get(target.wall.id), center - w / 2 - 0.2, center + w / 2 + 0.2)) {
        add(
          createElement(scene, {
            type: 'door',
            name: 'Terrace sliding door',
            hostId: target.wall.id,
            offset: round(center),
            width: round(w),
            height: Math.min(2.4, H - 0.25),
            doorType: 'sliding_glass',
            leafMaterial: 'glass_clear',
            frameMaterial: P.windows.frameMaterial,
          }),
        );
        occupy(target.wall.id, center - w / 2, center + w / 2);
      }
    }
  }

  // Interior doors: spanning tree from hall over adjacent room pairs.
  if (P.doors.interior) {
    for (let L = 0; L < interiorWallsByLevel.length; L++) {
      const walls = interiorWallsByLevel[L];
      const levelRooms = rooms.filter((r) => r.level === L).map((r) => r.label);
      if (!levelRooms.length) continue;
      const adj = new Map<string, { other: string; wall: WallElement }[]>();
      const link = (a: string, b: string, wall: WallElement) => {
        adj.set(a, [...(adj.get(a) ?? []), { other: b, wall }]);
      };
      for (const { wall, seg } of walls) {
        if (!seg.neg || !seg.pos || wallLen(wall) < 1.1) continue;
        link(seg.neg, seg.pos, wall);
        link(seg.pos, seg.neg, wall);
      }
      // Open-plan rooms are already connected.
      const groupOf = (lbl: string) => {
        const r = roomLabel.get(lbl);
        return r && OPEN_PLAN.includes(r.function) ? 'open' : r?.function === 'hall' ? 'circulation' : lbl;
      };
      const start = levelRooms.find((l) => roomLabel.get(l)?.function === 'hall') ?? levelRooms[0];
      // Shortest-path tree from the hall where walking *through* a bedroom, bathroom or
      // garage is expensive: private rooms get their own door from a hall or living
      // space whenever the plan allows, instead of becoming walk-through rooms.
      const PRIVATE: RoomFunction[] = ['bedroom', 'bathroom', 'garage', 'storage'];
      const passCost = (lbl: string) => (PRIVATE.includes(roomLabel.get(lbl)?.function ?? 'other') ? 12 : 1);
      const dist = new Map<string, number>();
      const visited = new Set<string>();
      const frontier: { lbl: string; d: number; from?: string; wall?: WallElement }[] = [];
      for (const l of levelRooms) if (groupOf(l) === groupOf(start)) frontier.push({ lbl: l, d: 0 });
      while (frontier.length) {
        frontier.sort((a, b) => a.d - b.d);
        const { lbl: cur, d, from, wall } = frontier.shift()!;
        if (visited.has(cur)) continue;
        const g = groupOf(cur);
        const groupReached = [...visited].some((v) => groupOf(v) === g);
        visited.add(cur);
        dist.set(cur, d);
        if (from && wall && !groupReached) {
          const len = wallLen(wall);
          const w = 0.9;
          const offset = len < 2.4 ? len / 2 : 0.25 + w / 2 + 0.2;
          if (!overlaps(occupied.get(wall.id), offset - w / 2, offset + w / 2)) {
            const rOther = roomLabel.get(cur);
            add(
              createElement(scene, {
                type: 'door',
                name: `Door to ${rOther?.name ?? 'room'}`,
                hostId: wall.id,
                offset: round(offset),
                width: w,
                height: Math.min(2.1, H - 0.3),
                doorType: 'hinged',
                leafMaterial: 'paint_white',
                frameMaterial: 'paint_white',
                frameDepth: P.interiorWallThickness + 0.02,
              }),
            );
            occupy(wall.id, offset - w / 2, offset + w / 2);
          }
          // The rest of an open-plan group is reached with it.
          for (const l of levelRooms) if (l !== cur && groupOf(l) === g && !visited.has(l)) frontier.push({ lbl: l, d });
        }
        for (const { other, wall: wl } of adj.get(cur) ?? []) {
          if (visited.has(other)) continue;
          if (groupOf(other) === g) {
            frontier.push({ lbl: other, d });
            continue;
          }
          frontier.push({ lbl: other, d: d + passCost(cur), from: cur, wall: wl });
        }
      }
    }
  }

  // ---- windows --------------------------------------------------------------
  const W = P.windows;
  const style = W.style;
  if (W.density !== 'none' || W.count) {
    const allExt = exteriorWallsByLevel.flatMap((lv, L) => lv.map((x) => ({ ...x, level: L })));
    // A window never straddles an interior wall meeting the façade (it would span two rooms
    // and leave the partition ending in glass): reserve each junction plus a reveal.
    for (const { wall, level } of allExt) {
      const L = wallLen(wall);
      const dir = { x: (wall.end.x - wall.start.x) / L, z: (wall.end.z - wall.start.z) / L };
      for (const { wall: iw } of interiorWallsByLevel[level] ?? []) {
        for (const q of [iw.start, iw.end]) {
          const t = (q.x - wall.start.x) * dir.x + (q.z - wall.start.z) * dir.z;
          const perp = Math.abs((q.x - wall.start.x) * dir.z - (q.z - wall.start.z) * dir.x);
          if (perp < wall.thickness / 2 + 0.05 && t > 0 && t < L) occupy(wall.id, t - iw.thickness / 2 - 0.15, t + iw.thickness / 2 + 0.15);
        }
      }
    }
    const spec = (L: number) => {
      const h = levels[L].height;
      switch (style) {
        case 'floor_to_ceiling':
          return { width: W.width ?? 2.2, height: W.height ?? round(Math.max(1.5, h - 0.35)), sill: W.sillHeight ?? 0 };
        case 'ribbon':
          return { width: W.width ?? 3.2, height: W.height ?? 0.8, sill: W.sillHeight ?? 1.1 };
        case 'curtain':
          return { width: W.width ?? 0, height: W.height ?? round(h - 0.2), sill: W.sillHeight ?? 0 };
        default:
          return { width: W.width ?? 1.2, height: W.height ?? round(Math.min(1.4, h - 1.2)), sill: W.sillHeight ?? 0.9 };
      }
    };
    const plan = new Map<string, number>();
    if (W.count !== undefined) {
      // Distribute an exact number of windows: give the next window to the wall
      // with the most free length per window. Ground floor first on ties.
      const free = (w: WallElement) => {
        const L = wallLen(w);
        const used = (occupied.get(w.id) ?? []).reduce((s, [a, b]) => s + (b - a), 0);
        return Math.max(0, L - used);
      };
      for (let i = 0; i < W.count; i++) {
        let best: { id: string; score: number } | undefined;
        for (const { wall, level } of allExt) {
          const s = spec(level);
          const n = plan.get(wall.id) ?? 0;
          const f = free(wall);
          if (f < (n + 1) * (s.width || 1.2) + (n + 2) * 0.4) continue;
          const doorPenalty = occupied.has(wall.id) ? 0.85 : 1;
          const score = (f / (n + 1)) * doorPenalty - level * 0.01;
          if (!best || score > best.score + 1e-9) best = { id: wall.id, score };
        }
        if (!best) break;
        plan.set(best.id, (plan.get(best.id) ?? 0) + 1);
      }
    }
    let windowNo = 0;
    for (const { wall, seg, level } of allExt) {
      const s = spec(level);
      const L = wallLen(wall);
      const isGarage = blocks.some((b) => b.garage && segInsideRect(seg, b.rect) && b.floors - 1 >= level);
      const intervals = freeIntervals(L, occupied.get(wall.id) ?? [], 0.35);
      const roomFor = (offset: number) => {
        const p = { x: wall.start.x + ((wall.end.x - wall.start.x) / L) * offset, z: wall.start.z + ((wall.end.z - wall.start.z) / L) * offset };
        const inward = { x: -(seg.outward?.x ?? 0) * 0.5, z: -(seg.outward?.z ?? 0) * 0.5 };
        const q = { x: p.x + inward.x, z: p.z + inward.z };
        return rooms.find((r) => r.level === level && q.x > r.x && q.x < r.x + r.width && q.z > r.z && q.z < r.z + r.depth);
      };
      const placeAt = (offset: number, width: number, extra: Record<string, unknown> = {}) => {
        windowNo++;
        const room = roomFor(offset);
        add(
          createElement(scene, {
            type: 'window',
            name: room ? `${room.name} window ${windowNo}` : `Window ${windowNo}`,
            hostId: wall.id,
            offset: round(offset),
            width: round(width),
            height: s.height,
            sillHeight: s.sill,
            frameMaterial: W.frameMaterial,
            style: style === 'curtain' ? 'curtain' : style === 'floor_to_ceiling' ? 'fixed' : style === 'ribbon' ? 'sliding' : 'casement',
            ...extra,
          }),
        );
        occupy(wall.id, offset - width / 2, offset + width / 2);
      };
      if (style === 'curtain' && W.count === undefined) {
        for (const [a, b] of intervals) {
          const w = b - a;
          if (w < 0.8) continue;
          placeAt((a + b) / 2, w, { mullionsVertical: Math.max(0, Math.round(w / 1.5) - 1), mullionsHorizontal: s.height > 3 ? 1 : 0 });
        }
        continue;
      }
      let n: number;
      if (W.count !== undefined) n = plan.get(wall.id) ?? 0;
      else {
        if (isGarage) continue;
        const spacing = W.density === 'high' ? 2.0 : W.density === 'low' ? 4.5 : 3.0;
        n = L < s.width + 0.8 ? 0 : Math.max(1, Math.floor(L / (spacing + (style === 'floor_to_ceiling' ? s.width / 2 : 0))));
      }
      if (n <= 0) continue;
      const offsets = distribute(intervals, n, s.width);
      for (const o of offsets) placeAt(o, s.width);
    }
  }

  // ---- stairs ---------------------------------------------------------------------
  for (const sp of stairPlacements) {
    add(
      createElement(scene, {
        type: 'stair',
        name: `Stair ${levels[sp.level].name} → ${levels[sp.level + 1].name}`,
        levelId: levels[sp.level].id,
        position: { x: sp.x, z: sp.zStart },
        rotation: 0,
        width: round(sp.rect.x1 - sp.rect.x0 - 0.2),
        totalRise: H,
        totalRun: sp.run,
        steps: sp.steps,
        material: 'oak',
      }),
    );
  }

  // ---- roofs -----------------------------------------------------------------------
  for (const b of blocks) {
    const type = b.roof?.type ?? (interiorKind ? 'none' : b.garage && P.roof.type !== 'flat' ? 'flat' : P.roof.type);
    if (type === 'none') continue;
    const top = levels[b.floors - 1];
    const ridgeAxis = b.width >= b.depth ? 'x' : 'z';
    add(
      createElement(scene, {
        type: 'roof',
        name: `${b.name ?? (b === mainBlock ? 'Main' : `Block ${b.index + 1}`)} roof`,
        levelId: top.id,
        roofType: type,
        center: { x: round((b.rect.x0 + b.rect.x1) / 2), z: round((b.rect.z0 + b.rect.z1) / 2) },
        width: b.width,
        depth: b.depth,
        rotation: 0,
        pitchDeg: type === 'flat' ? 0 : b.roof?.pitchDeg ?? P.roof.pitchDeg,
        overhang: type === 'flat' ? Math.min(P.roof.overhang, 0.3) : P.roof.overhang,
        thickness: type === 'flat' ? 0.3 : 0.2,
        baseOffset: top.height,
        ridgeAxis,
        material: b.roof?.material ?? (type === 'flat' && P.roof.material === 'metal_dark_grey' ? 'concrete' : P.roof.material),
        gableMaterial: P.exteriorMaterial,
        parapetHeight: P.kind === 'office' && type === 'flat' ? 0.5 : 0,
      }),
    );
  }

  // ---- furniture ------------------------------------------------------------------
  if (P.furnish) {
    for (const r of rooms) {
      const lvl = levels[r.level];
      if (!lvl) continue;
      const stair = stairPlacements.find((s) => s.level === r.level)?.rect ?? stairRects[r.level] ?? null;
      const openings = roomOpenings(scene, lvl.id, r);
      for (const f of furnishRoom(r, { requested: P.furniture, avoid: stair, openings, buildingKind: P.kind })) {
        add(createElement(scene, { ...f, type: 'furniture', levelId: lvl.id }));
      }
    }
  }

  // ---- site extras ----------------------------------------------------------------
  const fp = {
    x0: Math.min(...blocks.map((b) => b.rect.x0)),
    z0: Math.min(...blocks.map((b) => b.rect.z0)),
    x1: Math.max(...blocks.map((b) => b.rect.x1)),
    z1: Math.max(...blocks.map((b) => b.rect.z1)),
  };
  let frontEdge = fp.z1;
  const sideRect = (side: 'front' | 'back' | 'left' | 'right', depth: number, gap: number, along: Rect): Rect => {
    switch (side) {
      case 'front':
        return { x0: along.x0, x1: along.x1, z0: fp.z1 + gap, z1: fp.z1 + gap + depth };
      case 'back':
        return { x0: along.x0, x1: along.x1, z0: fp.z0 - gap - depth, z1: fp.z0 - gap };
      case 'left':
        return { x0: fp.x0 - gap - depth, x1: fp.x0 - gap, z0: along.z0, z1: along.z1 };
      case 'right':
        return { x0: fp.x1 + gap, x1: fp.x1 + gap + depth, z0: along.z0, z1: along.z1 };
    }
  };
  if (P.extras.terrace) {
    const t = P.extras.terrace;
    const r = sideRect(t.side, t.depth, 0, mainBlock.rect);
    add(
      createElement(scene, {
        type: 'slab',
        name: 'Terrace',
        levelId: levels[0].id,
        polygon: rectPoly(r),
        thickness: 0.15,
        elevation: 0,
        material: t.material,
        role: 'terrace',
      }),
    );
    if (t.side === 'front') frontEdge = r.z1;
  }
  if (P.extras.pool) {
    const p = P.extras.pool;
    const side = p.side;
    const horizontal = side === 'front' || side === 'back';
    const along = mainBlock.rect;
    const gap = (P.extras.terrace && P.extras.terrace.side === side ? P.extras.terrace.depth : 0) + 1.2;
    const r = sideRect(side, p.width, gap, along);
    const cx = horizontal ? (along.x0 + along.x1) / 2 : (r.x0 + r.x1) / 2;
    const cz = horizontal ? (r.z0 + r.z1) / 2 : (along.z0 + along.z1) / 2;
    add(
      createElement(scene, {
        type: 'pool',
        name: 'Swimming pool',
        levelId: levels[0].id,
        center: { x: round(cx), z: round(cz) },
        width: horizontal ? p.length : p.width,
        length: horizontal ? p.width : p.length,
        rotation: 0,
        material: 'tile_pool',
        copingMaterial: 'stone_light',
      }),
    );
    if (side === 'front') frontEdge = r.z1;
    if (P.furnish && horizontal) {
      for (let i = 0; i < 2; i++) {
        add(
          createElement(scene, {
            type: 'furniture',
            kind: 'lounger',
            name: `Sun lounger ${i + 1}`,
            levelId: levels[0].id,
            position: { x: round(cx + p.length / 2 + 1.0 + i * 0.9), y: 0, z: round(cz) },
            rotation: 0,
            width: 0.7,
            depth: 1.9,
            height: 0.4,
            material: 'wood_deck',
            secondaryMaterial: 'fabric_beige',
          }),
        );
      }
    }
  }
  const wantTerrain = P.extras.terrain ?? !interiorKind;
  if (wantTerrain) {
    const cx = (fp.x0 + fp.x1) / 2;
    const cz = (fp.z0 + Math.max(fp.z1, frontEdge)) / 2;
    const size = Math.max(fp.x1 - fp.x0, Math.max(fp.z1, frontEdge) - fp.z0) + 40;
    add(
      createElement(scene, {
        type: 'terrain',
        name: 'Site terrain',
        levelId: levels[0].id,
        center: { x: round(cx), z: round(cz) },
        width: round(size),
        depth: round(size),
        elevation: -0.15,
        material: 'grass',
      }),
    );
  }

  // Final planning pass: no furniture in door clearances, in front of glazing, on stairs,
  // in walls or in other furniture. Pieces are moved to the nearest free spot or left out.
  const resolved = opts.resolveClashes === false ? { scene, moved: [], removed: [] } : resolveFurnitureClashes(scene);
  if (resolved.removed.length || resolved.moved.length) {
    scene.elements = resolved.scene.elements;
    const gone = new Set(resolved.removed);
    for (let i = created.length - 1; i >= 0; i--) if (gone.has(created[i])) created.splice(i, 1);
  }

  const counts = countTypes(scene.elements.filter((e) => created.includes(e.id)));
  const summary = Object.entries(counts)
    .map(([t, n]) => `${n} ${t}${n > 1 ? 's' : ''}`)
    .join(', ');
  return { scene, createdIds: created, summary };
}

/** Doors and windows in the sides of a rectangular room, for furnishing around them. */
function roomOpenings(scene: Scene, levelId: string, r: ProgramRoom): RoomOpening[] {
  const out: RoomOpening[] = [];
  const x0 = r.x;
  const z0 = r.z;
  const x1 = r.x + r.width;
  const z1 = r.z + r.depth;
  for (const e of scene.elements) {
    if ((e.type !== 'door' && e.type !== 'window') || e.levelId !== levelId) continue;
    const host = findElement(scene, e.hostId);
    if (!host || host.type !== 'wall') continue;
    const f = wallFrame(host);
    const p = pointAlongWall(host, e.offset);
    const tol = host.thickness / 2 + 0.05;
    const half = e.width / 2;
    if (Math.abs(f.dir.z) < 0.1) {
      if (p.x + half < x0 || p.x - half > x1) continue;
      if (Math.abs(p.z - z0) < tol) out.push({ kind: e.type, side: 'n', a: p.x - half, b: p.x + half });
      else if (Math.abs(p.z - z1) < tol) out.push({ kind: e.type, side: 's', a: p.x - half, b: p.x + half });
    } else if (Math.abs(f.dir.x) < 0.1) {
      if (p.z + half < z0 || p.z - half > z1) continue;
      if (Math.abs(p.x - x0) < tol) out.push({ kind: e.type, side: 'w', a: p.z - half, b: p.z + half });
      else if (Math.abs(p.x - x1) < tol) out.push({ kind: e.type, side: 'e', a: p.z - half, b: p.z + half });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------
function autoLayout(
  P: BuildingProgram,
  blocks: { rect: Rect; floors: number; width: number; depth: number; garage?: boolean; name?: string; index: number }[],
  main: { rect: Rect; floors: number; width: number; depth: number },
  nLevels: number,
  wantStairs: boolean,
): LevelRoom[] {
  const rooms: LevelRoom[] = [];
  let labelN = 0;
  const push = (r: Omit<LevelRoom, 'label'>) => rooms.push({ ...r, label: `r${labelN++}` });

  for (const b of blocks) {
    if (b.garage) push({ name: 'Garage', function: 'garage', level: 0, x: b.rect.x0, z: b.rect.z0, width: b.width, depth: b.depth });
  }

  const single = P.kind === 'room' || P.kind === 'interior' || (!P.program && P.kind === 'generic');
  if (single) {
    const fn = guessSingleRoomFunction(P);
    for (let L = 0; L < main.floors; L++) {
      push({ name: L === 0 && fn !== 'other' ? ROOM_NAMES[fn] : P.kind === 'room' ? 'Room' : ROOM_NAMES[fn], function: fn, level: L, x: main.rect.x0, z: main.rect.z0, width: main.width, depth: main.depth });
    }
    return rooms;
  }

  const defaults =
    P.kind === 'office'
      ? { bedrooms: 0, bathrooms: 1, living: false, kitchen: false, dining: false, offices: 1 }
      : P.kind === 'apartment'
        ? { bedrooms: 2, bathrooms: 1, living: true, kitchen: true, dining: true, offices: 0 }
        : P.kind === 'cabin'
          ? { bedrooms: 2, bathrooms: 1, living: true, kitchen: true, dining: false, offices: 0 }
          : { bedrooms: 3, bathrooms: 2, living: true, kitchen: true, dining: true, offices: 0 };
  const prog = { ...defaults, ...(P.program ?? {}) };
  if (P.program && !P.program.living && !P.program.kitchen && P.kind !== 'office') {
    prog.living = true;
    prog.kitchen = true;
  }

  const levelsOfMain = main.floors;
  const perLevel: RoomFunction[][] = Array.from({ length: levelsOfMain }, () => []);
  if (P.kind === 'office') {
    for (let L = 0; L < levelsOfMain; L++) perLevel[L].push('office', 'office', 'bathroom');
  } else if (P.kind === 'apartment' && levelsOfMain > 1) {
    // Apartment building: one apartment layout repeated on every storey.
    for (let L = 0; L < levelsOfMain; L++) {
      perLevel[L].push('living', 'kitchen');
      for (let i = 0; i < Math.max(1, prog.bedrooms); i++) perLevel[L].push('bedroom');
      for (let i = 0; i < Math.max(1, prog.bathrooms); i++) perLevel[L].push('bathroom');
    }
  } else {
    if (prog.living) perLevel[0].push('living');
    if (prog.kitchen) perLevel[0].push('kitchen');
    if (prog.dining) perLevel[0].push('dining');
    const upper = levelsOfMain > 1 ? 1 : 0;
    let bathsLeft = prog.bathrooms;
    if (levelsOfMain > 1 && bathsLeft > 0) {
      perLevel[0].push('bathroom');
      bathsLeft--;
    }
    for (let i = 0; i < prog.offices; i++) perLevel[0].push('office');
    for (let i = 0; i < prog.bedrooms; i++) perLevel[upper + (levelsOfMain > 2 ? i % (levelsOfMain - 1) : 0)].push('bedroom');
    for (let i = 0; i < bathsLeft; i++) perLevel[upper + (levelsOfMain > 2 ? i % (levelsOfMain - 1) : 0)].push('bathroom');
  }

  const needHall = wantStairs || perLevel.some((l) => l.length >= 3);
  let bedroomNo = 0;
  let bathNo = 0;
  let officeNo = 0;
  for (let L = 0; L < levelsOfMain; L++) {
    let area: Rect = { ...main.rect };
    if (needHall) {
      // A stair hall needs room for the flight beside the passage; otherwise a corridor will do.
      const hallW = wantStairs ? Math.min(2.7, main.width * 0.3) : Math.min(1.6, Math.max(1.3, main.width * 0.2));
      push({ name: L === 0 ? 'Entrance hall' : `Landing ${L}`, function: 'hall', level: L, x: area.x0, z: area.z0, width: round(hallW), depth: main.depth });
      area = { ...area, x0: round(area.x0 + hallW) };
    }
    const fns = perLevel[L];
    if (!fns.length) {
      push({ name: 'Open space', function: 'other', level: L, x: area.x0, z: area.z0, width: round(area.x1 - area.x0), depth: round(area.z1 - area.z0) });
      continue;
    }
    const items = fns.map((fn) => {
      let name = ROOM_NAMES[fn];
      if (fn === 'bedroom') name = ++bedroomNo === 1 ? 'Master bedroom' : `Bedroom ${bedroomNo}`;
      if (fn === 'bathroom') name = ++bathNo === 1 ? 'Bathroom' : `Bathroom ${bathNo}`;
      if (fn === 'office') name = P.kind === 'office' ? (officeNo++ % 2 === 0 ? 'Open office' : 'Meeting room') : 'Office';
      const master = fn === 'bedroom' && name === 'Master bedroom';
      const weight = master ? 16 : AREA_WEIGHT[fn];
      return { fn, name, weight, minSide: master ? 3.2 : MIN_SIDE[fn] };
    });
    if (P.kind === 'office') {
      items[0].weight = 60;
      items[1].weight = 18;
    }
    // With several bedrooms/bathrooms a corridor off the hall gives each its own door;
    // otherwise rooms are split directly.
    const banded = needHall && P.kind !== 'office' && items.filter((i) => PRIVATE_FNS.includes(i.fn)).length >= 2 ? corridorLayout(items, area) : null;
    if (banded) push({ name: L === 0 ? 'Corridor' : `Corridor ${L}`, function: 'hall', level: L, x: banded.corridor.x0, z: banded.corridor.z0, width: round(banded.corridor.x1 - banded.corridor.x0), depth: round(banded.corridor.z1 - banded.corridor.z0) });
    for (const { item, rect } of banded?.parts ?? sliceAndDice(items, area)) {
      push({ name: item.name, function: item.fn, level: L, x: round(rect.x0), z: round(rect.z0), width: round(rect.x1 - rect.x0), depth: round(rect.z1 - rect.z0) });
    }
  }
  void nLevels;
  return rooms;
}

function guessSingleRoomFunction(P: BuildingProgram): RoomFunction {
  const words = [...(P.furniture ?? []), P.name ?? ''].join(' ').toLowerCase();
  if (/kitchen|kök|counter|island/.test(words)) return 'kitchen';
  if (/bed|sovrum/.test(words)) return 'bedroom';
  if (/bath|toilet|shower|badrum/.test(words)) return 'bathroom';
  if (/desk|office|kontor/.test(words)) return 'office';
  if (/sofa|living|vardags|soffa/.test(words)) return 'living';
  if (/dining|matsal/.test(words)) return 'dining';
  return P.kind === 'room' ? 'other' : 'living';
}

const PRIVATE_FNS: RoomFunction[] = ['bedroom', 'bathroom', 'storage'];
const CORRIDOR_W = 1.2;

/**
 * Two bands of rooms either side of a corridor running from the hall: every room
 * opens onto circulation. Living spaces (open plan, so one wide space) take the
 * front band with whatever private rooms fit beside them; the rest go to the back.
 * Returns null when the rooms do not fit this way.
 */
function corridorLayout<T extends SliceItem & { fn: RoomFunction }>(items: T[], area: Rect): { parts: { item: T; rect: Rect }[]; corridor: Rect } | null {
  const W = area.x1 - area.x0;
  const D = area.z1 - area.z0;
  if (D < 2 * 2.9 + CORRIDOR_W || W < 4.5) return null;
  const pub = items.filter((i) => OPEN_PLAN.includes(i.fn));
  const priv = items.filter((i) => !OPEN_PLAN.includes(i.fn));
  const need = (band: T[]) => {
    const p = band.filter((i) => OPEN_PLAN.includes(i.fn));
    return band.filter((i) => !OPEN_PLAN.includes(i.fn)).reduce((a, i) => a + i.minSide, 0) + (p.length ? Math.max(3.4, ...p.map((i) => i.minSide)) : 0);
  };
  const back: T[] = [];
  const front: T[] = [...pub];
  for (const it of priv) {
    if (need([...back, it]) <= W) back.push(it);
    else if (need([...front, it]) <= W) front.push(it);
    else return null;
  }
  if (!front.length) {
    // Upper floors: balance the bands.
    while (back.length > front.length + 1) front.unshift(back.pop()!);
  }
  if (!back.length || !front.length) return null;
  const sum = (xs: T[]) => xs.reduce((a, i) => a + i.weight, 0);
  const avail = D - CORRIDOR_W;
  const minBack = Math.max(...back.map((i) => i.minSide), 2.9);
  const minFront = Math.max(...front.map((i) => (OPEN_PLAN.includes(i.fn) ? 3.4 : i.minSide)), 2.9);
  if (minBack + minFront > avail) return null;
  const dBack = round(Math.min(avail - minFront, Math.max(minBack, (avail * sum(back)) / (sum(back) + sum(front)))), 2);
  // Split a band along x: everyone gets their minimum, the rest goes by weight.
  const band = (list: T[], z0: number, z1: number) => {
    const mins = list.map((i) => (OPEN_PLAN.includes(i.fn) && list.filter((o) => OPEN_PLAN.includes(o.fn)).length > 1 ? 0 : i.minSide));
    // An open-plan group shares one minimum.
    const pubIdx = list.map((i, k) => (OPEN_PLAN.includes(i.fn) ? k : -1)).filter((k) => k >= 0);
    if (pubIdx.length > 1) for (const k of pubIdx) mins[k] = 3.4 / pubIdx.length;
    const spare = W - mins.reduce((a, b) => a + b, 0);
    const wsum = sum(list);
    let x = area.x0;
    return list.map((item, k) => {
      const w = k === list.length - 1 ? area.x1 - x : round(mins[k] + (spare * item.weight) / wsum, 2);
      const rect = { x0: round(x), z0: z0, x1: round(x + w), z1: z1 };
      x += w;
      return { item, rect };
    });
  };
  const zc0 = round(area.z0 + dBack);
  const zc1 = round(zc0 + CORRIDOR_W);
  return {
    parts: [...band(front, zc1, area.z1), ...band(back, area.z0, zc0)],
    corridor: { x0: area.x0, z0: zc0, x1: area.x1, z1: zc1 },
  };
}

/** Smallest sensible short side (wall centre to wall centre) per room function, in metres. */
const MIN_SIDE: Record<RoomFunction, number> = {
  living: 3.4,
  kitchen: 2.4,
  dining: 2.8,
  bedroom: 2.9,
  bathroom: 1.8,
  office: 2.6,
  hall: 1.2,
  storage: 1.2,
  garage: 2.8,
  terrace: 2,
  other: 2,
};

interface SliceItem {
  weight: number;
  minSide: number;
}

/** How badly a rectangle suits a room: too narrow weighs heavily, very elongated a little. */
function leafPenalty(item: SliceItem, r: Rect) {
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  const s = Math.min(w, d);
  const l = Math.max(w, d);
  return Math.max(0, item.minSide - s) * 10 + Math.max(0, l / Math.max(s, 0.1) - 2.4) * 1.5;
}

/** Quick estimate for a group that will be split further. */
function groupPenalty(items: SliceItem[], r: Rect) {
  if (items.length === 1) return leafPenalty(items[0], r);
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  const need = items.reduce((a, i) => a + i.minSide * i.minSide * 1.15, 0);
  const widest = Math.max(...items.map((i) => i.minSide));
  return Math.max(0, widest - Math.min(w, d)) * 10 + Math.max(0, need - w * d) * 0.8;
}

/**
 * Splits a rectangle among rooms (in order) by recursive bisection. Each split tries
 * every division point, both orientations and a few area shifts; the most promising
 * few are followed through to the leaves and the layout whose rooms all get a usable
 * shape (minimum short side, not too elongated) closest to their area share wins.
 */
function sliceAndDice<T extends SliceItem>(items: T[], rect: Rect): { item: T; rect: Rect }[] {
  return slice(items, rect).parts;
}

function slice<T extends SliceItem>(items: T[], rect: Rect): { parts: { item: T; rect: Rect }[]; cost: number } {
  if (items.length === 1) return { parts: [{ item: items[0], rect }], cost: leafPenalty(items[0], rect) };
  const sum = (xs: T[]) => xs.reduce((s, i) => s + i.weight, 0);
  const total = sum(items);
  const w = rect.x1 - rect.x0;
  const d = rect.z1 - rect.z0;
  const options: { est: number; shift: number; a: T[]; b: T[]; ra: Rect; rb: Rect }[] = [];
  for (let i = 1; i < items.length; i++) {
    const a = items.slice(0, i);
    const b = items.slice(i);
    const fa0 = sum(a) / total;
    for (const alongX of [true, false]) {
      for (const k of [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.35]) {
        const fa = Math.min(0.92, Math.max(0.08, fa0 * k));
        let ra: Rect;
        let rb: Rect;
        if (alongX) {
          const xm = round(rect.x0 + w * fa, 2);
          ra = { ...rect, x1: xm };
          rb = { ...rect, x0: xm };
        } else {
          // Larger (first) group goes to the front (south, +z).
          const zm = round(rect.z1 - d * fa, 2);
          ra = { ...rect, z0: zm };
          rb = { ...rect, z1: zm };
        }
        // Area shift away from the program's proportions, plus a mild preference for
        // cutting across the long side.
        const shift = Math.abs(fa - fa0) * 2 + (alongX === w >= d ? 0 : 0.15);
        options.push({ est: groupPenalty(a, ra) + groupPenalty(b, rb) + shift, shift, a, b, ra, rb });
      }
    }
  }
  options.sort((p, q) => p.est - q.est);
  let best: { parts: { item: T; rect: Rect }[]; cost: number } | null = null;
  for (const o of options.slice(0, items.length > 4 ? 3 : 4)) {
    const A = slice(o.a, o.ra);
    const B = slice(o.b, o.rb);
    const cost = A.cost + B.cost + o.shift;
    if (!best || cost < best.cost - 1e-9) best = { parts: [...A.parts, ...B.parts], cost };
    if (best.cost < 1e-6) break;
  }
  return best!;
}

function freeIntervals(L: number, occ: [number, number][], margin: number): [number, number][] {
  const sorted = [...occ].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let cur = margin;
  for (const [a, b] of sorted) {
    if (a - margin > cur) out.push([cur, a - margin]);
    cur = Math.max(cur, b + margin);
  }
  if (L - margin > cur) out.push([cur, L - margin]);
  return out;
}

/** Spreads n openings of width w over free intervals, proportional to length. */
function distribute(intervals: [number, number][], n: number, w: number): number[] {
  const usable = intervals.filter(([a, b]) => b - a >= w);
  if (!usable.length) return [];
  const total = usable.reduce((s, [a, b]) => s + (b - a), 0);
  const counts = usable.map(([a, b]) => Math.floor(((b - a) / total) * n));
  let assigned = counts.reduce((s, c) => s + c, 0);
  // Hand out the remainder to the intervals with the most free length per opening.
  while (assigned < n) {
    let best = -1;
    let bestScore = -Infinity;
    usable.forEach(([a, b], i) => {
      const capacity = Math.floor((b - a + 0.3) / (w + 0.3));
      if (counts[i] >= capacity) return;
      const score = (b - a) / (counts[i] + 1);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best < 0) break;
    counts[best]++;
    assigned++;
  }
  const out: number[] = [];
  usable.forEach(([a, b], i) => {
    const k = Math.min(counts[i], Math.floor((b - a + 0.3) / (w + 0.3)));
    for (let j = 0; j < k; j++) out.push(a + ((b - a) * (j + 0.5)) / k);
  });
  return out;
}

function overlaps(list: [number, number][] | undefined, a: number, b: number) {
  return (list ?? []).some(([x, y]) => a < y && b > x);
}

function segTouchesRect(seg: EdgeSegment, r: ProgramRoom) {
  const minx = Math.min(seg.a.x, seg.b.x);
  const maxx = Math.max(seg.a.x, seg.b.x);
  const minz = Math.min(seg.a.z, seg.b.z);
  const maxz = Math.max(seg.a.z, seg.b.z);
  return maxx >= r.x - 0.01 && minx <= r.x + r.width + 0.01 && maxz >= r.z - 0.01 && minz <= r.z + r.depth + 0.01;
}

function segInsideRect(seg: EdgeSegment, r: Rect) {
  const mx = (seg.a.x + seg.b.x) / 2;
  const mz = (seg.a.z + seg.b.z) / 2;
  return mx >= r.x0 - 0.01 && mx <= r.x1 + 0.01 && mz >= r.z0 - 0.01 && mz <= r.z1 + 0.01;
}

function rectPoly(r: Rect): Vec2[] {
  return [
    { x: r.x0, z: r.z0 },
    { x: r.x1, z: r.z0 },
    { x: r.x1, z: r.z1 },
    { x: r.x0, z: r.z1 },
  ];
}

function countTypes(els: Element[]) {
  const c: Record<string, number> = {};
  for (const e of els) c[e.type] = (c[e.type] ?? 0) + 1;
  return c;
}
