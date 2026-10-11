/**
 * Furniture presets per room function. Positions are computed from the room
 * rectangle; furniture rotation 0 means the piece "faces" +z (south).
 */
import type { FurnitureKind } from '../schema/elements';
import type { ProgramRoom } from './program';
import { round } from '../geometry/math2d';

export interface FurnitureSpec {
  name: string;
  kind: FurnitureKind;
  position: { x: number; y: number; z: number };
  rotation: number;
  width: number;
  depth: number;
  height: number;
  material: string;
  secondaryMaterial?: string;
}

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export const FURNITURE_DEFAULTS: Record<FurnitureKind, { w: number; d: number; h: number; m: string; m2?: string; label: string }> = {
  sofa: { w: 2.4, d: 0.95, h: 0.8, m: 'fabric_beige', m2: 'oak', label: 'Sofa' },
  armchair: { w: 0.85, d: 0.85, h: 0.8, m: 'leather_cognac', m2: 'oak', label: 'Armchair' },
  coffee_table: { w: 1.2, d: 0.6, h: 0.4, m: 'oak', m2: 'steel', label: 'Coffee table' },
  dining_table: { w: 1.8, d: 0.95, h: 0.75, m: 'oak', m2: 'aluminium_black', label: 'Dining table' },
  chair: { w: 0.48, d: 0.5, h: 0.82, m: 'oak', m2: 'fabric_grey', label: 'Chair' },
  bed: { w: 1.8, d: 2.1, h: 0.5, m: 'fabric_grey', m2: 'oak', label: 'Bed' },
  nightstand: { w: 0.5, d: 0.4, h: 0.5, m: 'oak', label: 'Nightstand' },
  wardrobe: { w: 1.8, d: 0.6, h: 2.2, m: 'oak', m2: 'brass', label: 'Wardrobe' },
  kitchen_counter: { w: 3.0, d: 0.62, h: 0.9, m: 'paint_white', m2: 'marble_white', label: 'Kitchen counter' },
  kitchen_island: { w: 2.2, d: 1.0, h: 0.9, m: 'walnut', m2: 'marble_white', label: 'Kitchen island' },
  desk: { w: 1.6, d: 0.8, h: 0.75, m: 'oak', m2: 'steel', label: 'Desk' },
  office_chair: { w: 0.6, d: 0.6, h: 1.0, m: 'fabric_grey', m2: 'steel', label: 'Office chair' },
  shelf: { w: 1.2, d: 0.35, h: 1.9, m: 'oak', label: 'Shelf' },
  rug: { w: 2.4, d: 1.7, h: 0.01, m: 'fabric_grey', label: 'Rug' },
  plant: { w: 0.5, d: 0.5, h: 1.3, m: 'foliage', m2: 'concrete', label: 'Plant' },
  floor_lamp: { w: 0.4, d: 0.4, h: 1.6, m: 'brass', m2: 'fabric_beige', label: 'Floor lamp' },
  pendant_lamp: { w: 0.4, d: 0.4, h: 0.4, m: 'brass', m2: 'fabric_beige', label: 'Pendant lamp' },
  tv_unit: { w: 1.8, d: 0.45, h: 0.5, m: 'walnut', m2: 'paint_black', label: 'TV unit' },
  bathtub: { w: 1.7, d: 0.75, h: 0.58, m: 'tile_white', label: 'Bathtub' },
  shower: { w: 0.9, d: 0.9, h: 2.0, m: 'tile_white', m2: 'glass_clear', label: 'Shower' },
  toilet: { w: 0.4, d: 0.65, h: 0.8, m: 'tile_white', label: 'Toilet' },
  vanity: { w: 1.0, d: 0.5, h: 0.85, m: 'oak', m2: 'marble_white', label: 'Vanity' },
  lounger: { w: 0.7, d: 1.9, h: 0.4, m: 'wood_deck', m2: 'fabric_beige', label: 'Lounger' },
  box: { w: 1, d: 1, h: 1, m: 'oak', label: 'Object' },
};

export function furnitureItem(
  kind: FurnitureKind,
  x: number,
  z: number,
  rotation = 0,
  overrides: Partial<Pick<FurnitureSpec, 'width' | 'depth' | 'height' | 'material' | 'secondaryMaterial' | 'name'>> & { y?: number } = {},
): FurnitureSpec {
  const d = FURNITURE_DEFAULTS[kind];
  return {
    name: overrides.name ?? d.label,
    kind,
    position: { x: round(x, 3), y: overrides.y ?? 0, z: round(z, 3) },
    rotation,
    width: overrides.width ?? d.w,
    depth: overrides.depth ?? d.d,
    height: overrides.height ?? d.h,
    material: overrides.material ?? d.m,
    secondaryMaterial: overrides.secondaryMaterial ?? d.m2,
  };
}

const PI = Math.PI;

export function furnishRoom(room: ProgramRoom, opts: { requested?: string[]; avoid?: Rect | null } = {}): FurnitureSpec[] {
  const m = 0.3; // clearance from wall centrelines
  const r: Rect = { x0: room.x + m, z0: room.z + m, x1: room.x + room.width - m, z1: room.z + room.depth - m };
  if (opts.avoid) {
    // Shrink the usable rect away from a stair void on the west side.
    const a = opts.avoid;
    if (a.x1 > r.x0 && a.x0 < r.x1 && a.z1 > r.z0 && a.z0 < r.z1) r.x0 = Math.max(r.x0, a.x1 + 0.2);
  }
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  if (w < 0.8 || d < 0.8) return [];
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  const out: FurnitureSpec[] = [];
  const isMaster = /master/i.test(room.name);

  switch (room.function) {
    case 'living': {
      if (d < 2.6 || w < 2.2) break;
      const sofaW = Math.min(2.6, w * 0.6);
      out.push(furnitureItem('rug', cx, r.z0 + 1.65, 0, { width: Math.min(2.6, w * 0.7), depth: Math.min(1.9, d * 0.45) }));
      out.push(furnitureItem('sofa', cx, r.z0 + 0.5, 0, { width: round(sofaW, 2) }));
      out.push(furnitureItem('coffee_table', cx, r.z0 + 1.65));
      if (d > 3.6) out.push(furnitureItem('tv_unit', cx, r.z1 - 0.25, PI, { width: Math.min(1.8, w * 0.5) }));
      if (w > 3.8) out.push(furnitureItem('armchair', cx - sofaW / 2 - 0.8, r.z0 + 1.6, PI / 2));
      out.push(furnitureItem('plant', r.x1 - 0.3, r.z0 + 0.3));
      if (w > 3.2) out.push(furnitureItem('floor_lamp', cx + sofaW / 2 + 0.35, r.z0 + 0.3));
      break;
    }
    case 'kitchen': {
      const counterW = Math.min(w - 0.2, 4.2);
      if (counterW < 1.2) break;
      out.push(furnitureItem('kitchen_counter', cx, r.z0 + 0.31, 0, { width: round(counterW, 2) }));
      if (w >= 3.4 && d >= 3.4) out.push(furnitureItem('kitchen_island', cx, r.z0 + 0.62 + 1.1 + 0.5, 0, { width: Math.min(2.4, w - 1.6) }));
      break;
    }
    case 'dining': {
      if (w < 2.4 || d < 2.2) break;
      const long = w >= d;
      const tw = Math.min(2.2, (long ? w : d) - 1.4);
      out.push(furnitureItem('dining_table', cx, cz, long ? 0 : PI / 2, { width: round(Math.max(1.2, tw), 2) }));
      const n = tw >= 1.8 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const t = (i - (n - 1) / 2) * (tw / n);
        if (long) {
          out.push(furnitureItem('chair', cx + t, cz - 0.7, 0));
          out.push(furnitureItem('chair', cx + t, cz + 0.7, PI));
        } else {
          out.push(furnitureItem('chair', cx - 0.7, cz + t, PI / 2));
          out.push(furnitureItem('chair', cx + 0.7, cz + t, -PI / 2));
        }
      }
      out.push(furnitureItem('pendant_lamp', cx, cz, 0, { y: 1.9 }));
      break;
    }
    case 'bedroom': {
      if (d < 2.5 || w < 2.0) break;
      const bw = isMaster ? Math.min(1.8, w - 1.2) : Math.min(1.4, w - 1.0);
      out.push(furnitureItem('bed', cx, r.z0 + 1.05, 0, { width: round(Math.max(0.9, bw), 2) }));
      if (w - bw > 1.2) {
        out.push(furnitureItem('nightstand', cx - bw / 2 - 0.3, r.z0 + 0.2));
        out.push(furnitureItem('nightstand', cx + bw / 2 + 0.3, r.z0 + 0.2));
      }
      if (d > 3.4) out.push(furnitureItem('wardrobe', cx, r.z1 - 0.3, PI, { width: Math.min(2.0, w - 1.0) }));
      out.push(furnitureItem('rug', cx, r.z0 + 1.4, 0, { width: Math.min(2.4, w - 0.4), depth: 1.6 }));
      break;
    }
    case 'bathroom': {
      if (w < 1.4 || d < 1.4) break;
      out.push(furnitureItem('vanity', r.x0 + 0.55, r.z0 + 0.25));
      if (w > 1.9) out.push(furnitureItem('toilet', r.x0 + 1.4, r.z0 + 0.33));
      if (w >= 2.0 && d >= 2.4) out.push(furnitureItem('bathtub', cx, r.z1 - 0.38, PI));
      else out.push(furnitureItem('shower', r.x1 - 0.45, r.z1 - 0.45));
      break;
    }
    case 'office': {
      const cols = Math.max(1, Math.floor((w - 0.4) / 2.0));
      const rows = Math.max(1, Math.floor((d - 0.4) / 2.0));
      if (/meeting/i.test(room.name)) {
        out.push(furnitureItem('dining_table', cx, cz, w >= d ? 0 : PI / 2, { name: 'Meeting table', width: Math.min(3.2, Math.max(w, d) - 1.6), material: 'walnut' }));
        break;
      }
      let k = 0;
      for (let i = 0; i < cols && k < 48; i++) {
        for (let j = 0; j < rows && k < 48; j++, k++) {
          const x = r.x0 + (w / cols) * (i + 0.5);
          const z = r.z0 + (d / rows) * (j + 0.5);
          out.push(furnitureItem('desk', x, z - 0.2, 0));
          out.push(furnitureItem('office_chair', x, z + 0.45, PI));
        }
      }
      break;
    }
    case 'hall': {
      if (w > 1.0 && d > 1.5) out.push(furnitureItem('plant', r.x1 - 0.3, r.z1 - 0.3));
      break;
    }
    default:
      break;
  }

  // Specifically requested items not covered by the preset.
  const requested = (opts.requested ?? []).map((s) => s.toLowerCase());
  if (requested.length) {
    const have = new Set(out.map((f) => f.kind));
    let slot = 0;
    for (const req of requested) {
      const kind = matchFurnitureKind(req);
      if (!kind || have.has(kind)) continue;
      have.add(kind);
      const def = FURNITURE_DEFAULTS[kind];
      const x = r.x0 + def.w / 2 + slot;
      if (x + def.w / 2 > r.x1) break;
      out.push(furnitureItem(kind, x, r.z1 - def.d / 2, PI));
      slot += def.w + 0.4;
    }
  }
  // Keep everything inside the room.
  return out.filter((f) => f.position.x >= room.x && f.position.x <= room.x + room.width && f.position.z >= room.z && f.position.z <= room.z + room.depth);
}

const FURNITURE_WORDS: [RegExp, FurnitureKind][] = [
  [/sofa|couch|soffa/, 'sofa'],
  [/armchair|fåtölj|lounge chair/, 'armchair'],
  [/coffee table|soffbord/, 'coffee_table'],
  [/dining table|matbord|meeting table/, 'dining_table'],
  [/office chair|kontorsstol/, 'office_chair'],
  [/\bchair|stol\b/, 'chair'],
  [/\bbed\b|säng/, 'bed'],
  [/nightstand|bedside|nattduksbord/, 'nightstand'],
  [/wardrobe|closet|garderob/, 'wardrobe'],
  [/island|köksö/, 'kitchen_island'],
  [/counter|kitchen|kök|bänk/, 'kitchen_counter'],
  [/desk|skrivbord/, 'desk'],
  [/shelf|bookcase|hylla|bokhylla/, 'shelf'],
  [/rug|carpet|matta/, 'rug'],
  [/plant|växt/, 'plant'],
  [/floor lamp|golvlampa|lamp|lampa|warm light/, 'floor_lamp'],
  [/pendant|taklampa/, 'pendant_lamp'],
  [/tv|media/, 'tv_unit'],
  [/bathtub|bath tub|badkar/, 'bathtub'],
  [/shower|dusch/, 'shower'],
  [/toilet|wc|toalett/, 'toilet'],
  [/vanity|sink|handfat/, 'vanity'],
  [/lounger|sunbed|solstol/, 'lounger'],
];

export function matchFurnitureKind(text: string): FurnitureKind | undefined {
  const t = text.toLowerCase();
  for (const [re, kind] of FURNITURE_WORDS) if (re.test(t)) return kind;
  return undefined;
}
