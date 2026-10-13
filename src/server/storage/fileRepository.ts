/**
 * Zero-configuration JSON file repository, used when DATABASE_URL is not set
 * (local development, demos). Same contract as the PostgreSQL repository.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { Scene } from '@/core/schema/scene';
import type { AssetRecord, CreateProjectInput, PlanId, ProjectRecord, ProjectSummary, Repository, SessionRecord, UpdateProjectInput, UserPatch, UserRecord, VersionRecord } from './types';

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${nanoid(6)}.tmp`;
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, file);
}

const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '');

/** Serialises read-modify-write sequences on the same key within this process. */
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    key,
    next.catch(() => {}).finally(() => {
      if (locks.get(key) === next) locks.delete(key);
    }),
  );
  return next;
}

export class FileRepository implements Repository {
  readonly kind = 'file' as const;
  constructor(private root: string) {}
  private p(...parts: string[]) {
    return path.join(this.root, ...parts);
  }

  async listProjects(ownerId?: string) {
    const all = await this.allProjects();
    return ownerId === undefined ? all : all.filter((p) => p.ownerId === ownerId);
  }

  async countProjects(ownerId: string) {
    return (await this.listProjects(ownerId)).length;
  }

  async claimOrphanProjects(ownerId: string) {
    let n = 0;
    for (const s of await this.allProjects()) {
      if (s.ownerId) continue;
      const rec = await this.getProject(s.id);
      if (!rec) continue;
      await writeJson(this.p('projects', `${rec.id}.json`), { ...rec, ownerId });
      n++;
    }
    return n;
  }

  private async allProjects(): Promise<ProjectSummary[]> {
    let files: string[] = [];
    try {
      files = await readdir(this.p('projects'));
    } catch {
      return [];
    }
    const out = [];
    for (const f of files.filter((x) => x.endsWith('.json'))) {
      const r = await readJson<ProjectRecord>(this.p('projects', f));
      if (r) {
        const { scene: _s, chat: _c, ...summary } = r;
        void _s;
        void _c;
        out.push({ ...summary, ownerId: summary.ownerId ?? null });
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getProject(id: string) {
    const r = await readJson<ProjectRecord>(this.p('projects', `${safeId(id)}.json`));
    return r ? { ...r, ownerId: r.ownerId ?? null } : null;
  }

  async createProject(input: CreateProjectInput) {
    const now = new Date().toISOString();
    const rec: ProjectRecord = {
      id: nanoid(12),
      ownerId: input.ownerId ?? null,
      name: input.name,
      description: input.description ?? '',
      createdAt: now,
      updatedAt: now,
      thumbnail: input.thumbnail ?? null,
      elementCount: input.scene.elements.length,
      shareToken: null,
      scene: input.scene,
      chat: [],
    };
    await writeJson(this.p('projects', `${rec.id}.json`), rec);
    return rec;
  }

  async updateProject(id: string, patch: UpdateProjectInput) {
    const rec = await this.getProject(id);
    if (!rec) return null;
    const next: ProjectRecord = {
      ...rec,
      ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
      elementCount: (patch.scene ?? rec.scene).elements.length,
      updatedAt: new Date().toISOString(),
    } as ProjectRecord;
    await writeJson(this.p('projects', `${rec.id}.json`), next);
    return next;
  }

  async deleteProject(id: string) {
    const rec = await this.getProject(id);
    if (!rec) return false;
    await rm(this.p('projects', `${rec.id}.json`), { force: true });
    await rm(this.p('versions', rec.id), { recursive: true, force: true });
    return true;
  }

  async listVersions(projectId: string) {
    let files: string[] = [];
    try {
      files = await readdir(this.p('versions', safeId(projectId)));
    } catch {
      return [];
    }
    const out: VersionRecord[] = [];
    for (const f of files) {
      const v = await readJson<VersionRecord>(this.p('versions', safeId(projectId), f));
      if (v) {
        const { scene: _s, ...rest } = v;
        void _s;
        out.push(rest);
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createVersion(projectId: string, label: string, scene: Scene, thumbnail: string | null) {
    const v: VersionRecord = { id: nanoid(12), projectId, label, createdAt: new Date().toISOString(), thumbnail, elementCount: scene.elements.length, scene };
    await writeJson(this.p('versions', safeId(projectId), `${v.id}.json`), v);
    const { scene: _s, ...rest } = v;
    void _s;
    return rest;
  }

  getVersion(projectId: string, versionId: string) {
    return readJson<VersionRecord>(this.p('versions', safeId(projectId), `${safeId(versionId)}.json`));
  }

  async setShareToken(projectId: string, token: string | null) {
    const rec = await this.getProject(projectId);
    if (!rec) return;
    await writeJson(this.p('projects', `${rec.id}.json`), { ...rec, shareToken: token });
  }

  async getProjectByShareToken(token: string) {
    for (const s of await this.allProjects()) if (s.shareToken && s.shareToken === token) return this.getProject(s.id);
    return null;
  }

  async listAssets(projectId: string) {
    let files: string[] = [];
    try {
      files = await readdir(this.p('assets'));
    } catch {
      return [];
    }
    const out: AssetRecord[] = [];
    for (const f of files) {
      const a = await readJson<AssetRecord>(this.p('assets', f));
      if (a && a.projectId === projectId) out.push(a);
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createAsset(a: Omit<AssetRecord, 'id' | 'createdAt'>) {
    const rec: AssetRecord = { ...a, id: nanoid(12), createdAt: new Date().toISOString() };
    await writeJson(this.p('assets', `${rec.id}.json`), rec);
    return rec;
  }

  getAsset(id: string) {
    return readJson<AssetRecord>(this.p('assets', `${safeId(id)}.json`));
  }

  async updateAssetAnalysis(id: string, analysis: unknown) {
    const a = await this.getAsset(id);
    if (a) await writeJson(this.p('assets', `${a.id}.json`), { ...a, analysis });
  }

  async deleteAsset(id: string) {
    const a = await this.getAsset(id);
    if (!a) return false;
    await rm(this.p('assets', `${a.id}.json`), { force: true });
    return true;
  }

  // ---- accounts -------------------------------------------------------------

  private async allUsers(): Promise<UserRecord[]> {
    let files: string[] = [];
    try {
      files = await readdir(this.p('users'));
    } catch {
      return [];
    }
    const out: UserRecord[] = [];
    for (const f of files.filter((x) => x.endsWith('.json'))) {
      const u = await readJson<UserRecord>(this.p('users', f));
      if (u) out.push(u);
    }
    return out;
  }

  async countUsers() {
    return (await this.allUsers()).length;
  }

  createUser(input: { email: string; name: string; passwordHash: string; plan?: PlanId }) {
    return withLock('users', async () => {
      if (await this.getUserByEmail(input.email)) throw new Error('duplicate key value violates unique constraint "users_email_key"');
      const u: UserRecord = {
        id: nanoid(14),
        email: input.email,
        name: input.name,
        passwordHash: input.passwordHash,
        plan: input.plan ?? 'free',
        planStatus: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        currentPeriodEnd: null,
        createdAt: new Date().toISOString(),
      };
      await writeJson(this.p('users', `${u.id}.json`), u);
      return u;
    });
  }

  getUserById(id: string) {
    return readJson<UserRecord>(this.p('users', `${safeId(id)}.json`));
  }

  async getUserByEmail(email: string) {
    return (await this.allUsers()).find((u) => u.email === email) ?? null;
  }

  async getUserByStripeCustomer(customerId: string) {
    return (await this.allUsers()).find((u) => u.stripeCustomerId === customerId) ?? null;
  }

  updateUser(id: string, patch: UserPatch) {
    return withLock(`user:${id}`, async () => {
      const u = await this.getUserById(id);
      if (!u) return null;
      const next = { ...u, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as UserRecord;
      await writeJson(this.p('users', `${u.id}.json`), next);
      return next;
    });
  }

  async deleteUser(id: string) {
    for (const p of await this.listProjects(id)) {
      for (const a of await this.listAssets(p.id)) await this.deleteAsset(a.id);
      await this.deleteProject(p.id);
    }
    let files: string[] = [];
    try {
      files = await readdir(this.p('sessions'));
    } catch {
      /* none */
    }
    for (const f of files) {
      const s = await readJson<SessionRecord>(this.p('sessions', f));
      if (s?.userId === id) await rm(this.p('sessions', f), { force: true });
    }
    await rm(this.p('usage', `${safeId(id)}.json`), { force: true });
    await rm(this.p('users', `${safeId(id)}.json`), { force: true });
  }

  async createSession(tokenHash: string, userId: string, expiresAt: Date) {
    await writeJson(this.p('sessions', `${safeId(tokenHash)}.json`), { userId, expiresAt: expiresAt.toISOString() } satisfies SessionRecord);
  }

  async getSession(tokenHash: string) {
    const s = await readJson<SessionRecord>(this.p('sessions', `${safeId(tokenHash)}.json`));
    if (!s) return null;
    if (new Date(s.expiresAt).getTime() < Date.now()) {
      await this.deleteSession(tokenHash);
      return null;
    }
    return s;
  }

  async deleteSession(tokenHash: string) {
    await rm(this.p('sessions', `${safeId(tokenHash)}.json`), { force: true });
  }

  incrementUsage(userId: string, period: string, metric: string, amount: number) {
    return withLock(`usage:${userId}`, async () => {
      const file = this.p('usage', `${safeId(userId)}.json`);
      const all = (await readJson<Record<string, Record<string, number>>>(file)) ?? {};
      const cur = all[period] ?? {};
      cur[metric] = (cur[metric] ?? 0) + amount;
      all[period] = cur;
      await writeJson(file, all);
      return cur[metric];
    });
  }

  async getUsage(userId: string, period: string) {
    const all = (await readJson<Record<string, Record<string, number>>>(this.p('usage', `${safeId(userId)}.json`))) ?? {};
    return all[period] ?? {};
  }
}
