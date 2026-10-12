'use client';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEditor } from '../store/editor';
import { sceneBounds } from '@/core/scene/query';
import { viewportHandles } from './registry';
import { WalkControls } from './Walk';

type Controls = { target: THREE.Vector3; update: () => void; enabled: boolean; addEventListener: (t: string, f: () => void) => void; removeEventListener: (t: string, f: () => void) => void };

interface Tween {
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  fromZoom: number;
  toZoom: number;
  t0: number;
  dur: number;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function CameraRig() {
  const { camera, size } = useThree();
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const viewRequest = useEditor((s) => s.viewRequest);
  const walkMode = useEditor((s) => s.walkMode);
  const cameraKind = useEditor((s) => s.camera);
  const tween = useRef<Tween | null>(null);
  const firstView = useRef(true);

  useEffect(() => {
    // Only orbit controls have a target; walk controls must not replace the handle.
    if (controls && 'target' in controls) {
      viewportHandles.controls = controls;
      const exit = viewportHandles.walkExit;
      if (exit) {
        viewportHandles.walkExit = undefined;
        camera.position.copy(exit.position);
        controls.target.copy(exit.target);
        controls.update();
      }
    }
  }, [controls, camera]);

  // Track camera orientation in plan for "left/right" in natural language.
  useEffect(() => {
    if (!controls || !('target' in controls)) return;
    const update = () => {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const fwd = new THREE.Vector2(dir.x, dir.z);
      if (fwd.lengthSq() < 1e-6) {
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
    if (!viewRequest || !controls || !('target' in controls) || walkMode) return;
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
    const toPos = c.clone().add(d.multiplyScalar(dist));
    const ortho = camera as THREE.OrthographicCamera;
    let toZoom = ortho.isOrthographicCamera ? ortho.zoom : 1;
    if (ortho.isOrthographicCamera) {
      const span = Math.max(ext.x, ext.z, ext.y) * 1.25 + 2;
      toZoom = Math.min(size.width, size.height) / span;
      ortho.near = -1000;
      ortho.far = 2500;
    }
    camera.up.set(0, 1, 0);
    if (firstView.current) {
      // Opening a project: jump straight to the view.
      firstView.current = false;
      camera.position.copy(toPos);
      if (ortho.isOrthographicCamera) ortho.zoom = toZoom;
      camera.updateProjectionMatrix();
      controls.target.copy(c);
      controls.update();
      return;
    }
    tween.current = {
      fromPos: camera.position.clone(),
      toPos,
      fromTarget: controls.target.clone(),
      toTarget: c,
      fromZoom: ortho.isOrthographicCamera ? ortho.zoom : 1,
      toZoom,
      t0: performance.now(),
      dur: 650,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewRequest, controls, cameraKind]);

  // Smooth camera transitions between views.
  useFrame(() => {
    const tw = tween.current;
    if (!tw || !controls || !('target' in controls)) return;
    const t = Math.min(1, (performance.now() - tw.t0) / tw.dur);
    const e = ease(t);
    camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
    controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
    const ortho = camera as THREE.OrthographicCamera;
    if (ortho.isOrthographicCamera) {
      ortho.zoom = tw.fromZoom + (tw.toZoom - tw.fromZoom) * e;
      ortho.updateProjectionMatrix();
    }
    controls.update();
    if (t >= 1) tween.current = null;
  });

  return walkMode ? (
    <WalkControls />
  ) : (
    <OrbitControls makeDefault enableDamping dampingFactor={0.08} rotateSpeed={0.8} zoomSpeed={0.9} maxPolarAngle={Math.PI * 0.495} minDistance={0.3} maxDistance={1500} screenSpacePanning />
  );
}
