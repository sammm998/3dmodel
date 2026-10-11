import { z } from 'zod';
import { getRepository } from '@/server/storage';
import { handle, json, readJson } from '@/server/http';
import { emptyScene, Scene } from '@/core/schema/scene';
import { generateBuilding } from '@/core/generator/generateBuilding';
import { STARTERS } from '@/core/generator/starters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CreateBody = z.object({
  name: z.string().min(1).max(120).default('Untitled project'),
  description: z.string().max(2000).optional(),
  starterId: z.string().optional(),
  scene: Scene.optional(),
});

export const GET = handle(async () => json({ projects: await getRepository().listProjects() }));

export const POST = handle(async (req: Request) => {
  const body = CreateBody.parse(await readJson(req));
  let scene = body.scene ?? emptyScene();
  let description = body.description ?? '';
  if (body.starterId) {
    const starter = STARTERS.find((s) => s.id === body.starterId);
    if (!starter) return json({ error: 'Unknown starter' }, 400);
    scene = generateBuilding(starter.program).scene;
    description = description || starter.description;
  }
  const project = await getRepository().createProject({ name: body.name, description, scene });
  return json({ project }, 201);
});
