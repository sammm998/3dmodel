import type * as THREE from 'three';

/** Live map of element id → rendered object (for gizmos, outlines, tests). */
export const objectRegistry = new Map<string, THREE.Object3D>();

/** Shared handles set by the canvas (camera, renderer) for UI actions. */
export const viewportHandles: {
  gl?: THREE.WebGLRenderer;
  camera?: THREE.Camera;
  scene?: THREE.Scene;
  controls?: { target: THREE.Vector3; update: () => void } | null;
  container?: HTMLElement | null;
} = {};
