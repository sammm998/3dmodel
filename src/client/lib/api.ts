import type { Scene } from '@/core/schema/scene';
import type { AssetRecord, ChatMessage, ProjectRecord, ProjectSummary, VersionRecord } from '@/server/storage/types';

async function req<T>(url: string, init?: RequestInit, timeoutMs = 30_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal, headers: { ...(init?.body && !(init.body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...(init?.headers ?? {}) } });
  } catch (e) {
    throw new Error((e as Error).name === 'AbortError' ? `The server did not respond within ${timeoutMs / 1000} s (${url}). Check /api/health.` : `Network error: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { message?: string; error?: string }).message ?? (data as { error?: string }).error ?? `Request failed (${res.status})`) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = (data as { error?: string }).error;
    throw err;
  }
  return data as T;
}

export const api = {
  listProjects: () => req<{ projects: ProjectSummary[] }>('/api/projects'),
  createProject: (body: { name: string; description?: string; starterId?: string; scene?: Scene }) =>
    req<{ project: ProjectRecord }>('/api/projects', { method: 'POST', body: JSON.stringify(body) }),
  getProject: (id: string) => req<{ project: ProjectRecord }>(`/api/projects/${id}`),
  updateProject: (id: string, body: { name?: string; scene?: Scene; chat?: ChatMessage[]; thumbnail?: string | null; description?: string }) =>
    req<{ project: ProjectSummary }>(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteProject: (id: string) => req<{ ok: true }>(`/api/projects/${id}`, { method: 'DELETE' }),
  listVersions: (id: string) => req<{ versions: VersionRecord[] }>(`/api/projects/${id}/versions`),
  createVersion: (id: string, label: string, scene: Scene, thumbnail: string | null) =>
    req<{ version: VersionRecord }>(`/api/projects/${id}/versions`, { method: 'POST', body: JSON.stringify({ label, scene, thumbnail }) }),
  getVersion: (id: string, vid: string) => req<{ version: VersionRecord }>(`/api/projects/${id}/versions/${vid}`),
  share: (id: string) => req<{ token: string; path: string }>(`/api/projects/${id}/share`, { method: 'POST' }),
  unshare: (id: string) => req<{ ok: true }>(`/api/projects/${id}/share`, { method: 'DELETE' }),
  getShared: (token: string) => req<{ project: { id: string; name: string; description: string; updatedAt: string; scene: Scene } }>(`/api/share/${token}`),
  listAssets: (id: string) => req<{ assets: AssetRecord[] }>(`/api/projects/${id}/assets`),
  uploadAsset: (id: string, file: File, kind = 'drawing') => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', kind);
    return req<{ asset: AssetRecord }>(`/api/projects/${id}/assets`, { method: 'POST', body: fd });
  },
  saveAssetAnalysis: (aid: string, analysis: unknown) => req<{ ok: true }>(`/api/assets/${aid}`, { method: 'PATCH', body: JSON.stringify({ analysis }) }),
  deleteAsset: (aid: string) => req<{ ok: true }>(`/api/assets/${aid}`, { method: 'DELETE' }),
  aiStatus: () =>
    req<{ configured: boolean; provider: string | null; model: string | null; vision: boolean; serverSpeechToText: boolean; serverTextToSpeech: boolean }>('/api/ai/status'),
};
