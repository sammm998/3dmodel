/**
 * Compact, scene-aware context for the LLM. Sends the selected elements in
 * full, their structural neighbours (host wall, sibling openings, room) and
 * an index of the rest — never the full raw scene.
 */
import type { Element, Vec2 } from '../schema/elements';
import type { Scene } from '../schema/scene';
import { describeElement, findElement, hostedChildren, levelOf, roomContaining, sceneBounds } from '../scene/query';

export interface AiContext {
  selection: { summary: ReturnType<typeof describeElement>; element: Element }[];
  related: ReturnType<typeof describeElement>[];
  levels: { id: string; name: string; elevation: number; height: number }[];
  activeLevelId?: string;
  counts: Record<string, number>;
  bounds: ReturnType<typeof sceneBounds>;
  index: { id: string; type: string; name: string; level: string }[];
  indexTruncated: boolean;
  customMaterials: { id: string; name: string }[];
  view?: { right: Vec2; forward: Vec2 };
}

const INDEX_LIMIT = 250;

export function buildAiContext(scene: Scene, selectedIds: string[], opts: { activeLevelId?: string; view?: { right: Vec2; forward: Vec2 } } = {}): AiContext {
  const selected = selectedIds.map((id) => findElement(scene, id)).filter((e): e is Element => !!e);
  const relatedIds = new Set<string>();
  for (const el of selected) {
    if ('hostId' in el) {
      relatedIds.add(el.hostId);
      for (const sib of hostedChildren(scene, el.hostId)) relatedIds.add(sib.id);
    }
    for (const c of hostedChildren(scene, el.id)) relatedIds.add(c.id);
    const room = el.type === 'room' ? undefined : roomContaining(scene, el);
    if (room) relatedIds.add(room.id);
  }
  for (const s of selected) relatedIds.delete(s.id);
  const counts: Record<string, number> = {};
  for (const e of scene.elements) counts[e.type] = (counts[e.type] ?? 0) + 1;
  // Index: prioritise structure over furniture when truncating.
  const priority = (e: Element) => (e.type === 'furniture' ? 2 : e.type === 'slab' || e.type === 'terrain' ? 1 : 0);
  const sorted = [...scene.elements].sort((a, b) => priority(a) - priority(b));
  return {
    selection: selected.map((element) => ({ summary: describeElement(scene, element), element })),
    related: [...relatedIds]
      .map((id) => findElement(scene, id))
      .filter((e): e is Element => !!e)
      .slice(0, 40)
      .map((e) => describeElement(scene, e)),
    levels: scene.levels.map((l) => ({ id: l.id, name: l.name, elevation: l.elevation, height: l.height })),
    activeLevelId: opts.activeLevelId,
    counts,
    bounds: sceneBounds(scene),
    index: sorted.slice(0, INDEX_LIMIT).map((e) => ({ id: e.id, type: e.type, name: e.name, level: levelOf(scene, e).id })),
    indexTruncated: scene.elements.length > INDEX_LIMIT,
    customMaterials: scene.materials.map((m) => ({ id: m.id, name: m.name })),
    view: opts.view,
  };
}
