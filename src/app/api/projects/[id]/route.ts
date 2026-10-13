import { z } from 'zod';
import { getRepository } from '@/server/storage';
import { handle, HttpError, json, readJson } from '@/server/http';
import { Scene } from '@/core/schema/scene';
import { requireProject } from '@/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const ChatMessage = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  text: z.string().max(20000),
  createdAt: z.string(),
  provider: z.string().optional(),
  voice: z.boolean().optional(),
  status: z.enum(['applied', 'proposed', 'cancelled', 'failed', 'info']).optional(),
  summary: z.string().optional(),
});

const UpdateBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  scene: Scene.optional(),
  chat: z.array(ChatMessage).max(500).optional(),
  thumbnail: z
    .string()
    .max(2_000_000)
    .regex(/^data:image\/(png|jpeg|webp);base64,/)
    .nullable()
    .optional(),
});

export const GET = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { project } = await requireProject(req, id);
  return json({ project });
});

export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  await requireProject(req, id);
  const body = UpdateBody.parse(await readJson(req));
  const project = await getRepository().updateProject(id, body);
  if (!project) throw new HttpError(404, 'Project not found');
  return json({ project: { ...project, scene: undefined, chat: undefined } });
});

export const DELETE = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  await requireProject(req, id);
  const ok = await getRepository().deleteProject(id);
  if (!ok) throw new HttpError(404, 'Project not found');
  return json({ ok: true });
});
