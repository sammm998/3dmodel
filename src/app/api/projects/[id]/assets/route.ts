import { nanoid } from 'nanoid';
import { getRepository } from '@/server/storage';
import { getObjectStorage } from '@/server/storage/objectStorage';
import { handle, HttpError, json } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = /^(image\/(png|jpeg|webp|gif)|application\/pdf|application\/dxf|image\/vnd\.dxf|application\/octet-stream|text\/plain)$/;

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return json({ assets: await getRepository().listAssets(id) });
});

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const repo = getRepository();
  if (!(await repo.getProject(id))) throw new HttpError(404, 'Project not found');
  const form = await req.formData();
  const file = form.get('file');
  const kind = (form.get('kind') as string) || 'drawing';
  if (!(file instanceof File)) throw new HttpError(400, 'Missing file');
  if (file.size > MAX_BYTES) throw new HttpError(413, 'File too large (max 25 MB)');
  const isDxf = /\.dxf$/i.test(file.name);
  const mime = isDxf ? 'application/dxf' : file.type || 'application/octet-stream';
  if (!ALLOWED.test(mime)) throw new HttpError(415, `Unsupported file type ${mime}`);
  if (!['drawing', 'reference', 'model', 'render'].includes(kind)) throw new HttpError(400, 'Invalid kind');
  const key = `projects/${id}/${nanoid(10)}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  await getObjectStorage().put(key, Buffer.from(await file.arrayBuffer()), mime);
  const asset = await repo.createAsset({ projectId: id, filename: file.name, mime, size: file.size, kind: kind as 'drawing', storageKey: key, analysis: null });
  return json({ asset }, 201);
});
