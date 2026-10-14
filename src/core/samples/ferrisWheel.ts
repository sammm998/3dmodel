/**
 * A detailed Ferris wheel composed from solids, round beams and arrays: the
 * reference for how the assistant should build non-building objects (also used
 * in tests and as a sample).
 */
import type { OperationInput } from '../ops/operations';

export function ferrisWheelOps(at: { x: number; z: number } = { x: 25, z: 0 }, opts: { radius?: number; gondolas?: number } = {}): OperationInput[] {
  const R = opts.radius ?? 8;
  const n = opts.gondolas ?? 16;
  // High enough that the lowest gondola clears the boarding platform.
  const hubY = R + 3;
  const { x, z } = at;
  const half = 1.0; // rims at z ± half
  const ops: OperationInput[] = [];
  const steel = 'steel';
  // Foundation and boarding platform.
  ops.push({ op: 'create', element: { type: 'box', name: 'Wheel foundation', position: { x, y: 0, z }, width: 11, depth: 6, height: 0.3, material: 'concrete', cornerRadius: 0.05 } });
  ops.push({ op: 'create', element: { type: 'box', name: 'Boarding platform', position: { x, y: 0.3, z: z + 0.5 }, width: 3.4, depth: 3.4, height: 0.4, material: 'wood_deck', cornerRadius: 0.03 } });
  ops.push({ op: 'create', element: { type: 'stair', name: 'Platform steps', position: { x, z: z + 3.1 }, rotation: 0, width: 1.2, totalRise: 0.7, totalRun: 0.9, steps: 3, material: 'concrete' } });
  // A-frame legs (round steel tubes) to the hub bearings, with cross braces.
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      ops.push({ op: 'create', element: { type: 'beam', name: 'Leg', profile: 'round', width: 0.35, depth: 0.35, start: { x: x + sx * 4.6, y: 0.3, z: z + sz * 2.3 }, end: { x, y: hubY, z: z + sz * (half + 0.35) }, material: 'paint_white' } });
    }
    ops.push({ op: 'create', element: { type: 'beam', name: 'Leg brace', profile: 'round', width: 0.16, depth: 0.16, start: { x: x - 2.4, y: hubY * 0.48, z: z + sz * 1.85 }, end: { x: x + 2.4, y: hubY * 0.48, z: z + sz * 1.85 }, material: 'paint_white' } });
    ops.push({ op: 'create', element: { type: 'box', name: 'Bearing', shape: 'cylinder', width: 0.9, depth: 0.9, height: 0.5, tiltX: Math.PI / 2, position: { x, y: hubY - 0.25, z: z + sz * (half + 0.35) }, material: 'metal_dark_grey' } });
  }
  // Axle and hub.
  ops.push({ op: 'create', element: { type: 'box', name: 'Axle', shape: 'cylinder', width: 0.45, depth: 0.45, height: 2 * half + 1.2, tiltX: Math.PI / 2, position: { x, y: hubY - (half + 0.6), z }, material: steel } });
  ops.push({ op: 'create', element: { type: 'box', name: 'Hub', shape: 'cylinder', width: 1.4, depth: 1.4, height: 2 * half + 0.3, tiltX: Math.PI / 2, position: { x, y: hubY - (half + 0.15), z }, material: 'paint_white' } });
  // Two rims, an inner ring for stiffness.
  for (const sz of [-1, 1]) {
    ops.push({ op: 'create', element: { type: 'box', name: 'Rim', shape: 'torus', width: 2 * R + 0.24, height: 2 * R + 0.24, depth: 0.24, thickness: 0.24, position: { x, y: hubY - R - 0.12, z: z + sz * half }, material: 'paint_white' } });
    ops.push({ op: 'create', element: { type: 'box', name: 'Inner ring', shape: 'torus', width: R + 0.12, height: R + 0.12, depth: 0.12, thickness: 0.12, position: { x, y: hubY - R / 2 - 0.06, z: z + sz * half }, material: 'paint_white' } });
    // Spokes from the hub to the rim on each side, repeated round the wheel.
    ops.push({ op: 'create', ref: sz < 0 ? '$spokeA' : '$spokeB', element: { type: 'beam', name: 'Spoke', profile: 'round', width: 0.08, depth: 0.08, start: { x, y: hubY, z: z + sz * half }, end: { x: x + R, y: hubY, z: z + sz * half }, material: steel } });
    ops.push({ op: 'array', id: sz < 0 ? '$spokeA' : '$spokeB', count: n * 2, radial: { center: { x, y: hubY, z }, axis: 'z' } });
  }
  // Cross tubes tying the rims together at every gondola.
  ops.push({ op: 'create', ref: '$cross', element: { type: 'beam', name: 'Rim tie', profile: 'round', width: 0.12, depth: 0.12, start: { x: x + R, y: hubY, z: z - half }, end: { x: x + R, y: hubY, z: z + half }, material: 'paint_white' } });
  ops.push({ op: 'array', id: '$cross', count: n, radial: { center: { x, y: hubY, z }, axis: 'z' } });
  // Gondola: a rounded cabin with a glazed band and roof, hanging from the tie on a rod.
  const gy = hubY - 0.35 - 1.9; // cabin bottom under the tie at (x + R, hubY)
  ops.push({ op: 'create', ref: '$hanger', element: { type: 'beam', name: 'Gondola hanger', profile: 'round', width: 0.06, depth: 0.06, start: { x: x + R, y: hubY, z }, end: { x: x + R, y: gy + 1.9, z }, material: steel } });
  ops.push({ op: 'create', ref: '$cabin', element: { type: 'box', name: 'Gondola', position: { x: x + R, y: gy, z }, width: 1.5, depth: 1.3, height: 1.15, cornerRadius: 0.22, material: 'paint_red' } });
  ops.push({ op: 'create', ref: '$glass', element: { type: 'box', name: 'Gondola glazing', position: { x: x + R, y: gy + 1.05, z }, width: 1.42, depth: 1.22, height: 0.55, cornerRadius: 0.18, material: 'glass_tinted' } });
  ops.push({ op: 'create', ref: '$roof', element: { type: 'box', name: 'Gondola roof', shape: 'cylinder', taper: 0.55, position: { x: x + R, y: gy + 1.6, z }, width: 1.65, depth: 1.45, height: 0.3, material: 'paint_white' } });
  for (const id of ['$hanger', '$cabin', '$glass', '$roof']) ops.push({ op: 'array', id, count: n, radial: { center: { x, y: hubY, z }, axis: 'z', keepUpright: true, hangFrom: { x: x + R, y: hubY, z } } });
  return ops;
}
