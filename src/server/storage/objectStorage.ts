/**
 * Object storage for binary assets (uploaded drawings, renders).
 * Local filesystem implementation; the interface matches what an S3/GCS
 * adapter would provide.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface ObjectStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export class LocalObjectStorage implements ObjectStorage {
  constructor(private root: string) {}
  private file(key: string) {
    const safe = key.replace(/[^a-zA-Z0-9/_.-]/g, '_').replace(/\.\.+/g, '_');
    return path.join(this.root, safe);
  }
  async put(key: string, data: Buffer) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, data);
  }
  async get(key: string) {
    try {
      return await readFile(this.file(key));
    } catch {
      return null;
    }
  }
  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
}

let storage: ObjectStorage | null = null;
export function getObjectStorage(): ObjectStorage {
  if (!storage) storage = new LocalObjectStorage(process.env.OBJECT_STORAGE_DIR ?? path.join(process.cwd(), 'data', 'objects'));
  return storage;
}
