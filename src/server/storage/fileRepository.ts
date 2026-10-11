/**
 * Zero-configuration JSON file repository, used when DATABASE_URL is not set
 * (local development, demos). Same contract as the PostgreSQL repository.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { Scene } from '@/core/schema/scene';
import type { AssetRecord, CreateProjectInput, ProjectRecord, Repository, UpdateProjectInput, VersionRecord } from './types';

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

export class FileRepository implements Repository {
  readonly kind = 'file' as const;
  constructor(private root: string) {}
  private p(...parts: string[]) {
    return path.join(this.root, ...parts);
  }

  async listProjects() {
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
        out.push(summary);
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getProject(id: string) {
    return readJson<ProjectRecord>(this.p('projects', `${safeId(id)}.json`));
  }

  async createProject(input: CreateProjectInput) {
    const now = new Date().toISOString();
    const rec: ProjectRecord = {
      id: nanoid(12),
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
    for (const s of await this.listProjects()) if (s.shareToken && s.shareToken === token) return this.getProject(s.id);
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
}
