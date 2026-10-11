/**
 * IFC4 (ISO 16739) STEP exporter.
 *
 * Supported mapping
 * - Level            → IfcBuildingStorey
 * - wall             → IfcWall, SweptSolid extrusion, Pset_WallCommon
 * - window / door    → IfcOpeningElement (IfcRelVoidsElement) + IfcWindow / IfcDoor (IfcRelFillsElement)
 * - slab             → IfcSlab, extruded IfcArbitraryClosedProfileDef
 * - column           → IfcColumn, extrusion
 * - room             → IfcSpace, extruded footprint
 * - roof             → IfcRoof (tessellated body)
 * - stair            → IfcStair (tessellated body)
 * - beam             → IfcBeam (tessellated body)
 * - furniture        → IfcFurniture (tessellated body)
 * - terrain          → IfcGeographicElement (TERRAIN)
 * - pool, skylight, box → IfcBuildingElementProxy / IfcWindow (tessellated)
 * Coordinates: IFC is Z-up; plan (x, z) maps to IFC (x, -z), height to Z.
 */
import * as THREE from 'three';
import type { Element, WallElement } from '../schema/elements';
import type { Scene } from '../schema/scene';
import { resolveMaterial } from '../materials/library';
import { buildElementObject, createBuildContext } from '../geometry/build3d';
import { computeWallExtensions, findElement, levelOf, wallFrame } from '../scene/query';
import { exportMaterialFn } from './meshExport';
import { polygonArea } from '../geometry/math2d';

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

function hash128(s: string): Uint8Array {
  const out = new Uint8Array(16);
  for (let k = 0; k < 4; k++) {
    let h = 0x811c9dc5 ^ (k * 0x9e3779b1);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    for (let b = 0; b < 4; b++) out[k * 4 + b] = (h >>> (b * 8)) & 0xff;
  }
  return out;
}

/** Deterministic 22-character IFC GlobalId derived from a key. */
export function ifcGuid(key: string): string {
  const bytes = hash128(key);
  // 128 bits → 1 char of 2 bits + 21 chars of 6 bits
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = B64[parseInt(bits.slice(0, 2), 2)];
  for (let i = 2; i < 128; i += 6) out += B64[parseInt(bits.slice(i, i + 6), 2)];
  return out;
}

function str(s: string | undefined | null): string {
  if (s === undefined || s === null) return '$';
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === "'") out += "''";
    else if (ch === '\\') out += '\\\\';
    else if (c >= 32 && c < 127) out += ch;
    else if (c <= 0xffff) out += `\\X2\\${c.toString(16).toUpperCase().padStart(4, '0')}\\X0\\`;
  }
  return `'${out}'`;
}

function real(x: number): string {
  if (!Number.isFinite(x)) return '0.';
  const r = Math.abs(x) < 1e-9 ? 0 : Number(x.toFixed(6));
  const s = String(r);
  if (s.includes('e')) return r.toExponential(6).replace('e', 'E').replace(/^(-?\d)(E)/, '$1.$2');
  return s.includes('.') ? s : `${s}.`;
}

class StepWriter {
  lines: string[] = [];
  types = new Map<string, string>();
  private n = 0;
  add(entity: string): string {
    this.n += 1;
    const id = `#${this.n}`;
    this.lines.push(`${id}=${entity};`);
    this.types.set(id, entity.slice(0, entity.indexOf('(')));
    return id;
  }
}

export interface IfcExportResult {
  content: string;
  /** Element ids exported, by IFC entity. */
  mapping: Record<string, string>;
  skipped: { id: string; reason: string }[];
}

export function exportIFC(scene: Scene, opts: { projectName?: string; projectId?: string; timestamp?: Date } = {}): IfcExportResult {
  const w = new StepWriter();
  const key = opts.projectId ?? 'project';
  const g = (k: string) => str(ifcGuid(`${key}/${k}`));
  const ts = opts.timestamp ?? new Date();
  const mapping: Record<string, string> = {};
  const skipped: IfcExportResult['skipped'] = [];

  const person = w.add(`IFCPERSON($,$,'',$,$,$,$,$)`);
  const org = w.add(`IFCORGANIZATION($,'AI 3D Studio',$,$,$)`);
  const po = w.add(`IFCPERSONANDORGANIZATION(${person},${org},$)`);
  const app = w.add(`IFCAPPLICATION(${org},'0.1','AI 3D Studio','ai3dstudio')`);
  const oh = w.add(`IFCOWNERHISTORY(${po},${app},$,.ADDED.,$,$,$,${Math.floor(ts.getTime() / 1000)})`);
  const uLen = w.add(`IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)`);
  const uArea = w.add(`IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)`);
  const uVol = w.add(`IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)`);
  const uAng = w.add(`IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)`);
  const units = w.add(`IFCUNITASSIGNMENT((${uLen},${uArea},${uVol},${uAng}))`);
  const origin = w.add(`IFCCARTESIANPOINT((0.,0.,0.))`);
  const zDir = w.add(`IFCDIRECTION((0.,0.,1.))`);
  const xDir = w.add(`IFCDIRECTION((1.,0.,0.))`);
  const wcs = w.add(`IFCAXIS2PLACEMENT3D(${origin},${zDir},${xDir})`);
  const ctx = w.add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${wcs},$)`);
  const body = w.add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
  const axisCtx = w.add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Axis','Model',*,*,*,*,${ctx},$,.GRAPH_VIEW.,$)`);
  const project = w.add(`IFCPROJECT(${g('project')},${oh},${str(opts.projectName ?? 'AI 3D Studio project')},$,$,$,$,(${ctx}),${units})`);

  const placement = (rel: string | null, x: number, y: number, z: number, dirX = 1, dirY = 0) => {
    const p = w.add(`IFCCARTESIANPOINT((${real(x)},${real(y)},${real(z)}))`);
    const ref = dirX === 1 && dirY === 0 ? xDir : w.add(`IFCDIRECTION((${real(dirX)},${real(dirY)},0.))`);
    const ax = w.add(`IFCAXIS2PLACEMENT3D(${p},${zDir},${ref})`);
    return w.add(`IFCLOCALPLACEMENT(${rel ?? '$'},${ax})`);
  };

  const sitePl = placement(null, 0, 0, 0);
  const site = w.add(`IFCSITE(${g('site')},${oh},'Site',$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bldPl = placement(sitePl, 0, 0, 0);
  const building = w.add(`IFCBUILDING(${g('building')},${oh},${str(opts.projectName ?? 'Building')},$,$,${bldPl},$,$,.ELEMENT.,$,$,$)`);
  w.add(`IFCRELAGGREGATES(${g('rel/project-site')},${oh},$,$,${project},(${site}))`);
  w.add(`IFCRELAGGREGATES(${g('rel/site-building')},${oh},$,$,${site},(${building}))`);

  const storeys = new Map<string, { id: string; pl: string; elevation: number; members: string[]; spaces: string[] }>();
  for (const lvl of [...scene.levels].sort((a, b) => a.elevation - b.elevation)) {
    const pl = placement(bldPl, 0, 0, lvl.elevation);
    const id = w.add(`IFCBUILDINGSTOREY(${g(`storey/${lvl.id}`)},${oh},${str(lvl.name)},$,$,${pl},$,$,.ELEMENT.,${real(lvl.elevation)})`);
    storeys.set(lvl.id, { id, pl, elevation: lvl.elevation, members: [], spaces: [] });
  }
  w.add(`IFCRELAGGREGATES(${g('rel/building-storeys')},${oh},$,$,${building},(${[...storeys.values()].map((s) => s.id).join(',')}))`);

  // ---- styles & materials ----
  const styleCache = new Map<string, string>();
  const materialCache = new Map<string, string>();
  const materialMembers = new Map<string, string[]>();
  const style = (ref: string) => {
    let s = styleCache.get(ref);
    if (s) return s;
    const def = resolveMaterial(ref, scene.materials);
    const c = new THREE.Color(def.color);
    const rgb = w.add(`IFCCOLOURRGB($,${real(c.r)},${real(c.g)},${real(c.b)})`);
    const shading = w.add(`IFCSURFACESTYLESHADING(${rgb},${real(def.category === 'glass' ? 0.7 : 1 - (def.opacity ?? 1))})`);
    s = w.add(`IFCSURFACESTYLE(${str(def.name)},.BOTH.,(${shading}))`);
    styleCache.set(ref, s);
    return s;
  };
  const material = (ref: string) => {
    let m = materialCache.get(ref);
    if (m) return m;
    const def = resolveMaterial(ref, scene.materials);
    m = w.add(`IFCMATERIAL(${str(def.name)},$,${str(def.category)})`);
    materialCache.set(ref, m);
    return m;
  };
  const assignMaterial = (ref: string, product: string) => {
    material(ref);
    materialMembers.set(ref, [...(materialMembers.get(ref) ?? []), product]);
  };
  const styled = (item: string, ref: string) => w.add(`IFCSTYLEDITEM(${item},(${style(ref)}),$)`);

  const psets: { product: string; name: string; props: [string, string][] }[] = [];

  // ---- geometry helpers ----
  const extrudedRect = (cx: number, cy: number, xDim: number, yDim: number, depth: number, z0 = 0, dirX = 1, dirY = 0) => {
    const p2 = w.add(`IFCCARTESIANPOINT((${real(cx)},${real(cy)}))`);
    const d2 = w.add(`IFCDIRECTION((${real(dirX)},${real(dirY)}))`);
    const ax2 = w.add(`IFCAXIS2PLACEMENT2D(${p2},${d2})`);
    const prof = w.add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${ax2},${real(xDim)},${real(yDim)})`);
    const p3 = w.add(`IFCCARTESIANPOINT((0.,0.,${real(z0)}))`);
    const pos = w.add(`IFCAXIS2PLACEMENT3D(${p3},$,$)`);
    return w.add(`IFCEXTRUDEDAREASOLID(${prof},${pos},${zDir},${real(depth)})`);
  };
  const extrudedPolygon = (pts: { x: number; y: number }[], depth: number, z0: number) => {
    const ps = [...pts, pts[0]].map((p) => w.add(`IFCCARTESIANPOINT((${real(p.x)},${real(p.y)}))`));
    const poly = w.add(`IFCPOLYLINE((${ps.join(',')}))`);
    const prof = w.add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${poly})`);
    const p3 = w.add(`IFCCARTESIANPOINT((0.,0.,${real(z0)}))`);
    const pos = w.add(`IFCAXIS2PLACEMENT3D(${p3},$,$)`);
    return w.add(`IFCEXTRUDEDAREASOLID(${prof},${pos},${zDir},${real(depth)})`);
  };
  const shape = (items: string[], type: 'SweptSolid' | 'Tessellation', extra: string[] = []) => {
    const rep = w.add(`IFCSHAPEREPRESENTATION(${body},'Body',${str(type)},(${items.join(',')}))`);
    return w.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${[rep, ...extra].join(',')}))`);
  };

  // Tessellated body from the parametric three.js geometry (world → storey-local IFC coords).
  const matFn = exportMaterialFn(scene);
  const bctx = createBuildContext(scene, matFn, false);
  const tessellate = (el: Element, elevation: number): string[] => {
    const obj = buildElementObject(el, bctx);
    if (!obj) return [];
    obj.updateMatrixWorld(true);
    const byMat = new Map<string, { pts: number[]; idx: number[] }>();
    const v = new THREE.Vector3();
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geo0 = mesh.geometry as THREE.BufferGeometry;
      const geo = geo0.index ? geo0.toNonIndexed() : geo0;
      const pos = geo.attributes.position;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const groups = geo.groups.length ? geo.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
      for (const grp of groups) {
        const mname = (mats[grp.materialIndex ?? 0] ?? mats[0]).name || 'default';
        const bucket = byMat.get(mname) ?? { pts: [], idx: [] };
        for (let i = grp.start; i + 2 < grp.start + grp.count && i + 2 < pos.count; i += 3) {
          const base = bucket.pts.length / 3;
          for (let k = 0; k < 3; k++) {
            v.fromBufferAttribute(pos, i + k).applyMatrix4(mesh.matrixWorld);
            bucket.pts.push(v.x, -v.z, v.y - elevation);
          }
          bucket.idx.push(base + 1, base + 2, base + 3);
        }
        byMat.set(mname, bucket);
      }
    });
    const items: string[] = [];
    for (const [mname, b] of byMat) {
      if (!b.idx.length) continue;
      const coords: string[] = [];
      for (let i = 0; i < b.pts.length; i += 3) coords.push(`(${real(b.pts[i])},${real(b.pts[i + 1])},${real(b.pts[i + 2])})`);
      const list = w.add(`IFCCARTESIANPOINTLIST3D((${coords.join(',')}))`);
      const tris: string[] = [];
      for (let i = 0; i < b.idx.length; i += 3) tris.push(`(${b.idx[i]},${b.idx[i + 1]},${b.idx[i + 2]})`);
      const fs = w.add(`IFCTRIANGULATEDFACESET(${list},$,$,(${tris.join(',')}),$)`);
      styled(fs, mname);
      items.push(fs);
    }
    return items;
  };

  const walls = scene.elements.filter((e): e is WallElement => e.type === 'wall');
  const ext = computeWallExtensions(walls);
  const wallPlacement = new Map<string, string>();
  const wallProduct = new Map<string, string>();

  // Walls first so that hosted openings can reference their placements.
  const ordered = [...scene.elements.filter((e) => e.type === 'wall'), ...scene.elements.filter((e) => e.type !== 'wall')];
  for (const el of ordered) {
    const lvl = levelOf(scene, el);
    const st = storeys.get(lvl.id)!;
    const name = str(el.name);
    const tagStr = str(el.id);
    let product: string | undefined;

    switch (el.type) {
      case 'wall': {
        const f = wallFrame(el);
        const e = ext.get(el.id) ?? { start: 0, end: 0 };
        const pl = placement(st.pl, el.start.x, -el.start.z, el.baseOffset, f.dir.x, -f.dir.z);
        const len = f.length + e.start + e.end;
        const solid = extrudedRect(f.length / 2 + (e.end - e.start) / 2, 0, len, el.thickness, el.height);
        styled(solid, el.material);
        const a0 = w.add(`IFCCARTESIANPOINT((0.,0.))`);
        const a1 = w.add(`IFCCARTESIANPOINT((${real(f.length)},0.))`);
        const axisLine = w.add(`IFCPOLYLINE((${a0},${a1}))`);
        const axisRep = w.add(`IFCSHAPEREPRESENTATION(${axisCtx},'Axis','Curve2D',(${axisLine}))`);
        product = w.add(`IFCWALL(${g(el.id)},${oh},${name},$,$,${pl},${shape([solid], 'SweptSolid', [axisRep])},${tagStr},.STANDARD.)`);
        wallPlacement.set(el.id, pl);
        wallProduct.set(el.id, product);
        assignMaterial(el.material, product);
        psets.push({ product, name: 'Pset_WallCommon', props: [['IsExternal', `IFCBOOLEAN(${el.exterior ? '.T.' : '.F.'})`], ['LoadBearing', `IFCBOOLEAN(${el.bim?.loadBearing ? '.T.' : '.F.'})`], ['Reference', `IFCIDENTIFIER(${str(el.id)})`]] });
        psets.push({ product, name: 'Qto_WallBaseQuantities_Simple', props: [['Length', `IFCLENGTHMEASURE(${real(f.length)})`], ['Height', `IFCLENGTHMEASURE(${real(el.height)})`], ['Width', `IFCLENGTHMEASURE(${real(el.thickness)})`]] });
        break;
      }
      case 'slab': {
        const pl = placement(st.pl, 0, 0, 0);
        const pts = el.polygon.map((p) => ({ x: p.x, y: -p.z }));
        if (polygonArea(el.polygon) > 0) pts.reverse();
        const solid = extrudedPolygon(pts, el.thickness, el.elevation - el.thickness);
        styled(solid, el.material);
        const ptype = el.role === 'foundation' ? '.BASESLAB.' : '.FLOOR.';
        product = w.add(`IFCSLAB(${g(el.id)},${oh},${name},$,$,${pl},${shape([solid], 'SweptSolid')},${tagStr},${ptype})`);
        assignMaterial(el.material, product);
        break;
      }
      case 'column': {
        const pl = placement(st.pl, el.position.x, -el.position.z, el.baseOffset, Math.cos(-el.rotation), Math.sin(-el.rotation));
        let solid: string;
        if (el.shape === 'round') {
          const p2 = w.add(`IFCCARTESIANPOINT((0.,0.))`);
          const ax2 = w.add(`IFCAXIS2PLACEMENT2D(${p2},$)`);
          const prof = w.add(`IFCCIRCLEPROFILEDEF(.AREA.,$,${ax2},${real(el.width / 2)})`);
          const pos = w.add(`IFCAXIS2PLACEMENT3D(${origin},$,$)`);
          solid = w.add(`IFCEXTRUDEDAREASOLID(${prof},${pos},${zDir},${real(el.height)})`);
        } else solid = extrudedRect(0, 0, el.width, el.depth, el.height);
        styled(solid, el.material);
        product = w.add(`IFCCOLUMN(${g(el.id)},${oh},${name},$,$,${pl},${shape([solid], 'SweptSolid')},${tagStr},.COLUMN.)`);
        assignMaterial(el.material, product);
        break;
      }
      case 'room': {
        const pl = placement(st.pl, 0, 0, 0);
        const pts = el.polygon.map((p) => ({ x: p.x, y: -p.z }));
        if (polygonArea(el.polygon) > 0) pts.reverse();
        const solid = extrudedPolygon(pts, lvl.height, 0);
        const sp = w.add(`IFCSPACE(${g(el.id)},${oh},${tagStr},$,$,${pl},${shape([solid], 'SweptSolid')},${name},.ELEMENT.,.INTERNAL.,$)`);
        st.spaces.push(sp);
        psets.push({ product: sp, name: 'Pset_SpaceCommon', props: [['Reference', `IFCIDENTIFIER(${str(el.function)})`], ['GrossPlannedArea', `IFCAREAMEASURE(${real(Math.abs(polygonArea(el.polygon)))})`]] });
        mapping[el.id] = 'IfcSpace';
        continue;
      }
      case 'window':
      case 'door': {
        const host = findElement(scene, el.hostId);
        const hostPl = host ? wallPlacement.get(host.id) : undefined;
        const hostProduct = host ? wallProduct.get(host.id) : undefined;
        if (!host || host.type !== 'wall' || !hostPl || !hostProduct) {
          skipped.push({ id: el.id, reason: 'host wall not exported' });
          continue;
        }
        const sill = el.type === 'window' ? el.sillHeight : 0;
        const opPl = placement(hostPl, el.offset, 0, sill);
        const opSolid = extrudedRect(0, 0, el.width, host.thickness + 0.1, el.height);
        const opening = w.add(`IFCOPENINGELEMENT(${g(`${el.id}/opening`)},${oh},${str(`${el.name} opening`)},$,$,${opPl},${shape([opSolid], 'SweptSolid')},$,.OPENING.)`);
        w.add(`IFCRELVOIDSELEMENT(${g(`${el.id}/voids`)},${oh},$,$,${hostProduct},${opening})`);
        const items = tessellate(el, lvl.elevation);
        const pl = placement(st.pl, 0, 0, 0);
        if (el.type === 'window') {
          const part = el.mullionsVertical > 0 ? '.DOUBLE_PANEL_VERTICAL.' : '.SINGLE_PANEL.';
          product = w.add(`IFCWINDOW(${g(el.id)},${oh},${name},$,$,${pl},${shape(items, 'Tessellation')},${tagStr},${real(el.height)},${real(el.width)},.WINDOW.,${part},$)`);
          assignMaterial(el.frameMaterial, product);
        } else {
          const opType: Record<string, string> = { hinged: el.swing === 'left' ? '.SINGLE_SWING_LEFT.' : '.SINGLE_SWING_RIGHT.', double: '.DOUBLE_DOOR_SINGLE_SWING.', sliding: '.SLIDING_TO_LEFT.', sliding_glass: '.DOUBLE_DOOR_SLIDING.', garage: '.ROLLINGUP.', opening: '.NOTDEFINED.' };
          product = w.add(`IFCDOOR(${g(el.id)},${oh},${name},$,$,${pl},${shape(items, 'Tessellation')},${tagStr},${real(el.height)},${real(el.width)},.DOOR.,${opType[el.doorType]},$)`);
          assignMaterial(el.leafMaterial, product);
        }
        w.add(`IFCRELFILLSELEMENT(${g(`${el.id}/fills`)},${oh},$,$,${opening},${product})`);
        psets.push({ product, name: el.type === 'window' ? 'Pset_WindowCommon' : 'Pset_DoorCommon', props: [['IsExternal', `IFCBOOLEAN(${host.exterior ? '.T.' : '.F.'})`], ['Reference', `IFCIDENTIFIER(${str(el.id)})`]] });
        break;
      }
      default: {
        const items = tessellate(el, lvl.elevation);
        if (!items.length) {
          skipped.push({ id: el.id, reason: 'no geometry' });
          continue;
        }
        const pl = placement(st.pl, 0, 0, 0);
        const rep = shape(items, 'Tessellation');
        const head = `${g(el.id)},${oh},${name},$,$,${pl},${rep},${tagStr}`;
        switch (el.type) {
          case 'roof': {
            const t: Record<string, string> = { flat: '.FLAT_ROOF.', gable: '.GABLE_ROOF.', hip: '.HIP_ROOF.', shed: '.SHED_ROOF.' };
            product = w.add(`IFCROOF(${head},${t[el.roofType]})`);
            assignMaterial(el.material, product);
            break;
          }
          case 'stair':
            product = w.add(`IFCSTAIR(${head},.STRAIGHT_RUN_STAIR.)`);
            assignMaterial(el.material, product);
            break;
          case 'beam':
            product = w.add(`IFCBEAM(${head},.BEAM.)`);
            assignMaterial(el.material, product);
            break;
          case 'furniture': {
            const t: Partial<Record<string, string>> = { chair: '.CHAIR.', office_chair: '.CHAIR.', dining_table: '.TABLE.', coffee_table: '.TABLE.', desk: '.DESK.', bed: '.BED.', shelf: '.SHELF.', sofa: '.SOFA.', armchair: '.CHAIR.' };
            product = w.add(`IFCFURNITURE(${head},${t[el.kind] ?? '.NOTDEFINED.'})`);
            assignMaterial(el.material, product);
            break;
          }
          case 'terrain':
            product = w.add(`IFCGEOGRAPHICELEMENT(${head},.TERRAIN.)`);
            break;
          case 'skylight':
            product = w.add(`IFCWINDOW(${head},${real(el.length)},${real(el.width)},.SKYLIGHT.,.SINGLE_PANEL.,$)`);
            break;
          default:
            product = w.add(`IFCBUILDINGELEMENTPROXY(${head},.ELEMENT.)`);
        }
      }
    }
    if (product) {
      st.members.push(product);
      mapping[el.id] = w.types.get(product) ?? 'IFCPRODUCT';
      psets.push({ product, name: 'AI3DStudio_Element', props: [['ElementId', `IFCIDENTIFIER(${str(el.id)})`], ['ElementType', `IFCLABEL(${str(el.type)})`]] });
    }
  }

  for (const [lid, st] of storeys) {
    if (st.members.length) w.add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${g(`rel/contains/${lid}`)},${oh},$,$,(${st.members.join(',')}),${st.id})`);
    if (st.spaces.length) w.add(`IFCRELAGGREGATES(${g(`rel/spaces/${lid}`)},${oh},$,$,${st.id},(${st.spaces.join(',')}))`);
  }
  for (const [ref, members] of materialMembers) {
    w.add(`IFCRELASSOCIATESMATERIAL(${g(`rel/material/${ref}`)},${oh},$,$,(${members.join(',')}),${material(ref)})`);
  }
  psets.forEach((ps, i) => {
    const props = ps.props.map(([n, v]) => w.add(`IFCPROPERTYSINGLEVALUE(${str(n)},$,${v},$)`));
    const set = w.add(`IFCPROPERTYSET(${g(`pset/${i}/${ps.name}`)},${oh},${str(ps.name)},$,(${props.join(',')}))`);
    w.add(`IFCRELDEFINESBYPROPERTIES(${g(`rel/pset/${i}`)},${oh},$,$,(${ps.product}),${set})`);
  });

  const iso = ts.toISOString().replace(/\.\d+Z$/, '');
  const header = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');",
    `FILE_NAME(${str((opts.projectName ?? 'model') + '.ifc')},'${iso}',(''),(''),'AI 3D Studio','AI 3D Studio','');`,
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
  ];
  const content = [...header, ...w.lines, 'ENDSEC;', 'END-ISO-10303-21;', ''].join('\n');
  return { content, mapping, skipped };
}
