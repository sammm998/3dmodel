'use client';
/**
 * Progressive GPU path tracing (three-gpu-pathtracer) for final-quality
 * stills: global illumination, soft shadows, glossy reflections and real
 * glass transmission. Rendering converges over time; any camera move restarts
 * accumulation.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { WebGLPathTracer } from 'three-gpu-pathtracer';
import { useEditor } from '../store/editor';
import { viewportHandles } from './registry';

const SKY: Record<string, [string, string, string]> = {
  day: ['#5f8fcf', '#dfe8f0', '#8a8f86'],
  sunset: ['#3a4f7a', '#f2b27d', '#5a4a44'],
  overcast: ['#9aa4ae', '#d9dde1', '#7c7f7c'],
  night: ['#05070d', '#1c2538', '#0a0b0e'],
};

/** Equirectangular sky (with sun disc) used as environment light. */
function makeSkyTexture(env: string, sunAz: number, sunEl: number): THREE.DataTexture {
  const W = 512;
  const H = 256;
  const data = new Float32Array(W * H * 4);
  const [top, hor, bot] = (SKY[env] ?? SKY.day).map((c) => new THREE.Color(c).convertSRGBToLinear());
  const az = THREE.MathUtils.degToRad(sunAz);
  const el = THREE.MathUtils.degToRad(sunEl);
  const sun = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  const d = new THREE.Vector3();
  const c = new THREE.Color();
  const sunI = env === 'night' ? 2 : env === 'overcast' ? 8 : 60;
  for (let y = 0; y < H; y++) {
    const v = 1 - (y + 0.5) / H;
    const theta = v * Math.PI; // 0 = up
    for (let x = 0; x < W; x++) {
      const phi = ((x + 0.5) / W) * Math.PI * 2;
      d.set(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
      const h = d.y;
      if (h > 0) c.copy(hor).lerp(top, Math.pow(h, 0.55));
      else c.copy(hor).lerp(bot, Math.pow(-h, 0.35));
      const s = Math.max(0, d.dot(sun));
      const glow = Math.pow(s, 2000) * sunI + Math.pow(s, 12) * 0.2;
      const i = (y * W + x) * 4;
      data[i] = c.r + glow;
      data[i + 1] = c.g + glow * 0.92;
      data[i + 2] = c.b + glow * 0.8;
      data[i + 3] = 1;
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function PathTracerRenderer() {
  const { gl, scene, camera } = useThree();
  const revision = useEditor((s) => s.revision);
  const settings = useEditor((s) => s.scene.settings);
  const tracer = useMemo(() => {
    const t = new WebGLPathTracer(gl);
    t.tiles.set(2, 2);
    t.bounces = 6;
    t.transmissiveBounces = 6;
    t.minSamples = 1;
    t.renderDelay = 0;
    t.fadeDuration = 250;
    t.filterGlossyFactor = 0.5;
    t.dynamicLowRes = true;
    return t;
  }, [gl]);
  const samples = useRef(0);

  useEffect(() => {
    const sky = makeSkyTexture(settings.environment, settings.sunAzimuth, settings.sunElevation);
    const prevEnv = scene.environment;
    const prevBg = scene.background;
    scene.environment = sky;
    scene.background = sky;
    // Enabling path tracing swaps materials, which rebuilds every element;
    // wait until the scene graph has settled before building the BVH.
    const id = setTimeout(() => {
      scene.updateMatrixWorld(true);
      tracer.setScene(scene, camera);
    }, 400);
    return () => {
      clearTimeout(id);
      scene.environment = prevEnv;
      scene.background = prevBg;
      sky.dispose();
    };
  }, [tracer, scene, camera, revision, settings.environment, settings.sunAzimuth, settings.sunElevation]);

  useEffect(() => {
    const controls = viewportHandles.controls as unknown as { addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void } | null;
    const onChange = () => tracer.updateCamera();
    controls?.addEventListener?.('change', onChange);
    return () => controls?.removeEventListener?.('change', onChange);
  }, [tracer]);

  useEffect(() => () => tracer.dispose(), [tracer]);

  // Priority 1 takes over R3F's render loop while path tracing is active.
  useFrame(({ gl: renderer, scene: sc, camera: cam }) => {
    if (!tracer.scene) {
      renderer.render(sc, cam);
      return;
    }
    tracer.renderSample();
    const n = Math.floor(tracer.samples);
    if (n !== samples.current) {
      samples.current = n;
      useEditor.getState().set({ pathTraceSamples: n });
    }
  }, 1);
  return null;
}
