/**
 * Door leaves that open as a first-person walker approaches and close behind
 * them (moving parts are tagged by buildDoor with userData.doorPart).
 */
import * as THREE from 'three';

/** An animated door leaf (see buildDoor: userData.doorPart). */
export interface DoorPart {
  part: THREE.Object3D;
  kind: 'hinge' | 'slide' | 'lift';
  amount: number;
  hinge: number;
  center: THREE.Vector3;
  normal: THREE.Vector3;
  closedPos: THREE.Vector3;
  closedQuat: THREE.Quaternion;
  t: number;
  side: number;
}

export function collectDoorParts(obj: THREE.Object3D, box: THREE.Box3): DoorPart[] {
  const out: DoorPart[] = [];
  const center = box.getCenter(new THREE.Vector3());
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    const data = o.userData.doorPart as { kind: 'hinge'; hinge: number } | { kind: 'slide'; dx: number } | { kind: 'lift'; dy: number } | undefined;
    if (!data) return;
    const closed = (o.userData.closed ??= { position: o.position.clone(), quaternion: o.quaternion.clone() }) as { position: THREE.Vector3; quaternion: THREE.Quaternion };
    const parentQ = o.parent ? o.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(parentQ.multiply(closed.quaternion)).setY(0).normalize();
    out.push({
      part: o,
      kind: data.kind,
      amount: data.kind === 'hinge' ? 0 : data.kind === 'slide' ? data.dx : data.dy,
      hinge: data.kind === 'hinge' ? data.hinge : 0,
      center,
      normal,
      closedPos: closed.position.clone(),
      closedQuat: closed.quaternion.clone(),
      t: 0,
      side: 1,
    });
  });
  return out;
}

const OPEN_DISTANCE = 1.9;
const DOOR_SPEED = 1.8; // fraction of full travel per second
const smooth = (x: number) => x * x * (3 - 2 * x);

/** Doors open as the walker approaches (away from them) and close again behind. */
export function animateDoors(parts: DoorPart[], feet: THREE.Vector3, dt: number) {
  for (const d of parts) {
    const dx = feet.x - d.center.x;
    const dz = feet.z - d.center.z;
    const near = Math.hypot(dx, dz) < OPEN_DISTANCE && Math.abs(feet.y - (d.center.y - 1)) < 2;
    // Pick the swing side while closed: always away from the walker.
    if (d.t < 0.02) d.side = dx * d.normal.x + dz * d.normal.z >= 0 ? 1 : -1;
    const target = near ? 1 : 0;
    if (d.t === target) continue;
    d.t = target > d.t ? Math.min(1, d.t + dt * DOOR_SPEED) : Math.max(0, d.t - dt * DOOR_SPEED);
    applyDoor(d, smooth(d.t));
  }
}

export function applyDoor(d: DoorPart, e: number) {
  const p = d.part;
  if (d.kind === 'hinge') {
    const angle = -d.side * d.hinge * (Math.PI / 2) * 0.96 * e;
    p.quaternion.copy(d.closedQuat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle));
  } else if (d.kind === 'slide') {
    p.position.copy(d.closedPos).add(new THREE.Vector3(d.amount * e, 0, 0).applyQuaternion(d.closedQuat));
  } else {
    p.position.copy(d.closedPos).add(new THREE.Vector3(0, d.amount * e, 0));
  }
  // Collision rays in the same frame must see the new pose.
  p.updateMatrixWorld(true);
}

export function resetDoors(parts: DoorPart[]) {
  for (const d of parts) {
    d.t = 0;
    applyDoor(d, 0);
  }
}

