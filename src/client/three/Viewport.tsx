'use client';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, Grid, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { EffectComposer, N8AO, SMAA } from '@react-three/postprocessing';
import { useEditor } from '../store/editor';
import { SceneObjects } from './SceneObjects';
import { GroundCatcher, MeasureOverlay, RoomLabels, SelectionLabels, SelectionOutlines } from './Overlays';
import { TransformGizmo } from './Gizmo';
import { CameraRig } from './CameraRig';
import { Lighting } from './Lighting';
import { MaterialManager } from './materials';
import { objectRegistry, viewportHandles } from './registry';
import { PathTracerRenderer } from './PathTracer';
import { elementAnchor, findElement } from '@/core/scene/query';

function Handles() {
  const { gl, camera, scene, size } = useThree();
  useEffect(() => {
    viewportHandles.gl = gl;
    viewportHandles.camera = camera;
    viewportHandles.scene = scene;
  }, [gl, camera, scene]);
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
    };
  }, [camera, gl, size]);
  return null;
}

function Effects() {
  const viewMode = useEditor((s) => s.viewMode);
  const pathTrace = useEditor((s) => s.pathTrace);
  if (viewMode === 'modeling' || pathTrace) return null;
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <N8AO halfRes aoRadius={0.9} intensity={2.2} distanceFalloff={0.6} quality="medium" />
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
  const pathTrace = useEditor((s) => s.pathTrace) && viewMode !== 'modeling';
  const pathTraceOn = useEditor((s) => s.pathTrace);
  const style = viewMode === 'modeling' ? 'technical' : pathTraceOn ? 'pathtrace' : 'realistic';
  const materials = useMemo(() => new MaterialManager(style, customMaterials), [style, customMaterials]);
  useEffect(() => () => materials.dispose(), [materials]);
  useEffect(() => {
    viewportHandles.container = containerRef.current;
  }, []);
  const gridY = (levels.find((l) => l.id === activeLevelId)?.elevation ?? 0) + 0.002;

  return (
    <div ref={containerRef} className="absolute inset-0" data-testid="viewport">
      <Canvas
        shadows={{ type: THREE.PCFSoftShadowMap }}
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance', logarithmicDepthBuffer: false }}
        onPointerMissed={(e) => {
          if (!interactive) return;
          if ((e as MouseEvent).shiftKey) return;
          if (useEditor.getState().tool !== 'measure') useEditor.getState().select(null);
        }}
      >
        {cameraKind === 'perspective' ? (
          <PerspectiveCamera makeDefault position={[14, 10, 16]} fov={45} near={0.05} far={6000} />
        ) : (
          <OrthographicCamera makeDefault position={[14, 10, 16]} zoom={40} near={-1000} far={6000} />
        )}
        <CameraRig />
        <Lighting />
        <Suspense fallback={null}>
          <SceneObjects materials={materials} interactive={interactive} />
        </Suspense>
        {interactive && !pathTrace ? <GroundCatcher /> : null}
        {!pathTrace ? (
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
            cellColor="#2b3038"
            sectionColor="#3f4652"
            fadeDistance={160}
            fadeStrength={1.5}
            followCamera={false}
          />
        ) : null}
        {viewMode === 'modeling' ? <axesHelper args={[1.2]} position={[0, 0.003, 0]} /> : null}
        {pathTrace ? <PathTracerRenderer /> : null}
        {viewMode !== 'presentation' && !pathTrace ? (
          <GizmoHelper alignment="bottom-right" margin={[72, 92]}>
            <GizmoViewport axisColors={['#e06c75', '#98c379', '#61afef']} labelColor="#0b0d10" />
          </GizmoHelper>
        ) : null}
        <Effects />
        <Handles />
      </Canvas>
    </div>
  );
}
