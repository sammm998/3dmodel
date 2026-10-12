import path from 'node:path';
import { FileRepository } from './fileRepository';
import { PostgresRepository } from './postgresRepository';
import type { Repository } from './types';

/** Directory for file storage: DATA_DIR, else a mounted Railway volume, else ./data. */
export function dataDir(): string {
  return process.env.DATA_DIR ?? process.env.RAILWAY_VOLUME_MOUNT_PATH ?? path.join(process.cwd(), 'data');
}

const onRailway = () => !!(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);

/** Whether file storage survives redeploys (local disk is fine outside container platforms). */
export function fileStorageIsPersistent(): boolean {
  if (process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH) return true;
  return !onRailway();
}

/** Turns low-level connection errors (incl. empty-message AggregateErrors) into an actionable explanation. */
export function describeDbError(e: unknown, url?: string): string {
  const inner: { code?: string; message?: string; address?: string; hostname?: string }[] =
    e instanceof AggregateError ? (e.errors as never[]) : [e as never];
  const codes = inner.map((x) => x?.code).filter(Boolean);
  let host = '';
  try {
    host = url ? new URL(url).hostname : '';
  } catch {
    /* unparsable URL */
  }
  const msg = (e as Error)?.message || inner.map((x) => x?.message).filter(Boolean).join('; ') || codes.join(', ') || String(e);
  if (/^(localhost|127\.0\.0\.1|::1)$/.test(host) && onRailway()) {
    return `DATABASE_URL points to ${host}, which on Railway is the app container itself (no database runs there). Remove DATABASE_URL, or set it to \${{Postgres.DATABASE_URL}} from a Railway PostgreSQL service. (${msg})`;
  }
  if (codes.includes('ECONNREFUSED')) return `Nothing is listening at ${host || 'the database host'} (connection refused). (${msg})`;
  if (codes.includes('ENOTFOUND') || codes.includes('EAI_AGAIN')) return `The database host "${host}" could not be found. (${msg})`;
  return msg;
}

/**
 * Uses PostgreSQL when DATABASE_URL is set and reachable. If it is not set, or
 * cannot be reached at startup, the app falls back to file storage instead of
 * failing — the reason is reported by /api/health and shown in the UI.
 */
class ResilientRepository implements Repository {
  private delegate: Repository;
  private ready: Promise<void>;
  fallbackReason: string | null = null;

  constructor(private url: string | undefined) {
    const file = new FileRepository(dataDir());
    if (!url) {
      this.delegate = file;
      this.ready = Promise.resolve();
      return;
    }
    const pg = PostgresRepository.fromUrl(url);
    this.delegate = pg;
    this.ready = pg.migrate().catch((e) => {
      this.fallbackReason = describeDbError(e, url);
      console.error(`[storage] PostgreSQL unavailable, using file storage in ${dataDir()}: ${this.fallbackReason}`);
      this.delegate = file;
      void pg.close().catch(() => {});
    });
  }

  get kind() {
    return this.delegate.kind;
  }

  async status() {
    await this.ready;
    return {
      kind: this.delegate.kind,
      databaseConfigured: !!this.url,
      fallbackReason: this.fallbackReason,
      persistent: this.delegate.kind === 'postgres' || fileStorageIsPersistent(),
    };
  }

  private async d() {
    await this.ready;
    return this.delegate;
  }

  listProjects: Repository['listProjects'] = async () => (await this.d()).listProjects();
  getProject: Repository['getProject'] = async (id) => (await this.d()).getProject(id);
  createProject: Repository['createProject'] = async (i) => (await this.d()).createProject(i);
  updateProject: Repository['updateProject'] = async (id, p) => (await this.d()).updateProject(id, p);
  deleteProject: Repository['deleteProject'] = async (id) => (await this.d()).deleteProject(id);
  listVersions: Repository['listVersions'] = async (id) => (await this.d()).listVersions(id);
  createVersion: Repository['createVersion'] = async (a, b, c, d) => (await this.d()).createVersion(a, b, c, d);
  getVersion: Repository['getVersion'] = async (a, b) => (await this.d()).getVersion(a, b);
  setShareToken: Repository['setShareToken'] = async (a, b) => (await this.d()).setShareToken(a, b);
  getProjectByShareToken: Repository['getProjectByShareToken'] = async (t) => (await this.d()).getProjectByShareToken(t);
  listAssets: Repository['listAssets'] = async (id) => (await this.d()).listAssets(id);
  createAsset: Repository['createAsset'] = async (a) => (await this.d()).createAsset(a);
  getAsset: Repository['getAsset'] = async (id) => (await this.d()).getAsset(id);
  updateAssetAnalysis: Repository['updateAssetAnalysis'] = async (id, a) => (await this.d()).updateAssetAnalysis(id, a);
  deleteAsset: Repository['deleteAsset'] = async (id) => (await this.d()).deleteAsset(id);
}

const g = globalThis as unknown as { __ai3dRepo?: ResilientRepository };

export function getRepository(): ResilientRepository {
  if (!g.__ai3dRepo) g.__ai3dRepo = new ResilientRepository(process.env.DATABASE_URL || undefined);
  return g.__ai3dRepo;
}

export type * from './types';
