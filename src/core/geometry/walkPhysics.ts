/**
 * First-person walking physics against the real element geometry:
 * capsule-like collision (rays at knee/chest/head height), gravity, and
 * automatic step-up so stairs can be climbed. Renderer-independent.
 */
import * as THREE from 'three';

export const WALK = {
  eye: 1.65,
  radius: 0.3,
  step: 0.45,
  walkSpeed: 1.7,
  runSpeed: 4.2,
  gravity: 18,
  jump: 5.2,
};

export interface Collider {
  obj: THREE.Object3D;
  box: THREE.Box3;
}

export class WalkPhysics {
  feet = new THREE.Vector3();
  vy = 0;
  onGround = false;
  private ray = new THREE.Raycaster();

  constructor(
    public block: Collider[] = [],
    public ground: Collider[] = [],
  ) {}

  static collider(obj: THREE.Object3D): Collider | null {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    return box.isEmpty() ? null : { obj, box };
  }

  private nearby(list: Collider[], p: THREE.Vector3, r: number): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const c of list) {
      if (p.x < c.box.min.x - r || p.x > c.box.max.x + r || p.z < c.box.min.z - r || p.z > c.box.max.z + r) continue;
      if (p.y < c.box.min.y - r - 2 || p.y > c.box.max.y + r) continue;
      out.push(c.obj);
    }
    return out;
  }

  private blocked(dir: THREE.Vector3, dist: number, objs: THREE.Object3D[]): boolean {
    if (!objs.length) return false;
    for (const h of [0.5, 1.2, 1.6]) {
      this.ray.set(new THREE.Vector3(this.feet.x, this.feet.y + h, this.feet.z), dir);
      this.ray.far = dist + WALK.radius;
      if (this.ray.intersectObjects(objs, true).length) return true;
    }
    return false;
  }

  /** Height of the walkable surface under the player (searching from step height down). */
  groundHeight(): number {
    const objs = this.nearby(this.ground, this.feet, 0.5);
    if (!objs.length) return -Infinity;
    this.ray.set(new THREE.Vector3(this.feet.x, this.feet.y + WALK.step + 0.05, this.feet.z), new THREE.Vector3(0, -1, 0));
    this.ray.far = 60;
    const hit = this.ray.intersectObjects(objs, true)[0];
    return hit ? hit.point.y : -Infinity;
  }

  /** Advances one frame. `move` is the desired horizontal displacement this frame. */
  step(move: THREE.Vector3, dt: number, jump = false) {
    const objs = this.nearby(this.block, this.feet, 1.5);
    for (const axis of ['x', 'z'] as const) {
      const d = move[axis];
      if (Math.abs(d) < 1e-7) continue;
      const dir = new THREE.Vector3(axis === 'x' ? Math.sign(d) : 0, 0, axis === 'z' ? Math.sign(d) : 0);
      if (!this.blocked(dir, Math.abs(d), objs)) this.feet[axis] += d;
    }
    if (jump && this.onGround) {
      this.vy = WALK.jump;
      this.onGround = false;
    }
    this.vy -= WALK.gravity * dt;
    this.feet.y += this.vy * dt;
    const g = this.groundHeight();
    if (this.feet.y <= g) {
      this.feet.y = g;
      this.vy = 0;
      this.onGround = true;
    } else this.onGround = this.feet.y - g < 0.05;
  }
}
