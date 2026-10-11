/**
 * BuildingProgram: the compact, validated design intent an AI (or the built-in
 * interpreter) produces for prompt-to-scene generation. The deterministic
 * generator in `generateBuilding.ts` turns it into parametric elements.
 * The LLM never emits mesh vertices.
 */
import { z } from 'zod';

const len = (max: number) => z.number().finite().positive().max(max);

export const RoomFunction = z.enum([
  'living',
  'kitchen',
  'dining',
  'bedroom',
  'bathroom',
  'office',
  'hall',
  'storage',
  'garage',
  'terrace',
  'other',
]);
export type RoomFunction = z.infer<typeof RoomFunction>;

export const ProgramBlock = z.object({
  name: z.string().max(80).optional(),
  /** Minimum corner of the block in plan. */
  x: z.number().finite().default(0),
  z: z.number().finite().default(0),
  width: len(300),
  depth: len(300),
  floors: z.number().int().min(1).max(60).default(1),
  roof: z
    .object({
      type: z.enum(['none', 'flat', 'gable', 'hip', 'shed']).optional(),
      pitchDeg: z.number().min(0).max(70).optional(),
      material: z.string().max(64).optional(),
    })
    .optional(),
  /** Marks the block as a garage (garage door, no furniture). */
  garage: z.boolean().optional(),
});
export type ProgramBlock = z.infer<typeof ProgramBlock>;

export const ProgramRoom = z.object({
  name: z.string().max(80),
  function: RoomFunction.default('other'),
  level: z.number().int().min(0).max(59).default(0),
  x: z.number().finite(),
  z: z.number().finite(),
  width: len(300),
  depth: len(300),
});
export type ProgramRoom = z.infer<typeof ProgramRoom>;

export const BuildingProgram = z.object({
  name: z.string().max(120).optional(),
  kind: z.enum(['room', 'house', 'villa', 'cabin', 'office', 'apartment', 'interior', 'generic']).default('house'),
  blocks: z.array(ProgramBlock).min(1).max(12),
  floorHeight: len(20).default(2.7),
  wallThickness: len(1.5).default(0.25),
  interiorWallThickness: len(1).default(0.12),
  exteriorMaterial: z.string().max(64).default('plaster_white'),
  interiorMaterial: z.string().max(64).default('paint_white'),
  floorMaterial: z.string().max(64).default('oak_floor'),
  windows: z
    .object({
      /** Total number of windows to distribute (overrides density). */
      count: z.number().int().min(0).max(500).optional(),
      density: z.enum(['none', 'low', 'medium', 'high']).default('medium'),
      style: z.enum(['standard', 'floor_to_ceiling', 'ribbon', 'curtain']).default('standard'),
      width: len(30).optional(),
      height: len(20).optional(),
      sillHeight: z.number().min(0).max(10).optional(),
      frameMaterial: z.string().max(64).default('aluminium_black'),
    })
    .default({}),
  doors: z
    .object({
      count: z.number().int().min(0).max(20).default(1),
      type: z.enum(['hinged', 'double', 'sliding', 'sliding_glass']).default('hinged'),
      width: len(6).optional(),
      material: z.string().max(64).default('oak'),
      frameMaterial: z.string().max(64).default('aluminium_black'),
      interior: z.boolean().default(true),
    })
    .default({}),
  roof: z
    .object({
      type: z.enum(['none', 'flat', 'gable', 'hip', 'shed']).default('flat'),
      pitchDeg: z.number().min(0).max(70).default(30),
      material: z.string().max(64).default('metal_dark_grey'),
      overhang: z.number().min(0).max(3).default(0.4),
    })
    .default({}),
  /** Explicit room rectangles (plan coordinates). */
  rooms: z.array(ProgramRoom).max(200).optional(),
  /** Room counts for automatic layout when `rooms` is omitted. */
  program: z
    .object({
      bedrooms: z.number().int().min(0).max(30).default(0),
      bathrooms: z.number().int().min(0).max(20).default(0),
      living: z.boolean().default(false),
      kitchen: z.boolean().default(false),
      dining: z.boolean().default(false),
      offices: z.number().int().min(0).max(50).default(0),
    })
    .optional(),
  furnish: z.boolean().default(false),
  /** Specific furniture requests for a single-room interior. */
  furniture: z.array(z.string().max(40)).max(60).optional(),
  extras: z
    .object({
      pool: z
        .object({
          width: len(30).default(4),
          length: len(60).default(10),
          side: z.enum(['front', 'back', 'left', 'right']).default('front'),
        })
        .optional(),
      terrace: z
        .object({ depth: len(30).default(4), side: z.enum(['front', 'back', 'left', 'right']).default('front'), material: z.string().max(64).default('wood_deck') })
        .optional(),
      terrain: z.boolean().optional(),
      stairs: z.boolean().default(true),
    })
    .default({}),
});
export type BuildingProgram = z.infer<typeof BuildingProgram>;
export type BuildingProgramInput = z.input<typeof BuildingProgram>;
