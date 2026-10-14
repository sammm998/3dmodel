/**
 * Typed scene schema.
 *
 * Conventions
 * - All lengths are in meters, angles on elements are in radians unless the
 *   field name says otherwise (e.g. `pitchDeg`).
 * - Y is up. Plan coordinates use (x, z); +z points "south" / towards the
 *   default front camera.
 * - Every element has a persistent, human-readable id such as `wall_014`.
 * - Visual geometry is never stored: it is derived deterministically from these
 *   parameters by `src/core/geometry`. BIM-oriented data lives in `bim`.
 */
import { z } from 'zod';

export const Vec2 = z.object({ x: z.number().finite(), z: z.number().finite() });
export type Vec2 = z.infer<typeof Vec2>;

export const Vec3 = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() });
export type Vec3 = z.infer<typeof Vec3>;

const pos = (max = 1000) => z.number().finite().positive().max(max);
const nonNeg = (max = 1000) => z.number().finite().min(0).max(max);

/** Material reference: id of a library material or of a scene custom material. */
export const MaterialRef = z.string().min(1).max(64);

export const BimData = z.record(z.union([z.string(), z.number(), z.boolean()])).optional();

const base = {
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, 'ids are lowercase snake_case').max(64),
  name: z.string().min(1).max(120),
  levelId: z.string().max(64).optional(),
  groupId: z.string().max(64).optional(),
  layer: z.string().max(64).optional(),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  /** Semantic metadata used by the AI and by exporters. */
  tags: z.array(z.string().max(48)).max(32).optional(),
  bim: BimData,
};

export const WallElement = z.object({
  ...base,
  type: z.literal('wall'),
  start: Vec2,
  end: Vec2,
  height: pos(200),
  thickness: pos(3),
  /** Vertical offset of the wall base relative to its level. */
  baseOffset: z.number().finite().min(-50).max(200).default(0),
  material: MaterialRef,
  /** Optional finish of the interior face; falls back to `material`. */
  interiorMaterial: MaterialRef.optional(),
  exterior: z.boolean().default(false),
});
export type WallElement = z.infer<typeof WallElement>;

export const WindowElement = z.object({
  ...base,
  type: z.literal('window'),
  hostId: z.string(),
  /** Distance from the host wall start to the window centre, along the wall. */
  offset: z.number().finite(),
  width: pos(50),
  height: pos(50),
  sillHeight: nonNeg(50),
  frameDepth: pos(1).default(0.08),
  frameWidth: pos(0.5).default(0.06),
  frameMaterial: MaterialRef,
  glazingMaterial: MaterialRef.default('glass_clear'),
  style: z.enum(['fixed', 'casement', 'sliding', 'curtain']).default('casement'),
  mullionsVertical: z.number().int().min(0).max(40).default(0),
  mullionsHorizontal: z.number().int().min(0).max(40).default(0),
});
export type WindowElement = z.infer<typeof WindowElement>;

export const DoorElement = z.object({
  ...base,
  type: z.literal('door'),
  hostId: z.string(),
  offset: z.number().finite(),
  width: pos(20),
  height: pos(20),
  doorType: z.enum(['hinged', 'double', 'sliding', 'sliding_glass', 'garage', 'opening']).default('hinged'),
  swing: z.enum(['left', 'right']).default('left'),
  frameMaterial: MaterialRef,
  leafMaterial: MaterialRef,
  frameDepth: pos(1).default(0.1),
});
export type DoorElement = z.infer<typeof DoorElement>;

export const SlabElement = z.object({
  ...base,
  type: z.literal('slab'),
  /** Plan polygon (counter-clockwise or clockwise). */
  polygon: z.array(Vec2).min(3).max(512),
  thickness: pos(5),
  /** Elevation of the top surface relative to the level. */
  elevation: z.number().finite().min(-50).max(200).default(0),
  material: MaterialRef,
  role: z.enum(['floor', 'ceiling', 'terrace', 'foundation', 'deck']).default('floor'),
});
export type SlabElement = z.infer<typeof SlabElement>;

export const RoofElement = z.object({
  ...base,
  type: z.literal('roof'),
  roofType: z.enum(['flat', 'gable', 'hip', 'shed']),
  center: Vec2,
  /** Footprint along local x (before overhang). */
  width: pos(500),
  /** Footprint along local z (before overhang). */
  depth: pos(500),
  rotation: z.number().finite().default(0),
  pitchDeg: z.number().finite().min(0).max(75).default(30),
  overhang: nonNeg(5).default(0.4),
  thickness: pos(2).default(0.25),
  /** Elevation of the eave line (top of walls) relative to the level. */
  baseOffset: z.number().finite().min(-50).max(500),
  /** For gable/shed: which local axis the ridge runs along. */
  ridgeAxis: z.enum(['x', 'z']).default('x'),
  material: MaterialRef,
  /** Material for gable end infill (gable roofs). */
  gableMaterial: MaterialRef.optional(),
  parapetHeight: nonNeg(3).default(0),
});
export type RoofElement = z.infer<typeof RoofElement>;

export const SkylightElement = z.object({
  ...base,
  type: z.literal('skylight'),
  hostId: z.string(),
  /** Offset from roof centre in roof-local x/z (meters, plan projection). */
  u: z.number().finite(),
  v: z.number().finite(),
  width: pos(20),
  length: pos(20),
  frameMaterial: MaterialRef,
  glazingMaterial: MaterialRef.default('glass_clear'),
});
export type SkylightElement = z.infer<typeof SkylightElement>;

export const StairElement = z.object({
  ...base,
  type: z.literal('stair'),
  /** Plan position of the bottom of the first step (centre of its width). */
  position: Vec2,
  /** Direction of ascent as rotation around Y (0 = towards -z / north). */
  rotation: z.number().finite().default(0),
  width: pos(10),
  totalRise: pos(50),
  totalRun: pos(50),
  steps: z.number().int().min(2).max(100),
  baseOffset: z.number().finite().default(0),
  material: MaterialRef,
});
export type StairElement = z.infer<typeof StairElement>;

export const ColumnElement = z.object({
  ...base,
  type: z.literal('column'),
  position: Vec2,
  width: pos(10),
  depth: pos(10),
  height: pos(200),
  baseOffset: z.number().finite().default(0),
  shape: z.enum(['rect', 'round']).default('rect'),
  rotation: z.number().finite().default(0),
  material: MaterialRef,
});
export type ColumnElement = z.infer<typeof ColumnElement>;

export const BeamElement = z.object({
  ...base,
  type: z.literal('beam'),
  start: Vec3,
  end: Vec3,
  width: pos(5),
  depth: pos(5),
  /** Cross-section: rectangular (width × depth) or round (tube/rod, diameter = width). */
  profile: z.enum(['rect', 'round']).default('rect'),
  material: MaterialRef,
});
export type BeamElement = z.infer<typeof BeamElement>;

export const RoomElement = z.object({
  ...base,
  type: z.literal('room'),
  polygon: z.array(Vec2).min(3).max(512),
  function: z
    .enum(['living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'office', 'hall', 'storage', 'garage', 'terrace', 'other'])
    .default('other'),
  floorMaterial: MaterialRef.optional(),
});
export type RoomElement = z.infer<typeof RoomElement>;

export const FurnitureKind = z.enum([
  'sofa',
  'armchair',
  'coffee_table',
  'dining_table',
  'chair',
  'bed',
  'nightstand',
  'wardrobe',
  'kitchen_counter',
  'kitchen_island',
  'desk',
  'office_chair',
  'shelf',
  'rug',
  'plant',
  'floor_lamp',
  'pendant_lamp',
  'tv_unit',
  'bathtub',
  'shower',
  'toilet',
  'vanity',
  'lounger',
  'box',
]);
export type FurnitureKind = z.infer<typeof FurnitureKind>;

export const FurnitureElement = z.object({
  ...base,
  type: z.literal('furniture'),
  kind: FurnitureKind,
  /** Plan centre of the footprint; y is the base offset relative to the level. */
  position: Vec3,
  rotation: z.number().finite().default(0),
  width: pos(30),
  depth: pos(30),
  height: pos(30),
  material: MaterialRef,
  secondaryMaterial: MaterialRef.optional(),
});
export type FurnitureElement = z.infer<typeof FurnitureElement>;

export const TerrainElement = z.object({
  ...base,
  type: z.literal('terrain'),
  center: Vec2,
  width: pos(5000),
  depth: pos(5000),
  elevation: z.number().finite().default(-0.02),
  material: MaterialRef,
});
export type TerrainElement = z.infer<typeof TerrainElement>;

export const PoolElement = z.object({
  ...base,
  type: z.literal('pool'),
  center: Vec2,
  width: pos(100),
  length: pos(100),
  waterDepth: pos(10).default(1.5),
  rotation: z.number().finite().default(0),
  copingWidth: nonNeg(2).default(0.3),
  material: MaterialRef,
  copingMaterial: MaterialRef.default('stone_light'),
});
export type PoolElement = z.infer<typeof PoolElement>;

/** Generic parametric box, used for custom objects and AI-created primitives. */
export const SolidShape = z.enum(['box', 'cylinder', 'sphere', 'cone', 'torus', 'capsule']);
export type SolidShape = z.infer<typeof SolidShape>;

/**
 * Generic solid ("object"): a box, cylinder, sphere, cone, torus (ring) or capsule
 * fitted in a width × height × depth bounding box whose bottom centre is `position`.
 * It turns by `rotation` about Y, then tilts by `tiltX` / `tiltZ` about its centre.
 * Cylinders, cones and capsules stand along Y; a torus lies in its local X–Y plane
 * (a wheel facing ±Z) with tube diameter `thickness`.
 */
export const BoxElement = z.object({
  ...base,
  type: z.literal('box'),
  position: Vec3,
  rotation: z.number().finite().default(0),
  width: pos(1000),
  depth: pos(1000),
  height: pos(1000),
  material: MaterialRef,
  shape: SolidShape.default('box'),
  tiltX: z.number().finite().default(0),
  tiltZ: z.number().finite().default(0),
  /** Rounded edges for boxes (m). */
  cornerRadius: z.number().min(0).max(50).default(0),
  /** Torus tube diameter (m). */
  thickness: z.number().positive().max(100).optional(),
  /** Top / bottom radius ratio for cylinders and cones (cone default 0). */
  taper: z.number().min(0).max(20).optional(),
  /** Partial sweep for cylinders, cones and tori (degrees). */
  arcDeg: z.number().min(1).max(360).default(360),
});
export type BoxElement = z.infer<typeof BoxElement>;

export const Element = z.discriminatedUnion('type', [
  WallElement,
  WindowElement,
  DoorElement,
  SlabElement,
  RoofElement,
  SkylightElement,
  StairElement,
  ColumnElement,
  BeamElement,
  RoomElement,
  FurnitureElement,
  TerrainElement,
  PoolElement,
  BoxElement,
]);
export type Element = z.infer<typeof Element>;
export type ElementType = Element['type'];
export type ElementOf<T extends ElementType> = Extract<Element, { type: T }>;

export const ELEMENT_TYPES: ElementType[] = [
  'wall',
  'window',
  'door',
  'slab',
  'roof',
  'skylight',
  'stair',
  'column',
  'beam',
  'room',
  'furniture',
  'terrain',
  'pool',
  'box',
];

/** Element types that are hosted by another element. */
export const HOSTED_TYPES = new Set<ElementType>(['window', 'door', 'skylight']);

export const ELEMENT_TYPE_LABELS: Record<ElementType, string> = {
  wall: 'Wall',
  window: 'Window',
  door: 'Door',
  slab: 'Slab',
  roof: 'Roof',
  skylight: 'Skylight',
  stair: 'Stair',
  column: 'Column',
  beam: 'Beam',
  room: 'Room',
  furniture: 'Furniture',
  terrain: 'Terrain',
  pool: 'Pool',
  box: 'Object',
};
