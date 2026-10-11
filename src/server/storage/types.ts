import type { Scene } from '@/core/schema/scene';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  createdAt: string;
  provider?: string;
  /** Voice input marker */
  voice?: boolean;
  status?: 'applied' | 'proposed' | 'cancelled' | 'failed' | 'info';
  summary?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  thumbnail: string | null;
  elementCount: number;
  shareToken: string | null;
}

export interface ProjectRecord extends ProjectSummary {
  scene: Scene;
  chat: ChatMessage[];
}

export interface VersionRecord {
  id: string;
  projectId: string;
  label: string;
  createdAt: string;
  thumbnail: string | null;
  elementCount: number;
  scene?: Scene;
}

export interface AssetRecord {
  id: string;
  projectId: string;
  filename: string;
  mime: string;
  size: number;
  kind: 'drawing' | 'reference' | 'model' | 'render';
  createdAt: string;
  storageKey: string;
  analysis: unknown | null;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  scene: Scene;
  thumbnail?: string | null;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  scene?: Scene;
  chat?: ChatMessage[];
  thumbnail?: string | null;
}

export interface Repository {
  readonly kind: 'postgres' | 'file';
  listProjects(): Promise<ProjectSummary[]>;
  getProject(id: string): Promise<ProjectRecord | null>;
  createProject(input: CreateProjectInput): Promise<ProjectRecord>;
  updateProject(id: string, patch: UpdateProjectInput): Promise<ProjectRecord | null>;
  deleteProject(id: string): Promise<boolean>;
  listVersions(projectId: string): Promise<VersionRecord[]>;
  createVersion(projectId: string, label: string, scene: Scene, thumbnail: string | null): Promise<VersionRecord>;
  getVersion(projectId: string, versionId: string): Promise<VersionRecord | null>;
  setShareToken(projectId: string, token: string | null): Promise<void>;
  getProjectByShareToken(token: string): Promise<ProjectRecord | null>;
  listAssets(projectId: string): Promise<AssetRecord[]>;
  createAsset(asset: Omit<AssetRecord, 'id' | 'createdAt'>): Promise<AssetRecord>;
  getAsset(id: string): Promise<AssetRecord | null>;
  updateAssetAnalysis(id: string, analysis: unknown): Promise<void>;
  deleteAsset(id: string): Promise<boolean>;
}
