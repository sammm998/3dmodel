'use client';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { useEditor } from '../store/editor';
import { preparedHdri, type HdriName } from './hdri';
import { sceneBounds } from '@/core/scene/query';

/** Photographed environment per lighting preset (image-based light and reflections). */
const HDRI_FOR: Record<string, HdriName> = { day: 'park', sunset: 'sunset', overcast: 'city', night: 'night' };

export const ENV_PRESETS = {
  day: { sky: { turbidity: 2.6, rayleigh: 1.3, mie: 0.004, mieG: 0.82, intensity: 0.62 }, ground: '#35501f', top: '#6b9ad6', horizon: '#e4ebf1', bottom: '#8a8f86', exposure: 1.2, sun: '#fff1dc', sunI: 4.0, hemiSky: '#cfe3ff', hemiGround: '#5b4f3f', hemiI: 0.55 },
  sunset: { sky: { turbidity: 5, rayleigh: 2.2, mie: 0.006, mieG: 0.86, intensity: 0.7 }, ground: '#3a4520', top: '#5d6f96', horizon: '#f0d2b4', bottom: '#5a4a44', exposure: 1.25, sun: '#ffc290', sunI: 3.6, hemiSky: '#ffd2a8', hemiGround: '#3d2f2a', hemiI: 0.45 },
  overcast: { sky: null, ground: '#3f5031', top: '#9aa4ae', horizon: '#d9dde1', bottom: '#7c7f7c', exposure: 1.35, sun: '#eef1f5', sunI: 1.2, hemiSky: '#dfe4ea', hemiGround: '#55524c', hemiI: 0.9 },
  night: { sky: null, ground: '#1a1d1a', top: '#05070d', horizon: '#1c2538', bottom: '#0a0b0e', exposure: 1.1, sun: '#9fb4ff', sunI: 0.35, hemiSky: '#3b4766', hemiGround: '#111318', hemiI: 0.35 },
};

export function gradientSkyMaterial(c: { top: string; horizon: string; bottom: string }, sunDir: THREE.Vector3): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          top: { value: new THREE.Color() },
          horizon: { value: new THREE.Color() },
          bottom: { value: new THREE.Color() },
          sunDir: { value: new THREE.Vector3() },
        },
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
        fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; varying vec3 vDir;
          void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h,0.0,1.0), 0.55)) : mix(horizon, bottom, pow(clamp(-h,0.0,1.0), 0.35));
          float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0); c += vec3(1.0,0.92,0.75) * (pow(s, 600.0) * 1.5 + pow(s, 12.0) * 0.12);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          }`,
  });
  m.uniforms.top.value.set(c.top).convertSRGBToLinear();
  m.uniforms.horizon.value.set(c.horizon).convertSRGBToLinear();
  m.uniforms.bottom.value.set(c.bottom).convertSRGBToLinear();
  m.uniforms.sunDir.value.copy(sunDir);
  return m;
}

/** Gradient sky dome with a soft sun glow (overcast and night). */
function GradientSky({ top, horizon, bottom, sunDir }: { top: string; horizon: string; bottom: string; sunDir: THREE.Vector3 }) {
  // Created once; colours are updated in place below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mat = useMemo(() => gradientSkyMaterial({ top, horizon, bottom }, sunDir), []);
  mat.uniforms.top.value.set(top).convertSRGBToLinear();
  mat.uniforms.horizon.value.set(horizon).convertSRGBToLinear();
  mat.uniforms.bottom.value.set(bottom).convertSRGBToLinear();
  mat.uniforms.sunDir.value.copy(sunDir);
  return (
    <mesh material={mat} scale={1800} frustumCulled={false} renderOrder={-1} raycast={() => {}}>
      <sphereGeometry args={[1, 32, 16]} />
    </mesh>
  );
}

export type SkyParams = { turbidity: number; rayleigh: number; mie: number; mieG: number; intensity: number };

/** Physically based (Preetham) atmosphere; brightness scaled to sit with the scene's sun light. */
export function physicalSkyMaterial(p: SkyParams, sunDir: THREE.Vector3): THREE.ShaderMaterial {
  const shader = (Sky as unknown as { SkyShader: { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string } }).SkyShader;
  const mat = new THREE.ShaderMaterial({
    name: 'PhysicalSky',
    uniforms: { ...THREE.UniformsUtils.clone(shader.uniforms), skyIntensity: { value: p.intensity } },
    vertexShader: shader.vertexShader,
    fragmentShader: shader.fragmentShader
      .replace('uniform vec3 up;', 'uniform vec3 up;\nuniform float skyIntensity;')
      .replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( retColor * skyIntensity, 1.0 );'),
    side: THREE.BackSide,
    depthWrite: false,
  });
  mat.uniforms.turbidity.value = p.turbidity;
  mat.uniforms.rayleigh.value = p.rayleigh;
  mat.uniforms.mieCoefficient.value = p.mie;
  mat.uniforms.mieDirectionalG.value = p.mieG;
  mat.uniforms.sunPosition.value.copy(sunDir).multiplyScalar(1000);
  return mat;
}

function PhysicalSky({ params, sunDir }: { params: SkyParams; sunDir: THREE.Vector3 }) {
  const key = `${JSON.stringify(params)}|${sunDir.toArray().map((v) => v.toFixed(4)).join(',')}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mat = useMemo(() => physicalSkyMaterial(params, sunDir), [key]);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh material={mat} scale={1800} frustumCulled={false} renderOrder={-1} raycast={() => {}}>
      <boxGeometry args={[1, 1, 1]} />
    </mesh>
  );
}

/**
 * Image-based lighting and reflections rendered from the same sky the viewer
 * sees (plus a ground hemisphere for bounce light), so glass reflects the real
 * sky and shaded façades pick up blue skylight. No network assets.
 */
function SkyEnvironment({ sky, gradient, sunDir, intensity, ground = '#8a8378', hdri = null }: { sky: SkyParams | null; gradient: { top: string; horizon: string; bottom: string }; sunDir: THREE.Vector3; intensity: number; ground?: string; hdri?: HdriName | null }) {
  const { gl, scene, invalidate } = useThree();
  const key = `${hdri}|${ground}|${JSON.stringify(sky)}|${JSON.stringify(gradient)}|${sunDir.toArray().map((v) => v.toFixed(3)).join(',')}`;
  useEffect(() => {
    const envScene = new THREE.Scene();
    const skyMat = sky ? physicalSkyMaterial(sky, sunDir) : gradientSkyMaterial(gradient, sunDir);
    const dome = new THREE.Mesh(sky ? new THREE.BoxGeometry(1, 1, 1) : new THREE.SphereGeometry(1, 32, 16), skyMat);
    dome.scale.setScalar(50);
    envScene.add(dome);
    // Bounce light from below: a neutral, slightly warm grey (green grass bounce would tint ceilings).
    const groundMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(ground).multiplyScalar(0.8), side: THREE.DoubleSide });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(40, 48), groundMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -1;
    envScene.add(disc);
    const pmrem = new THREE.PMREMGenerator(gl);
    // Render the sky without tone mapping: the environment must stay linear HDR.
    const prevTone = gl.toneMapping;
    gl.toneMapping = THREE.NoToneMapping;
    const env = pmrem.fromScene(envScene, 0.02, 0.1, 200).texture;
    gl.toneMapping = prevTone;
    scene.environment = env;
    invalidate();
    // Then the photographed environment, when it has loaded (the synthetic one stays otherwise).
    let cancelled = false;
    let photoEnv: THREE.Texture | null = null;
    if (hdri) {
      preparedHdri(hdri, sunDir)
        .then((tex) => {
          if (cancelled) return tex.dispose();
          photoEnv = pmrem.fromEquirectangular(tex).texture;
          tex.dispose();
          scene.environment = photoEnv;
          invalidate();
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      scene.environment = null;
      photoEnv?.dispose();
      env.dispose();
      pmrem.dispose();
      skyMat.dispose();
      groundMat.dispose();
      dome.geometry.dispose();
      disc.geometry.dispose();
      invalidate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, key]);
  useEffect(() => {
    scene.environmentIntensity = intensity;
    invalidate();
  }, [scene, intensity, invalidate]);
  return null;
}

/**
 * Ground beyond the site: the same lawn material as the site terrain with a hole
 * exactly where the terrain is (seamless, nothing overlaps, nothing z-fights),
 * fading into the horizon with the fog.
 */
/** Ground reaching the horizon, with a hole where the site terrain is (its pool cut-outs stay open). */
export function surroundingGroundGeometry(scene: import('@/core/schema/scene').Scene, center: THREE.Vector3, R: number): { geometry: THREE.BufferGeometry; y: number } {
  const terrain = scene.elements.find((e) => e.type === 'terrain');
  const base = scene.levels[0]?.elevation ?? 0;
  const outer = new THREE.Shape();
  outer.moveTo(center.x - R, -(center.z - R));
  outer.lineTo(center.x + R, -(center.z - R));
  outer.lineTo(center.x + R, -(center.z + R));
  outer.lineTo(center.x - R, -(center.z + R));
  outer.closePath();
  if (terrain && terrain.type === 'terrain') {
    const hw = terrain.width / 2;
    const hd = terrain.depth / 2;
    const hole = new THREE.Path();
    hole.moveTo(terrain.center.x - hw, -(terrain.center.z - hd));
    hole.lineTo(terrain.center.x - hw, -(terrain.center.z + hd));
    hole.lineTo(terrain.center.x + hw, -(terrain.center.z + hd));
    hole.lineTo(terrain.center.x + hw, -(terrain.center.z - hd));
    hole.closePath();
    outer.holes.push(hole);
  }
  const g = new THREE.ShapeGeometry(outer);
  g.rotateX(-Math.PI / 2);
  // Without a site terrain the ground sits just under the ground-floor slab.
  const y = terrain && terrain.type === 'terrain' ? base + terrain.elevation : base - 0.02;
  return { geometry: g, y };
}

function SurroundingGround({ material, color, scene, center, radius }: { material?: THREE.Material; color: string; scene: import('@/core/schema/scene').Scene; center: THREE.Vector3; radius: number }) {
  const terrain = scene.elements.find((e) => e.type === 'terrain');
  // Reaches the horizon, so the fogged ground meets the sky without a gap.
  const R = Math.max(radius * 40, 1500);
  const ground = useMemo(
    () => surroundingGroundGeometry(scene, center, R),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(terrain ?? null), center.x, center.z, R],
  );
  useEffect(() => () => ground.geometry.dispose(), [ground]);
  return (
    <mesh geometry={ground.geometry} position-y={ground.y} receiveShadow raycast={() => {}} material={material}>
      {material ? null : <meshStandardMaterial color={color} roughness={1} metalness={0} />}
    </mesh>
  );
}

/** Scene-level fog (a <fog attach> inside a group would attach to the group, not the scene). */
function SceneFog({ color, near, far }: { color: string; near: number; far: number }) {
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    scene.fog = new THREE.Fog(color, near, far);
    invalidate();
    return () => {
      scene.fog = null;
      invalidate();
    };
  }, [scene, color, near, far, invalidate]);
  return null;
}

export function Lighting({ groundMaterial }: { groundMaterial?: THREE.Material }) {
  const viewMode = useEditor((s) => s.viewMode);
  const settings = useEditor((s) => s.scene.settings);
  const scene = useEditor((s) => s.scene);
  const { gl } = useThree();
  const realistic = viewMode !== 'modeling';
  const walkMode = useEditor((s) => s.walkMode);
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const preset = ENV_PRESETS[settings.environment];

  const b = useMemo(() => sceneBounds(scene), [scene]);
  const center = b ? new THREE.Vector3((b.min.x + b.max.x) / 2, 0, (b.min.z + b.max.z) / 2) : new THREE.Vector3();
  const radius = b ? Math.max(8, Math.hypot(b.max.x - b.min.x, b.max.z - b.min.z) / 2 + 4) : 10;
  const az = THREE.MathUtils.degToRad(settings.sunAzimuth);
  const el = THREE.MathUtils.degToRad(settings.sunElevation);
  const sunDir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  const sunPos = center.clone().add(sunDir.clone().multiplyScalar(radius * 3));

  useEffect(() => {
    // AgX (as in Blender/film pipelines): natural highlight roll-off and colour.
    gl.toneMapping = realistic ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = realistic ? preset.exposure : 1.0;
  }, [gl, realistic, preset.exposure]);

  const shadowSize = 2048;
  const target = useMemo(() => new THREE.Object3D(), []);
  target.position.copy(center);
  target.updateMatrixWorld();
  return (
    <>
      <primitive object={target} />
      {!realistic ? <color attach="background" args={['#161513']} /> : null}
      {realistic ? (
        <group key="realistic-lighting">
          {preset.sky ? <PhysicalSky params={preset.sky} sunDir={sunDir} /> : <GradientSky top={preset.top} horizon={preset.horizon} bottom={preset.bottom} sunDir={sunDir} />}
          {/* Atmospheric depth: distant ground dissolves into the horizon instead of ending at a hard edge. */}
          <SceneFog color={preset.horizon} near={radius * 3.2} far={radius * 9} />
          <SurroundingGround material={groundMaterial} color={preset.ground} scene={scene} center={center} radius={radius} />
          {/* First person: no sun shadows (shadow maps alias badly at arm's length and shimmer
              while moving) and softer, more even light instead. */}
          <SkyEnvironment
            sky={preset.sky}
            gradient={{ top: preset.top, horizon: preset.horizon, bottom: preset.bottom }}
            sunDir={sunDir}
            intensity={(settings.environment === 'night' ? 0.3 : 1) * (walkMode ? 1.3 : 1)}
            // Indoors the lower hemisphere is pale floors and walls rather than terrain.
            ground={walkMode ? '#d8d0c2' : '#8a8378'}
            hdri={walkMode ? null : HDRI_FOR[settings.environment]}
          />
          {/* Indoors the light reaching ceilings bounces off pale floors and walls, not grass:
              warm the hemisphere's ground colour so ceilings read as white, not taupe. */}
          <hemisphereLight
            args={[
              preset.hemiSky,
              walkMode && settings.environment !== 'night' ? `#${new THREE.Color(preset.hemiGround).lerp(new THREE.Color('#d2c6b2'), 0.65).getHexString()}` : preset.hemiGround,
              preset.hemiI * (walkMode ? 1.6 : 1),
            ]}
          />
          <directionalLight
            ref={sunRef}
            position={sunPos}
            intensity={preset.sunI * (walkMode ? 0.45 : 1)}
            color={preset.sun}
            castShadow={!walkMode}
            shadow-mapSize-width={shadowSize}
            shadow-mapSize-height={shadowSize}
            shadow-bias={-0.0004}
            shadow-normalBias={0.045}
            shadow-camera-left={-radius * 1.3}
            shadow-camera-right={radius * 1.3}
            shadow-camera-top={radius * 1.3}
            shadow-camera-bottom={-radius * 1.3}
            shadow-camera-near={0.5}
            shadow-camera-far={radius * 8}
            target={target}
          />
          {settings.environment === 'night' ? <pointLight position={[center.x, 2.2, center.z]} intensity={20} distance={18} color="#ffcf94" /> : null}
        </group>
      ) : (
        <group key="modeling-lighting">
          <hemisphereLight args={['#eef2f7', '#3b3f46', 1.35]} />
          <directionalLight position={sunPos} intensity={1.6} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-bias={-0.0003} shadow-normalBias={0.03} shadow-camera-left={-radius * 1.3} shadow-camera-right={radius * 1.3} shadow-camera-top={radius * 1.3} shadow-camera-bottom={-radius * 1.3} shadow-camera-far={radius * 8} target={target} />
          <directionalLight position={[-sunPos.x, sunPos.y * 0.5, -sunPos.z]} intensity={0.45} />
        </group>
      )}
    </>
  );
}
