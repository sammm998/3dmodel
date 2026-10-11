import { Element } from '../schema/elements';
import type { Scene } from '../schema/scene';
import { materialExists } from '../materials/library';
import { findElement, materialSlots, wallFrame } from '../scene/query';

export interface SceneIssue {
  severity: 'error' | 'warning';
  elementId?: string;
  message: string;
}

const TOL = 1e-6;

/** Structural and semantic validation of a whole scene. */
export function validateScene(scene: Scene): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const ids = new Set<string>();
  const levelIds = new Set(scene.levels.map((l) => l.id));

  for (const el of scene.elements) {
    if (ids.has(el.id)) issues.push({ severity: 'error', elementId: el.id, message: `Duplicate id ${el.id}` });
    ids.add(el.id);
    const parsed = Element.safeParse(el);
    if (!parsed.success) {
      issues.push({
        severity: 'error',
        elementId: el.id,
        message: `${el.name || el.id}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
      });
      continue;
    }
    if (el.levelId && !levelIds.has(el.levelId)) {
      issues.push({ severity: 'error', elementId: el.id, message: `${el.name} references unknown level ${el.levelId}` });
    }
    for (const slot of materialSlots(el)) {
      const ref = (el as Record<string, unknown>)[slot];
      if (typeof ref === 'string' && !materialExists(ref, scene.materials)) {
        issues.push({ severity: 'error', elementId: el.id, message: `${el.name}: unknown material "${ref}"` });
      }
    }
  }

  for (const el of scene.elements) {
    if (el.type === 'wall') {
      if (wallFrame(el).length < 0.05) issues.push({ severity: 'error', elementId: el.id, message: `${el.name} has (almost) zero length` });
    }
    if (el.type === 'window' || el.type === 'door') {
      const host = findElement(scene, el.hostId);
      if (!host || host.type !== 'wall') {
        issues.push({ severity: 'error', elementId: el.id, message: `${el.name} must be hosted by a wall (host ${el.hostId} not found)` });
        continue;
      }
      const L = wallFrame(host).length;
      const a = el.offset - el.width / 2;
      const b = el.offset + el.width / 2;
      if (a < -TOL || b > L + TOL) {
        issues.push({
          severity: 'error',
          elementId: el.id,
          message: `${el.name} (${el.width.toFixed(2)} m wide at ${el.offset.toFixed(2)} m) does not fit within ${host.name} (${L.toFixed(2)} m long)`,
        });
      }
      const sill = el.type === 'window' ? el.sillHeight : 0;
      if (sill + el.height > host.height + TOL) {
        issues.push({
          severity: 'error',
          elementId: el.id,
          message: `${el.name} top (${(sill + el.height).toFixed(2)} m) is above ${host.name} height (${host.height.toFixed(2)} m)`,
        });
      }
    }
    if (el.type === 'skylight') {
      const host = findElement(scene, el.hostId);
      if (!host || host.type !== 'roof') {
        issues.push({ severity: 'error', elementId: el.id, message: `${el.name} must be hosted by a roof` });
        continue;
      }
      if (Math.abs(el.u) + el.width / 2 > host.width / 2 + host.overhang || Math.abs(el.v) + el.length / 2 > host.depth / 2 + host.overhang) {
        issues.push({ severity: 'warning', elementId: el.id, message: `${el.name} extends beyond the roof edge` });
      }
    }
  }

  // Overlapping openings on the same wall.
  const byHost = new Map<string, { id: string; name: string; a: number; b: number; lo: number; hi: number }[]>();
  for (const el of scene.elements) {
    if (el.type !== 'window' && el.type !== 'door') continue;
    const sill = el.type === 'window' ? el.sillHeight : 0;
    const list = byHost.get(el.hostId) ?? [];
    list.push({ id: el.id, name: el.name, a: el.offset - el.width / 2, b: el.offset + el.width / 2, lo: sill, hi: sill + el.height });
    byHost.set(el.hostId, list);
  }
  for (const list of byHost.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const p = list[i];
        const q = list[j];
        if (p.a < q.b - 0.01 && q.a < p.b - 0.01 && p.lo < q.hi - 0.01 && q.lo < p.hi - 0.01) {
          issues.push({ severity: 'warning', elementId: q.id, message: `${p.name} overlaps ${q.name}` });
        }
      }
    }
  }
  return issues;
}
