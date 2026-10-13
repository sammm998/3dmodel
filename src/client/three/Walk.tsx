'use client';
/**
 * First-person "walk inside the model" mode.
 *
 * - Pointer-lock mouse look, WASD / arrow keys, Shift to run, Space to jump.
 * - Collision against walls, glazing, columns and furniture (doors are passable).
 * - Gravity onto floors, stairs, terrain and roofs; steps up to 45 cm, so
 *   stairs can be climbed. Q/E (or PageUp/PageDown) jump between storeys.
 * - F toggles free flight (no gravity or collision).
 * Spawns just inside the main entrance, facing into the building.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls } from '@react-three/drei';
import { useEditor } from '../store/editor';
import { objectRegistry, viewportHandles } from './registry';
import { elementsOfType, findElement, levelOf, pointAlongWall, sceneBounds, wallFrame } from '@/core/scene/query';
import { polygonArea, polygonCentroid } from '@/core/geometry/math2d';
import type { Scene } from '@/core/schema/scene';
import type { ElementType } from '@/core/schema/elements';
import { WALK, WalkPhysics, type Collider } from '@/core/geometry/walkPhysics';
import { animateDoors, collectDoorParts, resetDoors, type DoorPart } from '@/core/geometry/doorMotion';

const EYE = WALK.eye;

const BLOCKING: ElementType[] = ['wall', 'window', 'column', 'furniture', 'box'];
const GROUND: ElementType[] = ['slab', 'stair', 'terrain', 'pool', 'roof', 'box'];
const PASSABLE_FURNITURE = new Set(['rug', 'pendant_lamp']);

/** Spawn point just inside the main entrance (or in the largest room). */
export function walkSpawn(scene: Scene): { feet: THREE.Vector3; look: THREE.Vector3 } {
  const b = sceneBounds(scene);
  const center = b ? new THREE.Vector3((b.min.x + b.max.x) / 2, 0, (b.min.z + b.max.z) / 2) : new THREE.Vector3();
  const base = scene.levels[0]?.elevation ?? 0;
  const doors = elementsOfType(scene, 'door').filter((d) => {
    const host = findElement(scene, d.hostId);
    return host?.type === 'wall' && levelOf(scene, host).id === scene.levels[0].id;
  });
  const door = doors.find((d) => /main|entr|entré|ytter/i.test(d.name)) ?? doors.find((d) => (findElement(scene, d.hostId) as { exterior?: boolean })?.exterior) ?? doors[0];
  if (door) {
    const host = findElement(scene, door.hostId);
    if (host?.type === 'wall') {
      const p = pointAlongWall(host, door.offset);
      const n = wallFrame(host).normal;
      const pos = new THREE.Vector3(p.x, base, p.z);
      // Inward = the side of the wall facing the building centre.
      let inward = new THREE.Vector3(n.x, 0, n.z);
      if (inward.dot(center.clone().sub(pos)) < 0) inward.negate();
      inward = inward.normalize();
      return { feet: pos.clone().add(inward.clone().multiplyScalar(1.1)), look: inward };
    }
  }
  const rooms = elementsOfType(scene, 'room').filter((r) => (r.levelId ?? scene.levels[0].id) === scene.levels[0].id);
  const big = rooms.sort((a, b2) => Math.abs(polygonArea(b2.polygon)) - Math.abs(polygonArea(a.polygon)))[0];
  if (big) {
    const c = polygonCentroid(big.polygon);
    return { feet: new THREE.Vector3(c.x, base, c.z), look: new THREE.Vector3(0, 0, -1) };
  }
  return { feet: new THREE.Vector3(center.x, base, center.z + (b ? b.max.z - center.z + 4 : 6)), look: new THREE.Vector3(0, 0, -1) };
}

export function WalkControls() {
  const { camera, gl } = useThree();
  const revision = useEditor((s) => s.revision);
  const keys = useRef(new Set<string>());
  const physics = useMemo(() => new WalkPhysics(), []);
  const feet = useRef(physics.feet);
  const fly = useRef(false);
  const lastLevel = useRef('');
  const settled = useRef(false);
  const doors = useRef<DoorPart[]>([]);

  // Colliders from the rendered element objects.
  useEffect(() => {
    const t = setTimeout(() => {
      const scene = useEditor.getState().scene;
      const block: Collider[] = [];
      const ground: Collider[] = [];
      const solid: Collider[] = [];
      resetDoors(doors.current);
      doors.current = [];
      for (const el of scene.elements) {
        const obj = objectRegistry.get(el.id);
        if (!obj || el.hidden) continue;
        const c = WalkPhysics.collider(obj);
        if (!c) continue;
        if (el.type !== 'room') {
          // Door leaves swing up to a leaf width out of the wall: widen their bounds.
          solid.push(el.type === 'door' ? { obj, box: c.box.clone().expandByScalar(1.1) } : c);
        }
        if (el.type === 'door') doors.current.push(...collectDoorParts(obj, c.box));
        const passable = el.type === 'furniture' && (PASSABLE_FURNITURE.has(el.kind) || el.height < 0.25);
        if (BLOCKING.includes(el.type) && !passable) block.push(c);
        if (GROUND.includes(el.type)) ground.push(c);
      }
      physics.block = block;
      physics.ground = ground;
      physics.solid = solid;
      // Never start inside or right against geometry (e.g. a stair next to the door).
      if (!settled.current && !fly.current) {
        settled.current = true;
        if (physics.settle()) {
          camera.position.x = feet.current.x;
          camera.position.z = feet.current.z;
        }
      }
    }, 60);
    return () => clearTimeout(t);
  }, [revision, physics, camera]);

  // Spawn, wider field of view, input handling.
  useEffect(() => {
    const st = useEditor.getState();
    const { feet: f, look } = walkSpawn(st.scene);
    feet.current.copy(f);
    physics.vy = 0;
    camera.position.set(f.x, f.y + EYE, f.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(f.x + look.x * 5, f.y + EYE, f.z + look.z * 5);
    const persp = camera as THREE.PerspectiveCamera;
    const prevFov = persp.fov;
    const prevNear = camera.near;
    if (persp.isPerspectiveCamera) {
      persp.fov = 70;
      // The eye keeps WALK.eyeClearance (15 cm) from every surface, so a 5 cm near
      // plane can never slice through geometry.
      persp.near = 0.05;
      persp.updateProjectionMatrix();
    }
    const changeLevel = (dir: 1 | -1) => {
      const levels = [...useEditor.getState().scene.levels].sort((a, b) => a.elevation - b.elevation);
      const cur = levels.findIndex((l, i) => feet.current.y >= l.elevation - 0.3 && (i === levels.length - 1 || feet.current.y < levels[i + 1].elevation - 0.3));
      const next = levels[Math.max(0, Math.min(levels.length - 1, (cur < 0 ? 0 : cur) + dir))];
      if (!next) return;
      feet.current.y = next.elevation + 0.05;
      physics.vy = 0;
    };
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      keys.current.add(e.code);
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'KeyF') fly.current = !fly.current;
      if (e.code === 'KeyE' || e.code === 'PageUp') changeLevel(1);
      if (e.code === 'KeyQ' || e.code === 'PageDown') changeLevel(-1);
      if (e.code === 'KeyX') useEditor.getState().set({ walkMode: false });
      useEditor.getState().set({ walkInfo: { ...useEditor.getState().walkInfo, fly: fly.current } });
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const blur = () => keys.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      if (persp.isPerspectiveCamera) {
        persp.fov = prevFov;
        persp.near = prevNear;
        persp.updateProjectionMatrix();
      }
      resetDoors(doors.current);
      // Hand back to orbit controls looking where the walker was looking.
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      viewportHandles.walkExit = { position: camera.position.clone(), target: camera.position.clone().add(dir.multiplyScalar(4)) };
      useEditor.getState().set({ walkLocked: false });
    };
  }, [camera, physics]);

  useFrame((_, rawDt) => {
    // Frame-rate independent: slow frames are split into small physics steps.
    const total = Math.min(rawDt, 0.25);
    const steps = Math.max(1, Math.ceil(total / 0.05));
    const dt = total / steps;
    const k = keys.current;
    const f = feet.current;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    if (!fly.current) forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    const move = new THREE.Vector3();
    if (k.has('KeyW') || k.has('ArrowUp')) move.add(forward);
    if (k.has('KeyS') || k.has('ArrowDown')) move.sub(forward);
    if (k.has('KeyD') || k.has('ArrowRight')) move.add(right);
    if (k.has('KeyA') || k.has('ArrowLeft')) move.sub(right);
    const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? WALK.runSpeed : WALK.walkSpeed) * (fly.current ? 2 : 1);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * dt);

    animateDoors(doors.current, f, total);

    if (fly.current) {
      if (k.has('Space')) move.y += speed * dt;
      if (k.has('KeyC')) move.y -= speed * dt;
      for (let i = 0; i < steps; i++) physics.fly(move);
      camera.position.set(f.x, f.y + EYE, f.z);
      return;
    }

    // Wait for the colliders before applying gravity (otherwise the walker drops through the floor).
    if (!physics.ground.length) return;
    for (let i = 0; i < steps; i++) physics.step(move, dt, k.has('Space'));
    // Fell off the world: respawn.
    const minY = (useEditor.getState().scene.levels[0]?.elevation ?? 0) - 30;
    if (f.y < minY) {
      const s = walkSpawn(useEditor.getState().scene);
      f.copy(s.feet);
      physics.vy = 0;
      physics.settle();
    }
    // Smooth eye height (softens stair steps).
    const eyeY = f.y + EYE;
    camera.position.x = f.x;
    camera.position.z = f.z;
    camera.position.y += (eyeY - camera.position.y) * Math.min(1, total * 14);

    const lvl = [...useEditor.getState().scene.levels].sort((a, b) => b.elevation - a.elevation).find((l) => f.y >= l.elevation - 0.3);
    if (lvl && lvl.name !== lastLevel.current) {
      lastLevel.current = lvl.name;
      useEditor.getState().set({ walkInfo: { level: lvl.name, fly: fly.current } });
    }
  });

  return (
    <PointerLockControls
      makeDefault
      selector="#walk-lock"
      domElement={gl.domElement}
      onLock={() => useEditor.getState().set({ walkLocked: true })}
      onUnlock={() => useEditor.getState().set({ walkLocked: false })}
    />
  );
}
