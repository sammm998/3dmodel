'use client';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, Grid, OrthographicCamera, PerformanceMonitor, PerspectiveCamera } from '@react-three/drei';
import { Bloom, EffectComposer, N8AO, SMAA, Vignette } from '@react-three/postprocessing';
import { useEditor } from '../store/editor';
import { SceneObjects } from './SceneObjects';
import { GroundCatcher, MeasureOverlay, RoomLabels, SelectionLabels, SelectionOutlines } from './Overlays';
import { TransformGizmo } from './Gizmo';
import { CameraRig } from './CameraRig';
import { Lighting } from './Lighting';
import { MaterialManager } from './materials';
import { objectRegistry, viewportHandles } from './registry';
import { elementAnchor, findElement } from '@/core/scene/query';

function Handles() {
  const { gl, camera, scene, size, invalidate } = useThree();
  useEffect(() => {
    viewportHandles.gl = gl;
    viewportHandles.camera = camera;
    viewportHandles.scene = scene;
    viewportHandles.invalidate = invalidate;
  }, [gl, camera, scene, invalidate]);
  // Test/automation bridge: element → screen position, state access.
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__AI3D__ = {
      getState: () => useEditor.getState(),
      projectElement: (id: string) => {
        const st = useEditor.getState();
        const el = findElement(st.scene, id);
        if (!el) return null;
        const obj = objectRegistry.get(id);
        let p: THREE.Vector3;
        if (obj) {
          const box = new THREE.Box3().setFromObject(obj);
          p = box.getCenter(new THREE.Vector3());
        } else {
          const a = elementAnchor(st.scene, el);
          p = new THREE.Vector3(a.x, a.y, a.z);
        }
        const v = p.clone().project(camera);
        const rect = gl.domElement.getBoundingClientRect();
        return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, visible: v.z < 1 };
      },
      registeredCount: () => objectRegistry.size,
      cameraPosition: () => camera.position.toArray(),
      /** Element id under a screen point, using the same raycasting as clicks. */
      pickAt: (x: number, y: number) => {
        const rect = gl.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
        const ray = new THREE.Raycaster();
        ray.setFromCamera(ndc, camera);
        const objs = [...objectRegistry.values()];
        const hit = ray.intersectObjects(objs, true).find((h) => h.object.userData.elementId && !h.object.userData.helper);
        return hit ? (hit.object.userData.elementId as string) : null;
      },
      /** Test hook: place the orbit camera (ignored in walk mode). */
      setView: (pos: [number, number, number], target: [number, number, number]) => {
        const c = viewportHandles.controls as { target: THREE.Vector3; update: () => void } | undefined;
        camera.position.set(...pos);
        if (c) {
          c.target.set(...target);
          c.update();
        } else camera.lookAt(...target);
        invalidate();
      },
      three: { gl, scene, camera },
    };
  }, [camera, gl, size, scene, invalidate]);
  return null;
}

function Effects({ lowPerf }: { lowPerf: boolean }) {
  const viewMode = useEditor((s) => s.viewMode);
  const walkMode = useEditor((s) => s.walkMode);
  const gl = useThree((s) => s.gl);
  // Ambient occlusion is the most expensive pass: drop it when the frame rate struggles.
  // Screen-space AO also streaks on thin, close geometry (stair treads, mullions) while
  // moving, so the first-person view renders without it (native MSAA instead).
  const active = !(viewMode === 'modeling' || lowPerf || walkMode);
  // postprocessing's EffectComposer switches the renderer's autoClear off for good when it
  // is created and never restores it. Without the composer, frames would then be drawn on
  // top of the previous ones (no colour/depth clear; the sky is a mesh, not a background
  // colour), smearing every object while the camera moves. Re-enable it every frame.
  useFrame(() => {
    if (!active && !gl.autoClear) gl.autoClear = true;
  });
  if (!active) return null;
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <N8AO halfRes aoRadius={0.9} intensity={2.2} distanceFalloff={0.6} quality="medium" />
      {/* Camera-like finish: a soft glow around the brightest highlights (sun on glass,
          water, white walls) and a gentle lens falloff towards the corners. */}
      <Bloom mipmapBlur luminanceThreshold={0.85} luminanceSmoothing={0.2} intensity={0.35} radius={0.6} />
      <Vignette offset={0.32} darkness={0.42} />
      <SMAA />
    </EffectComposer>
  );
}

export function Viewport({ interactive = true }: { interactive?: boolean }) {
  const viewMode = useEditor((s) => s.viewMode);
  const cameraKind = useEditor((s) => s.camera);
  const showGrid = useEditor((s) => s.showGrid);
  const customMaterials = useEditor((s) => s.scene.materials);
  const activeLevelId = useEditor((s) => s.activeLevelId);
  const levels = useEditor((s) => s.scene.levels);
  const containerRef = useRef<HTMLDivElement>(null);
  const walkMode = useEditor((s) => s.walkMode);
  const droneMode = useEditor((s) => s.droneMode);
  // Walking or recording a drone flight: no editing overlays, camera driven by code.
  const firstPerson = walkMode || droneMode;
  // Adaptive quality: resolution and AO follow the measured frame rate.
  // window.__AI3D_HQ__ (set by capture scripts) pins full quality regardless of frame rate.
  const hq = typeof window !== 'undefined' && !!(window as unknown as { __AI3D_HQ__?: number }).__AI3D_HQ__;
  const [dpr, setDpr] = useState(() => (typeof window === 'undefined' ? 1 : hq ? (window as unknown as { __AI3D_HQ__: number }).__AI3D_HQ__ : Math.min(1.5, window.devicePixelRatio || 1)));
  const [lowPerf, setLowPerf] = useState(false);
  const style = viewMode === 'modeling' ? 'technical' : 'realistic';
  // Keyed on content, not identity: every edit clones the scene, which must not rebuild all materials.
  const customKey = JSON.stringify(customMaterials);
  const glassMode = viewMode === 'presentation' && !firstPerson ? 'transmission' : 'transparent';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const materials = useMemo(() => new MaterialManager(style, customMaterials, glassMode, () => viewportHandles.invalidate?.()), [style, customKey, glassMode]);
  useEffect(() => () => materials.dispose(), [materials]);
  useEffect(() => {
    viewportHandles.container = containerRef.current;
  }, []);
  const gridY = (levels.find((l) => l.id === activeLevelId)?.elevation ?? 0) + 0.006;

  return (
    <div ref={containerRef} className="absolute inset-0" data-testid="viewport">
      {/* Render on demand (camera moves, edits, resizes) so an idle model costs no GPU time;
          the first-person view animates continuously. */}
      <Canvas
        frameloop={firstPerson ? 'always' : 'demand'}
        shadows={{ type: THREE.PCFSoftShadowMap }}
        dpr={droneMode ? Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1) : dpr}
        gl={{ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance', logarithmicDepthBuffer: false }}
        onPointerMissed={(e) => {
          if (!interactive) return;
          if ((e as MouseEvent).shiftKey) return;
          if (useEditor.getState().tool !== 'measure') useEditor.getState().select(null);
        }}
      >
        {cameraKind === 'perspective' ? (
          <PerspectiveCamera makeDefault position={[14, 10, 16]} fov={45} near={0.1} far={2500} />
        ) : (
          <OrthographicCamera makeDefault position={[14, 10, 16]} zoom={40} near={-1000} far={2500} />
        )}
        <CameraRig />
        <Lighting groundMaterial={materials.get('grass')} />
        <Suspense fallback={null}>
          <SceneObjects materials={materials} interactive={interactive && !firstPerson} />
        </Suspense>
        {interactive && !firstPerson ? <GroundCatcher /> : null}
        {!firstPerson ? (
          <>
            <SelectionOutlines />
            <SelectionLabels />
            <RoomLabels />
            <MeasureOverlay />
            {interactive ? <TransformGizmo /> : null}
          </>
        ) : null}
        {showGrid && viewMode === 'modeling' ? (
          <Grid
            position={[0, gridY, 0]}
            infiniteGrid
            cellSize={0.5}
            sectionSize={5}
            cellThickness={0.6}
            sectionThickness={1.1}
            cellColor="#2e2c28"
            sectionColor="#45423b"
            fadeDistance={160}
            fadeStrength={1.5}
            followCamera={false}
          />
        ) : null}
        {viewMode === 'modeling' ? <axesHelper args={[1.2]} position={[0, 0.003, 0]} /> : null}
        {viewMode !== 'presentation' && !firstPerson ? (
          <GizmoHelper alignment="bottom-right" margin={[72, 92]}>
            <GizmoViewport axisColors={['#e06c75', '#98c379', '#61afef']} labelColor="#0f0f0d" />
          </GizmoHelper>
        ) : null}
        <Effects lowPerf={lowPerf} />
        {/* Frame-rate based quality only while rendering continuously (walk mode). Degrade once and
            stay there: toggling quality back and forth is itself visible flicker. */}
        {hq || !walkMode ? null : <PerformanceMonitor
          onDecline={() => {
            setDpr(1);
            setLowPerf(true);
          }}
          flipflops={1}
          onFallback={() => {
            setDpr(1);
            setLowPerf(true);
          }}
        />}
        <Handles />
      </Canvas>
      {style === 'realistic' && !firstPerson ? (
        // Required credit for textures served through the Poly Haven API (CC0 scans).
        <a href="https://polyhaven.com" target="_blank" rel="noreferrer" className="pointer-events-auto absolute bottom-2 left-2 rounded bg-black/25 px-1.5 py-0.5 text-[10px] text-white/60 hover:text-white/90" data-testid="polyhaven-credit">
          Textures powered by Poly Haven
        </a>
      ) : null}
    </div>
  );
}
