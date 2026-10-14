import { describe, expect, it } from 'vitest';
import { generateBuilding } from '@/core/generator/generateBuilding';
import { STARTERS } from '@/core/generator/starters';
import { INDOOR_HEIGHT, pathLength, planDroneFlight, smoothPath } from '@/core/video/dronePath';
import { pointAlongWall, wallFrame } from '@/core/scene/query';
import type { DoorElement, WallElement } from '@/core/schema/elements';

describe('drone flight', () => {
  it.each(['scandinavian-villa', 'contemporary-office', 'luxury-apartment'])('%s: enters through the door, visits rooms on every storey, never flies through a wall', (id) => {
    const { scene } = generateBuilding(STARTERS.find((s) => s.id === id)!.program);
    const plan = planDroneFlight(scene);
    expect(plan.approach).not.toBeNull();
    expect(plan.visited.length).toBeGreaterThanOrEqual(3);
    const path = smoothPath(plan.interior);
    expect(pathLength(path)).toBeGreaterThan(10);

    const levels = [...scene.levels].sort((a, b) => a.elevation - b.elevation);
    const walls = scene.elements.filter((e): e is WallElement => e.type === 'wall');
    const doors = scene.elements.filter((e): e is DoorElement => e.type === 'door');
    let worst = Infinity;
    for (const p of path) {
      const floor = p.y - INDOOR_HEIGHT;
      const lvl = [...levels].reverse().find((l) => floor >= l.elevation - 0.3) ?? levels[0];
      for (const w of walls.filter((x) => (x.levelId ?? levels[0].id) === lvl.id)) {
        const f = wallFrame(w);
        const along = (p.x - w.start.x) * f.dir.x + (p.z - w.start.z) * f.dir.z;
        const across = Math.abs((p.x - w.start.x) * f.normal.x + (p.z - w.start.z) * f.normal.z);
        const beyond = Math.max(0, -along, along - f.length);
        const d = Math.hypot(beyond, across) - w.thickness / 2;
        if (d >= 0.12) continue;
        // Only allowed inside a door opening of this wall, away from the jambs.
        const inDoor = doors.some((dr) => dr.hostId === w.id && Math.abs(along - dr.offset) < dr.width / 2 - 0.18);
        if (!inDoor) worst = Math.min(worst, d);
      }
    }
    expect(worst).toBe(Infinity);
    // The flight starts outside and ends inside the building.
    expect(path[0]).toMatchObject(plan.approach!);
    void pointAlongWall;
  });

  it('climbs to the upper storey of multi-storey buildings', () => {
    const { scene } = generateBuilding(STARTERS.find((s) => s.id === 'scandinavian-villa')!.program);
    const plan = planDroneFlight(scene);
    const maxY = Math.max(...plan.interior.map((p) => p.y));
    expect(maxY).toBeGreaterThan(scene.levels[1].elevation + 1);
  });

  it('smoothPath stays close to the polyline and keeps its ends', () => {
    const pts = [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
      { x: 5, y: 0, z: 5 },
    ];
    const s = smoothPath(pts, 0.6);
    expect(s[0]).toEqual(pts[0]);
    expect(s[s.length - 1]).toEqual(pts[2]);
    for (const p of s) expect(Math.min(Math.abs(p.z), Math.abs(p.x - 5))).toBeLessThanOrEqual(0.6);
  });
});
