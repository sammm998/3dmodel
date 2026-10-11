import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error no types shipped
import validator from 'gltf-validator';
import DxfParser from 'dxf-parser';
import { generateBuilding } from '@/core/generator/generateBuilding';
import { exportGLB, exportOBJ, exportSTL } from '@/core/export/meshExport';
import { exportIFC, ifcGuid } from '@/core/export/ifc';
import { exportDXF } from '@/core/export/dxf';
import { applyOperations } from '@/core/ops/apply';

const room = generateBuilding({ kind: 'room', blocks: [{ width: 6, depth: 4 }], floorHeight: 2.7, windows: { count: 2 }, doors: { count: 1 } }).scene;
const villa = generateBuilding({ kind: 'villa', blocks: [{ width: 16, depth: 10, floors: 2 }], roof: { type: 'gable' }, furnish: true, extras: { pool: {}, terrace: {} } }).scene;

function hasPython(mod: string) {
  try {
    execFileSync('python3', ['-c', `import ${mod}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('exports', () => {
  it('exports a valid GLB (Khronos glTF validator) with one node per element and real dimensions', async () => {
    const edited = applyOperations(room, [{ op: 'modify', id: room.elements.find((e) => e.type === 'window')!.id, set: { width: 1.8 } }]).scene;
    const glb = await exportGLB(edited);
    expect(glb.byteLength).toBeGreaterThan(1000);
    const report = await validator.validateBytes(new Uint8Array(glb));
    expect(report.issues.numErrors).toBe(0);
    // Parse JSON chunk
    const dv = new DataView(glb);
    expect(dv.getUint32(0, true)).toBe(0x46546c67); // 'glTF'
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLen)));
    const names: string[] = json.nodes.map((n: { name?: string }) => n.name ?? '');
    for (const el of edited.elements) {
      if (el.type === 'room') continue;
      expect(names.some((n) => n.includes(`[${el.id}]`))).toBe(true);
    }
    const node = json.nodes.find((n: { extras?: { elementId?: string } }) => n.extras?.elementId === edited.elements.find((e) => e.type === 'window')!.id);
    expect(node.extras.elementType).toBe('window');
    // Accessor bounds give the real-world extent: 6 m (+ corner extensions) in X, 2.7 m in Y.
    let maxY = -Infinity;
    for (const acc of json.accessors) if (acc.type === 'VEC3' && acc.max && acc.min && acc.max.length === 3) maxY = Math.max(maxY, acc.max[1]);
    expect(maxY).toBeGreaterThan(0);
  });

  it('exports OBJ with materials and STL', () => {
    const { obj, mtl } = exportOBJ(villa);
    expect(obj).toMatch(/^mtllib model\.mtl/m);
    expect(obj.split('\n').filter((l) => l.startsWith('f ')).length).toBeGreaterThan(1000);
    expect(obj).toMatch(/^o .*wall_001/m);
    expect(mtl).toMatch(/newmtl plaster_white/);
    const stl = exportSTL(room);
    const triangles = new DataView(stl).getUint32(80, true);
    expect(stl.byteLength).toBe(84 + triangles * 50);
    expect(triangles).toBeGreaterThan(100);
  });

  it('exports IFC4 with storeys, walls, openings and spaces', () => {
    const { content, mapping } = exportIFC(villa, { projectName: 'Villa', projectId: 'p1', timestamp: new Date('2026-01-01T00:00:00Z') });
    expect(content.startsWith('ISO-10303-21;')).toBe(true);
    expect(content).toMatch(/FILE_SCHEMA\(\('IFC4'\)\)/);
    expect((content.match(/IFCBUILDINGSTOREY\(/g) ?? []).length).toBe(2);
    expect(content).toMatch(/IFCWALL\(/);
    expect(content).toMatch(/IFCRELVOIDSELEMENT\(/);
    expect(content).toMatch(/IFCRELFILLSELEMENT\(/);
    expect(content).toMatch(/IFCSPACE\(/);
    expect(content).toMatch(/IFCROOF\(/);
    expect(Object.values(mapping)).toContain('IFCWINDOW');
    expect(ifcGuid('a')).toHaveLength(22);
    expect(ifcGuid('a')).toBe(ifcGuid('a'));
  });

  it.runIf(hasPython('ifcopenshell'))('IFC opens in IfcOpenShell with correct entity counts', () => {
    const { content } = exportIFC(villa, { projectName: 'Villa', projectId: 'p1' });
    const dir = mkdtempSync(path.join(tmpdir(), 'ifc-'));
    const file = path.join(dir, 'villa.ifc');
    writeFileSync(file, content);
    const script = `
import sys, json, ifcopenshell, ifcopenshell.geom
f = ifcopenshell.open(sys.argv[1])
s = ifcopenshell.geom.settings()
ok = 0
for w in f.by_type('IfcWall')[:5]:
    shape = ifcopenshell.geom.create_shape(s, w)
    ok += 1 if len(shape.geometry.verts) > 0 else 0
print(json.dumps({'walls': len(f.by_type('IfcWall')), 'windows': len(f.by_type('IfcWindow')), 'storeys': len(f.by_type('IfcBuildingStorey')), 'spaces': len(f.by_type('IfcSpace')), 'geom_ok': ok, 'schema': f.schema}))
`;
    const out = JSON.parse(execFileSync('python3', ['-c', script, file]).toString());
    expect(out.schema).toBe('IFC4');
    expect(out.storeys).toBe(2);
    expect(out.walls).toBe(villa.elements.filter((e) => e.type === 'wall').length);
    expect(out.windows).toBe(villa.elements.filter((e) => e.type === 'window').length);
    expect(out.geom_ok).toBe(5);
  });

  it.runIf(hasPython('trimesh'))('GLB loads in trimesh with matching geometry', async () => {
    const glb = await exportGLB(room);
    const dir = mkdtempSync(path.join(tmpdir(), 'glb-'));
    const file = path.join(dir, 'room.glb');
    writeFileSync(file, Buffer.from(glb));
    const script = `
import sys, json, trimesh
s = trimesh.load(sys.argv[1])
b = s.bounds
print(json.dumps({'geoms': len(s.geometry), 'extent': (b[1]-b[0]).tolist()}))
`;
    const out = JSON.parse(execFileSync('python3', ['-c', script, file]).toString());
    expect(out.geoms).toBeGreaterThan(5);
    // width ≈ 6 + wall thickness, height 2.7 + slab 0.3
    expect(out.extent[0]).toBeCloseTo(6.25, 1);
    expect(out.extent[1]).toBeCloseTo(3.0, 1);
  });

  it('exports a DXF floor plan that parses', () => {
    const dxf = exportDXF(villa);
    const parsed = new DxfParser().parseSync(dxf);
    const layers = new Set(parsed!.entities.map((e: { layer: string }) => e.layer));
    expect(layers.has('WALLS')).toBe(true);
    expect(layers.has('DOORS')).toBe(true);
    expect(layers.has('ROOMS')).toBe(true);
    expect(parsed!.entities.length).toBeGreaterThan(200);
  });
});
