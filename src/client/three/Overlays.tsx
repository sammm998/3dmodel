'use client';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { Html, Line } from '@react-three/drei';
import { useEditor } from '../store/editor';
import { objectRegistry } from './registry';
import { describeElement, elementAnchor, findElement, elementsOfType, levelOf } from '@/core/scene/query';
import { formatArea, formatLength } from '@/core/schema/units';
import { polygonArea, polygonCentroid } from '@/core/geometry/math2d';

const ACCENT = new THREE.Color('#f0c97f');

function buildEdges(obj: THREE.Object3D, color: THREE.Color, opacity: number): THREE.Group {
  const g = new THREE.Group();
  obj.updateMatrixWorld(true);
  const front = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: true });
  const back = new THREE.LineBasicMaterial({ color, transparent: true, opacity: opacity * 0.35, depthTest: false });
  obj.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || m.userData.helper) return;
    const edges = new THREE.EdgesGeometry(m.geometry as THREE.BufferGeometry, 25);
    for (const mat of [back, front]) {
      const l = new THREE.LineSegments(edges, mat);
      l.matrixAutoUpdate = false;
      l.matrix.copy(m.matrixWorld);
      l.renderOrder = mat === back ? 998 : 999;
      l.raycast = () => {};
      g.add(l);
    }
  });
  return g;
}

/** Outlines selected (and hovered) elements using their real geometry edges. */
export function SelectionOutlines() {
  const selection = useEditor((s) => s.selection);
  const hoverId = useEditor((s) => s.hoverId);
  const revision = useEditor((s) => s.revision);
  const viewMode = useEditor((s) => s.viewMode);
  const [tick, setTick] = useState(0);
  // Objects are registered after render; re-run once registry is populated.
  useEffect(() => {
    const t = setTimeout(() => setTick((x) => x + 1), 30);
    return () => clearTimeout(t);
  }, [revision, selection]);

  const group = useMemo(() => {
    const g = new THREE.Group();
    if (viewMode === 'presentation') return g;
    for (const id of selection) {
      const obj = objectRegistry.get(id);
      if (obj) g.add(buildEdges(obj, ACCENT, 1));
    }
    if (hoverId && !selection.includes(hoverId)) {
      const obj = objectRegistry.get(hoverId);
      if (obj) g.add(buildEdges(obj, new THREE.Color('#9fb8d9'), 0.55));
    }
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, hoverId, revision, tick, viewMode]);

  useEffect(
    () => () => {
      group.traverse((c) => {
        const l = c as THREE.LineSegments;
        if (l.isLineSegments) l.geometry.dispose();
      });
    },
    [group],
  );
  return <primitive object={group} />;
}

function Label({ position, children, accent }: { position: [number, number, number]; children: React.ReactNode; accent?: boolean }) {
  return (
    <Html position={position} center zIndexRange={[20, 0]} className="label3d">
      <div
        className={
          accent
            ? 'rounded-md border border-accent/40 bg-ink-900/90 px-2 py-1 text-[11px] text-ink-100 shadow-panel backdrop-blur'
            : 'rounded border border-white/10 bg-ink-900/75 px-1.5 py-0.5 text-[10.5px] text-ink-200 backdrop-blur'
        }
      >
        {children}
      </div>
    </Html>
  );
}

/** Name and key dimensions of the selection. */
export function SelectionLabels() {
  const selection = useEditor((s) => s.selection);
  const scene = useEditor((s) => s.scene);
  const viewMode = useEditor((s) => s.viewMode);
  const units = scene.settings.displayUnits;
  if (viewMode === 'presentation' || selection.length !== 1) return null;
  const el = findElement(scene, selection[0]);
  if (!el) return null;
  const d = describeElement(scene, el);
  const a = elementAnchor(scene, el);
  const lvl = levelOf(scene, el);
  const top =
    el.type === 'wall' ? el.height + el.baseOffset : el.type === 'window' || el.type === 'door' ? el.height : el.type === 'furniture' || el.type === 'box' || el.type === 'column' ? el.height : el.type === 'roof' ? 1.5 : 0.3;
  const dims = Object.entries(d.dimensions)
    .filter(([k]) => !['offset'].includes(k))
    .slice(0, 4)
    .map(([k, v]) => `${k} ${k === 'area' ? formatArea(v, units) : k === 'pitchDeg' ? `${v}°` : k === 'steps' ? v : formatLength(v, units)}`);
  void lvl;
  return (
    <Label position={[a.x, a.y + top + 0.35, a.z]} accent>
      <div className="font-medium text-accent">{el.name}</div>
      <div className="font-mono text-[10px] text-ink-300">{el.id}</div>
      <div className="mt-0.5 text-[10.5px] text-ink-200">{dims.join(' · ')}</div>
    </Label>
  );
}

/** Room names and areas (modelling mode). */
export function RoomLabels() {
  const scene = useEditor((s) => s.scene);
  const viewMode = useEditor((s) => s.viewMode);
  const showLabels = useEditor((s) => s.showLabels);
  const activeLevelId = useEditor((s) => s.activeLevelId);
  const levelFilter = useEditor((s) => s.levelFilter);
  if (viewMode !== 'modeling' || !showLabels) return null;
  const rooms = elementsOfType(scene, 'room').filter((r) => levelFilter === 'all' ? (r.levelId ?? scene.levels[0].id) === activeLevelId || scene.levels.length === 1 : (r.levelId ?? scene.levels[0].id) === activeLevelId);
  return (
    <>
      {rooms.map((r) => {
        const c = polygonCentroid(r.polygon);
        const y = levelOf(scene, r).elevation + 0.05;
        return (
          <Label key={r.id} position={[c.x, y, c.z]}>
            <span className="font-medium text-ink-100">{r.name}</span> <span className="text-ink-300">{formatArea(Math.abs(polygonArea(r.polygon)), scene.settings.displayUnits)}</span>
          </Label>
        );
      })}
    </>
  );
}

/** Two-point measuring tool. */
export function MeasureOverlay() {
  const points = useEditor((s) => s.measure.points);
  const tool = useEditor((s) => s.tool);
  const units = useEditor((s) => s.scene.settings.displayUnits);
  if (tool !== 'measure' && points.length < 2) return null;
  const v = points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
  const dist = v.length === 2 ? v[0].distanceTo(v[1]) : 0;
  const dy = v.length === 2 ? Math.abs(v[1].y - v[0].y) : 0;
  const dh = v.length === 2 ? Math.hypot(v[1].x - v[0].x, v[1].z - v[0].z) : 0;
  return (
    <group>
      {v.map((p, i) => (
        <mesh key={i} position={p} raycast={() => {}}>
          <sphereGeometry args={[0.045, 16, 16]} />
          <meshBasicMaterial color="#f0c97f" depthTest={false} />
        </mesh>
      ))}
      {v.length === 2 ? (
        <>
          <Line points={[v[0], v[1]]} color="#f0c97f" lineWidth={2} depthTest={false} dashed={false} />
          <Label position={[(v[0].x + v[1].x) / 2, (v[0].y + v[1].y) / 2 + 0.15, (v[0].z + v[1].z) / 2]} accent>
            <span className="font-mono text-[12px] text-accent">{formatLength(dist, units)}</span>
            <span className="ml-2 text-[10px] text-ink-300">
              horiz {formatLength(dh, units)} · vert {formatLength(dy, units)}
            </span>
          </Label>
        </>
      ) : null}
    </group>
  );
}

/** Invisible ground plane so clicks on empty space can deselect or measure. */
export function GroundCatcher() {
  const scene = useEditor((s) => s.scene);
  const activeLevelId = useEditor((s) => s.activeLevelId);
  const y = scene.levels.find((l) => l.id === activeLevelId)?.elevation ?? 0;
  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position={[0, y - 0.001, 0]}
      onClick={(e) => {
        if (e.delta > 5) return;
        const st = useEditor.getState();
        e.stopPropagation();
        if (st.tool === 'measure') {
          st.set({ measure: { points: [...(st.measure.points.length >= 2 ? [] : st.measure.points), { x: e.point.x, y: e.point.y, z: e.point.z }] } });
        } else if (!e.nativeEvent.shiftKey) st.select(null);
      }}
    >
      <planeGeometry args={[4000, 4000]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}
