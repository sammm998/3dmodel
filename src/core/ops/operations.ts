/**
 * Scene operation language.
 *
 * Everything that changes a scene — UI gizmos, the properties panel, the
 * built-in interpreter and LLM tool calls — is expressed as these validated
 * operations and executed by the deterministic engine in `apply.ts`.
 * Model output is data only; nothing it produces is ever executed as code.
 */
import { z } from 'zod';
import { ELEMENT_TYPES, type ElementType } from '../schema/elements';
import { CustomMaterial } from '../schema/scene';
import { BuildingProgram } from '../generator/program';

const Id = z.string().min(1).max(64);
const ElementTypeEnum = z.enum(ELEMENT_TYPES as [ElementType, ...ElementType[]]);
const NumRecord = z.record(z.number().finite());

/** Partial element description; fully validated after defaults are applied. */
export const ElementDraft = z
  .object({ type: ElementTypeEnum })
  .passthrough()
  .refine((o) => !('id' in o) || typeof (o as { id?: unknown }).id === 'string', 'id must be a string');

export const CreateOp = z.object({
  op: z.literal('create'),
  element: ElementDraft,
  /** Temporary handle (e.g. "$wall1") later operations may use as an id. */
  ref: z
    .string()
    .regex(/^\$[a-zA-Z0-9_]+$/)
    .optional(),
});

export const ModifyOp = z.object({
  op: z.literal('modify'),
  id: Id,
  /** Absolute values. Supports virtual properties such as wall `length`. */
  set: z.record(z.unknown()).optional(),
  /** Multiplicative factors, e.g. { width: 1.3 } = 30% wider. */
  scale: NumRecord.optional(),
  /** Additive deltas in meters (or degrees for pitchDeg). */
  add: NumRecord.optional(),
  /** World-space translation in meters. */
  translate: z.object({ x: z.number().finite().optional(), y: z.number().finite().optional(), z: z.number().finite().optional() }).optional(),
  /** Hosted openings: slide along the host wall (meters, + towards wall end). */
  moveAlongHost: z.number().finite().optional(),
  /** Walls: move perpendicular to the wall (meters, + along the wall's left normal). */
  moveNormal: z.number().finite().optional(),
  /** Rotation about the element anchor around +Y, in degrees. */
  rotateDeg: z.number().finite().optional(),
  /** For length/width changes: which point stays fixed. */
  anchor: z.enum(['start', 'center', 'end']).optional(),
  /** Walls: move on their own without stretching joined walls or reshaping rooms (moving a whole room). */
  rigid: z.boolean().optional(),
});

export const DeleteOp = z.object({ op: z.literal('delete'), id: Id });

export const DeleteWhereOp = z.object({
  op: z.literal('delete_where'),
  types: z.array(ElementTypeEnum).min(1),
  roomId: Id.optional(),
  levelId: Id.optional(),
});

export const ReplaceOp = z.object({
  op: z.literal('replace'),
  id: Id,
  element: ElementDraft,
});

export const SetMaterialOp = z.object({
  op: z.literal('set_material'),
  ids: z.array(Id).min(1).max(5000),
  material: z.string().min(1).max(64),
  /** Material slot, e.g. frameMaterial. Defaults to the primary slot. */
  slot: z.string().max(40).optional(),
});

export const DefineMaterialOp = z.object({ op: z.literal('define_material'), material: CustomMaterial });

export const SetLevelOp = z.object({
  op: z.literal('set_level'),
  id: Id,
  name: z.string().max(80).optional(),
  height: z.number().finite().positive().max(100).optional(),
  /** Scale openings on the level proportionally with the height change. */
  preserveOpeningProportions: z.boolean().optional(),
});

export const AddLevelOp = z.object({
  op: z.literal('add_level'),
  name: z.string().max(80).optional(),
  height: z.number().finite().positive().max(100).optional(),
  /** Copy exterior walls of the level below. */
  copyWallsFrom: Id.optional(),
});

export const GenerateBuildingOp = z.object({
  op: z.literal('generate_building'),
  program: BuildingProgram,
  mode: z.enum(['replace', 'append']).default('replace'),
  origin: z.object({ x: z.number(), z: z.number() }).optional(),
});

export const GroupOp = z.object({
  op: z.literal('group'),
  ids: z.array(Id).min(1),
  name: z.string().max(80),
});

export const Operation = z.discriminatedUnion('op', [
  CreateOp,
  ModifyOp,
  DeleteOp,
  DeleteWhereOp,
  ReplaceOp,
  SetMaterialOp,
  DefineMaterialOp,
  SetLevelOp,
  AddLevelOp,
  GenerateBuildingOp,
  GroupOp,
]);
export type Operation = z.infer<typeof Operation>;
export type OperationInput = z.input<typeof Operation>;

export const OperationList = z.array(Operation).max(500);

/** A full AI/assistant proposal. */
export const AiProposal = z.object({
  message: z.string().max(4000),
  operations: z.array(z.unknown()).max(500).default([]),
  /** The model's own judgement that the change needs explicit confirmation. */
  needsConfirmation: z.boolean().default(false),
  /** When the request is ambiguous, ask instead of guessing. */
  clarifyingQuestion: z.string().max(1000).optional(),
});
export type AiProposal = z.infer<typeof AiProposal>;

export interface ParsedOps {
  ok: Operation[];
  errors: { index: number; message: string }[];
}

/** Parses an untrusted list of operations, keeping per-item errors. */
export function parseOperations(raw: unknown[]): ParsedOps {
  const ok: Operation[] = [];
  const errors: ParsedOps['errors'] = [];
  raw.forEach((item, index) => {
    const r = Operation.safeParse(item);
    if (r.success) ok.push(r.data);
    else errors.push({ index, message: r.error.issues.map((i) => `${i.path.join('.') || 'operation'}: ${i.message}`).join('; ') });
  });
  return { ok, errors };
}
