/**
 * AI orchestration: natural language + scene context → validated operations.
 *
 * The model is forced to answer through a single tool whose arguments are
 * validated with the same zod schemas the engine uses. Nothing it returns is
 * executed as code; invalid operations are dropped and reported.
 */
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Operation, parseOperations, type Operation as Op } from '@/core/ops/operations';
import { MATERIALS } from '@/core/materials/library';
import { FurnitureKind } from '@/core/schema/elements';
import type { AiContext } from '@/core/ai/context';
import { getProvider, type LLMMessage } from './providers';

const operationJsonSchema = zodToJsonSchema(Operation, { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>;

export const PROPOSE_TOOL = {
  name: 'propose_scene_operations',
  description:
    'Answer the user and propose structured, deterministic scene operations. Use an empty operations list for questions or when you need clarification.',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Short reply to the user in their language describing what will change (or answering the question).' },
      operations: { type: 'array', items: operationJsonSchema, description: 'Operations to execute in order.' },
      needsConfirmation: { type: 'boolean', description: 'True for destructive, large or uncertain changes.' },
      clarifyingQuestion: { type: 'string', description: 'Ask this instead of guessing when the request is ambiguous.' },
    },
    required: ['message', 'operations', 'needsConfirmation'],
  },
};

export function systemPrompt(): string {
  const mats = MATERIALS.map((m) => `${m.id} (${m.name})`).join(', ');
  return `You are the modelling engine assistant inside AI 3D Studio, a parametric architectural 3D modeller.
You never draw meshes. You edit a typed scene of parametric elements by calling propose_scene_operations.

UNITS & AXES: meters; angles on elements in radians except pitchDeg/rotateDeg (degrees). Y is up. Plan coordinates are (x, z); +z is south (towards the default camera), -z is north.

ELEMENT TYPES (key fields):
- wall: start{x,z}, end{x,z}, height, thickness, baseOffset, material, interiorMaterial, exterior. Virtual property "length" may be used in set/scale/add (anchor: start|center|end).
- window: hostId (wall), offset (centre distance from wall start along the wall), width, height, sillHeight, frameMaterial, glazingMaterial, style (fixed|casement|sliding|curtain), mullionsVertical, mullionsHorizontal.
- door: hostId (wall), offset, width, height, doorType (hinged|double|sliding|sliding_glass|garage|opening), swing, frameMaterial, leafMaterial.
- slab: polygon[{x,z}], thickness, elevation (top, relative to level), material, role.
- roof: roofType (flat|gable|hip|shed), center, width, depth, rotation, pitchDeg, overhang, thickness, baseOffset, ridgeAxis (x|z), material, gableMaterial, parapetHeight.
- skylight: hostId (roof), u, v (offset from roof centre), width, length, frameMaterial.
- stair: position, rotation, width, totalRise, totalRun, steps, material.
- column: position, width, depth, height, shape (rect|round), material.  beam: start{x,y,z}, end{x,y,z}, width, depth, material.
- room: polygon, function, floorMaterial (zone, no geometry).  terrain, pool (center, width, length, waterDepth).
- furniture: kind (${FurnitureKind.options.join('|')}), position{x,y,z}, rotation, width, depth, height, material, secondaryMaterial.  box: generic primitive.

OPERATIONS (executed in order, transactionally):
- {op:"modify", id, set?, scale?, add?, translate?{x,y,z}, moveAlongHost?, moveNormal?, rotateDeg?, anchor?}
  e.g. 30% wider window: {op:"modify", id:"window_004", scale:{width:1.3}}; move window 50 cm along its wall: moveAlongHost:-0.5;
  move a wall 1 m: translate in world axes (joined walls stretch automatically, hosted openings follow).
- {op:"set_material", ids:[...], material:"<material id>", slot?:"frameMaterial"|"glazingMaterial"|"leafMaterial"|"material"|"interiorMaterial"|"secondaryMaterial"|"floorMaterial"|"copingMaterial"|"gableMaterial"}
- {op:"create", element:{type, ...fields}, ref?:"$name"} — later ops may use "$name" as an id (e.g. hostId).
- {op:"delete", id} (hosted openings are removed with their host); {op:"delete_where", types:[...], roomId?, levelId?}
- {op:"replace", id, element:{type,...}} — keeps host/placement (e.g. window → door).
- {op:"set_level", id, height?, name?, preserveOpeningProportions?}; {op:"add_level", name?, height?, copyWallsFrom?}
- {op:"define_material", material:{id,name,base,color?,roughness?,metalness?}} for custom colours derived from a library material.
- {op:"generate_building", program:{...}, mode:"replace"|"append"} — for creating new buildings/rooms from a description. program: kind (room|house|villa|cabin|office|apartment|interior|generic), blocks:[{x,z,width,depth,floors,garage?}], floorHeight, wallThickness, exteriorMaterial, interiorMaterial, floorMaterial, windows:{count?|density, style (standard|floor_to_ceiling|ribbon|curtain), width?, height?, sillHeight?, frameMaterial}, doors:{count,type,material}, roof:{type (none|flat|gable|hip|shed), pitchDeg, material}, rooms?:[{name,function,level,x,z,width,depth}], program?:{bedrooms,bathrooms,living,kitchen,dining,offices}, furnish, furniture?:[...], extras:{pool?, terrace?, terrain?, stairs}.
- {op:"group", ids, name}

MATERIAL IDS (use exactly these, or define_material): ${mats}.

RULES
1. When objects are selected, "this/these/it" refers ONLY to them. Never modify unselected objects unless the user explicitly asks (e.g. "all windows"). Use ids exactly as given in the context; never invent ids.
2. Prefer relative operations (scale/add/translate) for relative requests ("wider", "50 cm to the left"). "Left/right" are relative to the camera: context.view.right is the camera's right vector in plan.
3. Keep openings within their host wall (offset ± width/2 inside the wall length; sill + height ≤ wall height). Adjust offset if needed and mention it.
4. For deletion, replacement, or edits affecting many objects set needsConfirmation=true.
5. If the request is ambiguous or required information is missing, return no operations and ask a clarifyingQuestion.
6. For new designs use generate_building with realistic dimensions. Do not invent precise dimensions the user did not imply — use sensible defaults and state them.
7. Reply in the user's language (Swedish or English). Keep the message short and concrete (what changes, new dimensions).`;
}

const Proposal = z.object({
  message: z.string().max(4000).default(''),
  operations: z.array(z.unknown()).max(500).default([]),
  needsConfirmation: z.boolean().default(false),
  clarifyingQuestion: z.string().max(1000).optional().nullable(),
});

export interface CommandResult {
  provider: string;
  model: string;
  message: string;
  operations: Op[];
  invalidOperations: { index: number; message: string }[];
  needsConfirmation: boolean;
  clarifyingQuestion?: string;
}

export async function runCommand(prompt: string, context: AiContext, history: { role: 'user' | 'assistant'; text: string }[], images: string[] = []): Promise<CommandResult> {
  const provider = getProvider();
  if (!provider) throw new Error('not_configured');
  const messages: LLMMessage[] = [
    ...history.slice(-8).map((h) => ({ role: h.role, text: h.text.slice(0, 2000) })),
    {
      role: 'user',
      text: `SCENE CONTEXT (JSON):\n${JSON.stringify(context)}\n\nUSER REQUEST:\n${prompt}`,
      images: images.slice(0, 4),
    },
  ];
  const raw = await provider.callTool({ system: systemPrompt(), messages, tool: PROPOSE_TOOL, vision: images.length > 0, maxTokens: 8192 });
  const p = Proposal.parse(raw);
  const { ok, errors } = parseOperations(p.operations);
  return {
    provider: provider.id,
    model: provider.model,
    message: p.message,
    operations: ok,
    invalidOperations: errors,
    needsConfirmation: p.needsConfirmation,
    clarifyingQuestion: p.clarifyingQuestion ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Drawing analysis (vision)

export const FloorPlanAnalysis = z.object({
  imageWidth: z.number().positive(),
  imageHeight: z.number().positive(),
  drawingType: z.enum(['floor_plan', 'elevation', 'section', 'sketch', 'site_plan', 'photo', 'other']).default('floor_plan'),
  scale: z
    .object({
      pixelsPerMeter: z.number().positive().nullable().optional(),
      source: z.enum(['dimension_annotation', 'scale_bar', 'title_block', 'assumed', 'unknown']).default('unknown'),
      confidence: z.number().min(0).max(1).default(0),
    })
    .default({}),
  walls: z
    .array(
      z.object({
        x1: z.number(),
        y1: z.number(),
        x2: z.number(),
        y2: z.number(),
        thicknessPx: z.number().positive().nullable().optional(),
        exterior: z.boolean().default(false),
        confidence: z.number().min(0).max(1).default(0.5),
      }),
    )
    .max(400)
    .default([]),
  openings: z
    .array(
      z.object({
        type: z.enum(['door', 'window', 'opening']),
        x: z.number(),
        y: z.number(),
        widthPx: z.number().positive(),
        confidence: z.number().min(0).max(1).default(0.5),
      }),
    )
    .max(400)
    .default([]),
  rooms: z
    .array(z.object({ name: z.string().max(80), x: z.number(), y: z.number(), function: z.string().max(40).optional(), areaM2: z.number().positive().nullable().optional() }))
    .max(200)
    .default([]),
  dimensions: z
    .array(z.object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), valueMeters: z.number().positive(), text: z.string().max(40).optional() }))
    .max(200)
    .default([]),
  notes: z.array(z.string().max(300)).max(30).default([]),
});
export type FloorPlanAnalysis = z.infer<typeof FloorPlanAnalysis>;

const ANALYSIS_TOOL = {
  name: 'report_floor_plan',
  description: 'Report the structure detected in the architectural drawing in image pixel coordinates.',
  parameters: zodToJsonSchema(FloorPlanAnalysis, { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>,
};

export async function analyzeDrawing(imageDataUrl: string, width: number, height: number, hint?: string): Promise<FloorPlanAnalysis & { provider: string; model: string }> {
  const provider = getProvider();
  if (!provider) throw new Error('not_configured');
  const system = `You are an expert at reading architectural drawings. Extract wall centre-lines, door and window openings, room labels and dimension annotations from the image.
All coordinates are PIXELS in the provided image (origin top-left, x right, y down). The image is ${width} x ${height} px.
- Walls: straight segments along wall centre-lines; merge collinear pieces; mark exterior walls.
- Openings: centre point on the wall and width in pixels.
- Dimensions: only report dimension strings you can actually read, with the pixel endpoints of the dimension line and the value converted to meters (e.g. "4500" mm → 4.5).
- Scale: derive pixelsPerMeter ONLY from readable dimensions or a scale bar; otherwise leave it null and set source "unknown". Never invent measurements.
- Use confidence values honestly; list uncertainties in notes.`;
  const raw = await provider.callTool({
    system,
    messages: [{ role: 'user', text: `Analyse this drawing.${hint ? ` User note: ${hint}` : ''}`, images: [imageDataUrl] }],
    tool: ANALYSIS_TOOL,
    vision: true,
    maxTokens: 8192,
  });
  const parsed = FloorPlanAnalysis.parse({ imageWidth: width, imageHeight: height, ...(raw as object) });
  return { ...parsed, imageWidth: width, imageHeight: height, provider: provider.id, model: provider.model };
}
