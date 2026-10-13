import { z } from 'zod';
import { getRepository } from '@/server/storage';
import { handle, json, readJson } from '@/server/http';
import { Scene } from '@/core/schema/scene';
import { requireProject } from '@/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ label: z.string().min(1).max(120), scene: Scene.optional(), thumbnail: z.string().max(2_000_000).nullable().optional() });

export const GET = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  await requireProject(req, id);
  return json({ versions: await getRepository().listVersions(id) });
});

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { project } = await requireProject(req, id);
  const body = Body.parse(await readJson(req));
  const repo = getRepository();
  const version = await repo.createVersion(id, body.label, body.scene ?? project.scene, body.thumbnail ?? project.thumbnail);
  return json({ version }, 201);
});
