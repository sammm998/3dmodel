import { z } from 'zod';
import { Element, type ElementType, Vec3 } from './elements';

export const SCENE_SCHEMA_VERSION = 1;

export const Level = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/).max(64),
  name: z.string().min(1).max(80),
  /** Elevation of the finished floor above project zero. */
  elevation: z.number().finite().min(-100).max(1000),
  /** Floor-to-floor height. */
  height: z.number().finite().positive().max(100),
});
export type Level = z.infer<typeof Level>;

/** User/AI defined material, derived from a library material. */
export const CustomMaterial = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/).max(64),
  name: z.string().min(1).max(80),
  base: z.string().max(64),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  roughness: z.number().min(0).max(1).optional(),
  metalness: z.number().min(0).max(1).optional(),
});
export type CustomMaterial = z.infer<typeof CustomMaterial>;

export const Group = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/).max(64),
  name: z.string().min(1).max(80),
});
export type Group = z.infer<typeof Group>;

export const SavedView = z.object({
  id: z.string().max(64),
  name: z.string().max(80),
  position: Vec3,
  target: Vec3,
  fov: z.number().min(10).max(120).default(50),
});
export type SavedView = z.infer<typeof SavedView>;

export const SceneSettings = z.object({
  environment: z.enum(['day', 'sunset', 'overcast', 'night']).default('day'),
  /** Sun direction in degrees. */
  sunAzimuth: z.number().min(-360).max(360).default(35),
  sunElevation: z.number().min(0).max(90).default(38),
  displayUnits: z.enum(['m', 'cm', 'mm', 'ft']).default('m'),
});
export type SceneSettings = z.infer<typeof SceneSettings>;

export const Scene = z.object({
  schemaVersion: z.literal(SCENE_SCHEMA_VERSION),
  units: z.literal('m'),
  levels: z.array(Level).min(1).max(200),
  elements: z.array(Element).max(20000),
  groups: z.array(Group).default([]),
  materials: z.array(CustomMaterial).default([]),
  views: z.array(SavedView).default([]),
  settings: SceneSettings.default({}),
  /** Monotonic id counters per prefix; guarantees ids are never reused. */
  counters: z.record(z.number().int().min(0)).default({}),
});
export type Scene = z.infer<typeof Scene>;

export function emptyScene(): Scene {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    units: 'm',
    levels: [{ id: 'level_0', name: 'Ground floor', elevation: 0, height: 2.7 }],
    elements: [],
    groups: [],
    materials: [],
    views: [],
    settings: { environment: 'day', sunAzimuth: 35, sunElevation: 38, displayUnits: 'm' },
    counters: { level: 0 },
  };
}

/** Allocates the next persistent id for a prefix, e.g. `wall_014`. Mutates counters. */
export function allocateId(scene: Pick<Scene, 'counters' | 'elements'>, prefix: ElementType | string): string {
  const taken = new Set(scene.elements.map((e) => e.id));
  let n = scene.counters[prefix] ?? 0;
  let id: string;
  do {
    n += 1;
    id = `${prefix}_${String(n).padStart(3, '0')}`;
  } while (taken.has(id));
  scene.counters[prefix] = n;
  return id;
}

export function parseScene(input: unknown): Scene {
  return Scene.parse(input);
}
