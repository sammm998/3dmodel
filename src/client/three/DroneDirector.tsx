'use client';
/**
 * Records a drone flight through the model as a video.
 *
 * Every frame is rendered at a fixed point in the timeline and encoded with
 * WebCodecs (H.264 in MP4) with exact timestamps, so the video is perfectly
 * smooth whatever the device's real-time frame rate. Browsers without
 * WebCodecs fall back to MediaRecorder (real-time WebM).
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { useEditor, type VideoSettings } from '../store/editor';
import { objectRegistry } from './registry';
import { INDOOR_HEIGHT, planDroneFlight, smoothPath, type Vec3 } from '@/core/video/dronePath';
import { animateDoors, collectDoorParts, resetDoors, type DoorPart } from '@/core/geometry/doorMotion';
import { WalkPhysics } from '@/core/geometry/walkPhysics';

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Timeline {
  frames: number;
  pose: (t: number) => { position: THREE.Vector3; target: THREE.Vector3; fade: number };
}

/** Arc-length parametrised sampled path. */
function arcPath(points: Vec3[]) {
  const pts = points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const length = acc[acc.length - 1] ?? 0;
  const at = (s: number) => {
    if (!pts.length) return new THREE.Vector3();
    const x = Math.max(0, Math.min(length, s));
    let lo = 0;
    let hi = acc.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (acc[mid] <= x) lo = mid;
      else hi = mid;
    }
    const seg = acc[hi] - acc[lo];
    return pts[lo].clone().lerp(pts[hi], seg > 1e-9 ? (x - acc[lo]) / seg : 0);
  };
  return { length, at };
}

function buildTimeline(settings: VideoSettings): Timeline {
  const scene = useEditor.getState().scene;
  const plan = planDroneFlight(scene);
  const T = settings.seconds;
  const c = new THREE.Vector3(plan.center.x, 0, plan.center.z);
  const lookAtBuilding = new THREE.Vector3(c.x, (scene.levels[0]?.elevation ?? 0) + plan.height * 0.4, c.z);
  const interior = arcPath(smoothPath(plan.interior));
  const hasInterior = !!plan.approach && interior.length > 4;

  // Time budget: establishing orbit, interior flight, exterior pull-back.
  let Ti = hasInterior ? 0.22 * T : 0.6 * T;
  let Tm = hasInterior ? 0.63 * T : 0;
  let L = interior.length;
  if (hasInterior) {
    const vMax = 2.2;
    const vMin = 0.9;
    if (L / Tm > vMax) L = vMax * Tm; // long tours end in the room reached in time
    if (L / Tm < vMin) {
      const spare = Tm - L / vMin;
      Tm -= spare;
      Ti += spare * 0.6;
    }
  }
  const To = T - Ti - Tm;
  const v = hasInterior ? L / Tm : 0;
  const LOOK = 2.2;

  const A = plan.approach ? new THREE.Vector3(plan.approach.x, plan.approach.y, plan.approach.z) : c.clone().add(new THREE.Vector3(plan.radius * 1.4, plan.height, plan.radius * 1.4));
  const thetaA = Math.atan2(A.z - c.z, A.x - c.x);
  const rA = Math.hypot(A.x - c.x, A.z - c.z);
  const R0 = plan.radius * 2.6 + 6;
  const H0 = (scene.levels[0]?.elevation ?? 0) + plan.height * 1.6 + 8;

  const pose = (t: number) => {
    if (t < Ti) {
      const u = ease(t / Ti);
      const theta = thetaA - 2.2 * (1 - u);
      const r = R0 + (rA - R0) * u;
      const h = H0 + (A.y - H0) * u;
      const position = new THREE.Vector3(c.x + Math.cos(theta) * r, h, c.z + Math.sin(theta) * r);
      const handoff = hasInterior ? interior.at(LOOK) : lookAtBuilding;
      const target = lookAtBuilding.clone().lerp(handoff, smoothstep(0.55, 1, t / Ti));
      return { position, target, fade: smoothstep(0, 0.8, t) };
    }
    if (t < Ti + Tm) {
      const s = v * (t - Ti);
      const position = interior.at(s);
      const target = interior.at(s + LOOK);
      // Fade through black into the exterior pull-back.
      return { position, target, fade: 1 - smoothstep(Ti + Tm - 0.7, Ti + Tm, t) };
    }
    const u = ease(Math.min(1, (t - Ti - Tm) / Math.max(To, 0.001)));
    const theta = thetaA + 0.5 + 1.0 * u;
    const r = plan.radius * 1.5 + 4 + plan.radius * 1.8 * u;
    const h = (scene.levels[0]?.elevation ?? 0) + plan.height * 0.7 + plan.height * 1.6 * u + 4 * u;
    const position = new THREE.Vector3(c.x + Math.cos(theta) * r, h, c.z + Math.sin(theta) * r);
    const fadeIn = hasInterior ? smoothstep(Ti + Tm, Ti + Tm + 0.7, t) : 1;
    const fadeOut = 1 - smoothstep(T - 0.8, T, t);
    return { position, target: lookAtBuilding.clone(), fade: Math.min(fadeIn, fadeOut) };
  };
  return { frames: Math.round(T * settings.fps), pose };
}

/** Encodes composited frames to MP4 (WebCodecs) or WebM (MediaRecorder fallback). */
class Encoder {
  private muxer?: Muxer<ArrayBufferTarget>;
  private enc?: VideoEncoder;
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private failed: Error | null = null;
  readonly webcodecs: boolean;
  codecLabel = 'WebM';
  constructor(
    private canvas: HTMLCanvasElement,
    private s: VideoSettings,
  ) {
    this.webcodecs = typeof window !== 'undefined' && 'VideoEncoder' in window;
  }

  async start() {
    if (this.webcodecs) {
      const bitrate = this.s.height >= 1080 ? 12_000_000 : 6_000_000;
      // H.264 first (plays everywhere, incl. QuickTime/iOS), VP9 in MP4 as a fallback.
      const candidates: [string, 'avc' | 'vp9'][] = [
        ['avc1.640028', 'avc'],
        ['avc1.4d0028', 'avc'],
        ['avc1.42e028', 'avc'],
        ['vp09.00.40.08', 'vp9'],
      ];
      let codec: [string, 'avc' | 'vp9'] | null = null;
      for (const c of candidates) {
        try {
          const r = await VideoEncoder.isConfigSupported({ codec: c[0], width: this.s.width, height: this.s.height, bitrate, framerate: this.s.fps });
          if (r.supported) {
            codec = c;
            break;
          }
        } catch {
          /* try next */
        }
      }
      if (codec) {
        this.codecLabel = codec[1] === 'avc' ? 'MP4 (H.264)' : 'MP4 (VP9)';
        this.muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: codec[1], width: this.s.width, height: this.s.height, frameRate: this.s.fps }, fastStart: 'in-memory' });
        this.enc = new VideoEncoder({
          output: (chunk, meta) => this.muxer!.addVideoChunk(chunk, meta),
          error: (e) => (this.failed = e as Error),
        });
        this.enc.configure({ codec: codec[0], width: this.s.width, height: this.s.height, bitrate, framerate: this.s.fps });
        return;
      }
      (this as { webcodecs: boolean }).webcodecs = false;
    }
    const stream = this.canvas.captureStream(this.s.fps);
    const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    this.recorder = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 8_000_000 });
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(500);
  }

  /** Back-pressure: true while the encoder is still busy with earlier frames. */
  busy() {
    return !!this.enc && this.enc.encodeQueueSize > 6;
  }

  add(index: number) {
    if (this.failed) throw this.failed;
    if (!this.enc) return;
    const us = Math.round((index * 1e6) / this.s.fps);
    const frame = new VideoFrame(this.canvas, { timestamp: us, duration: Math.round(1e6 / this.s.fps) });
    this.enc.encode(frame, { keyFrame: index % (this.s.fps * 2) === 0 });
    frame.close();
  }

  async finish(): Promise<{ blob: Blob; mime: string; ext: string; label: string }> {
    if (this.enc && this.muxer) {
      await this.enc.flush();
      this.enc.close();
      this.muxer.finalize();
      return { blob: new Blob([this.muxer.target.buffer], { type: 'video/mp4' }), mime: 'video/mp4', ext: 'mp4', label: this.codecLabel };
    }
    const rec = this.recorder!;
    await new Promise<void>((r) => {
      rec.onstop = () => r();
      rec.stop();
    });
    const mime = rec.mimeType || 'video/webm';
    return { blob: new Blob(this.chunks, { type: mime }), mime, ext: mime.includes('mp4') ? 'mp4' : 'webm', label: mime.includes('mp4') ? 'MP4' : 'WebM' };
  }

  dispose() {
    try {
      if (this.enc && this.enc.state !== 'closed') this.enc.close();
    } catch {
      /* already closed */
    }
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
  }
}

export function DroneDirector() {
  const { camera, gl, invalidate } = useThree();
  const state = useRef<{
    timeline: Timeline;
    settings: VideoSettings;
    encoder: Encoder;
    composite: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    frame: number;
    pendingFade: number | null;
    target: THREE.Vector3;
    doors: DoorPart[];
    ready: boolean;
    done: boolean;
    title: string;
  } | null>(null);

  useEffect(() => {
    const st = useEditor.getState();
    const settings = st.video.settings ?? { seconds: 45, width: 1920, height: 1080, fps: 30 };
    const composite = document.createElement('canvas');
    composite.width = settings.width;
    composite.height = settings.height;
    const ctx = composite.getContext('2d')!;
    const persp = camera as THREE.PerspectiveCamera;
    const prev = { fov: persp.fov, near: persp.near, position: camera.position.clone(), quaternion: camera.quaternion.clone() };
    if (persp.isPerspectiveCamera) {
      persp.fov = 62;
      persp.near = 0.08;
      persp.updateProjectionMatrix();
    }
    const doors: DoorPart[] = [];
    for (const el of st.scene.elements) {
      if (el.type !== 'door') continue;
      const obj = objectRegistry.get(el.id);
      const c = obj && WalkPhysics.collider(obj);
      if (obj && c) doors.push(...collectDoorParts(obj, c.box));
    }
    const encoder = new Encoder(composite, settings);
    const s = {
      timeline: buildTimeline(settings),
      settings,
      encoder,
      composite,
      ctx,
      frame: 0,
      pendingFade: null as number | null,
      target: new THREE.Vector3(),
      doors,
      ready: false,
      done: false,
      title: st.projectName,
    };
    state.current = s;
    encoder
      .start()
      .then(() => {
        s.ready = true;
        invalidate();
      })
      .catch((e) => fail(e));
    return () => {
      encoder.dispose();
      resetDoors(doors);
      if (persp.isPerspectiveCamera) {
        persp.fov = prev.fov;
        persp.near = prev.near;
        persp.updateProjectionMatrix();
      }
      camera.position.copy(prev.position);
      camera.quaternion.copy(prev.quaternion);
      state.current = null;
    };
  }, [camera, invalidate]);

  function fail(e: unknown) {
    const st = useEditor.getState();
    st.set({ droneMode: false, viewMode: st.video.returnViewMode ?? st.viewMode, video: { ...st.video, status: 'error', error: e instanceof Error ? e.message : String(e) } });
  }

  /** Copies the rendered canvas into the output frame (16:9 cover crop) with fades and the title. */
  function composeFrame(s: NonNullable<typeof state.current>, fade: number, t: number) {
    const src = gl.domElement;
    const { width: W, height: H } = s.composite;
    const sa = src.width / src.height;
    const da = W / H;
    let sw = src.width;
    let sh = src.height;
    if (sa > da) sw = sh * da;
    else sh = sw / da;
    const ctx = s.ctx;
    ctx.globalAlpha = 1;
    ctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, W, H);
    // Title during the opening seconds.
    const titleAlpha = smoothstep(0.6, 1.6, t) * (1 - smoothstep(4.2, 5.2, t));
    if (titleAlpha > 0) {
      const k = H / 1080;
      ctx.globalAlpha = titleAlpha * 0.55;
      const grad = ctx.createLinearGradient(0, H * 0.6, 0, H);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.85)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, H * 0.6, W, H * 0.4);
      ctx.globalAlpha = titleAlpha;
      ctx.fillStyle = '#f6f3ec';
      ctx.font = `${Math.round(64 * k)}px Georgia, 'Times New Roman', serif`;
      ctx.fillText(s.title, 80 * k, H - 120 * k);
      ctx.font = `${Math.round(22 * k)}px system-ui, sans-serif`;
      ctx.globalAlpha = titleAlpha * 0.75;
      ctx.fillText('AI 3D Studio', 82 * k, H - 76 * k);
    }
    if (fade < 1) {
      ctx.globalAlpha = 1 - fade;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 1;
  }

  useFrame(() => {
    const s = state.current;
    if (!s || s.done) return;
    invalidate();
    if (!s.ready || s.encoder.busy()) return;
    const fps = s.settings.fps;
    try {
      // 1) The canvas now shows the frame posed on the previous tick: capture it.
      if (s.pendingFade !== null) {
        const idx = s.frame - 1;
        composeFrame(s, s.pendingFade, idx / fps);
        s.encoder.add(idx);
        s.pendingFade = null;
        if (s.frame % 10 === 0) useEditor.getState().set({ video: { ...useEditor.getState().video, progress: s.frame / s.timeline.frames } });
      }
      // 2) Finished?
      if (s.frame >= s.timeline.frames) {
        s.done = true;
        void s.encoder.finish().then(({ blob, ext, label }) => {
          const st = useEditor.getState();
          const base = (st.projectName || 'model').replace(/[^a-zA-Z0-9_-]+/g, '_');
          st.set({
            droneMode: false,
            viewMode: st.video.returnViewMode ?? st.viewMode,
            video: { ...st.video, status: 'done', progress: 1, url: URL.createObjectURL(blob), filename: `${base}_drone.${ext}`, mime: label },
          });
        }, fail);
        return;
      }
      // 3) Pose the camera for this frame; it is rendered right after this callback.
      const t = s.frame / fps;
      const p = s.timeline.pose(t);
      // Cuts (e.g. from the interior to the exterior pull-back) snap the gaze instead of panning.
      const cut = s.frame === 0 || camera.position.distanceTo(p.position) > 3;
      camera.position.copy(p.position);
      if (cut) s.target.copy(p.target);
      else s.target.lerp(p.target, 0.12);
      camera.up.set(0, 1, 0);
      camera.lookAt(s.target);
      animateDoors(s.doors, new THREE.Vector3(p.position.x, p.position.y - INDOOR_HEIGHT, p.position.z), 1 / fps);
      s.pendingFade = p.fade;
      s.frame++;
    } catch (e) {
      s.done = true;
      fail(e);
    }
  });

  return null;
}
