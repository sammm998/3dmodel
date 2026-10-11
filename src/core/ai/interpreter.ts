/**
 * Built-in command interpreter (English + Swedish).
 *
 * A deterministic, rule-based parser that converts common modelling requests
 * into the same validated operations an LLM produces. It is used when no LLM
 * provider is configured and as a fast path for simple edits. It is honest
 * about what it does not understand: unknown requests return no operations
 * and a clarifying message instead of guessing.
 */
import type { Element, ElementType, FurnitureKind, Vec2 } from '../schema/elements';
import type { Scene } from '../schema/scene';
import type { OperationInput } from '../ops/operations';
import type { BuildingProgramInput } from '../generator/program';
import { findMaterialByText, type MaterialCategory } from '../materials/library';
import { elementAnchor, findElement, levelOf, roomContaining, wallFrame, openingsOf } from '../scene/query';
import { FURNITURE_DEFAULTS, matchFurnitureKind } from '../generator/furnish';
import { round } from '../geometry/math2d';

export interface InterpretContext {
  scene: Scene;
  selectedIds: string[];
  /** Camera right vector projected on the plan (for "left"/"right"). */
  viewRight?: Vec2;
  /** Camera forward vector projected on the plan (for "forward"/"back"). */
  viewForward?: Vec2;
  activeLevelId?: string;
}

export interface InterpretResult {
  understood: boolean;
  language: 'en' | 'sv';
  message: string;
  operations: OperationInput[];
  needsConfirmation: boolean;
  clarifyingQuestion?: string;
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  single: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  en: 1,
  ett: 1,
  två: 2,
  tre: 3,
  fyra: 4,
  fem: 5,
  sex: 6,
  sju: 7,
  åtta: 8,
  nio: 9,
  tio: 10,
  tolv: 12,
};
const NUM = `(\\d+(?:[.,]\\d+)?|${Object.keys(NUMBER_WORDS).join('|')})`;

function num(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const k = s.toLowerCase();
  if (k in NUMBER_WORDS) return NUMBER_WORDS[k];
  const v = parseFloat(k.replace(',', '.'));
  return Number.isFinite(v) ? v : undefined;
}

function toMeters(value: number, unit: string | undefined): number {
  const u = (unit ?? 'm').toLowerCase();
  if (u.startsWith('mm') || u.startsWith('millimet')) return value / 1000;
  if (u.startsWith('cm') || u.startsWith('centimet')) return value / 100;
  if (u.startsWith('dm')) return value / 10;
  return value;
}

const UNIT = `(mm|cm|dm|m|meters?|metres?|meter|millimet(?:er|re)s?|centimet(?:er|re)s?)?`;

export function detectLanguage(text: string): 'en' | 'sv' {
  return /\b(och|gör|den här|detta|denna|det här|ändra|byt|skapa|bygg|lägg till|ta bort|flytta|fönster|dörr|vägg|tak|med|till|större|mindre|bredare|högre|våning|rum)\b|[åäö]/i.test(text) ? 'sv' : 'en';
}

const t = (lang: 'en' | 'sv', en: string, sv: string) => (lang === 'sv' ? sv : en);

// ---------------------------------------------------------------------------
export function interpret(text: string, ctx: InterpretContext): InterpretResult {
  const raw = text.trim();
  const lang = detectLanguage(raw);
  const lower = raw.toLowerCase().replace(/[“”"]/g, '').replace(/\s+/g, ' ');

  if (isGenerationRequest(lower, ctx)) {
    const program = parseBuildingProgram(lower);
    const op: OperationInput = { op: 'generate_building', program, mode: ctx.scene.elements.length && /\b(add|another|next to|lägg till|ytterligare)\b/.test(lower) ? 'append' : 'replace' };
    const b = program.blocks[0];
    const floors = Math.max(...program.blocks.map((x) => x.floors ?? 1));
    const desc = `${round(b.width, 2)} × ${round(b.depth, 2)} m ${program.kind}${floors > 1 ? `, ${floors} ${t(lang, 'floors', 'våningar')}` : ''}, ${program.floorHeight ?? 2.7} m ${t(lang, 'floor height', 'våningshöjd')}`;
    return {
      understood: true,
      language: lang,
      message: t(
        lang,
        `I'll generate a ${desc} as editable parametric walls, slabs, openings${program.roof?.type && program.roof.type !== 'none' ? ', roof' : ''}${program.furnish ? ' and furniture' : ''}.`,
        `Jag skapar en ${desc} med redigerbara väggar, bjälklag, öppningar${program.roof?.type && program.roof.type !== 'none' ? ', tak' : ''}${program.furnish ? ' och möbler' : ''}.`,
      ),
      operations: [op],
      needsConfirmation: ctx.scene.elements.length > 0 && op.mode === 'replace',
    };
  }

  // ---- edits ------------------------------------------------------------------
  const targets = resolveTargets(lower, ctx);
  const clauses = splitClauses(lower);
  const ops: OperationInput[] = [];
  const notes: string[] = [];
  let needsConfirmation = false;
  let understoodAny = false;

  for (const clause of clauses) {
    const r = interpretClause(clause, targets, ctx, lang);
    if (r) {
      understoodAny = true;
      ops.push(...r.ops);
      if (r.note) notes.push(r.note);
      if (r.confirm) needsConfirmation = true;
    }
  }

  if (!understoodAny) {
    if (!targets.length && needsTarget(lower)) {
      const q = t(lang, 'Which object do you mean? Click an object in the viewport first, then ask again.', 'Vilket objekt menar du? Klicka på ett objekt i 3D-vyn först och fråga sedan igen.');
      return { understood: false, language: lang, message: q, operations: [], needsConfirmation: false, clarifyingQuestion: q };
    }
    const msg = t(
      lang,
      "The built-in interpreter didn't understand that request. Try e.g. \"make this window 1.8 m wide\", \"move this wall 1 m back\", \"change the frame to black\", or configure an LLM provider for free-form requests.",
      'Den inbyggda tolken förstod inte begäran. Prova t.ex. "gör fönstret 1,8 m brett", "flytta väggen 1 m bakåt", "byt ramen till svart", eller konfigurera en AI-leverantör för friare instruktioner.',
    );
    return { understood: false, language: lang, message: msg, operations: [], needsConfirmation: false };
  }
  const names = targets.slice(0, 3).map((e) => e.name).join(', ') + (targets.length > 3 ? ` +${targets.length - 3}` : '');
  const message =
    (targets.length ? `${names}: ` : '') +
    (notes.length ? notes.join('; ') : t(lang, 'prepared the change', 'ändringen är förberedd')) +
    '.';
  return { understood: true, language: lang, message: capitalize(message), operations: ops, needsConfirmation };
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
const GEN_VERBS = /\b(create|build|generate|design|model|make me|make a|draw|skapa|bygg|generera|rita|designa|modellera)\b/;
const GEN_NOUNS =
  /\b(room|house|home|villa|building|office|apartment|flat|cabin|kitchen|living ?room|bedroom|bathroom|studio|garage|rum|hus|villa|byggnad|kontor|kontorshus|lägenhet|stuga|kök|vardagsrum|sovrum|badrum|attefallshus)\b/;

function isGenerationRequest(lower: string, ctx: InterpretContext): boolean {
  if (!GEN_VERBS.test(lower) || !GEN_NOUNS.test(lower)) return false;
  // "add a window to this room" is an edit, not a generation.
  if (/\b(add|lägg till)\b/.test(lower) && /\b(window|door|skylight|fönster|dörr|takfönster)\b/.test(lower) && !/\b(with|med)\b/.test(lower)) return false;
  if (ctx.selectedIds.length && /\b(this|these|it|den här|detta|denna)\b/.test(lower) && !/\b(new|ny|nytt)\b/.test(lower)) return false;
  return true;
}

export function parseBuildingProgram(lower: string): BuildingProgramInput {
  const has = (re: RegExp) => re.test(lower);
  // ---- kind
  let kind: BuildingProgramInput['kind'] = 'house';
  if (has(/\b(office|kontor|kontorshus|headquarters|workspace)\b/)) kind = 'office';
  else if (has(/\b(villa)\b/)) kind = 'villa';
  else if (has(/\b(cabin|stuga|attefallshus|cottage)\b/)) kind = 'cabin';
  else if (has(/\b(apartment|flat|lägenhet)\b/)) kind = 'apartment';
  else if (has(/\b(house|home|hus|bostad)\b/)) kind = 'house';
  else if (has(/\b(living ?room|kitchen|bedroom|bathroom|vardagsrum|kök|sovrum|badrum|studio)\b/)) kind = 'interior';
  else if (has(/\b(room|rum)\b/)) kind = 'room';
  else if (has(/\b(building|byggnad)\b/)) kind = 'generic';

  // ---- dimensions
  const dim = (words: string) => {
    const m = lower.match(new RegExp(`${NUM}\\s*${UNIT}\\s*(?:${words})\\b`));
    return m ? toMeters(num(m[1])!, m[2]) : undefined;
  };
  let length = dim('long|in length|lång|långt|längd');
  let width = dim('wide|in width|deep|bred|brett|djup|djupt|bredd');
  const height = dim('high|tall|in height|ceiling|hög|högt|höjd|takhöjd');
  const byMatch = lower.match(new RegExp(`${NUM}\\s*${UNIT}\\s*(?:x|×|by|gånger)\\s*${NUM}\\s*${UNIT}`));
  if (byMatch && (length === undefined || width === undefined)) {
    length = toMeters(num(byMatch[1])!, byMatch[2] ?? byMatch[4]);
    width = toMeters(num(byMatch[3])!, byMatch[4] ?? byMatch[2]);
  }
  const areaM = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:square met(?:er|re)s?|sq\.? ?m|sqm|m2|m²|kvm|kvadratmeter)/);
  const area = areaM ? parseFloat(areaM[1].replace(',', '.')) : undefined;

  const floorsM = lower.match(new RegExp(`${NUM}[\\s-]*(?:floors?|stor(?:e)?ys?|stories|levels?|våningar|våningsplan|plan)\\b`));
  let floors = floorsM ? Math.round(num(floorsM[1])!) : undefined;
  if (!floors && has(/\b(two|2)[- ]stor(e)?y\b|\btvåplans|\btvå våningar/)) floors = 2;
  if (!floors && has(/\b(single|one)[- ]stor(e)?y\b|\benplans/)) floors = 1;
  const defaults: Record<string, { w: number; d: number; f: number; h: number }> = {
    room: { w: 5, d: 4, f: 1, h: 2.7 },
    interior: { w: 6, d: 5, f: 1, h: 2.7 },
    house: { w: 12, d: 9, f: 2, h: 2.7 },
    villa: { w: 16, d: 10, f: 2, h: 2.9 },
    cabin: { w: 8, d: 6, f: 1, h: 2.5 },
    apartment: { w: 14, d: 10, f: 1, h: 2.7 },
    office: { w: 32, d: 18, f: 4, h: 3.5 },
    generic: { w: 12, d: 10, f: 1, h: 3 },
  };
  const def = defaults[kind];
  floors = floors ?? def.f;
  if (area && (!length || !width)) {
    const fp = area / floors;
    const aspect = 1.6;
    length = round(Math.sqrt(fp * aspect), 1);
    width = round(fp / length, 1);
  }
  length = length ?? (width ? Math.max(width, def.w) : def.w);
  width = width ?? def.d;

  // ---- counts
  const count = (re: string) => {
    const m = lower.match(new RegExp(`${NUM}\\s+(?:large |big |small |stora |små |stort |litet )?(?:${re})`));
    return m ? Math.round(num(m[1])!) : undefined;
  };
  const windowsN = count('windows?|fönster');
  const doorsN = count('doors?|dörrar|dörr');
  const bedrooms = count('bedrooms?|sovrum');
  const bathrooms = count('bathrooms?|badrum|wc');

  // ---- windows
  let style: 'standard' | 'floor_to_ceiling' | 'ribbon' | 'curtain' = 'standard';
  if (has(/glass fa[cç]ade|curtain wall|glasfasad|all[- ]glass/)) style = 'curtain';
  else if (has(/floor[- ]to[- ]ceiling|panoramic|large windows|golv till tak|stora fönster|panorama/)) style = 'floor_to_ceiling';
  else if (has(/ribbon|band ?windows|fönsterband/)) style = 'ribbon';
  const frameMat = has(/black (?:aluminium|aluminum|frames?|metal)|svarta? (?:ramar|karmar|aluminium)/)
    ? 'aluminium_black'
    : has(/\b(oak|ek) (?:frames?|windows?)/)
      ? 'oak'
      : has(/white frames?|vita ramar/)
        ? 'paint_white'
        : 'aluminium_black';

  // ---- materials
  const extMat = (() => {
    const m = lower.match(/(white plaster|white render|vit puts|beige plaster|grey plaster|gray plaster|red brick|white brick|dark brick|brick|tegel|exposed concrete|concrete|betong|larch|timber cladding|wood cladding|träpanel|charred|black wood|svart trä|falu|röd|limestone|kalksten|corten|stone)/);
    if (!m) return kind === 'office' ? 'concrete' : kind === 'cabin' ? 'paint_red' : 'plaster_white';
    const found = findMaterialByText(m[1], ['plaster', 'masonry', 'concrete', 'wood', 'stone']);
    if (found?.id === 'oak' || found?.id === 'pine') return 'larch_cladding';
    return found?.id ?? 'plaster_white';
  })();
  const interiorMat = (() => {
    const m = lower.match(/(white|beige|grey|gray|sage|green|blue|vit|vita|beige|grå|gröna?|blå)\s+(?:interior )?(?:walls?|väggar)/);
    if (!m) return 'paint_white';
    const map: Record<string, string> = { white: 'paint_white', vit: 'paint_white', vita: 'paint_white', beige: 'plaster_beige', grey: 'plaster_grey', gray: 'plaster_grey', grå: 'plaster_grey', sage: 'paint_sage', green: 'paint_sage', grön: 'paint_sage', gröna: 'paint_sage', blue: 'paint_blue', blå: 'paint_blue' };
    return map[m[1]] ?? 'paint_white';
  })();
  const floorMat = has(/marble floor|marmorgolv/) ? 'marble_white' : has(/concrete floor|betonggolv|microcement/) ? 'concrete_polished' : has(/tiles?|klinker/) && has(/floor|golv/) ? 'tile_grey' : has(/walnut floor|valnöt/) ? 'walnut' : 'oak_floor';
  const doorMat = has(/\boak\b|\bek\b/) ? 'oak' : has(/walnut|valnöt/) ? 'walnut' : 'oak';

  // ---- roof
  let roofType: 'none' | 'flat' | 'gable' | 'hip' | 'shed' =
    kind === 'room' || kind === 'interior' || kind === 'apartment' ? 'none' : kind === 'office' ? 'flat' : kind === 'villa' ? 'flat' : 'gable';
  if (has(/flat roof|platt tak|plant tak|flat-roof/)) roofType = 'flat';
  else if (has(/gable|pitched|saddle|sadeltak|sadel/)) roofType = 'gable';
  else if (has(/hip roof|hipped|valmat/)) roofType = 'hip';
  else if (has(/shed roof|mono[- ]?pitch|pulpettak|pulpet|lean-to/)) roofType = 'shed';
  else if (has(/no roof|utan tak|without (?:a )?roof/)) roofType = 'none';
  const pitchM = lower.match(/(\d+)\s*(?:°|deg|degrees?|grader)/);
  const roofMat = has(/tile roof|takpannor|tegeltak|clay tile/)
    ? 'brick_red'
    : has(/slate|skiffer/)
      ? 'stone_slate'
      : has(/(dark )?gr[ae]y metal|plåt/)
        ? 'metal_dark_grey'
        : has(/black roof|svart tak/)
          ? 'charred_wood'
          : 'metal_dark_grey';

  // ---- extras / furniture
  const furnitureWords = (lower.match(/\b(sofa|couch|armchair|coffee table|dining table|chairs?|bed|wardrobe|desk|shelf|bookcase|rug|carpet|plants?|lamp|tv|bathtub|shower|toilet|island|counter|soffa|fåtölj|säng|matbord|skrivbord|bokhylla|matta|växt|lampa|badkar|dusch|köksö)\b/g) ?? []).map(String);
  const furnish = kind !== 'room' || furnitureWords.length > 0 || has(/furnish|furniture|möbler|möblerad/);
  const pool = has(/\bpool|swimming|simbassäng|bassäng/) ? { width: 4, length: has(/large pool|lap pool|stor pool/) ? 14 : 10, side: 'front' as const } : undefined;
  const terrace = has(/terrace|deck|patio|terrass|altan|trall/) || (pool && kind === 'villa') ? { depth: 4, side: 'front' as const } : undefined;
  const garage = has(/garage/) && kind !== 'room' && kind !== 'interior';

  const blocks: BuildingProgramInput['blocks'] = [{ name: kind === 'room' ? 'Room' : 'Main', x: 0, z: 0, width: round(length, 3), depth: round(width, 3), floors }];
  if (garage) blocks.push({ name: 'Garage', x: length, z: Math.max(0, width - 7), width: 6.5, depth: Math.min(7, width), floors: 1, garage: true });

  const doorType = has(/sliding glass|glass sliding|skjutdörr i glas|glasskjutdörr/) ? 'sliding_glass' : has(/double door|pardörr|dubbeldörr/) ? 'double' : has(/sliding door|skjutdörr/) ? 'sliding' : 'hinged';
  const program: BuildingProgramInput = {
    name: undefined,
    kind,
    blocks,
    floorHeight: height ?? def.h,
    exteriorMaterial: kind === 'room' || kind === 'interior' ? interiorMat : extMat,
    interiorMaterial: interiorMat,
    floorMaterial: floorMat,
    windows: {
      density: windowsN === 0 ? 'none' : 'medium',
      count: windowsN,
      style,
      frameMaterial: frameMat,
    },
    doors: { count: doorsN ?? 1, type: doorType, material: doorMat, frameMaterial: frameMat },
    roof: { type: roofType, pitchDeg: pitchM ? Math.min(70, parseInt(pitchM[1], 10)) : 30, material: roofMat, overhang: roofType === 'flat' ? 0.2 : 0.45 },
    furnish,
    furniture: furnitureWords.length ? furnitureWords : undefined,
    extras: { pool, terrace, stairs: true },
  };
  if (bedrooms !== undefined || bathrooms !== undefined) {
    program.program = {
      bedrooms: bedrooms ?? 0,
      bathrooms: bathrooms ?? 1,
      living: true,
      kitchen: true,
      dining: kind === 'villa' || kind === 'house',
      offices: 0,
    };
  }
  return program;
}

// ---------------------------------------------------------------------------
function needsTarget(lower: string) {
  return /\b(this|these|it|its|selected|den här|detta|denna|det här|dessa|den|det)\b/.test(lower) || /\b(make|change|move|rotate|delete|remove|gör|ändra|flytta|rotera|ta bort|byt)\b/.test(lower);
}

const TYPE_WORDS: [RegExp, ElementType][] = [
  [/\bwindows?\b|fönstr(et|en)?|fönster/, 'window'],
  [/\bdoors?\b|dörr(en|ar|arna)?/, 'door'],
  [/\bwalls?\b|vägg(en|ar|arna)?/, 'wall'],
  [/\broofs?\b|tak(et)?\b/, 'roof'],
  [/\bskylights?\b|takfönster/, 'skylight'],
  [/\bstairs?\b|staircase|trapp(a|an|or)/, 'stair'],
  [/\bcolumns?\b|pelare|pelarna/, 'column'],
  [/\bfurniture\b|möbler(na)?/, 'furniture'],
  [/\bpool\b|bassäng(en)?/, 'pool'],
  [/\bslabs?\b|floors?\b|golv(et)?|bjälklag/, 'slab'],
];

function resolveTargets(lower: string, ctx: InterpretContext): Element[] {
  const { scene } = ctx;
  const selected = ctx.selectedIds.map((id) => findElement(scene, id)).filter((e): e is Element => !!e);
  const all = /\b(all|every|alla|samtliga)\b/.test(lower);
  if (all) {
    for (const [re, type] of TYPE_WORDS) {
      if (re.test(lower)) {
        let els = scene.elements.filter((e) => e.type === type);
        if (type === 'wall' && /\b(exterior|outer|yttervägg|fasad)/.test(lower)) els = els.filter((e) => e.type === 'wall' && e.exterior);
        return els;
      }
    }
  }
  if (selected.length) return selected;
  // "the roof" with no selection: if there is exactly one of that type, use it.
  for (const [re, type] of TYPE_WORDS) {
    if (re.test(lower)) {
      const els = scene.elements.filter((e) => e.type === type);
      if (els.length === 1) return els;
      if (type === 'roof' && els.length > 1) return [els[0]];
    }
  }
  return [];
}

function splitClauses(lower: string): string[] {
  // Split on "and"/"och"/commas/semicolons but keep "floor-to-ceiling" etc intact.
  return lower
    .split(/\s*(?:,|;|\band then\b|\band\b|\boch\b|\bthen\b|\bsedan\b|\bsen\b)\s*/)
    .map((c) => c.trim())
    .filter(Boolean);
}

interface ClauseResult {
  ops: OperationInput[];
  note?: string;
  confirm?: boolean;
}

const DIM_WORDS: { re: RegExp; prop: 'width' | 'height' | 'length' | 'thickness' | 'depth' }[] = [
  { re: /\b(wide|width|wider|narrower|bred|brett|bredare|smalare|bredd)\b/, prop: 'width' },
  { re: /\b(tall|high|height|taller|higher|shorter|lower|hög|högt|högre|lägre|höjd)\b/, prop: 'height' },
  { re: /\b(long|length|longer|lång|långt|längre|kortare|längd)\b/, prop: 'length' },
  { re: /\b(thick|thickness|thicker|thinner|tjock|tjockare|tunnare|tjocklek)\b/, prop: 'thickness' },
  { re: /\b(deep|depth|deeper|shallower|djup|djupare|djup)\b/, prop: 'depth' },
];
const SHRINK = /\b(narrower|shorter|lower|smaller|thinner|shallower|smalare|lägre|kortare|mindre|tunnare|grundare|decrease|reduce|minska)\b/;
const GROW = /\b(wider|taller|higher|longer|bigger|larger|thicker|deeper|bredare|högre|längre|större|tjockare|djupare|increase|öka|extend|förläng)\b/;

/** Maps a generic dimension word to the element's real property. */
function mapDim(el: Element, prop: string): string | undefined {
  switch (el.type) {
    case 'wall':
      return prop === 'width' ? 'length' : prop === 'depth' ? 'thickness' : prop;
    case 'window':
    case 'door':
      return prop === 'length' ? 'width' : prop === 'width' || prop === 'height' ? prop : undefined;
    case 'roof':
      return prop === 'length' ? 'width' : prop === 'height' ? 'pitchDeg' : prop === 'thickness' ? 'thickness' : prop;
    case 'pool':
      return prop === 'depth' ? 'waterDepth' : prop === 'height' ? undefined : prop;
    case 'skylight':
      return prop === 'height' || prop === 'depth' ? 'length' : prop;
    case 'stair':
      return prop === 'height' ? 'totalRise' : prop === 'length' || prop === 'depth' ? 'totalRun' : prop === 'width' ? 'width' : undefined;
    case 'slab':
      return prop === 'thickness' || prop === 'height' ? 'thickness' : undefined;
    case 'column':
      return prop === 'length' ? 'height' : prop;
    case 'furniture':
    case 'box':
      return prop === 'length' ? 'width' : prop === 'thickness' ? 'depth' : prop;
    case 'terrain':
      return prop === 'length' ? 'width' : prop === 'width' || prop === 'depth' ? prop : undefined;
    default:
      return undefined;
  }
}

function bigProps(el: Element): string[] {
  switch (el.type) {
    case 'wall':
      return ['length'];
    case 'window':
    case 'door':
      return ['width', 'height'];
    case 'roof':
      return ['width', 'depth'];
    case 'pool':
      return ['width', 'length'];
    case 'skylight':
      return ['width', 'length'];
    case 'furniture':
    case 'box':
    case 'column':
      return ['width', 'depth', 'height'];
    case 'terrain':
      return ['width', 'depth'];
    default:
      return [];
  }
}

function slotCategories(slot: string | undefined, el: Element): MaterialCategory[] {
  if (slot === 'frameMaterial') return ['metal', 'wood', 'paint'];
  if (slot === 'glazingMaterial') return ['glass'];
  if (slot === 'floorMaterial') return ['wood', 'ceramic', 'stone', 'concrete'];
  if (el.type === 'roof') return ['metal', 'stone', 'masonry'];
  if (el.type === 'wall') return ['plaster', 'paint', 'masonry', 'concrete', 'wood'];
  if (el.type === 'furniture') return ['fabric', 'wood'];
  return [];
}

const COLOR_FALLBACK: Record<string, Partial<Record<'metal' | 'paint' | 'plaster' | 'fabric' | 'wood', string>>> = {
  black: { metal: 'aluminium_black', paint: 'paint_black', plaster: 'paint_black', fabric: 'fabric_grey', wood: 'charred_wood' },
  svart: { metal: 'aluminium_black', paint: 'paint_black', plaster: 'paint_black', fabric: 'fabric_grey', wood: 'charred_wood' },
  white: { metal: 'paint_white', paint: 'paint_white', plaster: 'plaster_white', fabric: 'fabric_beige', wood: 'paint_white' },
  vit: { metal: 'paint_white', paint: 'paint_white', plaster: 'plaster_white', fabric: 'fabric_beige', wood: 'paint_white' },
  grey: { metal: 'metal_dark_grey', paint: 'plaster_grey', plaster: 'plaster_grey', fabric: 'fabric_grey' },
  gray: { metal: 'metal_dark_grey', paint: 'plaster_grey', plaster: 'plaster_grey', fabric: 'fabric_grey' },
  grå: { metal: 'metal_dark_grey', paint: 'plaster_grey', plaster: 'plaster_grey', fabric: 'fabric_grey' },
  silver: { metal: 'aluminium' },
  gold: { metal: 'brass' },
};

function findMaterial(clause: string, el: Element, slot: string | undefined): string | undefined {
  const cats = slotCategories(slot, el);
  // Explicit compound materials first ("black aluminium", "dark walnut").
  const found = findMaterialByText(clause, cats);
  const colorWord = clause.match(/\b(black|svart|svarta|white|vit|vita|grey|gray|grå|silver|gold)\b/)?.[1]?.replace(/a$/, '');
  if (found && (!colorWord || found.keywords.some((k) => k.includes(' ') && clause.includes(k)) || found.category !== 'paint')) {
    if (!(colorWord && found.category === 'paint' && cats.includes('metal'))) return found.id;
  }
  if (colorWord) {
    const fb = COLOR_FALLBACK[colorWord] ?? COLOR_FALLBACK[colorWord + 'a'];
    if (fb) {
      for (const c of cats) {
        const id = fb[c as keyof typeof fb];
        if (id) return id;
      }
      return fb.paint ?? fb.metal;
    }
  }
  return found?.id;
}

function interpretClause(clause: string, targets: Element[], ctx: InterpretContext, lang: 'en' | 'sv'): ClauseResult | null {
  const { scene } = ctx;
  const ops: OperationInput[] = [];
  const notes: string[] = [];
  let confirm = false;
  const one = targets[0];

  // ---- delete furniture in room
  if (/\b(remove|delete|clear|ta bort|radera|töm)\b/.test(clause) && /\b(furniture|möbler|möblerna)\b/.test(clause)) {
    const room = one ? (one.type === 'room' ? one : roomContaining(scene, one)) : undefined;
    if (!room) return { ops: [], note: t(lang, 'select a room (or an object inside it) first', 'markera ett rum (eller ett objekt i rummet) först') };
    return { ops: [{ op: 'delete_where', types: ['furniture'], roomId: room.id }], note: t(lang, `remove all furniture in ${room.name}`, `ta bort alla möbler i ${room.name}`), confirm: true };
  }
  // ---- delete
  if (/\b(delete|remove|erase|ta bort|radera)\b/.test(clause) && targets.length) {
    for (const el of targets) ops.push({ op: 'delete', id: el.id });
    return { ops, note: t(lang, `delete ${targets.length} object${targets.length > 1 ? 's' : ''}`, `ta bort ${targets.length} objekt`), confirm: true };
  }
  // ---- rename
  const rename = clause.match(/\b(?:rename(?: it| this)?(?: to)?|call it|name it|döp om (?:den |det )?till|kalla (?:den|det))\s+(.+)$/);
  if (rename && one) {
    const name = rename[1].trim().replace(/^["']|["']$/g, '');
    return { ops: [{ op: 'modify', id: one.id, set: { name: name.charAt(0).toUpperCase() + name.slice(1) } }], note: t(lang, `rename to "${name}"`, `byt namn till "${name}"`) };
  }
  // ---- add skylights / windows / doors / furniture
  const addM = clause.match(new RegExp(`\\b(?:add|insert|place|put|lägg till|sätt in|placera)\\s+(?:${NUM}\\s+)?(?:(?:new|large|small|nya?|stora?|små)\\s+)?(.+)$`));
  if (addM) {
    const n = Math.max(1, Math.min(20, Math.round(num(addM[1]) ?? 1)));
    const what = addM[2];
    if (/skylight|takfönster/.test(what)) {
      const roof = targets.find((e) => e.type === 'roof') ?? scene.elements.find((e) => e.type === 'roof');
      if (!roof || roof.type !== 'roof') return { ops: [], note: t(lang, 'there is no roof to add skylights to', 'det finns inget tak att lägga takfönster på') };
      const alongX = roof.ridgeAxis === 'x';
      const span = (alongX ? roof.width : roof.depth) * 0.7;
      const side = roof.roofType === 'flat' ? 0 : (alongX ? roof.depth : roof.width) * 0.22;
      for (let i = 0; i < n; i++) {
        const p = n === 1 ? 0 : -span / 2 + (span * i) / (n - 1);
        ops.push({ op: 'create', element: { type: 'skylight', hostId: roof.id, name: `Skylight ${i + 1}`, u: round(alongX ? p : side), v: round(alongX ? side : p), width: 0.9, length: 1.3 } });
      }
      return { ops, note: t(lang, `add ${n} skylight${n > 1 ? 's' : ''} to ${roof.name}`, `lägg till ${n} takfönster på ${roof.name}`) };
    }
    if (/window|fönster|door|dörr/.test(what)) {
      const isDoor = /door|dörr/.test(what);
      const wall = one?.type === 'wall' ? one : one && 'hostId' in one ? findElement(scene, one.hostId) : undefined;
      if (!wall || wall.type !== 'wall') return { ops: [], note: t(lang, 'select the wall that should receive the opening', 'markera väggen som ska få öppningen') };
      const L = wallFrame(wall).length;
      const w = isDoor ? 0.9 : 1.2;
      const occ = openingsOf(scene, wall.id).map((o) => [o.offset - o.width / 2 - 0.3, o.offset + o.width / 2 + 0.3] as [number, number]);
      const offsets: number[] = [];
      for (let k = 0; k < n; k++) {
        let best: number | undefined;
        let bestScore = -1;
        for (let x = w / 2 + 0.3; x <= L - w / 2 - 0.3; x += 0.05) {
          const all = [...occ, ...offsets.map((o) => [o - w / 2 - 0.3, o + w / 2 + 0.3] as [number, number])];
          if (all.some(([a, b]) => x + w / 2 > a && x - w / 2 < b)) continue;
          const dmin = Math.min(...all.map(([a, b]) => Math.min(Math.abs(x - a), Math.abs(x - b))), x, L - x);
          if (dmin > bestScore) {
            bestScore = dmin;
            best = x;
          }
        }
        if (best === undefined) break;
        offsets.push(best);
      }
      if (!offsets.length) return { ops: [], note: t(lang, `there is no free space on ${wall.name}`, `det finns inget ledigt utrymme på ${wall.name}`) };
      for (const off of offsets) {
        ops.push({ op: 'create', element: isDoor ? { type: 'door', hostId: wall.id, offset: round(off, 3) } : { type: 'window', hostId: wall.id, offset: round(off, 3), height: Math.min(1.4, wall.height - 1.2) } });
      }
      return { ops, note: t(lang, `add ${offsets.length} ${isDoor ? 'door' : 'window'}${offsets.length > 1 ? 's' : ''} to ${wall.name}`, `lägg till ${offsets.length} ${isDoor ? 'dörr(ar)' : 'fönster'} på ${wall.name}`) };
    }
    const kind: FurnitureKind | undefined = matchFurnitureKind(what);
    if (kind) {
      const room = one ? (one.type === 'room' ? one : roomContaining(scene, one)) : scene.elements.find((e) => e.type === 'room');
      const lvl = one ? levelOf(scene, one) : scene.levels[0];
      const c = room && room.type === 'room' ? centroid(room.polygon) : one ? (({ x, z }) => ({ x, z }))(elementAnchor(scene, one)) : { x: 0, z: 0 };
      const d = FURNITURE_DEFAULTS[kind];
      for (let i = 0; i < n; i++) {
        ops.push({ op: 'create', element: { type: 'furniture', kind, name: d.label, levelId: lvl.id, position: { x: round(c.x + i * (d.w + 0.3)), y: 0, z: round(c.z) }, width: d.w, depth: d.d, height: d.h, material: d.m, secondaryMaterial: d.m2 } });
      }
      return { ops, note: t(lang, `add ${n} ${d.label.toLowerCase()}${n > 1 ? 's' : ''}`, `lägg till ${n} ${d.label.toLowerCase()}`) };
    }
  }

  if (!targets.length) return null;

  // ---- ceiling height (level)
  const ceil = clause.match(new RegExp(`(?:ceiling height|room height|floor height|takhöjd(?:en)?|rumshöjd(?:en)?)`));
  if (ceil) {
    const lvl = levelOf(scene, one);
    const to = clause.match(new RegExp(`(?:to|till|=)\\s*${NUM}\\s*${UNIT}`));
    const by = clause.match(new RegExp(`(?:by|med)\\s*${NUM}\\s*${UNIT}`));
    let h: number | undefined;
    if (to) h = toMeters(num(to[1])!, to[2]);
    else if (by) h = lvl.height + (SHRINK.test(clause) ? -1 : 1) * toMeters(num(by[1])!, by[2]);
    else h = lvl.height + (SHRINK.test(clause) ? -0.3 : 0.3);
    const preserve = /proportion|proportioner/.test(clause) || /proportion|proportioner/.test(clause);
    return {
      ops: [{ op: 'set_level', id: lvl.id, height: round(h, 3), preserveOpeningProportions: preserve }],
      note: t(lang, `set ${lvl.name} ceiling height to ${round(h, 2)} m${preserve ? ' and scale windows proportionally' : ''}`, `sätt takhöjden på ${lvl.name} till ${round(h, 2)} m${preserve ? ' och skala fönstren proportionellt' : ''}`),
    };
  }
  if (/preserv|keep|behåll|bevara/.test(clause) && /proportion/.test(clause)) {
    // Handled together with the ceiling-height clause.
    return { ops: [], note: undefined };
  }

  // ---- roof pitch / type
  const roofs = targets.filter((e) => e.type === 'roof');
  if (roofs.length) {
    const typeM = clause.match(/\b(flat|gable|hip|hipped|shed|platt|sadeltak|valmat|pulpettak|pulpet)\b/);
    if (typeM && /\b(roof|tak|make|change|turn|convert|gör|ändra|byt)\b/.test(clause) && !/flatter|flackare/.test(clause)) {
      const map: Record<string, string> = { flat: 'flat', platt: 'flat', gable: 'gable', sadeltak: 'gable', hip: 'hip', hipped: 'hip', valmat: 'hip', shed: 'shed', pulpettak: 'shed', pulpet: 'shed' };
      for (const r of roofs) ops.push({ op: 'modify', id: r.id, set: { roofType: map[typeM[1]], ...(map[typeM[1]] !== 'flat' && r.type === 'roof' && r.pitchDeg < 5 ? { pitchDeg: 25 } : {}) } });
      notes.push(t(lang, `change to a ${map[typeM[1]]} roof`, `ändra till ${map[typeM[1]]}-tak`));
    }
    const degTo = clause.match(/(?:to|till|=|pitch(?: of)?|lutning(?: på)?)\s*(\d+(?:[.,]\d+)?)\s*(?:°|deg|degrees?|grader)/);
    const degBy = clause.match(/(?:by|med)\s*(\d+(?:[.,]\d+)?)\s*(?:°|deg|degrees?|grader)/);
    const steeper = /\b(steeper|brantare|more pitch)\b/.test(clause);
    const flatter = /\b(flatter|flackare|less steep|lower pitch|shallower|lägre lutning)\b/.test(clause);
    if (degTo) {
      for (const r of roofs) ops.push({ op: 'modify', id: r.id, set: { pitchDeg: parseFloat(degTo[1].replace(',', '.')) } });
      notes.push(t(lang, `set pitch to ${degTo[1]}°`, `sätt lutningen till ${degTo[1]}°`));
    } else if (steeper || flatter) {
      const amount = degBy ? parseFloat(degBy[1].replace(',', '.')) : /\b(slightly|a little|a bit|lite|något|aningen)\b/.test(clause) ? 5 : 10;
      for (const r of roofs) {
        if (r.type !== 'roof') continue;
        const next = Math.max(0, Math.min(70, r.pitchDeg + (steeper ? amount : -amount)));
        ops.push({ op: 'modify', id: r.id, set: { pitchDeg: next, ...(r.roofType === 'flat' && steeper ? { roofType: 'gable' } : {}) } });
      }
      notes.push(t(lang, `make the roof ${steeper ? 'steeper' : 'flatter'} by ${amount}°`, `gör taket ${steeper ? 'brantare' : 'flackare'} med ${amount}°`));
    }
  }

  // ---- door type / window style
  const doors = targets.filter((e) => e.type === 'door');
  if (doors.length && /(sliding glass|glass sliding|sliding|double|garage|hinged|regular|skjutdörr|glasskjutdörr|pardörr|garageport|slagdörr)/.test(clause) && /\b(replace|make|change|turn|convert|swap|byt|ändra|gör|ersätt|to|till|with|mot|into)\b/.test(clause)) {
    const m = clause.match(/(sliding glass|glass sliding|glasskjutdörr|skjutdörr i glas|sliding|skjutdörr|double|pardörr|garage|garageport|hinged|slagdörr|regular)/)!;
    const map: Record<string, string> = { 'sliding glass': 'sliding_glass', 'glass sliding': 'sliding_glass', glasskjutdörr: 'sliding_glass', 'skjutdörr i glas': 'sliding_glass', sliding: 'sliding', skjutdörr: 'sliding', double: 'double', pardörr: 'double', garage: 'garage', garageport: 'garage', hinged: 'hinged', slagdörr: 'hinged', regular: 'hinged' };
    const dt = map[m[1]];
    for (const d of doors) {
      if (d.type !== 'door') continue;
      const set: Record<string, unknown> = { doorType: dt };
      if (dt === 'sliding_glass') {
        set.leafMaterial = 'glass_clear';
        if (d.width < 1.8) set.width = 2.4;
        if (d.height < 2.2) set.height = Math.min(2.3, (findElement(scene, d.hostId) as { height?: number })?.height ?? 2.3);
      }
      if (dt === 'double' && d.width < 1.4) set.width = 1.6;
      ops.push({ op: 'modify', id: d.id, set, anchor: 'center' });
    }
    notes.push(t(lang, `change to a ${dt.replace('_', ' ')} door`, `byt till ${m[1]}`));
  }
  if (/\b(replace|ersätt|byt ut)\b/.test(clause) && /\b(with|mot|to|till)\b.*\b(door|dörr)\b/.test(clause) && one?.type === 'window') {
    for (const w of targets.filter((e) => e.type === 'window')) {
      ops.push({ op: 'replace', id: w.id, element: { type: 'door', width: w.type === 'window' ? w.width : 0.9, height: 2.1, name: `${w.name.replace(/window/i, 'door')}` } });
    }
    notes.push(t(lang, 'replace with a door', 'ersätt med en dörr'));
    confirm = true;
  }
  if (/\b(replace|ersätt|byt ut)\b/.test(clause) && /\b(with|mot|to|till)\b.*\b(window|fönster)\b/.test(clause) && one?.type === 'door') {
    for (const d of targets.filter((e) => e.type === 'door')) {
      ops.push({ op: 'replace', id: d.id, element: { type: 'window', width: d.type === 'door' ? d.width : 1.2 } });
    }
    notes.push(t(lang, 'replace with a window', 'ersätt med ett fönster'));
    confirm = true;
  }
  const windows = targets.filter((e) => e.type === 'window');
  if (windows.length && /(floor[- ]to[- ]ceiling|golv till tak)/.test(clause)) {
    for (const w of windows) {
      if (w.type !== 'window') continue;
      const host = findElement(scene, w.hostId);
      const h = host && host.type === 'wall' ? round(host.height - 0.3, 3) : 2.4;
      ops.push({ op: 'modify', id: w.id, set: { sillHeight: 0, height: h, style: 'fixed' } });
    }
    notes.push(t(lang, 'make floor-to-ceiling', 'gör golv-till-tak'));
  }

  // ---- materials
  const matVerb = /\b(change|make|set|use|paint|switch|turn|in|to|into|with|byt|ändra|gör|måla|använd|till|i)\b/.test(clause);
  const slotWord = clause.match(/\b(frames?|ram(?:en|arna)?|karm(?:en)?|glass|glazing|glas(?:et)?|leaf|door panel|dörrblad(?:et)?|floor(?:ing)?|golv(?:et)?|interior|insida|inside|cushions?|fabric|legs?|ben(?:en)?|top|countertop|skiva|coping)\b/)?.[1];
  const hasMaterialWord =
    /(?:^|[^a-zåäö])(black|white|grey|gray|silver|gold|svart|svarta|vit|vita|grå|oak|walnut|pine|ek|valnöt|furu|concrete|betong|brick|tegel|marble|marmor|plaster|puts|glass|glas|steel|stål|alumin|metal|metall|wood|trä|stone|sten|tile|kakel|klinker|brass|mässing|linen|wool|velvet|leather|läder|corten|slate|skiffer|larch|granite|granit|beige|sage|navy|red|röd|green|grön|blue|blå|frosted|tinted)/.test(
      clause,
    );
  if (matVerb && hasMaterialWord && !/(sliding glass|glass sliding|glasskjutdörr)/.test(clause)) {
    const byId = new Map<string, string[]>();
    let label = '';
    for (const el of targets) {
      let slot: string | undefined;
      if (slotWord) {
        if (/frame|ram|karm/.test(slotWord)) slot = ['window', 'door', 'skylight'].includes(el.type) ? 'frameMaterial' : el.type === 'furniture' ? 'secondaryMaterial' : undefined;
        else if (/glass|glazing|glas/.test(slotWord)) slot = ['window', 'skylight'].includes(el.type) ? 'glazingMaterial' : undefined;
        else if (/leaf|panel|dörrblad/.test(slotWord)) slot = el.type === 'door' ? 'leafMaterial' : undefined;
        else if (/floor|golv/.test(slotWord)) slot = el.type === 'room' ? 'floorMaterial' : undefined;
        else if (/interior|insida|inside/.test(slotWord)) slot = el.type === 'wall' ? 'interiorMaterial' : undefined;
        else if (/legs?|ben|top|countertop|skiva|coping/.test(slotWord)) slot = el.type === 'furniture' || el.type === 'pool' ? (el.type === 'pool' ? 'copingMaterial' : 'secondaryMaterial') : undefined;
        else if (/cushion|fabric/.test(slotWord)) slot = 'material';
      }
      if (!slot) slot = ['window', 'skylight'].includes(el.type) ? 'frameMaterial' : el.type === 'door' ? 'leafMaterial' : el.type === 'room' ? 'floorMaterial' : 'material';
      // Floors: a selected room's floor is its slab.
      const mat = findMaterial(clause, el, slot);
      if (!mat) continue;
      const key = `${slot}|${mat}`;
      byId.set(key, [...(byId.get(key) ?? []), el.id]);
      label = mat;
    }
    for (const [key, ids] of byId) {
      const [slot, mat] = key.split('|');
      ops.push({ op: 'set_material', ids, material: mat, slot });
    }
    if (byId.size) notes.push(t(lang, `set ${slotWord ? `${slotWord} ` : ''}material to ${label.replace(/_/g, ' ')}`, `byt ${slotWord ? `${slotWord} ` : ''}material till ${label.replace(/_/g, ' ')}`));
  }

  // ---- move
  const moveM = clause.match(new RegExp(`\\b(?:move|shift|slide|push|flytta|skjut)\\b(?:.*?)(?:${NUM}\\s*${UNIT})?\\s*(?:to the |towards the |åt |till |mot )?(left|right|up|down|forward|forwards|backward|backwards|back|north|south|east|west|outward|inward|vänster|höger|upp|uppåt|ner|nedåt|framåt|bakåt|norr|söder|öster|väster|utåt|inåt)\\b`));
  if (moveM) {
    let dist = moveM[1] ? toMeters(num(moveM[1])!, moveM[2]) : /\b(slightly|a little|a bit|lite|något)\b/.test(clause) ? 0.2 : 0.5;
    if (!moveM[1]) {
      const any = clause.match(new RegExp(`${NUM}\\s*${UNIT}`));
      if (any && /\d/.test(any[1])) dist = toMeters(num(any[1])!, any[2]);
    }
    const dirWord = moveM[3];
    const right = norm(ctx.viewRight ?? { x: 1, z: 0 });
    const fwd = norm(ctx.viewForward ?? { x: 0, z: -1 });
    let v = { x: 0, y: 0, z: 0 };
    switch (dirWord) {
      case 'left':
      case 'vänster':
        v = { x: -right.x * dist, y: 0, z: -right.z * dist };
        break;
      case 'right':
      case 'höger':
        v = { x: right.x * dist, y: 0, z: right.z * dist };
        break;
      case 'up':
      case 'upp':
      case 'uppåt':
        v = { x: 0, y: dist, z: 0 };
        break;
      case 'down':
      case 'ner':
      case 'nedåt':
        v = { x: 0, y: -dist, z: 0 };
        break;
      case 'forward':
      case 'forwards':
      case 'framåt':
        v = { x: -fwd.x * dist, y: 0, z: -fwd.z * dist };
        break;
      case 'backward':
      case 'backwards':
      case 'back':
      case 'bakåt':
        v = { x: fwd.x * dist, y: 0, z: fwd.z * dist };
        break;
      case 'north':
      case 'norr':
        v = { x: 0, y: 0, z: -dist };
        break;
      case 'south':
      case 'söder':
        v = { x: 0, y: 0, z: dist };
        break;
      case 'east':
      case 'öster':
        v = { x: dist, y: 0, z: 0 };
        break;
      case 'west':
      case 'väster':
        v = { x: -dist, y: 0, z: 0 };
        break;
    }
    // Walls move perpendicular to themselves; "forward/back" snaps to the wall normal.
    for (const el of targets) {
      if (el.type === 'wall' && v.y === 0) {
        const n = wallFrame(el).normal;
        const along = v.x * n.x + v.z * n.z;
        const dir = Math.abs(along) > 1e-6 ? along : 0;
        if (Math.abs(dir) > 1e-6) ops.push({ op: 'modify', id: el.id, moveNormal: round(Math.sign(dir) * dist, 4) });
        else ops.push({ op: 'modify', id: el.id, translate: { x: round(v.x, 4), z: round(v.z, 4) } });
      } else {
        ops.push({ op: 'modify', id: el.id, translate: { x: round(v.x, 4), y: round(v.y, 4), z: round(v.z, 4) } });
      }
    }
    notes.push(t(lang, `move ${round(dist * 100, 0)} cm ${dirWord}`, `flytta ${round(dist * 100, 0)} cm ${dirWord}`));
  }

  // ---- rotate
  const rotM = clause.match(/\b(?:rotate|turn|spin|rotera|vrid)\b.*?(-?\d+(?:[.,]\d+)?)\s*(?:°|deg|degrees?|grader)/);
  if (rotM) {
    const deg = parseFloat(rotM[1].replace(',', '.')) * (/\b(counter|anti|moturs)/.test(clause) ? -1 : 1);
    for (const el of targets) if (!['window', 'door', 'skylight'].includes(el.type)) ops.push({ op: 'modify', id: el.id, rotateDeg: deg });
    notes.push(t(lang, `rotate ${deg}°`, `rotera ${deg}°`));
  }

  // ---- dimensions (absolute, percent, by delta, comparative)
  if (!moveM && !rotM && !ceil) {
    const dimOps = dimensionOps(clause, targets, lang);
    if (dimOps) {
      ops.push(...dimOps.ops);
      notes.push(dimOps.note);
    }
  }

  if (!ops.length && !notes.length) return null;
  return { ops, note: notes.join(', '), confirm };
}

function dimensionOps(clause: string, targets: Element[], lang: 'en' | 'sv'): { ops: OperationInput[]; note: string } | null {
  const ops: OperationInput[] = [];
  let note = '';
  const dimWord = DIM_WORDS.find((d) => d.re.test(clause));
  // Absolute: "1.8m wide", "width 1.8 m", "to 1.8 m wide", "3 meter hög"
  const abs1 = clause.match(new RegExp(`${NUM}\\s*${UNIT}\\s*(wide|tall|high|long|thick|deep|in width|in height|bred|brett|hög|högt|lång|långt|tjock|djup|djupt)\\b`));
  const abs2 = clause.match(new RegExp(`\\b(width|height|length|thickness|depth|bredd(?:en)?|höjd(?:en)?|längd(?:en)?|tjocklek(?:en)?|djup(?:et)?)\\s*(?:of|to|=|:|till|på)?\\s*${NUM}\\s*${UNIT}`));
  const pct = clause.match(/(\d+(?:[.,]\d+)?)\s*(?:%|percent|procent)/);
  const by = clause.match(new RegExp(`\\b(?:by|med)\\s*${NUM}\\s*${UNIT}\\b`));
  const wordToProp = (w: string) => DIM_WORDS.find((d) => d.re.test(w))?.prop;

  if ((abs1 || abs2) && !pct) {
    const value = abs1 ? toMeters(num(abs1[1])!, abs1[2]) : toMeters(num(abs2![2])!, abs2![3]);
    const word = abs1 ? abs1[3] : abs2![1];
    const prop = wordToProp(word);
    if (!prop) return null;
    for (const el of targets) {
      const p = mapDim(el, prop);
      if (!p || p === 'pitchDeg') continue;
      ops.push({ op: 'modify', id: el.id, set: { [p]: round(value, 4) }, ...(el.type === 'wall' ? { anchor: 'center' as const } : {}) });
    }
    note = t(lang, `set ${prop} to ${round(value, 3)} m`, `sätt ${prop === 'width' ? 'bredden' : prop === 'height' ? 'höjden' : prop === 'length' ? 'längden' : prop} till ${round(value, 3)} m`);
    return ops.length ? { ops, note } : null;
  }
  const shrink = SHRINK.test(clause);
  const grow = GROW.test(clause);
  if (!shrink && !grow) return null;
  const props = (el: Element) => {
    if (dimWord) {
      const p = mapDim(el, dimWord.prop);
      return p ? [p] : [];
    }
    return bigProps(el);
  };
  if (pct || !by) {
    const amount = pct ? parseFloat(pct[1].replace(',', '.')) / 100 : /\b(slightly|a little|a bit|lite|något|aningen)\b/.test(clause) ? 0.1 : /\b(much|a lot|significantly|mycket|betydligt)\b/.test(clause) ? 0.4 : 0.2;
    const f = shrink ? 1 / (1 + amount) : 1 + amount;
    const factor = shrink && pct ? 1 - amount : f;
    for (const el of targets) {
      const ps = props(el).filter((p) => p !== 'pitchDeg');
      if (!ps.length) continue;
      ops.push({ op: 'modify', id: el.id, scale: Object.fromEntries(ps.map((p) => [p, round(factor, 4)])), ...(el.type === 'wall' ? { anchor: 'center' as const } : {}) });
    }
    note = t(lang, `${shrink ? 'reduce' : 'increase'} ${dimWord?.prop ?? 'size'} by ${round(amount * 100, 1)}%`, `${shrink ? 'minska' : 'öka'} ${dimWord?.prop ?? 'storleken'} med ${round(amount * 100, 1)}%`);
  } else {
    const delta = toMeters(num(by[1])!, by[2]) * (shrink ? -1 : 1);
    for (const el of targets) {
      const ps = props(el).filter((p) => p !== 'pitchDeg');
      if (!ps.length) continue;
      ops.push({ op: 'modify', id: el.id, add: Object.fromEntries(ps.map((p) => [p, round(delta, 4)])), ...(el.type === 'wall' ? { anchor: 'center' as const } : {}) });
    }
    note = t(lang, `${shrink ? 'reduce' : 'increase'} ${dimWord?.prop ?? 'size'} by ${round(Math.abs(delta), 3)} m`, `${shrink ? 'minska' : 'öka'} ${dimWord?.prop ?? 'storleken'} med ${round(Math.abs(delta), 3)} m`);
  }
  return ops.length ? { ops, note } : null;
}

function norm(v: Vec2): Vec2 {
  const l = Math.hypot(v.x, v.z) || 1;
  return { x: v.x / l, z: v.z / l };
}

function centroid(poly: Vec2[]): Vec2 {
  const s = poly.reduce((a, p) => ({ x: a.x + p.x, z: a.z + p.z }), { x: 0, z: 0 });
  return { x: s.x / poly.length, z: s.z / poly.length };
}
