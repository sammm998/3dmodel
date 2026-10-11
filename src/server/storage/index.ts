import path from 'node:path';
import { FileRepository } from './fileRepository';
import { PostgresRepository } from './postgresRepository';
import type { Repository } from './types';

const g = globalThis as unknown as { __ai3dRepo?: Repository };

/** PostgreSQL when DATABASE_URL is set, otherwise a local JSON file store. */
export function getRepository(): Repository {
  if (!g.__ai3dRepo) {
    const url = process.env.DATABASE_URL;
    g.__ai3dRepo = url ? PostgresRepository.fromUrl(url) : new FileRepository(process.env.DATA_DIR ?? path.join(process.cwd(), 'data'));
  }
  return g.__ai3dRepo;
}

export type * from './types';
