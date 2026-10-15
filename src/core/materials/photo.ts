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
  /**
   * Re-colour the scan to the material's colour (paint, plaster, fabric). Without
   * it the scan keeps its own, real colour and only its brightness is matched.
   */
  recolor?: boolean;
}

export const PHOTO_MATERIALS: Record<string, PhotoTextureSpec> = {
  oak_floor: { asset: 'wood_floor' },
  wood_deck: { asset: 'wood_floor_deck' },
  oak: { asset: 'wood_table' },
  pine: { asset: 'wood_table' },
  walnut: { asset: 'wood_table', recolor: true },
  larch_cladding: { asset: 'synthetic_wood' },
  charred_wood: { asset: 'synthetic_wood', roughness: 1.2, recolor: true },
  plaster_white: { asset: 'white_plaster_02', recolor: true },
  plaster_beige: { asset: 'white_plaster_02', recolor: true },
  plaster_grey: { asset: 'white_plaster_02', recolor: true },
  // Painted walls: the plaster scan with a gentle relief under the paint.
  paint_white: { asset: 'white_plaster_02', normalScale: 0.35, roughness: 0.95, recolor: true },
  paint_black: { asset: 'white_plaster_02', normalScale: 0.35, roughness: 0.9, recolor: true },
  paint_sage: { asset: 'white_plaster_02', normalScale: 0.35, roughness: 0.95, recolor: true },
  paint_blue: { asset: 'white_plaster_02', normalScale: 0.35, roughness: 0.95, recolor: true },
  paint_red: { asset: 'white_plaster_02', normalScale: 0.35, roughness: 0.95, recolor: true },
  concrete: { asset: 'concrete_floor_worn_001' },
  concrete_polished: { asset: 'concrete_floor_worn_001', roughness: 0.55, normalScale: 0.5 },
  brick_red: { asset: 'red_brick' },
  brick_white: { asset: 'red_brick', recolor: true },
  brick_dark: { asset: 'red_brick', recolor: true },
  marble_white: { asset: 'marble_01', roughness: 0.6 },
  marble_black: { asset: 'marble_01', roughness: 0.6, recolor: true },
  fabric_beige: { asset: 'rough_linen', recolor: true },
  fabric_grey: { asset: 'rough_linen', recolor: true },
  fabric_green: { asset: 'rough_linen', recolor: true },
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

type RGB = { r: number; g: number; b: number };
const lum = (c: RGB) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/**
 * Colour multiplier for a scan (all values linear). The scan's average colour is
 * `mean`, the material's colour `target`.
 * - Natural materials keep the photographed colour; brightness moves at most ±25 %.
 * - Re-coloured materials take the target hue, but no channel is boosted more than
 *   1.6× (bright texels would exceed 100 % reflectance and blow out), and the
 *   average albedo stays at or below 0.7 (white paint is about that bright).
 */
export function photoTint(target: RGB, mean: RGB, recolor: boolean): RGB {
  const ml = Math.max(lum(mean), 0.01);
  if (!recolor) {
    let s = Math.min(1.25, Math.max(0.75, lum(target) / ml));
    if (ml * s > 0.7) s = 0.7 / ml;
    return { r: s, g: s, b: s };
  }
  let t = { r: target.r / Math.max(mean.r, 0.01), g: target.g / Math.max(mean.g, 0.01), b: target.b / Math.max(mean.b, 0.01) };
  const peak = Math.max(t.r, t.g, t.b);
  if (peak > 1.6) t = { r: (t.r * 1.6) / peak, g: (t.g * 1.6) / peak, b: (t.b * 1.6) / peak };
  const result = lum({ r: mean.r * t.r, g: mean.g * t.g, b: mean.b * t.b });
  if (result > 0.7) t = { r: (t.r * 0.7) / result, g: (t.g * 0.7) / result, b: (t.b * 0.7) / result };
  return t;
}
