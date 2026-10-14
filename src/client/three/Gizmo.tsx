'use client';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { TransformControls } from '@react-three/drei';
import { useEditor } from '../store/editor';
import { objectRegistry } from './registry';
import { elementAnchor, findElement, wallFrame } from '@/core/scene/query';
import type { Element } from '@/core/schema/elements';
import type { OperationInput } from '@/core/ops/operations';
import { round } from '@/core/geometry/math2d';
import { moveRoomOps, roomParts } from '@/core/scene/rooms';

/** Orientation of the gizmo frame for an element (walls/openings align with the wall). */
function frameAngle(scene: ReturnType<typeof useEditor.getState>['scene'], el: Element): number {
  if (el.type === 'wall') return wallFrame(el).angle;
  if (el.type === 'window' || el.type === 'door') {
    const host = findElement(scene, el.hostId);
    return host && host.type === 'wall' ? wallFrame(host).angle : 0;
  }
  if ('rotation' in el && typeof el.rotation === 'number') return el.rotation;
  return 0;
}

/** Maps gizmo scale factors (local x, y, z) to element dimensions. */
function scaleOp(el: Element, s: THREE.Vector3): Record<string, number> {
  const f: Record<string, number> = {};
  const put = (k: string, v: number) => {
    if (Math.abs(v - 1) > 1e-3) f[k] = round(v, 4);
  };
  switch (el.type) {
    case 'wall':
      put('length', s.x);
      put('height', s.y);
      put('thickness', s.z);
      break;
    case 'window':
    case 'door':
    case 'skylight':
      put('width', s.x);
      put(el.type === 'skylight' ? 'length' : 'height', el.type === 'skylight' ? s.z : s.y);
      break;
    case 'furniture':
    case 'box':
    case 'column':
      put('width', s.x);
      put('height', s.y);
      put('depth', s.z);
      break;
    case 'roof':
    case 'terrain':
      put('width', s.x);
      put('depth', s.z);
      break;
    case 'pool':
      put('width', s.x);
      put('length', s.z);
      break;
    case 'stair':
      put('width', s.x);
      put('totalRise', s.y);
      put('totalRun', s.z);
      break;
    case 'slab':
      put('thickness', s.y);
      break;
  }
  return f;
}

export function TransformGizmo() {
  const tool = useEditor((s) => s.tool);
  const selection = useEditor((s) => s.selection);
  const scene = useEditor((s) => s.scene);
  const snap = useEditor((s) => s.snap);
  const gridSize = useEditor((s) => s.gridSize);
  const viewMode = useEditor((s) => s.viewMode);
  const readOnly = useEditor((s) => s.readOnly);
  const proxy = useMemo(() => new THREE.Object3D(), []);
  const start = useRef<{ pos: THREE.Vector3; quat: THREE.Quaternion; objPos: THREE.Vector3; objQuat: THREE.Quaternion; objScale: THREE.Vector3; carried: { obj: THREE.Object3D; pos: THREE.Vector3 }[] } | null>(null);

  const el = selection.length === 1 ? findElement(scene, selection[0]) : undefined;
  // Rooms only move (as a whole, with their contents).
  const active = !readOnly && viewMode !== 'presentation' && (tool === 'move' || tool === 'rotate' || tool === 'scale') && el && !el.locked && (el.type !== 'room' || tool === 'move');

  useEffect(() => {
    if (!el) return;
    const a = elementAnchor(scene, el);
    proxy.position.set(a.x, a.y, a.z);
    proxy.rotation.set(0, frameAngle(scene, el), 0);
    proxy.scale.set(1, 1, 1);
    proxy.updateMatrixWorld();
  }, [el, scene, proxy, tool]);

  if (!active || !el) return null;
  const hosted = el.type === 'window' || el.type === 'door';
  const flat = el.type === 'room';
  const mode = tool === 'move' ? 'translate' : tool === 'rotate' ? 'rotate' : 'scale';
  if (mode === 'rotate' && (hosted || el.type === 'skylight')) return null;

  const onDown = () => {
    const obj = objectRegistry.get(el.id);
    // A room carries its contents along in the preview (walls etc. only when free-standing).
    const carried: { obj: THREE.Object3D; pos: THREE.Vector3 }[] = [];
    if (el.type === 'room') {
      const parts = roomParts(scene, el);
      const ids = [...parts.furniture.map((f) => f.id), ...(parts.freeStanding ? [...parts.walls, ...parts.openings, ...parts.slabs].map((e) => e.id) : [])];
      for (const id of ids) {
        const o = objectRegistry.get(id);
        if (o) carried.push({ obj: o, pos: o.position.clone() });
      }
    }
    start.current = {
      carried,
      pos: proxy.position.clone(),
      quat: proxy.quaternion.clone(),
      objPos: obj?.position.clone() ?? new THREE.Vector3(),
      objQuat: obj?.quaternion.clone() ?? new THREE.Quaternion(),
      objScale: obj?.scale.clone() ?? new THREE.Vector3(1, 1, 1),
    };
  };

  const onChange = () => {
    const s0 = start.current;
    const obj = objectRegistry.get(el.id);
    if (!s0 || !obj) return;
    // Live preview by transforming the rendered object about the anchor.
    if (mode === 'translate') {
      const d = proxy.position.clone().sub(s0.pos);
      obj.position.copy(s0.objPos).add(d);
      for (const c of s0.carried) {
        c.obj.position.copy(c.pos).add(d);
        c.obj.updateMatrixWorld();
      }
    } else if (mode === 'rotate') {
      const dq = proxy.quaternion.clone().multiply(s0.quat.clone().invert());
      obj.position.copy(s0.objPos.clone().sub(s0.pos).applyQuaternion(dq).add(s0.pos));
      obj.quaternion.copy(dq.clone().multiply(s0.objQuat));
    } else {
      const sc = proxy.scale;
      // Approximate preview in the element frame.
      obj.scale.set(s0.objScale.x * sc.x, s0.objScale.y * sc.y, s0.objScale.z * sc.z);
    }
    obj.updateMatrixWorld();
  };

  const onUp = () => {
    const s0 = start.current;
    start.current = null;
    if (!s0) return;
    const obj = objectRegistry.get(el.id);
    const reset = () => {
      for (const c of s0.carried) {
        c.obj.position.copy(c.pos);
        c.obj.updateMatrixWorld();
      }
      if (!obj) return;
      obj.position.copy(s0.objPos);
      obj.quaternion.copy(s0.objQuat);
      obj.scale.copy(s0.objScale);
      obj.updateMatrixWorld();
    };
    let op: OperationInput | null = null;
    let label = '';
    if (mode === 'translate') {
      const d = proxy.position.clone().sub(s0.pos);
      if (d.length() < 1e-4) return reset();
      if (el.type === 'room') {
        const { ops, wholeRoom } = moveRoomOps(useEditor.getState().scene, el.id, d.x, d.z);
        reset();
        if (!ops.length) return;
        const r = useEditor.getState().apply(ops, `Move ${el.name}`);
        if (!r.ok) useEditor.getState().notify(r.errors[0] ?? 'Change rejected', 'danger');
        else if (!wholeRoom) useEditor.getState().notify('Moved the furniture. To resize the room itself, drag its walls.', 'info');
        else if (r.warnings.length) useEditor.getState().notify(r.warnings[0], 'warn');
        return;
      }
      op = { op: 'modify', id: el.id, translate: { x: round(d.x, 4), y: round(d.y, 4), z: round(d.z, 4) } };
      label = `Move ${el.name}`;
    } else if (mode === 'rotate') {
      const e0 = new THREE.Euler().setFromQuaternion(s0.quat, 'YXZ').y;
      const e1 = new THREE.Euler().setFromQuaternion(proxy.quaternion, 'YXZ').y;
      const deg = round(((e1 - e0) * 180) / Math.PI, 3);
      if (Math.abs(deg) < 0.01) return reset();
      op = { op: 'modify', id: el.id, rotateDeg: deg };
      label = `Rotate ${el.name}`;
    } else {
      const f = scaleOp(el, proxy.scale);
      if (!Object.keys(f).length) return reset();
      op = { op: 'modify', id: el.id, scale: f, anchor: 'center' };
      label = `Resize ${el.name}`;
    }
    const r = useEditor.getState().apply([op], label, { scopeIds: [el.id] });
    if (!r.ok) {
      reset();
      useEditor.getState().notify(r.errors[0] ?? 'Change rejected', 'danger');
    } else if (r.warnings.length) useEditor.getState().notify(r.warnings[0], 'warn');
  };

  return (
    <>
    <primitive object={proxy} />
    <TransformControls
      object={proxy}
      mode={mode}
      space="local"
      size={0.85}
      translationSnap={snap ? gridSize : null}
      rotationSnap={snap ? THREE.MathUtils.degToRad(15) : null}
      scaleSnap={snap ? 0.05 : null}
      showX={mode !== 'rotate'}
      showZ={mode !== 'rotate' && !hosted}
      showY={!flat}
      onMouseDown={onDown}
      onObjectChange={onChange}
      onMouseUp={onUp}
    />
    </>
  );
}
