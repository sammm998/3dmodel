'use client';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PointerLockControls } from '@react-three/drei';
import { useEditor } from '../store/editor';
import { sceneBounds } from '@/core/scene/query';
import { viewportHandles } from './registry';

type Controls = { target: THREE.Vector3; update: () => void; enabled: boolean; addEventListener: (t: string, f: () => void) => void; removeEventListener: (t: string, f: () => void) => void };

export function CameraRig() {
  const { camera, size } = useThree();
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const viewRequest = useEditor((s) => s.viewRequest);
  const walkMode = useEditor((s) => s.walkMode);
  const cameraKind = useEditor((s) => s.camera);

  useEffect(() => {
    viewportHandles.controls = controls;
  }, [controls]);

  // Track camera orientation in plan for "left/right" in natural language.
  useEffect(() => {
    if (!controls) return;
    const update = () => {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const fwd = new THREE.Vector2(dir.x, dir.z);
      if (fwd.lengthSq() < 1e-6) {
        // Top view: use camera up as forward.
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        fwd.set(up.x, up.z);
      }
      fwd.normalize();
      useEditor.getState().set({ viewVectors: { forward: { x: fwd.x, z: fwd.y }, right: { x: -fwd.y, z: fwd.x } } });
    };
    controls.addEventListener('end', update);
    update();
    return () => controls.removeEventListener('end', update);
  }, [controls, camera]);

  useEffect(() => {
    if (!viewRequest || !controls) return;
    const scene = useEditor.getState().scene;
    const b = sceneBounds(scene) ?? { min: { x: -5, y: 0, z: -5 }, max: { x: 5, y: 3, z: 5 } };
    const c = new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
    const ext = new THREE.Vector3(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
    const radius = Math.max(4, ext.length() / 2);
    const persp = camera as THREE.PerspectiveCamera;
    const fov = persp.isPerspectiveCamera ? (persp.fov * Math.PI) / 180 : Math.PI / 4;
    const dist = (radius / Math.sin(fov / 2)) * 0.95;
    const dirs: Record<string, THREE.Vector3> = {
      iso: new THREE.Vector3(0.75, 0.62, 1).normalize(),
      fit: new THREE.Vector3(0.75, 0.62, 1).normalize(),
      top: new THREE.Vector3(0, 1, 0.0001).normalize(),
      front: new THREE.Vector3(0, 0.12, 1).normalize(),
      back: new THREE.Vector3(0, 0.12, -1).normalize(),
      left: new THREE.Vector3(-1, 0.12, 0).normalize(),
      right: new THREE.Vector3(1, 0.12, 0).normalize(),
    };
    const d = dirs[viewRequest.preset] ?? dirs.iso;
    camera.position.copy(c.clone().add(d.multiplyScalar(dist)));
    camera.up.set(0, 1, 0);
    camera.lookAt(c);
    const ortho = camera as THREE.OrthographicCamera;
    if (ortho.isOrthographicCamera) {
      const span = Math.max(ext.x, ext.z, ext.y) * 1.25 + 2;
      ortho.zoom = Math.min(size.width, size.height) / span;
      ortho.near = -1000;
      ortho.far = 5000;
      ortho.updateProjectionMatrix();
    }
    controls.target.copy(c);
    controls.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewRequest, controls, cameraKind]);

  return walkMode ? <WalkControls /> : <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI * 0.495} minDistance={0.3} maxDistance={2000} screenSpacePanning />;
}

function WalkControls() {
  const { camera } = useThree();
  const keys = useRef(new Set<string>());
  const ready = useRef(false);
  useEffect(() => {
    const st = useEditor.getState();
    const lvl = st.scene.levels.find((l) => l.id === st.activeLevelId) ?? st.scene.levels[0];
    const ctr = viewportHandles.controls?.target ?? new THREE.Vector3();
    camera.position.set(ctr.x, lvl.elevation + 1.65, ctr.z + 0.01);
    camera.lookAt(ctr.x, lvl.elevation + 1.65, ctr.z - 5);
    ready.current = true;
    const down = (e: KeyboardEvent) => keys.current.add(e.code);
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [camera]);
  useFrame((_, dt) => {
    if (!ready.current) return;
    const k = keys.current;
    const speed = (k.has('ShiftLeft') ? 4 : 1.6) * dt;
    const f = new THREE.Vector3();
    camera.getWorldDirection(f);
    f.y = 0;
    f.normalize();
    const r = new THREE.Vector3(-f.z, 0, f.x);
    if (k.has('KeyW') || k.has('ArrowUp')) camera.position.addScaledVector(f, speed);
    if (k.has('KeyS') || k.has('ArrowDown')) camera.position.addScaledVector(f, -speed);
    if (k.has('KeyA') || k.has('ArrowLeft')) camera.position.addScaledVector(r, -speed);
    if (k.has('KeyD') || k.has('ArrowRight')) camera.position.addScaledVector(r, speed);
  });
  return <PointerLockControls makeDefault onUnlock={() => useEditor.getState().set({ walkMode: false })} />;
}
