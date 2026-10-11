/**
 * Mesh exporters: glTF 2.0 binary (GLB), Wavefront OBJ + MTL, binary STL.
 *
 * All exports are in meters with +Y up (the glTF convention). Every element is
 * exported as its own named node so it remains identifiable in Blender,
 * SketchUp, Rhino, 3ds Max etc. glTF nodes carry `extras` with the persistent
 * element id, type and level.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import type { Scene } from '../schema/scene';
import { resolveMaterial } from '../materials/library';
import { buildSceneGroup, type MaterialFn } from '../geometry/build3d';

/** Plain PBR materials (no textures) suitable for any exporter. */
export function exportMaterialFn(scene: Scene): MaterialFn {
  const cache = new Map<string, THREE.Material>();
  return (ref: string) => {
    let m = cache.get(ref);
    if (m) return m;
    const def = resolveMaterial(ref, scene.materials);
    if (def.category === 'glass' || def.transmission) {
      m = new THREE.MeshPhysicalMaterial({
        name: def.id,
        color: new THREE.Color(def.color),
        roughness: def.roughness,
        metalness: def.metalness,
        transparent: true,
        opacity: def.opacity ?? 0.3,
        transmission: def.transmission ?? 0.9,
        ior: def.ior ?? 1.5,
      });
    } else {
      m = new THREE.MeshStandardMaterial({ name: def.id, color: new THREE.Color(def.color), roughness: def.roughness, metalness: def.metalness });
    }
    cache.set(ref, m);
    return m;
  };
}

export interface MeshExportOptions {
  /** Restrict the export to these element ids. */
  ids?: Set<string>;
  /** Material provider; defaults to untextured PBR materials. */
  material?: MaterialFn;
}

export function buildExportGroup(scene: Scene, opts: MeshExportOptions = {}): THREE.Group {
  const group = buildSceneGroup(scene, opts.material ?? exportMaterialFn(scene), { includeHelpers: false, ids: opts.ids });
  // Name nodes after the element so they are recognisable in other tools.
  for (const child of group.children) {
    const id = child.userData.elementId as string;
    const el = scene.elements.find((e) => e.id === id);
    if (el) {
      child.name = `${el.name} [${el.id}]`;
      child.userData = { elementId: el.id, elementType: el.type, levelId: el.levelId ?? scene.levels[0].id, ...(el.bim ? { bim: el.bim } : {}) };
      child.traverse((c) => {
        if (c !== child) c.userData = {};
      });
    }
  }
  group.updateMatrixWorld(true);
  return group;
}

export async function exportGLB(scene: Scene, opts: MeshExportOptions = {}): Promise<ArrayBuffer> {
  const group = buildExportGroup(scene, opts);
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(group, { binary: true, onlyVisible: true });
  if (!(result instanceof ArrayBuffer)) throw new Error('GLB export did not produce binary output');
  return result;
}

export function exportSTL(scene: Scene, opts: MeshExportOptions & { unit?: 'm' | 'mm' } = {}): ArrayBuffer {
  const group = buildExportGroup(scene, opts);
  if (opts.unit === 'mm') {
    group.scale.setScalar(1000);
    group.updateMatrixWorld(true);
  }
  const out = new STLExporter().parse(group, { binary: true }) as DataView;
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

/** OBJ + MTL with one object per element and materials per face group. */
export function exportOBJ(scene: Scene, opts: MeshExportOptions & { mtlFileName?: string } = {}): { obj: string; mtl: string } {
  const group = buildExportGroup(scene, opts);
  const mtlName = opts.mtlFileName ?? 'model.mtl';
  const lines: string[] = ['# AI 3D Studio OBJ export — units: meters, +Y up', `mtllib ${mtlName}`];
  const usedMaterials = new Map<string, THREE.Material>();
  let vOffset = 1;
  let vtOffset = 1;
  let vnOffset = 1;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_\-.[\]]+/g, '_');

  for (const elementNode of group.children) {
    lines.push(`o ${safe(elementNode.name)}`);
    elementNode.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geo = (mesh.geometry as THREE.BufferGeometry).index ? (mesh.geometry as THREE.BufferGeometry).toNonIndexed() : (mesh.geometry as THREE.BufferGeometry);
      const pos = geo.attributes.position;
      const uv = geo.attributes.uv;
      const nor = geo.attributes.normal;
      normalMatrix.getNormalMatrix(mesh.matrixWorld);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        lines.push(`v ${fmt(v.x)} ${fmt(v.y)} ${fmt(v.z)}`);
      }
      if (uv) for (let i = 0; i < uv.count; i++) lines.push(`vt ${fmt(uv.getX(i))} ${fmt(uv.getY(i))}`);
      if (nor)
        for (let i = 0; i < nor.count; i++) {
          n.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
          lines.push(`vn ${fmt(n.x)} ${fmt(n.y)} ${fmt(n.z)}`);
        }
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const groups = geo.groups.length ? geo.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
      for (const g of groups) {
        const mat = mats[g.materialIndex ?? 0] ?? mats[0];
        const name = safe(mat.name || 'default');
        usedMaterials.set(name, mat);
        lines.push(`usemtl ${name}`);
        for (let i = g.start; i + 2 < g.start + g.count && i + 2 < pos.count; i += 3) {
          const f = [i, i + 1, i + 2].map((k) => {
            const a = vOffset + k;
            const t = uv ? vtOffset + k : '';
            const nn = nor ? vnOffset + k : '';
            return `${a}/${t}/${nn}`;
          });
          lines.push(`f ${f.join(' ')}`);
        }
      }
      vOffset += pos.count;
      if (uv) vtOffset += uv.count;
      if (nor) vnOffset += nor.count;
    });
  }

  const mtl: string[] = ['# AI 3D Studio materials'];
  for (const [name, m] of usedMaterials) {
    const std = m as THREE.MeshStandardMaterial;
    const c = std.color ?? new THREE.Color(0.8, 0.8, 0.8);
    mtl.push(`newmtl ${name}`, `Kd ${fmt(c.r)} ${fmt(c.g)} ${fmt(c.b)}`, `Ka 0 0 0`, `Ks ${fmt(1 - (std.roughness ?? 0.5))} ${fmt(1 - (std.roughness ?? 0.5))} ${fmt(1 - (std.roughness ?? 0.5))}`);
    mtl.push(`Ns ${fmt((1 - (std.roughness ?? 0.5)) * 500)}`, `d ${fmt(std.transparent ? std.opacity : 1)}`, `illum 2`);
    mtl.push(`Pr ${fmt(std.roughness ?? 0.5)}`, `Pm ${fmt(std.metalness ?? 0)}`, '');
  }
  return { obj: lines.join('\n') + '\n', mtl: mtl.join('\n') + '\n' };
}

function fmt(x: number) {
  return Number.isFinite(x) ? Number(x.toFixed(5)).toString() : '0';
}
