/**
 * Architectural PBR material library.
 *
 * Definitions are renderer-agnostic data. The browser turns them into
 * THREE.MeshStandardMaterial / MeshPhysicalMaterial with procedurally generated
 * textures (see `src/client/three/materials.ts`); exporters reuse the same
 * colour/roughness/metalness values.
 */
import type { CustomMaterial } from '../schema/scene';

export type TexturePattern =
  | 'none'
  | 'wood'
  | 'concrete'
  | 'brick'
  | 'marble'
  | 'plaster'
  | 'stone'
  | 'tiles'
  | 'grass'
  | 'water'
  | 'metal'
  | 'fabric'
  | 'planks'
  | 'gravel';

export type MaterialCategory =
  | 'wood'
  | 'masonry'
  | 'concrete'
  | 'stone'
  | 'plaster'
  | 'metal'
  | 'glass'
  | 'ceramic'
  | 'fabric'
  | 'landscape'
  | 'paint';

export interface MaterialDef {
  id: string;
  name: string;
  /** Swedish display name, used by the built-in interpreter for matching. */
  nameSv?: string;
  category: MaterialCategory;
  color: string;
  /** Secondary colour used by the procedural texture generator. */
  color2?: string;
  roughness: number;
  metalness: number;
  pattern: TexturePattern;
  /** Real-world size in meters covered by one texture tile. */
  tileSize: number;
  opacity?: number;
  transmission?: number;
  ior?: number;
  /** Matching keywords (English + Swedish). */
  keywords: string[];
}

const M = (d: MaterialDef) => d;

export const MATERIALS: MaterialDef[] = [
  // Wood
  M({ id: 'oak', name: 'Oak', nameSv: 'Ek', category: 'wood', color: '#c49a6c', color2: '#a87b4f', roughness: 0.55, metalness: 0, pattern: 'wood', tileSize: 1.2, keywords: ['oak', 'ek', 'ekträ', 'light wood', 'ljust trä', 'wood', 'trä'] }),
  M({ id: 'oak_floor', name: 'Oak plank floor', nameSv: 'Ekgolv', category: 'wood', color: '#c9a273', color2: '#a9814f', roughness: 0.45, metalness: 0, pattern: 'planks', tileSize: 2.0, keywords: ['oak floor', 'oak flooring', 'parquet', 'ekgolv', 'parkett', 'trägolv', 'wood floor'] }),
  M({ id: 'walnut', name: 'Walnut', nameSv: 'Valnöt', category: 'wood', color: '#5d3d26', color2: '#3f281a', roughness: 0.5, metalness: 0, pattern: 'wood', tileSize: 1.2, keywords: ['walnut', 'valnöt', 'dark wood', 'mörkt trä'] }),
  M({ id: 'pine', name: 'Pine', nameSv: 'Furu', category: 'wood', color: '#dcb985', color2: '#c39b62', roughness: 0.6, metalness: 0, pattern: 'wood', tileSize: 1.2, keywords: ['pine', 'furu', 'gran', 'spruce'] }),
  M({ id: 'larch_cladding', name: 'Larch cladding', nameSv: 'Lärkpanel', category: 'wood', color: '#a87f55', color2: '#8a6440', roughness: 0.7, metalness: 0, pattern: 'planks', tileSize: 2.4, keywords: ['larch', 'cladding', 'timber cladding', 'panel', 'träpanel', 'lärk'] }),
  M({ id: 'charred_wood', name: 'Charred timber', nameSv: 'Bränt trä', category: 'wood', color: '#232120', color2: '#141312', roughness: 0.85, metalness: 0, pattern: 'planks', tileSize: 2.4, keywords: ['charred', 'black wood', 'svart trä', 'shou sugi ban', 'bränt'] }),
  M({ id: 'wood_deck', name: 'Wood decking', nameSv: 'Trädäck', category: 'wood', color: '#9c7451', color2: '#7a5536', roughness: 0.75, metalness: 0, pattern: 'planks', tileSize: 1.8, keywords: ['deck', 'decking', 'trall', 'trädäck'] }),
  // Plaster / paint
  M({ id: 'plaster_white', name: 'White plaster', nameSv: 'Vit puts', category: 'plaster', color: '#f1efea', color2: '#e3e0d9', roughness: 0.9, metalness: 0, pattern: 'plaster', tileSize: 2, keywords: ['white plaster', 'white render', 'vit puts', 'puts', 'plaster', 'render', 'white', 'vit'] }),
  M({ id: 'plaster_beige', name: 'Beige plaster', nameSv: 'Beige puts', category: 'plaster', color: '#e3d6c0', color2: '#d4c6ad', roughness: 0.9, metalness: 0, pattern: 'plaster', tileSize: 2, keywords: ['beige', 'sand', 'cream', 'beige puts'] }),
  M({ id: 'plaster_grey', name: 'Grey plaster', nameSv: 'Grå puts', category: 'plaster', color: '#a7a7a3', color2: '#97978f', roughness: 0.9, metalness: 0, pattern: 'plaster', tileSize: 2, keywords: ['grey plaster', 'gray plaster', 'grå puts', 'grey', 'gray', 'grå'] }),
  M({ id: 'paint_white', name: 'White paint', nameSv: 'Vit färg', category: 'paint', color: '#f4f4f2', roughness: 0.6, metalness: 0, pattern: 'none', tileSize: 1, keywords: ['white paint', 'vit färg', 'painted white'] }),
  M({ id: 'paint_black', name: 'Black paint', nameSv: 'Svart färg', category: 'paint', color: '#1b1b1c', roughness: 0.5, metalness: 0, pattern: 'none', tileSize: 1, keywords: ['black', 'svart', 'black paint'] }),
  M({ id: 'paint_sage', name: 'Sage green paint', nameSv: 'Salviagrön', category: 'paint', color: '#8f9e86', roughness: 0.6, metalness: 0, pattern: 'none', tileSize: 1, keywords: ['green', 'grön', 'sage'] }),
  M({ id: 'paint_blue', name: 'Navy paint', nameSv: 'Marinblå', category: 'paint', color: '#253650', roughness: 0.55, metalness: 0, pattern: 'none', tileSize: 1, keywords: ['blue', 'blå', 'navy'] }),
  M({ id: 'paint_red', name: 'Falu red', nameSv: 'Falu rödfärg', category: 'paint', color: '#7d2a1f', roughness: 0.85, metalness: 0, pattern: 'none', tileSize: 1, keywords: ['red', 'röd', 'falu', 'falu red', 'rödfärg'] }),
  // Concrete / masonry / stone
  M({ id: 'concrete', name: 'Exposed concrete', nameSv: 'Betong', category: 'concrete', color: '#9c9a95', color2: '#86847f', roughness: 0.85, metalness: 0, pattern: 'concrete', tileSize: 2.5, keywords: ['concrete', 'betong', 'raw concrete', 'board-formed'] }),
  M({ id: 'concrete_polished', name: 'Polished concrete', nameSv: 'Slipad betong', category: 'concrete', color: '#b3b0aa', color2: '#9d9a94', roughness: 0.35, metalness: 0, pattern: 'concrete', tileSize: 3, keywords: ['polished concrete', 'slipad betong', 'microcement'] }),
  M({ id: 'brick_red', name: 'Red brick', nameSv: 'Rött tegel', category: 'masonry', color: '#8e4a35', color2: '#d8cfc4', roughness: 0.9, metalness: 0, pattern: 'brick', tileSize: 1, keywords: ['brick', 'tegel', 'red brick', 'rött tegel'] }),
  M({ id: 'brick_white', name: 'White brick', nameSv: 'Vitt tegel', category: 'masonry', color: '#e6e1d8', color2: '#bdb7ad', roughness: 0.9, metalness: 0, pattern: 'brick', tileSize: 1, keywords: ['white brick', 'vitt tegel'] }),
  M({ id: 'brick_dark', name: 'Dark brick', nameSv: 'Mörkt tegel', category: 'masonry', color: '#3c3330', color2: '#7d7570', roughness: 0.9, metalness: 0, pattern: 'brick', tileSize: 1, keywords: ['dark brick', 'mörkt tegel', 'black brick'] }),
  M({ id: 'marble_white', name: 'Carrara marble', nameSv: 'Carraramarmor', category: 'stone', color: '#eeece8', color2: '#9a9a9e', roughness: 0.2, metalness: 0, pattern: 'marble', tileSize: 1.5, keywords: ['marble', 'marmor', 'carrara', 'white marble'] }),
  M({ id: 'marble_black', name: 'Nero marble', nameSv: 'Svart marmor', category: 'stone', color: '#1f1f22', color2: '#8c8a88', roughness: 0.2, metalness: 0, pattern: 'marble', tileSize: 1.5, keywords: ['black marble', 'svart marmor', 'nero'] }),
  M({ id: 'stone_light', name: 'Limestone', nameSv: 'Kalksten', category: 'stone', color: '#d6cdbb', color2: '#c2b8a3', roughness: 0.75, metalness: 0, pattern: 'stone', tileSize: 1.2, keywords: ['limestone', 'kalksten', 'stone', 'sten', 'light stone'] }),
  M({ id: 'stone_slate', name: 'Slate', nameSv: 'Skiffer', category: 'stone', color: '#3d4045', color2: '#2d3034', roughness: 0.7, metalness: 0, pattern: 'stone', tileSize: 1, keywords: ['slate', 'skiffer', 'dark stone'] }),
  M({ id: 'granite', name: 'Granite', nameSv: 'Granit', category: 'stone', color: '#7f7d7a', color2: '#4f4d4b', roughness: 0.55, metalness: 0, pattern: 'gravel', tileSize: 0.8, keywords: ['granite', 'granit'] }),
  // Ceramic
  M({ id: 'tile_white', name: 'White ceramic tile', nameSv: 'Vitt kakel', category: 'ceramic', color: '#f3f3f1', color2: '#cfcfcb', roughness: 0.25, metalness: 0, pattern: 'tiles', tileSize: 0.6, keywords: ['tile', 'tiles', 'ceramic', 'kakel', 'klinker', 'white tile'] }),
  M({ id: 'tile_grey', name: 'Grey porcelain tile', nameSv: 'Grå klinker', category: 'ceramic', color: '#8d8c88', color2: '#6f6e6a', roughness: 0.35, metalness: 0, pattern: 'tiles', tileSize: 1.2, keywords: ['grey tile', 'porcelain', 'grå klinker'] }),
  M({ id: 'tile_pool', name: 'Pool mosaic', nameSv: 'Poolmosaik', category: 'ceramic', color: '#4fa3b8', color2: '#3b8a9f', roughness: 0.2, metalness: 0, pattern: 'tiles', tileSize: 0.3, keywords: ['pool tile', 'mosaic', 'mosaik'] }),
  // Metal
  M({ id: 'aluminium_black', name: 'Black aluminium', nameSv: 'Svart aluminium', category: 'metal', color: '#1c1d1f', roughness: 0.4, metalness: 0.8, pattern: 'metal', tileSize: 1, keywords: ['black aluminium', 'black aluminum', 'svart aluminium', 'black metal', 'svart metall'] }),
  M({ id: 'aluminium', name: 'Anodised aluminium', nameSv: 'Aluminium', category: 'metal', color: '#b9bcbf', roughness: 0.35, metalness: 0.9, pattern: 'metal', tileSize: 1, keywords: ['aluminium', 'aluminum', 'silver', 'silver metal'] }),
  M({ id: 'steel', name: 'Brushed steel', nameSv: 'Borstat stål', category: 'metal', color: '#9ea2a6', roughness: 0.3, metalness: 1, pattern: 'metal', tileSize: 1, keywords: ['steel', 'stål', 'stainless', 'rostfritt'] }),
  M({ id: 'metal_dark_grey', name: 'Dark grey standing seam', nameSv: 'Mörkgrå plåt', category: 'metal', color: '#3b3e42', roughness: 0.45, metalness: 0.7, pattern: 'metal', tileSize: 1, keywords: ['dark grey metal', 'dark gray metal', 'mörkgrå plåt', 'plåt', 'standing seam', 'metal roof', 'plåttak'] }),
  M({ id: 'corten', name: 'Corten steel', nameSv: 'Cortenstål', category: 'metal', color: '#7a3e1d', roughness: 0.8, metalness: 0.4, pattern: 'concrete', tileSize: 1.5, keywords: ['corten', 'rust', 'weathering steel'] }),
  M({ id: 'brass', name: 'Brushed brass', nameSv: 'Mässing', category: 'metal', color: '#b28b46', roughness: 0.3, metalness: 1, pattern: 'metal', tileSize: 1, keywords: ['brass', 'mässing', 'gold', 'guld'] }),
  // Glass
  M({ id: 'glass_clear', name: 'Clear glazing', nameSv: 'Klarglas', category: 'glass', color: '#d7e6ee', roughness: 0.03, metalness: 0, pattern: 'none', tileSize: 1, opacity: 0.25, transmission: 0.95, ior: 1.5, keywords: ['glass', 'glas', 'clear glass', 'glazing'] }),
  M({ id: 'glass_tinted', name: 'Tinted glazing', nameSv: 'Tonat glas', category: 'glass', color: '#5d6d75', roughness: 0.03, metalness: 0, pattern: 'none', tileSize: 1, opacity: 0.45, transmission: 0.7, ior: 1.5, keywords: ['tinted glass', 'tonat glas', 'dark glass', 'solar glass'] }),
  M({ id: 'glass_frosted', name: 'Frosted glass', nameSv: 'Frostat glas', category: 'glass', color: '#e8eef0', roughness: 0.6, metalness: 0, pattern: 'none', tileSize: 1, opacity: 0.6, transmission: 0.6, ior: 1.5, keywords: ['frosted', 'frostat', 'satin glass', 'matt glass'] }),
  // Fabric / soft
  M({ id: 'fabric_beige', name: 'Beige linen', nameSv: 'Beige linne', category: 'fabric', color: '#cbbfa8', color2: '#b9ad95', roughness: 0.95, metalness: 0, pattern: 'fabric', tileSize: 0.3, keywords: ['linen', 'linne', 'fabric', 'tyg', 'beige fabric'] }),
  M({ id: 'fabric_grey', name: 'Grey wool', nameSv: 'Grå ull', category: 'fabric', color: '#6f6f72', color2: '#626265', roughness: 0.95, metalness: 0, pattern: 'fabric', tileSize: 0.3, keywords: ['wool', 'ull', 'grey fabric', 'gray fabric'] }),
  M({ id: 'fabric_green', name: 'Green velvet', nameSv: 'Grön sammet', category: 'fabric', color: '#365447', color2: '#2c463b', roughness: 0.85, metalness: 0, pattern: 'fabric', tileSize: 0.3, keywords: ['velvet', 'sammet', 'green fabric'] }),
  M({ id: 'leather_cognac', name: 'Cognac leather', nameSv: 'Konjakläder', category: 'fabric', color: '#8a4f2a', roughness: 0.55, metalness: 0, pattern: 'none', tileSize: 1, keywords: ['leather', 'läder', 'cognac'] }),
  // Landscape
  M({ id: 'grass', name: 'Lawn', nameSv: 'Gräsmatta', category: 'landscape', color: '#5d7d3c', color2: '#4b6a2f', roughness: 1, metalness: 0, pattern: 'grass', tileSize: 3, keywords: ['grass', 'lawn', 'gräs', 'gräsmatta'] }),
  M({ id: 'gravel', name: 'Gravel', nameSv: 'Grus', category: 'landscape', color: '#b1aa9d', color2: '#8d877b', roughness: 1, metalness: 0, pattern: 'gravel', tileSize: 1, keywords: ['gravel', 'grus'] }),
  M({ id: 'water', name: 'Pool water', nameSv: 'Vatten', category: 'landscape', color: '#3d9bb5', roughness: 0.05, metalness: 0, pattern: 'water', tileSize: 4, opacity: 0.75, transmission: 0.6, ior: 1.33, keywords: ['water', 'vatten'] }),
  M({ id: 'foliage', name: 'Foliage', nameSv: 'Bladverk', category: 'landscape', color: '#4a6b35', roughness: 0.9, metalness: 0, pattern: 'none', tileSize: 1, keywords: ['plant', 'foliage', 'växt'] }),
];

const BY_ID = new Map(MATERIALS.map((m) => [m.id, m]));

export const DEFAULT_MATERIAL_ID = 'plaster_white';

export function getLibraryMaterial(id: string): MaterialDef | undefined {
  return BY_ID.get(id);
}

/** Resolves a material reference against the library and scene custom materials. */
export function resolveMaterial(ref: string, custom: CustomMaterial[] = []): MaterialDef {
  const lib = BY_ID.get(ref);
  if (lib) return lib;
  const c = custom.find((m) => m.id === ref);
  if (c) {
    const baseDef = BY_ID.get(c.base) ?? BY_ID.get(DEFAULT_MATERIAL_ID)!;
    return {
      ...baseDef,
      id: c.id,
      name: c.name,
      color: c.color ?? baseDef.color,
      roughness: c.roughness ?? baseDef.roughness,
      metalness: c.metalness ?? baseDef.metalness,
    };
  }
  return BY_ID.get(DEFAULT_MATERIAL_ID)!;
}

export function materialExists(ref: string, custom: CustomMaterial[] = []): boolean {
  return BY_ID.has(ref) || custom.some((m) => m.id === ref);
}

/**
 * Finds the best library material for a phrase such as "black aluminium" or
 * "mörk valnöt". `preferCategories` biases the choice, e.g. frames prefer metal.
 */
export function findMaterialByText(text: string, preferCategories: MaterialCategory[] = []): MaterialDef | undefined {
  const t = text.toLowerCase();
  let best: { def: MaterialDef; score: number } | undefined;
  for (const def of MATERIALS) {
    for (const kw of def.keywords) {
      const re = new RegExp(`(^|[^a-zåäö])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-zåäö])`, 'i');
      if (!re.test(t)) continue;
      let score = kw.length;
      if (preferCategories.includes(def.category)) score += 6;
      if (!best || score > best.score) best = { def, score };
    }
  }
  return best?.def;
}
