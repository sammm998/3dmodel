import { assertExportAllowed, requireProject } from '@/server/auth';
import { handle, HttpError } from '@/server/http';
import { exportIFC } from '@/core/export/ifc';
import { exportDXF } from '@/core/export/dxf';
import { exportGLB, exportOBJ, exportSTL } from '@/core/export/meshExport';
import '@/server/nodePolyfills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Server-side export of the saved project (untextured materials). */
export const GET = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const format = new URL(req.url).searchParams.get('format') ?? 'glb';
  const { user, project } = await requireProject(req, id);
  if (['glb', 'obj', 'mtl', 'stl', 'ifc', 'dxf'].includes(format)) assertExportAllowed(user, format);
  const base = project.name.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'model';
  const send = (body: BodyInit, type: string, ext: string) =>
    new Response(body, { headers: { 'content-type': type, 'content-disposition': `attachment; filename="${base}.${ext}"` } });
  switch (format) {
    case 'glb':
      return send(await exportGLB(project.scene), 'model/gltf-binary', 'glb');
    case 'stl':
      return send(exportSTL(project.scene), 'model/stl', 'stl');
    case 'obj':
      return send(exportOBJ(project.scene, { mtlFileName: `${base}.mtl` }).obj, 'text/plain', 'obj');
    case 'mtl':
      return send(exportOBJ(project.scene, { mtlFileName: `${base}.mtl` }).mtl, 'text/plain', 'mtl');
    case 'ifc':
      return send(exportIFC(project.scene, { projectName: project.name, projectId: project.id }).content, 'application/x-step', 'ifc');
    case 'dxf':
      return send(exportDXF(project.scene), 'application/dxf', 'dxf');
    default:
      throw new HttpError(400, `Unsupported format "${format}". Supported: glb, obj, mtl, stl, ifc, dxf`);
  }
});
