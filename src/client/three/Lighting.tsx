'use client';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { useEditor } from '../store/editor';
import { sceneBounds } from '@/core/scene/query';

const ENV_PRESETS = {
  day: { top: '#5f8fcf', horizon: '#dfe8f0', bottom: '#8a8f86', exposure: 1.0, sun: '#fff4e2', sunI: 3.2, hemiSky: '#cfe3ff', hemiGround: '#5b4f3f', hemiI: 0.55 },
  sunset: { top: '#3a4f7a', horizon: '#f2b27d', bottom: '#5a4a44', exposure: 0.95, sun: '#ffb27a', sunI: 2.6, hemiSky: '#ffd2a8', hemiGround: '#3d2f2a', hemiI: 0.45 },
  overcast: { top: '#9aa4ae', horizon: '#d9dde1', bottom: '#7c7f7c', exposure: 1.05, sun: '#eef1f5', sunI: 1.2, hemiSky: '#dfe4ea', hemiGround: '#55524c', hemiI: 0.9 },
  night: { top: '#05070d', horizon: '#1c2538', bottom: '#0a0b0e', exposure: 0.8, sun: '#9fb4ff', sunI: 0.35, hemiSky: '#3b4766', hemiGround: '#111318', hemiI: 0.35 },
};

/** Gradient sky dome with a soft sun glow (tone-mapping friendly). */
function GradientSky({ top, horizon, bottom, sunDir }: { top: string; horizon: string; bottom: string; sunDir: THREE.Vector3 }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
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
      }),
    [],
  );
  mat.uniforms.top.value.set(top).convertSRGBToLinear();
  mat.uniforms.horizon.value.set(horizon).convertSRGBToLinear();
  mat.uniforms.bottom.value.set(bottom).convertSRGBToLinear();
  mat.uniforms.sunDir.value.copy(sunDir);
  return (
    <mesh material={mat} scale={3000} frustumCulled={false} renderOrder={-1} raycast={() => {}}>
      <sphereGeometry args={[1, 32, 16]} />
    </mesh>
  );
}

/** Image-based reflections without network assets (procedural room environment). */
function EnvironmentMap({ intensity }: { intensity: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = intensity;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, intensity]);
  return null;
}

export function Lighting() {
  const viewMode = useEditor((s) => s.viewMode);
  const settings = useEditor((s) => s.scene.settings);
  const scene = useEditor((s) => s.scene);
  const { gl } = useThree();
  const realistic = viewMode !== 'modeling';
  const pathTrace = useEditor((s) => s.pathTrace) && realistic;
  const preset = ENV_PRESETS[settings.environment];

  const b = useMemo(() => sceneBounds(scene), [scene]);
  const center = b ? new THREE.Vector3((b.min.x + b.max.x) / 2, 0, (b.min.z + b.max.z) / 2) : new THREE.Vector3();
  const radius = b ? Math.max(8, Math.hypot(b.max.x - b.min.x, b.max.z - b.min.z) / 2 + 4) : 10;
  const az = THREE.MathUtils.degToRad(settings.sunAzimuth);
  const el = THREE.MathUtils.degToRad(settings.sunElevation);
  const sunDir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  const sunPos = center.clone().add(sunDir.clone().multiplyScalar(radius * 3));

  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = realistic ? preset.exposure : 1.0;
  }, [gl, realistic, preset.exposure]);

  const shadowSize = 4096;
  const target = useMemo(() => new THREE.Object3D(), []);
  target.position.copy(center);
  target.updateMatrixWorld();
  return (
    <>
      <primitive object={target} />
      {!realistic ? <color attach="background" args={['#15181d']} /> : null}
      {realistic ? (
        <group key="realistic-lighting">
          {!pathTrace ? <GradientSky top={preset.top} horizon={preset.horizon} bottom={preset.bottom} sunDir={sunDir} /> : null}
          {!pathTrace ? <EnvironmentMap intensity={settings.environment === 'night' ? 0.15 : 0.55} /> : null}
          <hemisphereLight args={[preset.hemiSky, preset.hemiGround, preset.hemiI]} />
          <directionalLight
            position={sunPos}
            intensity={preset.sunI}
            color={preset.sun}
            castShadow
            shadow-mapSize-width={shadowSize}
            shadow-mapSize-height={shadowSize}
            shadow-bias={-0.0002}
            shadow-normalBias={0.03}
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
