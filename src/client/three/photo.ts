'use client';
/**
 * Photo render: a progressive, GPU path-traced image of the current view
 * (three-gpu-pathtracer). It runs on its own canvas and renderer with a clean
 * copy of the building (no helpers, labels or selection), the same materials as
 * the realistic view with physically refractive glass, the same sky as image-based
 * light and background, and the sun as a directional light. Light bounces between
 * surfaces (global illumination), so interiors, soft contact shadows, reflections
 * and glass look like a photograph; the image converges sample by sample.
 */
import * as THREE from 'three';
import { WebGLPathTracer } from 'three-gpu-pathtracer';
import type { Scene } from '@/core/schema/scene';
import { buildSceneGroup } from '@/core/geometry/build3d';
import { sceneBounds } from '@/core/scene/query';
import { pointInPolygon } from '@/core/geometry/math2d';
import { MaterialManager } from './materials';
import { ENV_PRESETS, gradientSkyMaterial, physicalSkyMaterial, surroundingGroundGeometry } from './Lighting';

export interface PhotoRender {
  readonly samples: number;
  stop(): void;
  dispose(): void;
}

/** The sky (as in the realistic view) rendered to an equirectangular HDR texture. */
function skyEquirect(renderer: THREE.WebGLRenderer, environment: keyof typeof ENV_PRESETS, sunDir: THREE.Vector3): THREE.DataTexture {
  const preset = ENV_PRESETS[environment];
  const skyScene = new THREE.Scene();
  const mat = preset.sky ? physicalSkyMaterial(preset.sky, sunDir) : gradientSkyMaterial({ top: preset.top, horizon: preset.horizon, bottom: preset.bottom }, sunDir);
  const dome = new THREE.Mesh(preset.sky ? new THREE.BoxGeometry(1, 1, 1) : new THREE.SphereGeometry(1, 64, 32), mat);
  dome.scale.setScalar(100);
  skyScene.add(dome);
  // Below the horizon: a neutral, slightly warm ground so bounce light is not green or black.
  const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color('#8a8378').multiplyScalar(0.55), side: THREE.DoubleSide }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2;
  skyScene.add(ground);
  const cubeRT = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType });
  const cubeCam = new THREE.CubeCamera(0.1, 500, cubeRT);
  cubeCam.update(renderer, skyScene);

  // Cube → equirect on a full-screen quad.
  const W = 1024;
  const H = 512;
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType });
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: { cube: { value: cubeRT.texture } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform samplerCube cube; varying vec2 vUv;
        void main(){
          // Inverse of three.js equirectUv(): u = atan(z, x) / 2π + 0.5, v = asin(y) / π + 0.5.
          float phi = (vUv.x - 0.5) * 6.28318530718;
          float lat = (vUv.y - 0.5) * 3.14159265359;
          vec3 d = vec3(cos(phi) * cos(lat), sin(lat), sin(phi) * cos(lat));
          // Render-target cube maps are sampled without the x flip.
          gl_FragColor = vec4(textureCube(cube, d).rgb, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    }),
  );
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(quadScene, quadCam);
  const data = new Float32Array(W * H * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, W, H, data);
  renderer.setRenderTarget(prevTarget);
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  rt.dispose();
  cubeRT.dispose();
  mat.dispose();
  (quad.material as THREE.Material).dispose();
  return tex;
}

/**
 * The path tracer assigns one material per mesh; meshes with several materials
 * (e.g. walls with inner and outer finishes) are split into one mesh per material
 * group, or every later material would land on the wrong surface.
 */
function splitMultiMaterial(root: THREE.Object3D) {
  const multi: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && Array.isArray(m.material)) multi.push(m);
  });
  for (const mesh of multi) {
    const mats = mesh.material as THREE.Material[];
    const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const groups = src.groups.length ? src.groups : [{ start: 0, count: src.attributes.position.count, materialIndex: 0 }];
    for (const grp of groups) {
      const mat = mats[grp.materialIndex ?? 0];
      if (!mat || grp.count <= 0) continue;
      const g = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(src.attributes)) {
        const a = attr as THREE.BufferAttribute;
        g.setAttribute(name, new THREE.BufferAttribute((a.array as Float32Array).slice(grp.start * a.itemSize, (grp.start + grp.count) * a.itemSize), a.itemSize, a.normalized));
      }
      const part = new THREE.Mesh(g, mat);
      part.position.copy(mesh.position);
      part.quaternion.copy(mesh.quaternion);
      part.scale.copy(mesh.scale);
      mesh.parent?.add(part);
    }
    mesh.parent?.remove(mesh);
  }
}

/**
 * Grass, gravel and fabrics scatter light through fibres and blades: a smooth
 * plane with the default 4 % reflectance shows a sky sheen at grazing angles that
 * reads as wet plastic. Give these surfaces a low specular reflectance instead.
 */
const MATTE = /^(grass|gravel|fabric_|leather_|rug|foliage|soil)/;
function softenMatteSurfaces(root: THREE.Object3D) {
  const swapped = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    const src = m.material as THREE.MeshStandardMaterial;
    if (!src.isMeshStandardMaterial || !MATTE.test(src.name)) return;
    let dst = swapped.get(src);
    if (!dst) {
      const p = new THREE.MeshPhysicalMaterial();
      THREE.MeshStandardMaterial.prototype.copy.call(p, src);
      p.specularIntensity = src.name.startsWith('leather_') ? 0.6 : 0.12;
      swapped.set(src, (dst = p));
    }
    m.material = dst;
  });
}

export async function startPhotoRender(opts: {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  scene: Scene;
  camera: THREE.PerspectiveCamera;
  maxSamples?: number;
  onSample?: (n: number) => void;
  onReady?: () => void;
}): Promise<PhotoRender> {
  const { scene, width, height } = opts;
  const settings = scene.settings;
  const preset = ENV_PRESETS[settings.environment];
  const renderer = new THREE.WebGLRenderer({ canvas: opts.canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = preset.exposure;

  const az = THREE.MathUtils.degToRad(settings.sunAzimuth);
  const el = THREE.MathUtils.degToRad(settings.sunElevation);
  const sunDir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));

  // A clean scene: the building with presentation materials (refractive glass).
  // 2k scans for stills; wait for them so the tracer packs the photographed maps.
  const materials = new MaterialManager('realistic', scene.materials, 'transmission', undefined, '2k');
  const world = new THREE.Scene();
  world.add(buildSceneGroup(scene, materials.get));
  materials.get('grass');
  await materials.ready(20_000);
  splitMultiMaterial(world);
  const b = sceneBounds({ ...scene, elements: scene.elements.filter((e) => e.type !== 'terrain') });
  const center = b ? new THREE.Vector3((b.min.x + b.max.x) / 2, 0, (b.min.z + b.max.z) / 2) : new THREE.Vector3();
  const radius = b ? Math.max(8, Math.hypot(b.max.x - b.min.x, b.max.z - b.min.z) / 2 + 4) : 10;
  // Surrounding ground to the horizon, open where the site terrain (and its pool) is.
  const sg = surroundingGroundGeometry(scene, center, Math.max(radius * 25, 600));
  const ground = new THREE.Mesh(sg.geometry, materials.get('grass'));
  ground.position.y = sg.y;
  world.add(ground);
  softenMatteSurfaces(world);

  const env = skyEquirect(renderer, settings.environment, sunDir);
  world.environment = env;
  world.background = env;

  const sun = new THREE.DirectionalLight(preset.sun, preset.sunI);
  sun.position.copy(center).addScaledVector(sunDir, radius * 4);
  sun.target.position.copy(center);
  world.add(sun, sun.target);

  // Lamps are on: warm point lights in the shades of floor and pendant lamps.
  const lampPower = settings.environment === 'night' ? 60 : settings.environment === 'sunset' ? 35 : 18;
  for (const el of scene.elements) {
    if (el.type !== 'furniture' || el.hidden || (el.kind !== 'floor_lamp' && el.kind !== 'pendant_lamp')) continue;
    const lvl = scene.levels.find((l) => l.id === el.levelId) ?? scene.levels[0];
    const y = lvl.elevation + el.position.y + (el.kind === 'floor_lamp' ? el.height - 0.18 : el.height * 0.3);
    const lamp = new THREE.PointLight('#ffd2a1', lampPower, 0, 2);
    lamp.position.set(el.position.x, y, el.position.z);
    world.add(lamp);
  }

  // Interiors are exposed brighter, as a photographer would (daylight through windows
  // is several stops darker than outside).
  const camPos = opts.camera.position;
  const indoors = scene.elements.some((e) => {
    if (e.type !== 'room') return false;
    const lvl = scene.levels.find((l) => l.id === e.levelId) ?? scene.levels[0];
    return camPos.y >= lvl.elevation && camPos.y <= lvl.elevation + lvl.height && pointInPolygon({ x: camPos.x, z: camPos.z }, e.polygon);
  });
  if (indoors) renderer.toneMappingExposure = preset.exposure * 3.2;

  const cam = opts.camera.clone();
  cam.aspect = width / height;
  cam.updateProjectionMatrix();
  world.updateMatrixWorld(true);

  const tracer = new WebGLPathTracer(renderer);
  tracer.bounces = 7;
  tracer.transmissiveBounces = 10;
  tracer.filterGlossyFactor = 0.5;
  tracer.multipleImportanceSampling = true;
  tracer.minSamples = 1;
  tracer.renderDelay = 0;
  tracer.fadeDuration = 0;
  tracer.dynamicLowRes = false;
  tracer.renderScale = 1;
  tracer.tiles.set(2, 2);
  // Builds the BVH on the main thread (a moment for a typical house); the caller
  // shows a "preparing" state first.
  await new Promise((r) => setTimeout(r, 30));
  tracer.setScene(world, cam);
  opts.onReady?.();

  let running = true;
  let raf = 0;
  const max = opts.maxSamples ?? 1024;
  const loop = () => {
    if (!running) return;
    tracer.renderSample();
    const n = Math.floor(tracer.samples);
    opts.onSample?.(n);
    if (n >= max) {
      running = false;
      return;
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return {
    get samples() {
      return Math.floor(tracer.samples);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      tracer.dispose();
      env.dispose();
      world.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      materials.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
