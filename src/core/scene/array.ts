/**
 * Repeating an element: copies along a line, or around an axis (a wheel's spokes
 * and gondolas, columns round a rotunda, chairs round a table).
 */
import * as THREE from 'three';
import type { Element } from '../schema/elements';
import { round } from '../geometry/math2d';

export interface ArraySpec {
  count: number;
  /** Linear step between copies (m). */
  step?: { x?: number; y?: number; z?: number };
  /** Rotate copies about an axis through `center` (level-relative coordinates). */
  radial?: { center: { x: number; y?: number; z: number }; axis?: 'x' | 'y' | 'z'; angleDeg?: number; keepUpright?: boolean; hangFrom?: { x: number; y: number; z: number } };
}

const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const r4 = (v: number) => round(v, 4);

/** Drafts (without ids) for copies 1..count-1 of an element; copy 0 is the original. */
export function arrayCopies(el: Element, spec: ArraySpec): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const n = Math.max(2, Math.min(400, Math.round(spec.count)));
  const axisKey = spec.radial?.axis ?? 'y';
  const sweep = ((spec.radial?.angleDeg ?? 360) * Math.PI) / 180;
  // A full circle spreads n copies over 360°; a partial arc includes both ends.
  const stepAngle = Math.abs(sweep - Math.PI * 2) < 1e-6 ? sweep / n : sweep / (n - 1);
  if (spec.radial && axisKey !== 'y' && !['box', 'beam'].includes(el.type)) {
    throw new Error('Only objects (boxes/solids) and beams can be repeated around a horizontal axis');
  }
  if (!spec.radial && !spec.step) throw new Error('array needs either step or radial');
  for (let i = 1; i < n; i++) {
    const copy = structuredClone(el) as Record<string, unknown>;
    delete copy.id;
    delete copy.groupId;
    copy.name = `${el.name} ${i + 1}`;
    if (spec.radial) {
      const c = new THREE.Vector3(spec.radial.center.x, spec.radial.center.y ?? 0, spec.radial.center.z);
      const q = new THREE.Quaternion().setFromAxisAngle(AXES[axisKey], stepAngle * i);
      const turn = (p: { x: number; y: number; z: number }) => {
        const v = new THREE.Vector3(p.x, p.y, p.z).sub(c).applyQuaternion(q).add(c);
        return { x: r4(v.x), y: r4(v.y), z: r4(v.z) };
      };
      if (spec.radial.keepUpright) {
        // Copies only move (no turning): the point they hang from travels round the circle.
        const ref =
          spec.radial.hangFrom ??
          (el.type === 'beam'
            ? { x: (el.start.x + el.end.x) / 2, y: (el.start.y + el.end.y) / 2, z: (el.start.z + el.end.z) / 2 }
            : el.type === 'box'
              ? { x: el.position.x, y: el.position.y + el.height / 2, z: el.position.z }
              : 'position' in el
                ? { x: el.position.x, y: 'y' in el.position ? (el.position as { y: number }).y : 0, z: el.position.z }
                : null);
        if (!ref) throw new Error(`A ${el.type} cannot be repeated around an axis`);
        const t = turn(ref);
        moveBy(copy, el, { x: t.x - ref.x, y: t.y - ref.y, z: t.z - ref.z }, 1);
        if (spec.step) moveBy(copy, el, spec.step, i);
        out.push(copy);
        continue;
      }
      switch (el.type) {
        case 'beam':
          copy.start = turn(el.start);
          copy.end = turn(el.end);
          break;
        case 'box': {
          // Rotate about the solid's centre point, then compose the orientation.
          const centre = turn({ x: el.position.x, y: el.position.y + el.height / 2, z: el.position.z });
          copy.position = { x: centre.x, y: r4(centre.y - el.height / 2), z: centre.z };
          if (!spec.radial.keepUpright) {
            const e = new THREE.Euler(el.tiltX ?? 0, el.rotation, el.tiltZ ?? 0, 'YXZ');
            const o = new THREE.Quaternion().setFromEuler(e).premultiply(q);
            const e2 = new THREE.Euler().setFromQuaternion(o, 'YXZ');
            copy.tiltX = r4(e2.x);
            copy.rotation = r4(e2.y);
            copy.tiltZ = r4(e2.z);
          }
          break;
        }
        default: {
          // Plan elements: rotate the position about the vertical axis and turn them with it.
          const p = (copy.position ?? copy.center) as { x: number; y?: number; z: number } | undefined;
          if (!p) throw new Error(`A ${el.type} cannot be repeated around an axis`);
          const t = turn({ x: p.x, y: p.y ?? 0, z: p.z });
          const np = 'y' in p ? { ...p, x: t.x, z: t.z } : { x: t.x, z: t.z };
          if (copy.position) copy.position = np;
          else copy.center = np;
          if (typeof copy.rotation === 'number' && !spec.radial.keepUpright) copy.rotation = r4((copy.rotation as number) + stepAngle * i);
        }
      }
    }
    if (spec.step) moveBy(copy, el, spec.step, i);
    out.push(copy);
  }
  return out;
}

/** Moves a copy by i × step. */
function moveBy(copy: Record<string, unknown>, el: Element, step: { x?: number; y?: number; z?: number }, i: number) {
  const dx = (step.x ?? 0) * i;
  const dy = (step.y ?? 0) * i;
  const dz = (step.z ?? 0) * i;
  const mv3 = (p: { x: number; y: number; z: number }) => ({ x: r4(p.x + dx), y: r4(p.y + dy), z: r4(p.z + dz) });
  const mv2 = (p: { x: number; z: number }) => ({ x: r4(p.x + dx), z: r4(p.z + dz) });
  if (copy.start && copy.end && el.type === 'beam') {
    copy.start = mv3(copy.start as never);
    copy.end = mv3(copy.end as never);
  } else if (copy.start && copy.end) {
    copy.start = mv2(copy.start as never);
    copy.end = mv2(copy.end as never);
  } else if (copy.position) copy.position = 'y' in (copy.position as object) ? mv3(copy.position as never) : mv2(copy.position as never);
  else if (copy.center) copy.center = mv2(copy.center as never);
  else if (copy.polygon) copy.polygon = (copy.polygon as { x: number; z: number }[]).map(mv2);
  else throw new Error(`A ${el.type} cannot be repeated`);
}
