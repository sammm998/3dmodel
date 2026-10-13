import { Pool } from 'pg';
import { nanoid } from 'nanoid';
import type { Scene } from '@/core/schema/scene';
import type { AssetRecord, CreateProjectInput, PlanId, ProjectRecord, ProjectSummary, Repository, UpdateProjectInput, UserPatch, UserRecord, VersionRecord } from './types';

export const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS projects (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     scene JSONB NOT NULL,
     chat JSONB NOT NULL DEFAULT '[]'::jsonb,
     thumbnail TEXT,
     share_token TEXT UNIQUE,
     element_count INTEGER NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS project_versions (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     label TEXT NOT NULL,
     scene JSONB NOT NULL,
     thumbnail TEXT,
     element_count INTEGER NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS project_versions_project_idx ON project_versions(project_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS assets (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     filename TEXT NOT NULL,
     mime TEXT NOT NULL,
     size INTEGER NOT NULL,
     kind TEXT NOT NULL,
     storage_key TEXT NOT NULL,
     analysis JSONB,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS assets_project_idx ON assets(project_id)`,
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL DEFAULT '',
     password_hash TEXT NOT NULL,
     plan TEXT NOT NULL DEFAULT 'free',
     plan_status TEXT,
     stripe_customer_id TEXT UNIQUE,
     stripe_subscription_id TEXT,
     current_period_end TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at TIMESTAMPTZ NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS usage_counters (
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     period TEXT NOT NULL,
     metric TEXT NOT NULL,
     amount INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, period, metric)
   )`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES users(id) ON DELETE CASCADE`,
  `CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects(owner_id, updated_at DESC)`,
];

type Row = Record<string, any>;

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

function summary(r: Row): ProjectSummary {
  return {
    id: r.id,
    ownerId: r.owner_id ?? null,
    name: r.name,
    description: r.description,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    thumbnail: r.thumbnail ?? null,
    elementCount: r.element_count,
    shareToken: r.share_token ?? null,
  };
}

function project(r: Row): ProjectRecord {
  return { ...summary(r), scene: r.scene as Scene, chat: r.chat ?? [] };
}

function user(r: Row): UserRecord {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    passwordHash: r.password_hash,
    plan: r.plan as PlanId,
    planStatus: r.plan_status ?? null,
    stripeCustomerId: r.stripe_customer_id ?? null,
    stripeSubscriptionId: r.stripe_subscription_id ?? null,
    currentPeriodEnd: r.current_period_end ? iso(r.current_period_end) : null,
    createdAt: iso(r.created_at),
  };
}

const USER_COLS: Record<keyof UserPatch, string> = {
  email: 'email',
  name: 'name',
  passwordHash: 'password_hash',
  plan: 'plan',
  planStatus: 'plan_status',
  stripeCustomerId: 'stripe_customer_id',
  stripeSubscriptionId: 'stripe_subscription_id',
  currentPeriodEnd: 'current_period_end',
};

function asset(r: Row): AssetRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    filename: r.filename,
    mime: r.mime,
    size: r.size,
    kind: r.kind,
    storageKey: r.storage_key,
    analysis: r.analysis ?? null,
    createdAt: iso(r.created_at),
  };
}

export class PostgresRepository implements Repository {
  readonly kind = 'postgres' as const;
  private ready: Promise<void> | null = null;
  constructor(private pool: Pool) {}

  static fromUrl(url: string) {
    // Fail fast instead of hanging requests when the database is unreachable.
    return new PostgresRepository(
      new Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000, statement_timeout: 20_000, query_timeout: 25_000 }),
    );
  }

  /** Applies idempotent migrations once per process. */
  migrate(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        const client = await this.pool.connect();
        try {
          await client.query('SELECT pg_advisory_lock(424242)');
          await client.query(MIGRATIONS[0]);
          const { rows } = await client.query('SELECT version FROM schema_migrations');
          const done = new Set(rows.map((r) => r.version));
          for (let i = 1; i < MIGRATIONS.length; i++) {
            if (done.has(i)) continue;
            await client.query(MIGRATIONS[i]);
            await client.query('INSERT INTO schema_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING', [i]);
          }
        } finally {
          await client.query('SELECT pg_advisory_unlock(424242)').catch(() => {});
          client.release();
        }
      })().catch((e) => {
        this.ready = null;
        throw e;
      });
    }
    return this.ready;
  }

  private async q(sql: string, params: unknown[] = []) {
    await this.migrate();
    return this.pool.query(sql, params);
  }

  async listProjects(ownerId?: string) {
    const cols = 'id, owner_id, name, description, thumbnail, share_token, element_count, created_at, updated_at';
    const { rows } =
      ownerId === undefined
        ? await this.q(`SELECT ${cols} FROM projects ORDER BY updated_at DESC`)
        : await this.q(`SELECT ${cols} FROM projects WHERE owner_id = $1 ORDER BY updated_at DESC`, [ownerId]);
    return rows.map(summary);
  }

  async countProjects(ownerId: string) {
    const { rows } = await this.q('SELECT count(*)::int AS n FROM projects WHERE owner_id = $1', [ownerId]);
    return rows[0].n as number;
  }

  async claimOrphanProjects(ownerId: string) {
    const { rowCount } = await this.q('UPDATE projects SET owner_id = $1 WHERE owner_id IS NULL', [ownerId]);
    return rowCount ?? 0;
  }

  async getProject(id: string) {
    const { rows } = await this.q('SELECT * FROM projects WHERE id = $1', [id]);
    return rows[0] ? project(rows[0]) : null;
  }

  async createProject(input: CreateProjectInput) {
    const id = nanoid(12);
    const { rows } = await this.q(
      `INSERT INTO projects (id, owner_id, name, description, scene, thumbnail, element_count) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, input.ownerId ?? null, input.name, input.description ?? '', JSON.stringify(input.scene), input.thumbnail ?? null, input.scene.elements.length],
    );
    return project(rows[0]);
  }

  async updateProject(id: string, patch: UpdateProjectInput) {
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (patch.name !== undefined) add('name', patch.name);
    if (patch.description !== undefined) add('description', patch.description);
    if (patch.scene !== undefined) {
      add('scene', JSON.stringify(patch.scene));
      add('element_count', patch.scene.elements.length);
    }
    if (patch.chat !== undefined) add('chat', JSON.stringify(patch.chat));
    if (patch.thumbnail !== undefined) add('thumbnail', patch.thumbnail);
    sets.push('updated_at = now()');
    params.push(id);
    const { rows } = await this.q(`UPDATE projects SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    return rows[0] ? project(rows[0]) : null;
  }

  async deleteProject(id: string) {
    const { rowCount } = await this.q('DELETE FROM projects WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  }

  async listVersions(projectId: string) {
    const { rows } = await this.q('SELECT id, project_id, label, thumbnail, element_count, created_at FROM project_versions WHERE project_id = $1 ORDER BY created_at DESC', [projectId]);
    return rows.map((r) => ({ id: r.id, projectId: r.project_id, label: r.label, thumbnail: r.thumbnail, elementCount: r.element_count, createdAt: iso(r.created_at) }));
  }

  async createVersion(projectId: string, label: string, scene: Scene, thumbnail: string | null): Promise<VersionRecord> {
    const id = nanoid(12);
    const { rows } = await this.q(
      'INSERT INTO project_versions (id, project_id, label, scene, thumbnail, element_count) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, project_id, label, thumbnail, element_count, created_at',
      [id, projectId, label, JSON.stringify(scene), thumbnail, scene.elements.length],
    );
    const r = rows[0];
    return { id: r.id, projectId: r.project_id, label: r.label, thumbnail: r.thumbnail, elementCount: r.element_count, createdAt: iso(r.created_at) };
  }

  async getVersion(projectId: string, versionId: string) {
    const { rows } = await this.q('SELECT * FROM project_versions WHERE id = $1 AND project_id = $2', [versionId, projectId]);
    const r = rows[0];
    return r ? { id: r.id, projectId: r.project_id, label: r.label, thumbnail: r.thumbnail, elementCount: r.element_count, createdAt: iso(r.created_at), scene: r.scene } : null;
  }

  async setShareToken(projectId: string, token: string | null) {
    await this.q('UPDATE projects SET share_token = $1 WHERE id = $2', [token, projectId]);
  }

  async getProjectByShareToken(token: string) {
    const { rows } = await this.q('SELECT * FROM projects WHERE share_token = $1', [token]);
    return rows[0] ? project(rows[0]) : null;
  }

  async listAssets(projectId: string) {
    const { rows } = await this.q('SELECT * FROM assets WHERE project_id = $1 ORDER BY created_at DESC', [projectId]);
    return rows.map(asset);
  }

  async createAsset(a: Omit<AssetRecord, 'id' | 'createdAt'>) {
    const id = nanoid(12);
    const { rows } = await this.q(
      'INSERT INTO assets (id, project_id, filename, mime, size, kind, storage_key, analysis) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [id, a.projectId, a.filename, a.mime, a.size, a.kind, a.storageKey, a.analysis ? JSON.stringify(a.analysis) : null],
    );
    return asset(rows[0]);
  }

  async getAsset(id: string) {
    const { rows } = await this.q('SELECT * FROM assets WHERE id = $1', [id]);
    return rows[0] ? asset(rows[0]) : null;
  }

  async updateAssetAnalysis(id: string, analysis: unknown) {
    await this.q('UPDATE assets SET analysis = $1 WHERE id = $2', [JSON.stringify(analysis), id]);
  }

  async deleteAsset(id: string) {
    const { rowCount } = await this.q('DELETE FROM assets WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  }

  async countUsers() {
    const { rows } = await this.q('SELECT count(*)::int AS n FROM users');
    return rows[0].n as number;
  }

  async createUser(input: { email: string; name: string; passwordHash: string; plan?: PlanId }) {
    const { rows } = await this.q('INSERT INTO users (id, email, name, password_hash, plan) VALUES ($1,$2,$3,$4,$5) RETURNING *', [
      nanoid(14),
      input.email,
      input.name,
      input.passwordHash,
      input.plan ?? 'free',
    ]);
    return user(rows[0]);
  }

  async getUserById(id: string) {
    const { rows } = await this.q('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ? user(rows[0]) : null;
  }

  async getUserByEmail(email: string) {
    const { rows } = await this.q('SELECT * FROM users WHERE email = $1', [email]);
    return rows[0] ? user(rows[0]) : null;
  }

  async getUserByStripeCustomer(customerId: string) {
    const { rows } = await this.q('SELECT * FROM users WHERE stripe_customer_id = $1', [customerId]);
    return rows[0] ? user(rows[0]) : null;
  }

  async updateUser(id: string, patch: UserPatch) {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      params.push(v);
      sets.push(`${USER_COLS[k as keyof UserPatch]} = $${params.length}`);
    }
    if (!sets.length) return this.getUserById(id);
    params.push(id);
    const { rows } = await this.q(`UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    return rows[0] ? user(rows[0]) : null;
  }

  async deleteUser(id: string) {
    // projects (and their versions/assets), sessions and usage cascade.
    await this.q('DELETE FROM users WHERE id = $1', [id]);
  }

  async createSession(tokenHash: string, userId: string, expiresAt: Date) {
    await this.q('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [tokenHash, userId, expiresAt]);
    // Opportunistic cleanup of expired sessions.
    await this.q('DELETE FROM sessions WHERE expires_at < now()');
  }

  async getSession(tokenHash: string) {
    const { rows } = await this.q('SELECT user_id, expires_at FROM sessions WHERE token_hash = $1 AND expires_at > now()', [tokenHash]);
    return rows[0] ? { userId: rows[0].user_id as string, expiresAt: iso(rows[0].expires_at) } : null;
  }

  async deleteSession(tokenHash: string) {
    await this.q('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }

  async incrementUsage(userId: string, period: string, metric: string, amount: number) {
    const { rows } = await this.q(
      `INSERT INTO usage_counters (user_id, period, metric, amount) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, period, metric) DO UPDATE SET amount = usage_counters.amount + EXCLUDED.amount RETURNING amount`,
      [userId, period, metric, amount],
    );
    return rows[0].amount as number;
  }

  async getUsage(userId: string, period: string) {
    const { rows } = await this.q('SELECT metric, amount FROM usage_counters WHERE user_id = $1 AND period = $2', [userId, period]);
    return Object.fromEntries(rows.map((r) => [r.metric, r.amount as number]));
  }

  async close() {
    await this.pool.end();
  }
}
