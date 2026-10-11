'use client';
import { memo, useEffect, useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { useEditor } from '../store/editor';
import { buildElementObject, createBuildContext, type BuildContext } from '@/core/geometry/build3d';
import type { Element } from '@/core/schema/elements';
import type { Scene } from '@/core/schema/scene';
import { levelOf } from '@/core/scene/query';
import { MaterialManager } from './materials';
import { objectRegistry } from './registry';

function disposeObject(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) m.geometry?.dispose();
  });
}

/** Key capturing everything an element's geometry depends on. */
function dependencyKey(scene: Scene, el: Element, ctx: BuildContext): string {
  const lvl = levelOf(scene, el);
  let deps = '';
  switch (el.type) {
    case 'wall': {
      const ext = ctx.wallExtensions.get(el.id);
      const ops = scene.elements.filter((e) => (e.type === 'window' || e.type === 'door') && e.hostId === el.id);
      deps = JSON.stringify(ops) + JSON.stringify(ext);
      break;
    }
    case 'window':
    case 'door':
    case 'skylight': {
      const host = scene.elements.find((e) => e.id === el.hostId);
      deps = JSON.stringify(host) + (host ? levelOf(scene, host).elevation : '');
      break;
    }
    case 'terrain':
      deps = JSON.stringify(scene.elements.filter((e) => e.type === 'pool'));
      break;
  }
  return `${JSON.stringify(el)}|${lvl.elevation}|${deps}`;
}

const ElementNode = memo(function ElementNode({ el, ctx, depKey, onClick, onOver, onOut }: {
  el: Element;
  ctx: BuildContext;
  depKey: string;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
  onOver: (e: ThreeEvent<PointerEvent>) => void;
  onOut: (e: ThreeEvent<PointerEvent>) => void;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const obj = useMemo(() => buildElementObject(el, ctx), [depKey, ctx.material]);
  useLayoutEffect(() => {
    if (!obj) return;
    objectRegistry.set(el.id, obj);
    return () => {
      if (objectRegistry.get(el.id) === obj) objectRegistry.delete(el.id);
    };
  }, [obj, el.id]);
  useEffect(() => () => {
    if (obj) disposeObject(obj);
  }, [obj]);
  if (!obj) return null;
  return <primitive object={obj} onClick={onClick} onPointerOver={onOver} onPointerOut={onOut} />;
});

export function SceneObjects({ materials, interactive = true }: { materials: MaterialManager; interactive?: boolean }) {
  const scene = useEditor((s) => s.scene);
  const hiddenTypes = useEditor((s) => s.hiddenTypes);
  const hideRoofs = useEditor((s) => s.hideRoofs);
  const levelFilter = useEditor((s) => s.levelFilter);
  const activeLevelId = useEditor((s) => s.activeLevelId);
  const viewMode = useEditor((s) => s.viewMode);
  const showLabels = useEditor((s) => s.showLabels);

  const ctx = useMemo(() => createBuildContext(scene, materials.get, viewMode === 'modeling' && showLabels), [scene, materials, viewMode, showLabels]);

  const activeElevation = scene.levels.find((l) => l.id === activeLevelId)?.elevation ?? 0;
  const visible = useMemo(
    () =>
      scene.elements.filter((el) => {
        if (el.hidden || hiddenTypes.includes(el.type)) return false;
        if (hideRoofs && (el.type === 'roof' || el.type === 'skylight')) return false;
        if (levelFilter !== 'all' && el.type !== 'terrain') {
          const lvl = levelOf(scene, el);
          if (levelFilter === 'active' && lvl.id !== activeLevelId) return false;
          if (levelFilter === 'below' && lvl.elevation > activeElevation + 1e-6) return false;
        }
        return true;
      }),
    [scene, hiddenTypes, hideRoofs, levelFilter, activeLevelId, activeElevation],
  );

  const handlers = useMemo(() => {
    const idOf = (e: { eventObject: THREE.Object3D }) => e.eventObject.userData.elementId as string | undefined;
    return {
      onClick: (e: ThreeEvent<MouseEvent>) => {
        if (!interactive) return;
        const st = useEditor.getState();
        if (e.delta > 5) return;
        e.stopPropagation();
        if (st.tool === 'measure') {
          addMeasurePoint(e.point, e);
          return;
        }
        const id = idOf(e);
        if (id) st.select(id, e.nativeEvent.shiftKey || e.nativeEvent.metaKey || e.nativeEvent.ctrlKey);
      },
      onOver: (e: ThreeEvent<PointerEvent>) => {
        if (!interactive) return;
        e.stopPropagation();
        const id = idOf(e);
        if (id) useEditor.getState().setHover(id);
        document.body.style.cursor = useEditor.getState().tool === 'measure' ? 'crosshair' : 'pointer';
      },
      onOut: (e: ThreeEvent<PointerEvent>) => {
        if (!interactive) return;
        const id = idOf(e);
        if (useEditor.getState().hoverId === id) useEditor.getState().setHover(null);
        document.body.style.cursor = '';
      },
    };
  }, [interactive]);

  return (
    <group>
      {visible.map((el) => (
        <ElementNode key={el.id} el={el} ctx={ctx} depKey={dependencyKey(scene, el, ctx)} onClick={handlers.onClick} onOver={handlers.onOver} onOut={handlers.onOut} />
      ))}
    </group>
  );
}

/** Adds a measure point, snapping to the nearest vertex of the hit face within 12 cm. */
export function addMeasurePoint(point: THREE.Vector3, e?: ThreeEvent<MouseEvent>) {
  const p = point.clone();
  const mesh = e?.object as THREE.Mesh | undefined;
  if (mesh?.isMesh && e?.face) {
    const pos = (mesh.geometry as THREE.BufferGeometry).attributes.position;
    let best: THREE.Vector3 | null = null;
    let bestD = 0.12;
    for (const idx of [e.face.a, e.face.b, e.face.c]) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, idx).applyMatrix4(mesh.matrixWorld);
      const d = v.distanceTo(point);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    if (best) p.copy(best);
  }
  const st = useEditor.getState();
  const pts = st.measure.points.length >= 2 ? [] : st.measure.points;
  st.set({ measure: { points: [...pts, { x: p.x, y: p.y, z: p.z }] } });
}
