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

export type PlanId = 'free' | 'pro' | 'studio';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  plan: PlanId;
  /** Stripe subscription status (active, trialing, past_due, canceled, …) or null. */
  planStatus: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  createdAt: string;
}

export type UserPatch = Partial<Omit<UserRecord, 'id' | 'createdAt'>>;

export interface SessionRecord {
  userId: string;
  expiresAt: string;
}

export interface ProjectSummary {
  id: string;
  /** Owning account (null only for projects created before accounts existed). */
  ownerId: string | null;
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
  ownerId?: string | null;
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
  /** Projects of one owner (all projects when ownerId is undefined). */
  listProjects(ownerId?: string): Promise<ProjectSummary[]>;
  countProjects(ownerId: string): Promise<number>;
  /** Assigns projects without an owner (created before accounts) to this user. */
  claimOrphanProjects(ownerId: string): Promise<number>;
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

  countUsers(): Promise<number>;
  createUser(input: { email: string; name: string; passwordHash: string; plan?: PlanId }): Promise<UserRecord>;
  getUserById(id: string): Promise<UserRecord | null>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  getUserByStripeCustomer(customerId: string): Promise<UserRecord | null>;
  updateUser(id: string, patch: UserPatch): Promise<UserRecord | null>;
  /** Deletes the account with its sessions, usage, projects, versions and asset records. */
  deleteUser(id: string): Promise<void>;

  createSession(tokenHash: string, userId: string, expiresAt: Date): Promise<void>;
  getSession(tokenHash: string): Promise<SessionRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;

  /** Adds `amount` to a usage counter for a billing period ("2026-10") and returns the new total. */
  incrementUsage(userId: string, period: string, metric: string, amount: number): Promise<number>;
  getUsage(userId: string, period: string): Promise<Record<string, number>>;
}
