import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { generateBuilding } from '@/core/generator/generateBuilding';
import { STARTERS } from '@/core/generator/starters';
import { buildElementObject, createBuildContext } from '@/core/geometry/build3d';
import { WalkPhysics } from '@/core/geometry/walkPhysics';
import { collectDoorParts, animateDoors } from '@/core/geometry/doorMotion';
import { pointAlongWall, wallFrame, findElement, levelOf } from '@/core/scene/query';
describe('door swing', () => {
it('every hinged door opens away from whoever approaches it, from either side, on every storey', () => {
  const { scene } = generateBuilding(STARTERS.find((s) => s.id === 'scandinavian-villa')!.program);
  const ctx = createBuildContext(scene, () => new THREE.MeshStandardMaterial());
  for (const door of scene.elements) {
    if (door.type !== 'door' || door.doorType !== 'hinged') continue;
    const host = findElement(scene, door.hostId) as any;
    const obj = buildElementObject(door, ctx)!; const c = WalkPhysics.collider(obj)!;
    const p = pointAlongWall(host, door.offset); const n = wallFrame(host).normal;
    for (const side of [1, -1]) {
      const parts = collectDoorParts(obj, c.box);
      const feet = new THREE.Vector3(p.x + n.x * side * 1.2, levelOf(scene, host).elevation, p.z + n.z * side * 1.2);
      for (let i = 0; i < 30; i++) animateDoors(parts, feet, 0.05);
      obj.updateMatrixWorld(true);
      // Leaf extent along the wall normal (world).
      const b = new THREE.Box3();
      for (const d of parts) d.part.traverse((o) => { if ((o as THREE.Mesh).isMesh) b.expandByObject(o); });
      const center = b.getCenter(new THREE.Vector3());
      const leafSide = (center.x - p.x) * n.x + (center.z - p.z) * n.z;
      expect(Math.abs(leafSide), door.name).toBeGreaterThan(0.2);
      expect(Math.sign(leafSide), door.name).toBe(-side);
    }
  }
});
});
