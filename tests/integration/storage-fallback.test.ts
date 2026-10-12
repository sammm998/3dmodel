import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { emptyScene } from '@/core/schema/scene';

describe('storage fallback', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (globalThis as { __ai3dRepo?: unknown }).__ai3dRepo;
    vi.resetModules();
  });

  it('falls back to file storage when DATABASE_URL is unreachable and explains why', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://u:p@localhost:5999/db');
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'production');
    vi.stubEnv('DATA_DIR', mkdtempSync(path.join(tmpdir(), 'ai3d-')));
    const { getRepository } = await import('@/server/storage');
    const repo = getRepository();
    const p = await repo.createProject({ name: 'x', scene: emptyScene() });
    expect((await repo.getProject(p.id))?.name).toBe('x');
    const st = await repo.status();
    expect(st.kind).toBe('file');
    expect(st.fallbackReason).toMatch(/localhost.*Railway/);
    expect(st.persistent).toBe(true); // DATA_DIR set
  });

  it('describes empty-message AggregateErrors', async () => {
    const { describeDbError } = await import('@/server/storage');
    const err = new AggregateError([Object.assign(new Error('connect ECONNREFUSED ::1:5432'), { code: 'ECONNREFUSED' }), Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' })], '');
    expect(describeDbError(err, 'postgresql://a:b@db.example.com:5432/x')).toMatch(/connection refused.*ECONNREFUSED/);
  });
});
