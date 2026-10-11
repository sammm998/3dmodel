import { describe, expect, it } from 'vitest';
import { detectWallsFromRaster, detectWallsFromSegments, openingWidthsToMeters, analysisToPlan } from '@/core/plan/detect';
import { calibrate, planToOperations, type FloorPlan } from '@/core/plan/plan';
import { applyOperations } from '@/core/ops/apply';
import { emptyScene } from '@/core/schema/scene';
import { wallFrame } from '@/core/scene/query';
import type { WallElement } from '@/core/schema/elements';

/** 800×600 white image with a 600×400 px room, 12 px walls, a door gap and a window gap. */
function syntheticPlan() {
  const W = 800;
  const H = 600;
  const g = new Uint8Array(W * H).fill(255);
  const rect = (x0: number, y0: number, x1: number, y1: number, v = 0) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g[y * W + x] = v;
  };
  const T = 12;
  rect(100, 100, 700, 100 + T); // top
  rect(100, 500 - T, 700, 500); // bottom
  rect(100, 100, 100 + T, 500); // left
  rect(700 - T, 100, 700, 500); // right
  // door gap in bottom wall (x 300..360)
  rect(300, 500 - T, 360, 500, 255);
  // window gap in top wall (x 450..540) with a thin glazing line in the middle
  rect(450, 100, 540, 100 + T, 255);
  rect(450, 105, 540, 107, 0);
  // some noise: text and a dimension line
  rect(120, 40, 680, 41);
  rect(200, 200, 230, 210);
  return { g, W, H };
}

describe('raster wall detection', () => {
  it('finds the four walls and both openings of a simple plan', () => {
    const { g, W, H } = syntheticPlan();
    const r = detectWallsFromRaster(g, W, H);
    expect(r.walls.length).toBe(4);
    expect(r.medianThicknessPx).toBeGreaterThanOrEqual(10);
    const types = r.openings.map((o) => o.type).sort();
    expect(types).toEqual(['door', 'window']);
    // Calibrate: the room is 600 px = 6 m between outer faces → use centre-lines 588 px = 5.88 m
    const ppm = calibrate({ x: 100, y: 0 }, { x: 700, y: 0 }, 6);
    expect(ppm).toBeCloseTo(100);
    const plan: FloorPlan = { width: W, height: H, unitsPerMeter: ppm, scaleSource: 'calibration', walls: r.walls.map((w) => ({ ...w, exterior: true })), openings: openingWidthsToMeters(r.openings, ppm), rooms: [{ id: 'r1', name: 'Kitchen', at: { x: 400, y: 300 }, confidence: 1 }], wallHeight: 2.7, defaultThickness: 0.2 };
    const { ops, warnings } = planToOperations(plan, { levelId: 'level_0' });
    const res = applyOperations(emptyScene(), ops);
    expect(res.errors).toEqual([]);
    const walls = res.scene.elements.filter((e): e is WallElement => e.type === 'wall');
    expect(walls).toHaveLength(4);
    const lengths = walls.map((w) => Math.round(wallFrame(w).length * 10) / 10).sort();
    expect(lengths).toEqual([3.9, 3.9, 5.9, 5.9]);
    expect(res.scene.elements.filter((e) => e.type === 'door')).toHaveLength(1);
    expect(res.scene.elements.filter((e) => e.type === 'window')).toHaveLength(1);
    const door = res.scene.elements.find((e) => e.type === 'door')!;
    expect((door as { width: number }).width).toBeCloseTo(0.6, 1);
    expect(res.scene.elements.find((e) => e.type === 'room')?.name).toBe('Kitchen');
    expect(warnings.filter((w) => /closed loop/.test(w))).toEqual([]);
  });
});

describe('DXF line-pair detection', () => {
  it('pairs parallel face lines into centre-line walls with thickness', () => {
    // 5 × 4 m room drawn in millimeters with 200 mm walls (outer and inner faces)
    const segs = [
      { a: { x: 0, y: 0 }, b: { x: 5000, y: 0 } },
      { a: { x: 200, y: 200 }, b: { x: 4800, y: 200 } },
      { a: { x: 0, y: 4000 }, b: { x: 5000, y: 4000 } },
      { a: { x: 200, y: 3800 }, b: { x: 4800, y: 3800 } },
      { a: { x: 0, y: 0 }, b: { x: 0, y: 4000 } },
      { a: { x: 200, y: 200 }, b: { x: 200, y: 3800 } },
      { a: { x: 5000, y: 0 }, b: { x: 5000, y: 4000 } },
      { a: { x: 4800, y: 200 }, b: { x: 4800, y: 3800 } },
      { a: { x: 1000, y: 1000 }, b: { x: 1300, y: 1000 } }, // short noise line
    ];
    const walls = detectWallsFromSegments(segs, 1000);
    expect(walls).toHaveLength(4);
    expect(walls.every((w) => Math.abs((w.thickness ?? 0) - 0.2) < 1e-6)).toBe(true);
  });
});

describe('AI analysis conversion', () => {
  it('suggests a scale from readable dimensions and keeps confidence', () => {
    const r = analysisToPlan({
      imageWidth: 1000,
      imageHeight: 800,
      walls: [{ x1: 100, y1: 100, x2: 900, y2: 100, confidence: 0.9 }],
      openings: [{ type: 'window', x: 500, y: 102, widthPx: 120, confidence: 0.4 }],
      rooms: [],
      dimensions: [{ x1: 100, y1: 60, x2: 900, y2: 60, valueMeters: 8 }],
    });
    expect(r.suggestedUnitsPerMeter).toBeCloseTo(100);
    expect(r.plan.unitsPerMeter).toBeNull(); // never applied without user confirmation
    expect(r.plan.openings[0].confidence).toBe(0.4);
  });
});
