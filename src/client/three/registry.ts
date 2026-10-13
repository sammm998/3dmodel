import type * as THREE from 'three';

/** Live map of element id → rendered object (for gizmos, outlines, tests). */
export const objectRegistry = new Map<string, THREE.Object3D>();

/** Subscribers notified whenever rendered element objects are added, rebuilt or removed. */
const registryListeners = new Set<() => void>();
export function onRegistryChange(fn: () => void): () => void {
  registryListeners.add(fn);
  return () => registryListeners.delete(fn);
}
export function notifyRegistryChange() {
  for (const fn of registryListeners) fn();
}

/** Shared handles set by the canvas (camera, renderer) for UI actions. */
export const viewportHandles: {
  gl?: THREE.WebGLRenderer;
  camera?: THREE.Camera;
  scene?: THREE.Scene;
  controls?: { target: THREE.Vector3; update: () => void } | null;
  /** Requests a frame (the canvas renders on demand outside walk mode). */
  invalidate?: () => void;
  container?: HTMLElement | null;
  /** Where the camera was when walk mode ended (orbit resumes from there). */
  walkExit?: { position: THREE.Vector3; target: THREE.Vector3 };
} = {};
