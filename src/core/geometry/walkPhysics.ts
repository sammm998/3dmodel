/**
 * First-person walking physics against the real element geometry:
 * capsule-like collision (rays at knee/chest/head height), gravity, and
 * automatic step-up so stairs can be climbed. Renderer-independent.
 */
import * as THREE from 'three';

export const WALK = {
  eye: 1.65,
  /** Minimum distance from the eye to any surface (camera near plane is 0.05). */
  eyeClearance: 0.15,
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
    /** Everything visible; the eye may never come close to any of it. */
    public solid: Collider[] = [],
  ) {}

  private static EYE_DIRS = [
    ...Array.from({ length: 8 }, (_, i) => new THREE.Vector3(Math.cos((i / 8) * Math.PI * 2), 0, Math.sin((i / 8) * Math.PI * 2))),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0.7071, 0.7071, 0),
    new THREE.Vector3(-0.7071, 0.7071, 0),
    new THREE.Vector3(0, 0.7071, 0.7071),
    new THREE.Vector3(0, 0.7071, -0.7071),
  ];

  /**
   * True when no surface is within `eyeClearance` of the eye at feet position
   * (x, y, z). Guarantees the near plane never slices through geometry, which
   * is what renders as shards of wall, floor and frames.
   */
  eyeClear(x: number, y: number, z: number): boolean {
    if (!this.solid.length) return true;
    const eye = new THREE.Vector3(x, y + WALK.eye, z);
    const objs = this.nearby(this.solid, eye, WALK.eyeClearance + 0.2);
    if (!objs.length) return true;
    for (const dir of WalkPhysics.EYE_DIRS) {
      this.ray.set(eye, dir);
      this.ray.far = WALK.eyeClearance;
      if (this.ray.intersectObjects(objs, true).length) return false;
    }
    return true;
  }

  /** Free flight: no gravity or walking collision, but the eye still keeps its clearance. */
  fly(move: THREE.Vector3) {
    for (const axis of ['x', 'y', 'z'] as const) {
      const d = move[axis];
      if (Math.abs(d) < 1e-7) continue;
      const next = this.feet.clone();
      next[axis] += d;
      if (this.eyeClear(next.x, next.y, next.z)) this.feet.copy(next);
    }
  }

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

  /**
   * Headroom at a candidate position: something walkable (a stair flight, a
   * slab edge, a roof) between step height and just above eye level means the
   * player would walk into it from below or from the side.
   */
  private noHeadroom(x: number, z: number, reach = WALK.radius * 0.7, slope = 1): boolean {
    const p = new THREE.Vector3(x, this.feet.y + WALK.step + 0.05, z);
    const objs = this.nearby(this.ground, p, 0.5);
    if (!objs.length) return false;
    this.ray.set(p, new THREE.Vector3(0, 1, 0));
    this.ray.far = WALK.eye + 0.2 - WALK.step;
    const down = new THREE.Vector3(0, -1, 0);
    const top = this.feet.y + WALK.eye + 0.2;
    for (const off of [
      [0, 0],
      [reach, 0],
      [-reach, 0],
      [0, reach],
      [0, -reach],
    ]) {
      // Underside of something overhead…
      this.ray.set(new THREE.Vector3(x + off[0], p.y, z + off[1]), new THREE.Vector3(0, 1, 0));
      this.ray.far = WALK.eye + 0.2 - WALK.step;
      if (this.ray.intersectObjects(objs, true).length) return true;
      // …or a surface higher than a step (e.g. a stair flight rising beside the path).
      this.ray.set(new THREE.Vector3(x + off[0], top, z + off[1]), down);
      // Rising ground ahead (a flight being climbed) is allowed up to `slope`.
      const dist = Math.hypot(x + off[0] - this.feet.x, z + off[1] - this.feet.z);
      this.ray.far = top - (p.y + dist * slope);
      if (this.ray.far > 0 && this.ray.intersectObjects(objs, true).length) return true;
    }
    return false;
  }

  /** True when the player can stand at (x, z) at the current height without touching anything. */
  isClear(x: number, z: number, margin = 0.1): boolean {
    if (this.noHeadroom(x, z, WALK.radius + margin, 0)) return false;
    if (!this.eyeClear(x, this.feet.y, z)) return false;
    const p = new THREE.Vector3(x, this.feet.y, z);
    const objs = this.nearby(this.block, p, 1);
    const saved = this.feet.clone();
    this.feet.set(x, this.feet.y, z);
    let clear = true;
    for (let a = 0; a < 8 && clear; a++) {
      const ang = (a / 8) * Math.PI * 2;
      if (this.blocked(new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang)), margin, objs)) clear = false;
    }
    this.feet.copy(saved);
    return clear;
  }

  /** Moves the player to the nearest free spot (rings of up to 3 m) on the same floor. */
  settle(): boolean {
    const { x, z } = this.feet;
    if (this.isClear(x, z)) return true;
    for (let r = 0.2; r <= 3.01; r += 0.2) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const nx = x + Math.cos(ang) * r;
        const nz = z + Math.sin(ang) * r;
        if (!this.isClear(nx, nz)) continue;
        const saved = this.feet.clone();
        this.feet.set(nx, this.feet.y, nz);
        const g = this.groundHeight();
        if (Math.abs(g - saved.y) < 0.3) {
          this.feet.y = g;
          return true;
        }
        this.feet.copy(saved);
      }
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
      if (this.blocked(dir, Math.abs(d), objs)) continue;
      const nx = this.feet.x + (axis === 'x' ? d + Math.sign(d) * WALK.radius : 0);
      const nz = this.feet.z + (axis === 'z' ? d + Math.sign(d) * WALK.radius : 0);
      if (this.noHeadroom(nx, nz)) continue;
      const next = this.feet.clone();
      next[axis] += d;
      if (!this.eyeClear(next.x, next.y, next.z)) continue;
      this.feet[axis] += d;
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
