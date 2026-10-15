/**
 * Photographed PBR texture sets (CC0, from Poly Haven) behind the library
 * materials. The app server fetches and caches them (src/server/textures.ts);
 * the browser tints them to the material's colour, so e.g. beige and white
 * plaster share one scan. Materials without an entry keep their procedural
 * textures (crisp tiles, brushed metals, glass).
 */
export interface PhotoTextureSpec {
  /** Poly Haven asset id. */
  asset: string;
  /** Roughness multiplier on the scanned roughness map (polished vs raw). */
  roughness?: number;
  /** Strength of the scanned normal map. */
  normalScale?: number;
}

export const PHOTO_MATERIALS: Record<string, PhotoTextureSpec> = {
  oak_floor: { asset: 'wood_floor' },
  wood_deck: { asset: 'wood_floor_deck' },
  oak: { asset: 'wood_table' },
  pine: { asset: 'wood_table' },
  walnut: { asset: 'wood_table' },
  larch_cladding: { asset: 'synthetic_wood' },
  charred_wood: { asset: 'synthetic_wood', roughness: 1.2 },
  plaster_white: { asset: 'white_plaster_02' },
  plaster_beige: { asset: 'white_plaster_02' },
  plaster_grey: { asset: 'white_plaster_02' },
  // Painted walls: the plaster scan with a gentle relief under the paint.
  paint_white: { asset: 'white_plaster_02', normalScale: 0.35, roughness: 0.95 },
  paint_black: { asset: 'white_plaster_02', normalScale: 0.35, roughness: 0.9 },
  paint_sage: { asset: 'white_plaster_02', normalScale: 0.35, roughness: 0.95 },
  paint_blue: { asset: 'white_plaster_02', normalScale: 0.35, roughness: 0.95 },
  paint_red: { asset: 'white_plaster_02', normalScale: 0.35, roughness: 0.95 },
  concrete: { asset: 'concrete_floor_worn_001' },
  concrete_polished: { asset: 'concrete_floor_worn_001', roughness: 0.55, normalScale: 0.5 },
  brick_red: { asset: 'red_brick' },
  brick_white: { asset: 'red_brick' },
  brick_dark: { asset: 'red_brick' },
  marble_white: { asset: 'marble_01', roughness: 0.6 },
  marble_black: { asset: 'marble_01', roughness: 0.6 },
  fabric_beige: { asset: 'rough_linen' },
  fabric_grey: { asset: 'rough_linen' },
  fabric_green: { asset: 'rough_linen' },
  leather_cognac: { asset: 'fabric_leather_02' },
  grass: { asset: 'leafy_grass' },
  gravel: { asset: 'gravel_ground_01' },
};

/** Assets the texture service may fetch (nothing else is proxied). */
export const PHOTO_ASSETS = new Set(Object.values(PHOTO_MATERIALS).map((s) => s.asset));

export type PhotoMap = 'diff' | 'nor' | 'rough';
export const PHOTO_MAPS: PhotoMap[] = ['diff', 'nor', 'rough'];
export const PHOTO_RESOLUTIONS = ['1k', '2k'] as const;
export type PhotoResolution = (typeof PHOTO_RESOLUTIONS)[number];
